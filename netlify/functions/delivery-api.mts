import type { Config, Context } from "@netlify/functions";

// Customer delivery endpoint. Validates a delivery token and returns
// short-lived signed URLs for the finished headshots. Rate-limited per IP;
// invalid/expired tokens all return the same 404 shape (no detail leaks).

const DELIVERIES = "headshot-deliveries";

const env = (k: string) => Netlify.env.get(k) || "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const dbHeaders = () => ({
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
  Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
  "Content-Type": "application/json",
});

async function rateLimitOk(kind: string, ip: string, max: number, windowMinutes: number): Promise<boolean> {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/rate_limit_ok`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify({ p_kind: kind, p_ip: ip, p_max: max, p_window_minutes: windowMinutes }),
  });
  if (!res.ok) return true;
  return (await res.json()) === true;
}
async function logFailure(kind: string, ip: string) {
  await fetch(`${env("SUPABASE_URL")}/rest/v1/access_attempts`, {
    method: "POST",
    headers: { ...dbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ kind, ip, ok: false }),
  }).catch(() => {});
}

export default async (req: Request, context: Context) => {
  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  const expired = () => json({ error: "expired" }, 404);

  if (!(await rateLimitOk("delivery", ip, 30, 10))) {
    return json({ error: "rate" }, 429);
  }

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) {
    await logFailure("delivery", ip);
    return expired();
  }

  try {
    const res = await fetch(
      `${env("SUPABASE_URL")}/rest/v1/delivery_links?token=eq.${token}&select=order_key,customer_name,expires_at,revoked&limit=1`,
      { headers: dbHeaders() }
    );
    const rows = res.ok ? await res.json() : [];
    const row = rows[0];
    if (!row || row.revoked || new Date(row.expires_at) <= new Date()) {
      await logFailure("delivery", ip);
      return expired();
    }

    const listRes = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/list/${DELIVERIES}`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({ prefix: `orders/${row.order_key}`, limit: 100, sortBy: { column: "name", order: "asc" } }),
    });
    const entries = listRes.ok
      ? ((await listRes.json()) as Array<{ name: string; id: string | null }>).filter((e) => e.id !== null)
      : [];
    if (!entries.length) {
      await logFailure("delivery", ip);
      return expired();
    }

    const paths = entries.map((e) => `orders/${row.order_key}/${e.name}`);
    const signRes = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/sign/${DELIVERIES}`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({ expiresIn: 3600, paths }),
    });
    if (!signRes.ok) return json({ error: "unavailable" }, 502);
    const signed = (await signRes.json()) as Array<{ path: string; signedURL?: string }>;

    const files = signed
      .filter((s) => s.signedURL)
      .map((s, i) => {
        const base = `${env("SUPABASE_URL")}/storage/v1${s.signedURL}`;
        const ext = (s.path.split(".").pop() || "jpg").toLowerCase();
        const nice = `MVM-Headshot-${String(i + 1).padStart(2, "0")}.${ext}`;
        return { name: nice, previewUrl: base, downloadUrl: `${base}&download=${encodeURIComponent(nice)}` };
      });

    const firstName = (row.customer_name || "").trim().split(/\s+/)[0] || "";
    return json({ firstName, files, expiresAt: row.expires_at });
  } catch (err) {
    console.error("delivery-api error:", err);
    return json({ error: "unavailable" }, 502);
  }
};

export const config: Config = {
  path: "/api/delivery",
};
