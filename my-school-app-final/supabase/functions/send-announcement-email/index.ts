import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { json, preflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_ADDRESS = Deno.env.get("ANNOUNCEMENT_FROM_ADDRESS") ?? "";
const WORKER_SECRET = Deno.env.get("ANNOUNCEMENT_WORKER_SECRET") ?? "";

/**
 * send-announcement-email — drains the mail outbox 0013 fills.
 *
 * Deploy with:
 *   supabase functions deploy send-announcement-email --no-verify-jwt
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * RESEND_API_KEY, ANNOUNCEMENT_FROM_ADDRESS (e.g. "Pinnacle University
 * <notices@pinnacle.edu>"), and optionally ANNOUNCEMENT_WORKER_SECRET.
 * Run it on a schedule, or call it from an administrator's session:
 *   curl -X POST $URL/functions/v1/send-announcement-email \
 *        -H "Authorization: Bearer $WORKER_SECRET_OR_AN_ADMIN_JWT"
 *
 * Two identities again, exactly as in 0010: the caller proves who they are with
 * their own token, while the queue itself is only reachable through the service
 * role, because claim_email_deliveries and record_email_delivery both refuse a
 * request that carries a user id. So the browser can never mark its own mail as
 * sent, and a notice cannot be delivered by writing a row by hand.
 *
 * The answer is counts, never addresses. Whatever else goes wrong here, this
 * endpoint must not become a way to read the school's family mailing list.
 */
Deno.serve(async (req: Request) => {
  const crossed = preflight(req);
  if (crossed) return crossed;
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  if (!RESEND_API_KEY || !FROM_ADDRESS) {
    return json(500, { error: "Email delivery is not configured on this server yet." });
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return json(401, { error: "Sign in, or send the worker key." });

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // A scheduled ping holds no user session, so it proves itself with the shared
  // secret instead. Anything else has to be a signed-in administrator.
  if (WORKER_SECRET && bearer === WORKER_SECRET) {
    return await drain(service);
  }

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: me, error: meError } = await caller.auth.getUser();
  if (meError || !me.user) return json(401, { error: "That session is not valid any more." });

  const { data: profile } = await caller
    .from("profiles")
    .select("role")
    .eq("id", me.user.id)
    .maybeSingle();
  if (profile?.role !== "SUPER_ADMIN" && profile?.role !== "SCHOOL_ADMIN") {
    return json(403, { error: "Only the school office may send announcements." });
  }

  return await drain(service);
});

/** Take one batch off the queue, send it, and write down what happened. */
async function drain(service: ReturnType<typeof createClient>) {
  const { data: claimed, error: claimError } = await service.rpc("claim_email_deliveries", {
    p_limit: 20,
  });
  if (claimError) return json(500, { error: friendly(claimError.message) });

  const rows = (claimed ?? []) as Array<{
    id: string;
    to_address: string;
    subject: string;
    body: string;
    attempts: number;
  }>;

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await send(row.to_address, row.subject, row.body);
    if (result.ok) {
      sent += 1;
      await service.rpc("record_email_delivery", {
        p_id: row.id,
        p_status: "SENT",
        p_provider_id: result.id ?? null,
      });
    } else {
      failed += 1;
      // The reason goes on the row, because it is what the administrator reads
      // from the delivery report when a family says nothing arrived.
      await service.rpc("record_email_delivery", {
        p_id: row.id,
        p_status: "FAILED",
        p_error: result.error ?? "The mail service did not answer.",
      });
    }
  }

  return json(200, { claimed: rows.length, sent, failed });
}

async function send(
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to,
        subject,
        html: render(body),
      }),
    });
  } catch {
    return { ok: false, error: "The mail service is not reachable." };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: String(payload?.message ?? `The mail service refused the message (${response.status}).`) };
  }
  return { ok: true, id: payload?.id ? String(payload.id) : undefined };
}

/**
 * A notice is plain text with blank lines between paragraphs. It is escaped
 * first, so a title written in the compose screen cannot become markup in a
 * family's inbox.
 */
function render(body: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px;line-height:1.6">${escape(block).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** Postgres is precise about why it refused; the caller gets a sentence. */
function friendly(message: string): string {
  if (/delivery worker/i.test(message)) return "Only the delivery worker may claim mail.";
  return message;
}
