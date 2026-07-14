import type { Config } from "@netlify/functions";

// Runs daily. Deletes each order's reference photos 7 days after upload,
// enforcing the "photos deleted within 7 days of delivery" promise on the site
// (delivery is within 48h of upload, so upload + 7 days is always inside it).

const BUCKET = "headshot-uploads";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export default async () => {
  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("cleanup-uploads: storage env not configured");
    return new Response("not configured", { status: 500 });
  }

  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const list = async (prefix: string) => {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list ${prefix}: ${res.status} ${await res.text()}`);
    return (await res.json()) as Array<{ name: string; id: string | null; created_at?: string }>;
  };

  const cutoff = Date.now() - MAX_AGE_MS;
  const folders = (await list("orders")).filter((e) => e.id === null); // folders only
  let deletedFolders = 0, deletedFiles = 0;

  for (const folder of folders) {
    const files = (await list(`orders/${folder.name}`)).filter((e) => e.id !== null);
    if (files.length === 0) continue;
    // Delete only when the NEWEST file in the order is past the cutoff, so a
    // late re-upload keeps the whole order alive.
    const newest = Math.max(...files.map((f) => new Date(f.created_at || 0).getTime()));
    if (newest > cutoff) continue;

    const prefixes = files.map((f) => `orders/${folder.name}/${f.name}`);
    const del = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ prefixes }),
    });
    if (!del.ok) {
      console.error(`cleanup-uploads: delete failed for ${folder.name}: ${del.status} ${await del.text()}`);
      continue;
    }
    deletedFolders++;
    deletedFiles += prefixes.length;
  }

  console.log(`cleanup-uploads: removed ${deletedFiles} file(s) across ${deletedFolders} expired order(s); ${folders.length} order folder(s) scanned`);
  return new Response("ok");
};

export const config: Config = {
  schedule: "@daily",
};
