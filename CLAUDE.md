# CLAUDE.md — Motion Visual Media Sites

## Who this is
Motion Visual Media (MVM) — Charlotte, NC visual content studio owned and operated by Jeremy "Jerm" McKellar. Formerly McKellar's View Media (rebrand shipped July 2026). B2C/B2B: professional AI headshots, portrait sessions, and cinematic documentary-style brand films.

## The three sites
1. **motionvisualmedia.com** (Netlify: `motionvisualmedia`) — main brand site. Page order: hero → Start Here (three offers) → work → services → process → shows → about → contact. High-ticket "Start a Project" qualifying intake modal ($5k+ retainer track) must stay untouched; Story Film entry point reuses it with widened budget brackets swapped in at open time.
2. **headshots.motionvisualmedia.com** (Netlify: `mckellarview-ai-headshots`) — AI headshot order page, Stripe checkout (LIVE mode), full fulfillment system (see below).
3. **prompts.motionvisualmedia.com** (Netlify: `mckellarview-prompt-generator`) — free lead-magnet prompt tool, funnels to the headshot site.

Legacy `*.netlify.app` URLs 301 to the custom subdomains (forced redirects in each netlify.toml).

## Brand rules
- Palette: near-black forest green background (#0d1611-family), cream text (#f1f0e9-family), mint/sage accent (#a9c3a0-family). Fraunces (serif) for headlines, Inter/clean sans for body. Logo images: `mvm-logo-mark.png` (tool sites, root) / `assets/mvm-logo-wordmark.png` (main site).
- Voice: warm, confident, conversational. Never corporate, never desperate. Outcome-framed copy.
- NEVER reference Jeremy's day job or any employer. MVM content stays fully separate.

## Offer structure (current)
- **AI Headshots — $89 single offer.** AI-generated from customer photos (stated explicitly, not buried), 5 headshots, 3 styles, LinkedIn crop, hi-res, 48-hr delivery, 1 revision round. Pro review INCLUDED and framed as a selling point.
- **Life Update Session — $250.** 45-min in-studio, Charlotte, 5 edited images. Personal inquiry form (session-inquiry modal on main site) — deliberately NOT instant booking.
- **Story Film — from $1,500.** Opens the qualifying intake with entry-level budget brackets ($1,500–$3,000 / $3,000–$5,000 / $5,000+).
- Tester promo: code **MVMTEST1** ($88 off → $1 checkout, max 5 uses, expires 2026-08-13). The "Add promotion code" field is visible on all checkouts while the tester program runs — when done, remove `allow_promotion_codes` in create-checkout.mts and delete the coupon in Stripe.

## Headshot fulfillment system (all live)
- **Customer flow:** order page → photos upload direct-to-storage via signed upload URLs (no function size ceiling; 10MB/image, 3 max, image MIME enforced by bucket) OR reply to Stripe receipt with photos → pay $89 → webhook relays order into Netlify Forms → email notification to hello@motionvisualmedia.com.
- **Admin:** `/admin` — passcode-gated (env `ADMIN_PASSCODE`, verified server-side, rate-limited). Lists ONLY this site's orders (filtered by session success_url — the Stripe account serves other businesses too). Detail view shows reference photos (signed URLs), accepts finished-file uploads, generates 30-day delivery links.
- **Delivery:** `/delivery?token=...` — branded gallery, per-file + zip downloads, 64-hex tokens stored in Supabase `delivery_links` table; regenerating revokes the prior link.
- **Storage:** Supabase project `tnpqsshyhulzdelddyfn` (supabase-lightBlue-mountain — NOT "presently", that's an unrelated app). Buckets `headshot-uploads` (private, purged 7 days after upload) and `headshot-deliveries` (private, purged 30 days after upload) — both RLS, no anon policies, signed-URL access only. Daily scheduled function `cleanup-uploads` enforces the deletion promises.
- **Pages:** `/privacy`, `/terms`, `/support` (also registered with Stripe as the business's policy/support URLs).

## Netlify env vars (headshots site)
`STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSCODE`. **Env var changes only reach functions after a redeploy.** MCP env upserts can silently fail — always re-list to verify.

## Netlify Forms
Enabled on motionvisualmedia (`project-intake`, `session-inquiry`) and headshots (`order-notifications`, fed by the Stripe webhook — not a visible form). Email notification rules live in the Netlify dashboard.

## Outstanding / watch items
- Stripe checkout custom domain migration to a motionvisualmedia.com domain is pending in Stripe (was checkout.mckellarsview.com). Do NOT cancel mckellarsview.com until it's fully off that domain.
- mckellarsview.com (Squarespace) cancellation is the final rebrand step after the checkout domain clears.
- Admin auth is a shared passcode; upgrade to passkeys (WebAuthn, credentials in the existing Supabase DB) before adding team members.

## Decision filter
Every change gets tested against: does this move toward a call, a proposal, or cash? Site polish is deprioritized until outreach is generating conversations.
