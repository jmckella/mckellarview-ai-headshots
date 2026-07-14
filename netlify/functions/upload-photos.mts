import type { Context } from "@netlify/functions";

// Issues short-lived signed upload URLs so the browser uploads reference
// photos DIRECTLY to private Supabase storage. This bypasses the ~6MB
// Netlify function body limit that the old multipart passthrough hit with
// multiple phone photos. Constraints are validated here and enforced again
// by the bucket itself (10MB cap, image MIME allowlist, private, no anon
// policies — files are only readable via server-side signed URLs).

const BUCKET = "headshot-uploads";
const MAX_FILES = 3;
const MAX_SIZE = 10 * 1024 * 1024;
const SAFE_ORDER = /^[A-Za-z0-9_-]{4,60}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    // Service role key stays server-side; the browser only ever sees
    // single-use, path-scoped upload tokens.
    const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ error: "Storage not configured" }, 500);
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "Bad request" }, 400);

    const orderId = SAFE_ORDER.test(String(body.orderId || "")) ? String(body.orderId) : `order_${Date.now()}`;
    const files = (Array.isArray(body.files) ? body.files : []).slice(0, MAX_FILES);
    if (!files.length) return json({ error: "No files provided" }, 400);

    const uploads: Array<{ path: string; uploadUrl: string }> = [];
    const errors: string[] = [];

    for (const f of files) {
      const type = String(f.type || "");
      const size = Number(f.size || 0);
      const rawName = String(f.name || "photo.jpg");
      if (!type.startsWith("image/")) { errors.push(`${rawName}: not an image`); continue; }
      if (!size || size > MAX_SIZE) { errors.push(`${rawName}: over the 10MB limit`); continue; }

      const ext = (rawName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
      const path = `orders/${orderId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const res = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("upload-photos sign error:", res.status, err);
        errors.push(`${rawName}: storage error`);
        continue;
      }
      const { url: signed } = await res.json();
      uploads.push({ path, uploadUrl: `${supabaseUrl}/storage/v1${signed}` });
    }

    return json({
      success: uploads.length > 0,
      orderId,
      uploads,
      paths: uploads.map((u) => u.path),
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error("Upload function error:", err);
    return json({ error: "Upload failed. Please try again." }, 500);
  }
};

export const config = {
  path: "/api/upload-photos",
};
