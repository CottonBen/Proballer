# Custom domain setup — proballers.fi

Goal: serve the site at **https://proballers.fi** (and **www.proballers.fi**)
instead of the `proballers-coaching.onrender.com` address. Free HTTPS is
handled automatically by Render (Let's Encrypt).

The app needs **no code changes** — it already works on any hostname.

---

## Step 1 — Buy the domain (~€15/year)

`.fi` domains are open to anyone (individual or company, any country) since 2016
— no Finnish ID required.

Register **proballers.fi** at any registrar that sells `.fi`, e.g.:

| Registrar | Notes |
|---|---|
| **Gandi.net** | International, English UI, reliable, supports `.fi`. |
| **Domainkeskus.com** | Finnish, cheap, Finnish-language UI. |
| **Louhi.fi** | Finnish host + registrar. |

> The registrar's search box is the authoritative availability check. If
> `proballers.fi` is taken, `proballerscoaching.fi` was also free as of the last
> check — good fallback.

During checkout, **turn on WHOIS privacy** if offered (hides your personal
details from public lookups). You do **not** need their hosting or email add-ons
— just the domain.

---

## Step 2 — Add the domain in Render

1. Render dashboard → your service **proballers-coaching** → **Settings**.
2. Scroll to **Custom Domains** → **Add Custom Domain**.
3. Add **both**, one at a time:
   - `proballers.fi`
   - `www.proballers.fi`
4. Render now shows the exact DNS records to create. **Use the values Render
   shows you** (the apex IP can change) — they'll look like the table in Step 3.

---

## Step 3 — Point DNS at Render (at your registrar)

In the registrar's **DNS settings** for proballers.fi, add the records Render
gave you. They will be (typical Render values):

| Type | Name / Host | Value | Purpose |
|------|-------------|-------|---------|
| `A` | `@` (root / proballers.fi) | the IP Render shows (e.g. `216.24.57.1`) | apex domain |
| `CNAME` | `www` | `proballers-coaching.onrender.com` | www subdomain |

Notes:
- `@` means the bare domain (some registrars call it "root" or leave Host blank).
- If your registrar supports **ALIAS/ANAME** on the root, you can use that
  pointing to `proballers-coaching.onrender.com` instead of the `A` record —
  either works.
- Delete any placeholder/parking records the registrar added for `@` and `www`.

---

## Step 4 — Wait for verification + SSL

- DNS propagation is usually minutes, occasionally a few hours.
- Render shows each domain as **Verified** once it sees the records, then
  automatically issues the HTTPS certificate.
- When both are green, **https://proballers.fi** is live. Render auto-redirects
  `http → https` and you can pick whether `www` redirects to the bare domain or
  vice-versa (bare `proballers.fi` as primary is the common choice).

---

## After it's live — optional polish (ask Claude)

- Drop **"(working title)"** from the invoice business name now that the brand is set.
- Add SEO niceties that use the real domain: canonical `<link>`, `og:url`,
  `sitemap.xml`, `robots.txt`.
- Move the invoice reply address from a Gmail to **hello@proballers.fi** (needs
  email hosting — a separate, optional step).
