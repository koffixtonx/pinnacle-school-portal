import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { accepted, corsHeaders, json, preflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

/**
 * paystack-webhook — the only thing in this portal that can mark an invoice
 * paid.
 *
 * Deploy with:
 *   supabase functions deploy paystack-webhook --no-verify-jwt
 * then point the Paystack dashboard at the printed URL and set the live
 * signing secret as PAYSTACK_SECRET_KEY.
 *
 * Nothing here is trusted until the HMAC over the exact bytes Paystack sent
 * matches the signing secret, so a request that did not come from Paystack
 * cannot credit anybody. `confirm_payment_success` then does the rest in one
 * transaction: it dedupes on the event id, refuses an amount that does not
 * match the checkout session, and writes the ledger row whose trigger moves the
 * invoice. The function holds the service-role key, so it is the only caller
 * that can satisfy those RPCs' "no token attached" rule.
 */
Deno.serve(async (req: Request) => {
  if (preflight(req)) return preflight(req)!;
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  if (!(await verify(raw, signature))) {
    console.warn("Rejected a Paystack webhook whose signature did not match");
    return json(401, { error: "Invalid signature." });
  }

  let body: PaystackEvent;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Expected a JSON payload." });
  }

  const reference = String(body.data?.reference ?? "");
  if (!reference) return accepted("Ignored an event with no checkout reference.");

  // One id per delivery, so Paystack retrying the same event can never credit
  // the same money twice.
  const eventId = `paystack-${body.id ?? `${body.event}-${body.data?.id ?? reference}`}`;
  const amount = Number(body.data?.amount ?? 0) / 100;
  const transactionId = body.data?.id != null ? String(body.data.id) : null;

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (SUCCESS_EVENTS.has(body.event)) {
    const { data, error } = await service.rpc("confirm_payment_success", {
      p_reference: reference,
      p_event_id: eventId,
      p_event: body.event,
      p_paystack_tx_id: transactionId,
      p_amount: amount,
      p_payload: body,
    });
    if (error) {
      // A database problem is worth retrying, so Paystack is told it failed.
      console.error("confirm_payment_success failed", error.message);
      return json(500, { error: "Could not record the payment. Paystack will retry." });
    }
    const result = (data ?? {}) as { credited?: boolean; duplicate?: boolean; problem?: string };
    if (result.credited) return accepted(`Credited ${reference}.`);
    if (result.duplicate) return accepted(`Already recorded: ${reference}.`);
    // A refusal (wrong amount, session closed) will not fix itself on retry.
    console.error("Payment refused", reference, result.problem);
    return accepted(`Not credited: ${result.problem ?? "the checkout session does not match."}`);
  }

  if (FAILURE_EVENTS.has(body.event)) {
    const { error } = await service.rpc("mark_payment_failed", {
      p_reference: reference,
      p_reason: String(body.data?.message ?? "The card was declined."),
      p_event_id: eventId,
      p_event: body.event,
      p_payload: body,
    });
    if (error) {
      console.error("mark_payment_failed failed", error.message);
      return json(500, { error: "Could not record the failure. Paystack will retry." });
    }
    return accepted(`Marked failed: ${reference}.`);
  }

  return accepted(`Ignored ${body.event}.`);
});

const SUCCESS_EVENTS = new Set(["charge.success", "payment.success", "subscription.create"]);
const FAILURE_EVENTS = new Set(["charge.failed", "payment.failed"]);

interface PaystackEvent {
  event: string;
  id?: number;
  data?: { reference?: string; id?: number; amount?: number; message?: string };
}

async function verify(raw: string, signature: string): Promise<boolean> {
  if (!PAYSTACK_SECRET_KEY || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = [...signed].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  // Compare without short-circuiting, so the secret is not discoverable by
  // timing how early the check gives up.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
