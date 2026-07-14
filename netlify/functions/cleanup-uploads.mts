import type { Config } from "@netlify/functions";

// Runs daily. Enforces the site's privacy promises:
//  - reference photos (headshot-uploads): deleted 7 days after upload
//  - finished headshots (headshot-deliveries): deleted 30 days after upload
//  - stale delivery-link tokens: rows removed once 7 days past expiry

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKETS: Array<{ bucket: string; maxAgeMs: number }> = [
  { bucket: "headshot-uploads", maxAgeMs: 7 * DAY_MS },
  { bucket: "headshot-deliveries", maxAgeMs: 30 * DAY_MS },
];

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

  const list = async (bucket: string, prefix: string) => {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
    return (await res.json()) as Array<{ name: string; id: string | null; created_at?: string }>;
  };

  for (const { bucket, maxAgeMs } of BUCKETS) {
    const cutoff = Date.now() - maxAgeMs;
    const folders = (await list(bucket, "orders")).filter((e) => e.id === null); // folders only
    let deletedFolders = 0, deletedFiles = 0;

    for (const folder of folders) {
      const files = (await list(bucket, `orders/${folder.name}`)).filter((e) => e.id !== null);
      if (files.length === 0) continue;
      // Delete only when the NEWEST file in the order is past the cutoff, so a
      // late re-upload keeps the whole order alive.
      const newest = Math.max(...files.map((f) => new Date(f.created_at || 0).getTime()));
      if (newest > cutoff) continue;

      const prefixes = files.map((f) => `orders/${folder.name}/${f.name}`);
      const del = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ prefixes }),
      });
      if (!del.ok) {
        console.error(`cleanup-uploads: delete failed for ${bucket}/${folder.name}: ${del.status} ${await del.text()}`);
        continue;
      }
      deletedFolders++;
      deletedFiles += prefixes.length;
    }
    console.log(`cleanup-uploads: ${bucket}: removed ${deletedFiles} file(s) across ${deletedFolders} expired order(s); ${folders.length} folder(s) scanned`);
  }

  // Prune delivery-link tokens 7+ days past expiry
  const staleBefore = new Date(Date.now() - 7 * DAY_MS).toISOString();
  await fetch(`${supabaseUrl}/rest/v1/delivery_links?expires_at=lt.${encodeURIComponent(staleBefore)}`, {
    method: "DELETE",
    headers: { ...headers, apikey: serviceKey, Prefer: "return=minimal" },
  }).catch((e) => console.error("cleanup-uploads: token prune failed", e));

  return new Response("ok");
};

export const config: Config = {
  schedule: "@daily",
};
