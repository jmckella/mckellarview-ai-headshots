import type { Config, Context } from "@netlify/functions";

// Admin API for order fulfillment. Every route requires the x-admin-passcode
// header, verified server-side against ADMIN_PASSCODE with a constant-time
// comparison and per-IP rate limiting (Postgres-backed).

const UPLOADS = "headshot-uploads";
const DELIVERIES = "headshot-deliveries";
const LINK_TTL_DAYS = 30;

const env = (k: string) => Netlify.env.get(k) || "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
async function passcodeOk(supplied: string | null): Promise<boolean> {
  const expected = env("ADMIN_PASSCODE");
  if (!expected || !supplied) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

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
  if (!res.ok) return true; // fail open on limiter infra errors, closed on auth itself
  return (await res.json()) === true;
}
async function logFailure(kind: string, ip: string) {
  await fetch(`${env("SUPABASE_URL")}/rest/v1/access_attempts`, {
    method: "POST",
    headers: { ...dbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ kind, ip, ok: false }),
  }).catch(() => {});
}

async function storageList(bucket: string, prefix: string) {
  const res = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify({ prefix, limit: 200, sortBy: { column: "created_at", order: "asc" } }),
  });
  if (!res.ok) return [];
  const entries = (await res.json()) as Array<{ name: string; id: string | null; created_at?: string }>;
  return entries.filter((e) => e.id !== null);
}

async function signPaths(bucket: string, paths: string[], expiresIn: number) {
  if (!paths.length) return [];
  const res = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/sign/${bucket}`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify({ expiresIn, paths }),
  });
  if (!res.ok) return [];
  const out = (await res.json()) as Array<{ path: string; signedURL?: string; error?: string }>;
  return out
    .filter((o) => o.signedURL)
    .map((o) => ({ path: o.path, url: `${env("SUPABASE_URL")}/storage/v1${o.signedURL}` }));
}

const SAFE_KEY = /^[A-Za-z0-9_-]{4,80}$/;
const safeName = (n: string) => (n.split("/").pop() || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);

function orderKeyFromSession(s: any): string {
  try {
    const raw = s.metadata?.photo_urls;
    if (raw && raw !== "pending_email") {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && typeof arr[0] === "string") {
        const seg = arr[0].split("/");
        if (seg[0] === "orders" && SAFE_KEY.test(seg[1])) return seg[1];
      }
    }
  } catch { /* fall through */ }
  return s.id;
}

const stripeHeaders = () => ({ Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` });

function sessionSummary(s: any) {
  return {
    id: s.id,
    orderKey: orderKeyFromSession(s),
    created: s.created,
    name: s.metadata?.customer_name || s.customer_details?.name || "",
    email: s.customer_details?.email || s.customer_email || "",
    amount: s.amount_total,
    currency: s.currency,
    paymentStatus: s.payment_status,
    sessionStatus: s.status,
    style: s.metadata?.style || "",
    background: s.metadata?.background || "",
    notes: s.metadata?.notes || "",
    photosUploaded: !!(s.metadata?.photo_urls && s.metadata.photo_urls !== "pending_email"),
    livemode: s.livemode,
  };
}

export default async (req: Request, context: Context) => {
  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";

  if (!(await rateLimitOk("admin", ip, 10, 10))) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }
  if (!(await passcodeOk(req.headers.get("x-admin-passcode")))) {
    await logFailure("admin", ip);
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const route = url.pathname.replace(/\/$/, "");

  try {
    if (route === "/api/admin/verify") return json({ ok: true });

    if (route === "/api/admin/orders" && req.method === "GET") {
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=100", { headers: stripeHeaders() });
      if (!res.ok) return json({ error: "Stripe list failed" }, 502);
      const data = await res.json();
      const orders = (data.data as any[]).map(sessionSummary)
        .sort((a, b) => b.created - a.created);
      return json({ orders });
    }

    if (route === "/api/admin/order" && req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: "Bad id" }, 400);
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: stripeHeaders() });
      if (!res.ok) return json({ error: "Order not found" }, 404);
      const s = await res.json();
      const order = sessionSummary(s);

      const refFiles = await storageList(UPLOADS, `orders/${order.orderKey}`);
      const refs = await signPaths(UPLOADS, refFiles.map((f) => `orders/${order.orderKey}/${f.name}`), 3600);

      const delFiles = await storageList(DELIVERIES, `orders/${order.orderKey}`);
      const deliveries = await signPaths(DELIVERIES, delFiles.map((f) => `orders/${order.orderKey}/${f.name}`), 3600);

      const linkRes = await fetch(
        `${env("SUPABASE_URL")}/rest/v1/delivery_links?order_key=eq.${encodeURIComponent(order.orderKey)}&revoked=is.false&order=created_at.desc&limit=1`,
        { headers: dbHeaders() }
      );
      const rows = linkRes.ok ? await linkRes.json() : [];
      const active = rows[0];
      const link = active && new Date(active.expires_at) > new Date()
        ? { url: `https://headshots.motionvisualmedia.com/delivery?token=${active.token}`, expiresAt: active.expires_at }
        : null;

      return json({ order, referencePhotos: refs, deliveredPhotos: deliveries, deliveryLink: link });
    }

    if (route === "/api/admin/sign-uploads" && req.method === "POST") {
      const body = await req.json();
      const orderKey = String(body.orderKey || "");
      if (!SAFE_KEY.test(orderKey)) return json({ error: "Bad order key" }, 400);
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, 20);
      const out: Array<{ name: string; path: string; uploadUrl: string }> = [];
      for (const f of files) {
        const name = safeName(String(f.name || "photo.jpg"));
        const path = `orders/${orderKey}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${name}`;
        const res = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/upload/sign/${DELIVERIES}/${path}`, {
          method: "POST",
          headers: dbHeaders(),
          body: JSON.stringify({}),
        });
        if (!res.ok) return json({ error: `Could not sign upload for ${name}: ${res.status} ${(await res.text()).slice(0, 200)}` }, 502);
        const { url: signed } = await res.json();
        out.push({ name, path, uploadUrl: `${env("SUPABASE_URL")}/storage/v1${signed}` });
      }
      return json({ uploads: out });
    }

    if (route === "/api/admin/generate-link" && req.method === "POST") {
      const body = await req.json();
      const orderKey = String(body.orderKey || "");
      if (!SAFE_KEY.test(orderKey)) return json({ error: "Bad order key" }, 400);
      const customerName = String(body.customerName || "").slice(0, 120);

      const delivered = await storageList(DELIVERIES, `orders/${orderKey}`);
      if (!delivered.length) return json({ error: "Upload finished photos before generating a link" }, 400);

      // Revoke any previous link for this order, then mint a fresh token
      await fetch(`${env("SUPABASE_URL")}/rest/v1/delivery_links?order_key=eq.${encodeURIComponent(orderKey)}&revoked=is.false`, {
        method: "PATCH",
        headers: { ...dbHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ revoked: true }),
      });

      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const ins = await fetch(`${env("SUPABASE_URL")}/rest/v1/delivery_links`, {
        method: "POST",
        headers: { ...dbHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ order_key: orderKey, token, customer_name: customerName, expires_at: expiresAt }),
      });
      if (!ins.ok) return json({ error: "Could not store link" }, 502);

      return json({ url: `https://headshots.motionvisualmedia.com/delivery?token=${token}`, expiresAt });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("admin-api error:", err);
    return json({ error: "Server error" }, 500);
  }
};

export const config: Config = {
  path: "/api/admin/*",
};
