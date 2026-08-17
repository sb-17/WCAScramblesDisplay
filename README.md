# WCA Scrambles Display

Show scramble sets on a tablet in the scrambling area without a Delegate walking over and
typing a passcode before every group.

A Delegate uploads a competition's TNoodle archive from a laptop, pairs one or more display
devices using one-time codes, and then pushes a chosen scramble set to a chosen device from
their phone.

**The server cannot read your scrambles.** Everything is encrypted in the browser before it
is uploaded, and the keys never leave Delegates' devices. See [ROADMAP.md](ROADMAP.md) for
the full design and the reasoning behind it.

---

## Requirements

- Node 20 or newer (developed on 24)
- A [Neon](https://neon.tech) Postgres database (free tier is enough)
- A WCA OAuth application

---

## Environment variables

Copy `.env.example` to `.env.local` and fill it in.

| Variable | What it is |
|---|---|
| `WCA_CLIENT_ID` | From your WCA OAuth application |
| `WCA_CLIENT_SECRET` | From the same place |
| `DATABASE_URL` | Neon connection string, pooled |
| `SESSION_SECRET` | Signs the session cookie, 32+ characters |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### The WCA OAuth application

Create one at <https://www.worldcubeassociation.org/oauth/applications>.

- **Scopes:** `public`
- **Confidential:** yes
- **Redirect URIs:** one per line, for every origin you will use:
  ```
  http://localhost:3000/api/auth/callback
  https://your-app.vercel.app/api/auth/callback
  ```

Sign-in is restricted to WCA Delegates. The gate is `delegate_status != null` rather than a
list of known ranks, so a rank the WCA adds or renames later does not lock real Delegates
out.

---

## Running locally

```bash
npm install
npm run migrate     # applies src/db/schema.sql, safe to re-run
npm run dev
```

Then open <http://localhost:3000>.

### Testing on a real tablet

WebCrypto only works in a secure context, so a tablet reaching your machine over the LAN on
plain HTTP cannot pair — `crypto.subtle` is simply undefined there. Use:

```bash
npm run dev:https
```

This serves over HTTPS with a self-signed certificate, which the tablet will warn about
once. You also need your machine's LAN address in `allowedDevOrigins` in
[next.config.ts](next.config.ts), otherwise Next blocks the JavaScript and the page loads
but does nothing. That setting is development-only and has no effect once deployed.

---

## Deploying

### 1. Database

Either reuse your development Neon database, or create a second project for production and
apply the schema to it.

PowerShell:

```powershell
$env:DATABASE_URL = "<production url>"; npx tsx src/db/migrate.ts
```

bash:

```bash
DATABASE_URL="<production url>" npx tsx src/db/migrate.ts
```

A separate database is tidier, but means test competitions and real ones live apart — with
one database you get a single set of data to manage.

### 2. Vercel

1. Import the repository at <https://vercel.com/new>. Next.js is detected automatically; no
   build settings need changing.
2. Add all four environment variables under **Settings → Environment Variables**. Use a
   **different** `SESSION_SECRET` from your local one, so a leaked development secret cannot
   forge production sessions.
3. Deploy.

The `prebuild` script copies pdf.js's worker into `public/`, so it is fetched fresh at build
time and stays in step with the installed version.

### 3. Point the WCA application at it

Add `https://<your-deployment>/api/auth/callback` to the redirect URIs of your WCA OAuth
application. Sign-in fails with a redirect-mismatch error until this matches exactly.

### 4. Check it

1. Sign in. You should be asked to set up an encryption key and shown a recovery phrase.
2. Create an unofficial competition and upload a TNoodle archive.
3. Add a device, open `/display` on a tablet, and enter the code.
4. Push a set. The sheet should appear within a few seconds.

### A custom domain

Vercel's free tier supports custom domains, so you only pay a registrar. Add it under
**Settings → Domains**, then add the matching redirect URI to the WCA application.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run dev:https` | Development server over HTTPS, for testing on a tablet |
| `npm run build` | Production build |
| `npm run migrate` | Applies the schema, idempotent |
| `npm run selftest` | Archive parsing and cryptography self-tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run parse -- "<zip>" <password>` | Inspects a real TNoodle archive from the command line |

`npm run selftest` needs no database, no network and no real scramble data — it builds a
synthetic archive and exercises the key hierarchy end to end.

---

## A note before using this at a real competition

This puts live scrambles on third-party infrastructure. The encryption means the server
cannot read them, which makes that a much easier proposition, but it is still worth raising
with the WCA Software and Regulations teams before other Delegates rely on it.
