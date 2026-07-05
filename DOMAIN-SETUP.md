# Custom domain setup — proballerscoaching.com

Goal: serve the site at **https://proballerscoaching.com** (and
**www.proballerscoaching.com**) instead of the
`proballers-coaching.onrender.com` address. Free HTTPS is handled automatically
by Render (Let's Encrypt).

The app needs **no code changes** — it already works on any hostname.

- **Registrar:** Gandi (bought 2026-07-06, ~€13.80/yr)
- **DNS:** Gandi's free built-in **LiveDNS** (no Cloudflare needed)

---

## Step 1 — Buy the domain ✅ DONE (Gandi)

---

## Step 2 — Add the domain in Render

1. Render dashboard → your service **proballers-coaching** → **Settings**.
2. Scroll to **Custom Domains** → **Add Custom Domain**.
3. Add **both**, one at a time:
   - `proballerscoaching.com`
   - `www.proballerscoaching.com`
4. Render then shows the exact DNS records to create — an **A record** value
   (an IP) for the apex, and a **CNAME** target for `www`. Note them down (they
   look like the table in Step 3).

---

## Step 3 — Add the DNS records at Gandi

1. Gandi dashboard → **Domain names** → **proballerscoaching.com** → **DNS
   Records** (LiveDNS).
2. Add the records Render gave you. They'll be (typical Render values):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| `A` | `@` | the IP Render shows (e.g. `216.24.57.1`) | default |
| `CNAME` | `www` | `proballers-coaching.onrender.com.` | default |

Notes:
- `@` is the bare domain (Gandi labels it `@`).
- Gandi may have created default `A`/`CNAME`/parking records — **edit or delete**
  the existing `@` and `www` entries so they match the table above (no duplicates).
- The CNAME value can include a trailing dot in Gandi — that's fine.

---

## Step 4 — Wait for verification + SSL

- DNS propagation is usually minutes, occasionally a few hours.
- Render marks each domain **Verified**, then auto-issues the HTTPS certificate.
- When both are green, **https://proballerscoaching.com** is live. Render
  redirects `http → https`; choose whether `www` redirects to the bare domain or
  vice-versa (bare `proballerscoaching.com` as primary is the common choice).

---

## After it's live — optional polish (ask Claude)

- Drop **"(working title)"** from the invoice business name now the brand is set.
- SEO: canonical `<link>`, `og:url`, `sitemap.xml`, `robots.txt` using the domain.
- Move the invoice reply address to **hello@proballerscoaching.com** (needs an
  email/mailbox — Gandi offers mailboxes, or use a forwarder; separate step).
