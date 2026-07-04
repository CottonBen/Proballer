# Going live — push to GitHub, then deploy on Render

This app is a normal Node server with a local SQLite database and uploaded files
on disk. It needs an always-on host with a **persistent disk** — **Render** works,
**Vercel does not** (Vercel is serverless and wipes the disk).

Secrets (passwords, IBAN, any API keys) are **never** in the code. Locally they
live in a gitignored `.env`; in production you type them into Render's dashboard.

---

## 1. Put the code on GitHub (private repo)

**a. Create an empty private repo** at https://github.com (as CottonBen):
   New repository → name it e.g. `Proballer` → **Private** → do **not** add a
   README/.gitignore/license (it must start empty) → Create repository.

**b. Create a Personal Access Token** (GitHub no longer accepts your password for
   git). GitHub → Settings → Developer settings → Personal access tokens →
   *Fine-grained tokens* → Generate. Give it access to the new repo with
   **Contents: Read and write**. Copy the token now (you only see it once).

**c. Push** (in Terminal):
```bash
cd /Users/user/Downloads/proballers-coaching-finland
git remote add origin https://github.com/CottonBen/Proballer.git   # use YOUR repo URL
git branch -M main
git push -u origin main
```
When prompted: **Username** = `CottonBen`, **Password** = paste the **token**.
macOS offers to save it in Keychain, so you're only asked once.

> `.env` and the `data/` database are gitignored — they are **not** uploaded.

---

## 2. Deploy on Render

1. https://render.com → **New** → **Blueprint** → connect your GitHub → pick the repo.
   Render reads `render.yaml` (a web service + a 1 GB persistent disk at `/var/data`).
2. Open the service's **Environment** tab and set these (use **strong, new** values):

   | Variable          | What it is                                  |
   |-------------------|---------------------------------------------|
   | `PAYMENT_IBAN`    | Your bank IBAN, shown on invoices           |
   | `PAYMENT_PAYEE`   | Name money is paid to                       |
   | `ADMIN_EMAIL`     | Your admin login email                      |
   | `ADMIN_PASSWORD`  | Your admin login password                   |
   | `COACH_EMAIL`     | Kalle's login email                         |
   | `COACH_PASSWORD`  | Kalle's login password                      |

   (`DATA_DIR=/var/data` and `DEMO_DATA=0` are already set in `render.yaml`.)
3. **Create / Deploy.** First boot seeds a clean database using the credentials above.
   Your site is live at the Render URL. The persistent disk keeps your database and
   uploaded coach photos across every future deploy.

> If you skip the password vars, the first boot generates random ones and prints
> them in the Render **Logs** — set them yourself to avoid that.

---

## 3. Where your secrets live (so they never leak)

- **Code**: reads `process.env.*` only — no secret is ever written in a source file.
- **Locally**: `.env` (gitignored — git cannot push it).
- **On Render**: the Environment tab (encrypted, injected at runtime).
- **Passwords**: stored only as bcrypt *hashes* in the database, never as text.
- **Any future key** (email, Google Sheets): same rule — `.env` locally, Render
  Environment tab in production. Never paste a key into the code or a chat.

---

## 4. Changing the site later

- **Content / prices / features / new coaches' code**: edit + `git push` →
  Render auto-redeploys in ~1–2 min. Database and uploads are untouched.
- **Live data** (coaches, availability, passwords, marking invoices paid): the
  **admin panel**, no redeploy needed.

---

## 5. (Optional, later) Auto-email invoices to customers

Invoices are always generated and visible in the customer's *My bookings* and your
admin CRM. To also email them automatically, connect any SMTP provider (e.g. Brevo,
free 300/day) and set on Render: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM`. No code change needed — the app emails on booking once these are set.
