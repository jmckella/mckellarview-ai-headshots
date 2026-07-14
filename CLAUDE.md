# CLAUDE.md — Motion Visual Media Sites

## Who this is
Motion Visual Media (MVM) — Charlotte, NC visual content studio owned and operated by Jeremy "Jerm" McKellar. Formerly McKellar's View Media. B2C/B2B: professional headshots, portrait sessions, and cinematic documentary-style brand films.

## The three sites
1. **motionvisualmedia.com** (Netlify project: `motionvisualmedia`) — main brand site. Dark forest-green palette, cream text, mint accent, Fraunces serif headlines. High-ticket positioning (brand films, $5k+ intake form).
2. **AI Headshots** (Netlify project: `mckellarview-ai-headshots`) — productized AI headshot order page with Stripe checkout.
3. **Prompt Generator** (Netlify project: `mckellarview-prompt-generator`) — free lead-magnet tool that funnels to the headshot page.

## Brand rules
- Palette: near-black forest green background (#0e1a12-family), cream text (#f3efe3-family), mint/sage accent (#a8d5ba-family). Fraunces (serif) for headlines, clean sans for body.
- Voice: warm, confident, conversational. Never corporate, never desperate. Outcome-framed copy ("a photo that looks like who you've become"), not feature-framed ("portrait session $250").
- NEVER reference Jeremy's day job or any employer. MVM content stays fully separate.

## Offer structure (current)
- **AI Headshots — $89 single offer.** 5 headshots, 3 style selections, LinkedIn-optimized crop, hi-res files, 48-hr delivery, 1 revision round. Human review by a 15-year photography pro is INCLUDED and framed as a selling point (not a paid toggle).
- **Life Update Portrait Session — $250.** Charlotte, in-person, 60 min, 5 edited images.
- **Story Film — from $1,500.** Cinematic pilot-episode brand film; bridge to monthly retainer work.
- Consultations = free discovery call, not a paid product.

## PENDING CHANGES (queued, not yet shipped)
### All three sites — rebrand pass
- Replace all "Mckellar's View Media" / "McKellar's View" branding with "Motion Visual Media"
- Replace links to mckellarsview.com → motionvisualmedia.com
- Replace contact@mckellarsview.com → hello@motionvisualmedia.com (VERIFY the new inbox receives mail first — the headshot fulfillment flow depends on customers replying to their Stripe receipt email)
- Instagram links: verify current active handle before swapping (@mckellarsview_ may or may not have migrated)

### AI Headshots site
- Collapse 4 pricing tiers ($49/$89/$149/$199) + human-review toggle → ONE offer at $89 with review included (spec above)
- Update hero copy to reflect included pro review
- Simplify order-flow package step to the single package

### motionvisualmedia.com
- Add a "Start Here" section between the hero and "How We Work": three cards — Headshots ($89, links to headshot site order page), Life Update Session ($250, intake), Story Film (from $1,500, book a call)
- Do NOT touch the existing high-ticket "Start a Project" qualifying intake form — it stays as the separate premium track

### Post-launch
- Once all three are rebranded + live, mckellarsview.com (Squarespace) gets cancelled. Do not remove old-domain references until the new contact inbox is confirmed working.

## Deployment
- All three Netlify projects were manual "drop" deploys, now migrating to GitHub-linked continuous deployment. Static sites: no build command, publish directory = root.
- Netlify Forms may not be enabled at project level — verify form submissions actually arrive before relying on any intake form.

## Decision filter
Every change gets tested against: does this move toward a call, a proposal, or cash? Site polish beyond the pending changes above is deprioritized until outreach is generating conversations.
