import type { Config } from "@netlify/functions";

// Stripe webhook → order notification.
// On checkout.session.completed, relays an order summary into the site's
// "order-notifications" Netlify Form, whose email notification goes to
// hello@motionvisualmedia.com.

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=") as [string, string])
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;
  // Reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET not set");
    return new Response("not configured", { status: 500 });
  }

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  if (!(await verifyStripeSignature(payload, sig, secret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed") {
    return new Response("ignored");
  }

  const s = event.data.object;
  const md = s.metadata || {};
  const fields: Record<string, string> = {
    "form-name": "order-notifications",
    order_ref: s.id || "",
    customer_name: md.customer_name || s.customer_details?.name || "",
    customer_email: s.customer_details?.email || s.customer_email || "",
    amount: s.amount_total != null ? `$${(s.amount_total / 100).toFixed(2)} ${String(s.currency || "usd").toUpperCase()}` : "",
    package: md.package || "",
    style: md.style || "",
    background: md.background || "",
    notes: md.notes || "",
    photos: md.photo_urls && md.photo_urls !== "pending_email"
      ? `Uploaded to private storage: ${md.photo_urls}`
      : "Not uploaded — customer will reply to their Stripe receipt with photos",
    mode: event.livemode ? "LIVE payment" : "TEST payment",
  };

  const siteUrl = Netlify.env.get("URL") || "https://headshots.motionvisualmedia.com";
  const res = await fetch(siteUrl + "/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  if (!res.ok) {
    console.error(`stripe-webhook: form relay failed ${res.status} ${await res.text()}`);
    // Return 500 so Stripe retries the delivery
    return new Response("relay failed", { status: 500 });
  }

  console.log(`stripe-webhook: order notification relayed for ${s.id} (${fields.mode})`);
  return new Response("ok");
};

export const config: Config = {
  path: "/api/stripe-webhook",
};
