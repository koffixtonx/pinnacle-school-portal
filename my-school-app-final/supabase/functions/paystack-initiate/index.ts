import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json, preflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_CALLBACK_URL = Deno.env.get("PAYSTACK_CALLBACK_URL") ?? "";

/**
 * paystack-initiate — opens a Paystack checkout session for one invoice.
 *
 * Deploy with:
 *   supabase functions deploy paystack-initiate --no-verify-jwt
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * PAYSTACK_SECRET_KEY (live or test), PAYSTACK_CALLBACK_URL.
 *
 * Two clients, because the two writes need two different identities:
 * `begin_payment` insists on a signed-in caller (it is what enforces "you can
 * only pay your own invoices"), so it runs on the student's own token;
 * `mark_payment_started` refuses any token at all, because only the service may
 * say a session reached Paystack, so it runs on the service-role key.
 *
 * The secret key never reaches the browser: the client sends an invoice id and
 * gets an authorization URL back, which it opens. Recording the money is the
 * webhook's job alone.
 */
Deno.serve(async (req: Request) {
  if (preflight(req)) return preflight(req)!;
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in to make a payment." });

  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: me, error: meError } = await user.auth.getUser();
  if (meError || !me.user) return json(401, { error: "Your session expired. Please sign in again." });

  let body: { invoiceId?: string; email?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Send the invoice to pay as JSON." });
  }

  const invoiceId = String(body.invoiceId ?? "");
  if (!invoiceId) return json(400, { error: "Tell us which invoice you want to pay." });

  const { data: session, error: beginError } = await user.rpc("begin_payment", {
    p_invoice_id: invoiceId,
    p_email: body.email ? String(body.email) : null,
    p_amount: typeof body.amount === "number" ? body.amount : null,
  });
  if (beginError) return json(400, { error: friendly(beginError.message) });

  const attempt = (session ?? {}) as {
    reference?: string;
    amount?: number;
    currency?: string;
    email?: string;
    authorizationUrl?: string | null;
  };
  if (!attempt.reference) return json(500, { error: "The checkout session could not be opened. Please try again." });

  // A session that already reached Paystack keeps its authorization URL, so a
  // student who reloads checkout returns to the same payment instead of
  // stacking up references for the same money.
  if (attempt.authorizationUrl) {
    return json(200, { reference: attempt.reference, authorizationUrl: attempt.authorizationUrl });
  }

  let gateway: Response;
  try {
    gateway = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: attempt.email,
        // Paystack charges in the smallest unit; the portal stores naira.
        amount: Math.round(Number(attempt.amount ?? 0) * 100),
        currency: attempt.currency ?? "NGN",
        reference: attempt.reference,
        callback_url: PAYSTACK_CALLBACK_URL,
        metadata: { invoice_id: invoiceId, student_id: me.user.id },
      }),
    });
  } catch {
    // The session stays PENDING, which begin_payment will hand back on the next
    // attempt instead of opening a second one for the same money.
    return json(502, { error: "The payment gateway is not responding. Please try again in a moment." });
  }

  const initialized = await gateway.json().catch(() => null);
  if (!initialized?.status || !initialized?.data?.authorization_url) {
    return json(502, {
      error: String(initialized?.message ?? "Paystack refused the payment request. Please try again."),
    });
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: startedError } = await service.rpc("mark_payment_started", {
    p_reference: attempt.reference,
    p_paystack_tx_id: String(initialized.data.id ?? attempt.reference),
    p_authorization_url: initialized.data.authorization_url,
  });
  if (startedError) {
    console.error("mark_payment_started failed", startedError.message);
    // The URL is still valid for this reference, so the student can pay; the
    // webhook matches on the reference, not on what we stored here.
  }

  return json(200, { reference: attempt.reference, authorizationUrl: initialized.data.authorization_url });
});

/** Postgres messages are precise but not kind; the student gets a sentence. */
function friendly(message: string): string {
  if (/duplicate key|already exists/i.test(message)) {
    return "That payment is already in progress. Open your fees page to continue it.";
  }
  return message;
}
