/**
 * Shared between the Paystack Edge Functions.
 *
 * The browser calls these with `supabase.functions.invoke`, which sends an
 * `Authorization` header and therefore a CORS preflight. The functions are
 * deployed `--no-verify-jwt`, so they answer the preflight themselves and check
 * the token they were handed.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders });
}

/** A JSON body plus CORS, so a failure still reaches the caller's `error.message`. */
export function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Paystack delivers the same event until it sees a 2xx, so a webhook must never
 * answer 500 for a problem that retrying cannot fix.
 */
export function accepted(message: string): Response {
  return json(200, { status: "ok", message });
}
