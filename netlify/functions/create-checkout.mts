import type { Context } from "@netlify/functions";

const PRICES: Record<string, number> = {
  "pro-look": 8900,
};

const NAMES: Record<string, string> = {
  "pro-look": "Professional AI Headshots — Motion Visual Media",
};

const DESCRIPTIONS: Record<string, string> = {
  "pro-look": "5 AI headshots · 3 styles · Pro review included · 48-hour delivery · LinkedIn crop · 1 revision round",
};

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { package: pkg, name, email, style, background, human_review, notes, photo_urls } = body;

    if (!pkg || !PRICES[pkg]) {
      return new Response(JSON.stringify({ error: "Invalid package" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stripeSecretKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey || stripeSecretKey === "REPLACE_WITH_YOUR_STRIPE_SECRET_KEY") {
      return new Response(JSON.stringify({ error: "Stripe not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Calculate price
    const unitAmount = PRICES[pkg];
    const productName = NAMES[pkg];
    const description = DESCRIPTIONS[pkg];
    const humanReview = true; // review is included in every order

    const siteUrl = Netlify.env.get("URL") || "https://headshots.motionvisualmedia.com";

    // Build metadata — include photo storage references if uploaded
    const metadata: Record<string, string> = {
      package: pkg,
      style: style || "",
      background: background || "",
      human_review: humanReview ? "yes" : "no",
      notes: (notes || "").slice(0, 500),
      customer_name: name || "",
      photo_urls: photo_urls ? JSON.stringify(photo_urls).slice(0, 500) : "pending_email",
    };

    const params = new URLSearchParams({
      "mode": "payment",
      "customer_email": email || "",
      "success_url": `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      "cancel_url": `${siteUrl}/#order`,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(unitAmount),
      "line_items[0][price_data][product_data][name]": productName,
      "line_items[0][price_data][product_data][description]": description,
      "line_items[0][quantity]": "1",
      "payment_intent_data[description]": `Order: ${productName} — ${name || email}`,
      "payment_intent_data[receipt_email]": email || "",
    });

    Object.entries(metadata).forEach(([key, value]) => {
      if (value) params.append(`payment_intent_data[metadata][${key}]`, value);
    });

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.json() as { error?: { message?: string } };
      console.error("Stripe error:", err);
      return new Response(
        JSON.stringify({ error: err.error?.message || "Payment error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const session = await stripeRes.json() as { url: string; id: string };

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Checkout error:", err);
    return new Response(JSON.stringify({ error: "Server error. Please try again." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/create-checkout",
};
