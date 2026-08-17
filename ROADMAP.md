# WCA Scrambles Display — Roadmap

Show scramble PDFs on a tablet in the scrambling area without a Delegate walking over
and typing a passcode before every group.

A Delegate uploads a competition's TNoodle archive from a laptop, pairs one or more
display devices with one-time codes, and from then on pushes a chosen scramble set to a
chosen device from their phone.

---

## Non-goals

- **FMC.** Not supported, and deliberately no code exists for it. FMC sheets that happen
  to match the naming pattern will work incidentally; ones that don't land in the
  unrecognised bucket and get ignored.
- Replacing Groupifier, the WCA website, or any part of results handling.
- Group numbers. TNoodle gives us lettered *sets* (`Set A`, `Set B`), not groups. We show
  what the file says and never invent a group number.
- Any non-Delegate role. No competitor, organiser or scrambler accounts.

---

## Locked decisions

### Security model — zero-knowledge

The server stores ciphertext and nothing else. It never sees a scramble, a passcode, or
the master password.

- Encryption happens in the Delegate's browser before upload.
- Each scramble set gets its own AES-256-GCM key.
- Stored blob is `E_setkey(original_encrypted_pdf ‖ its_passcode)`. The PDF stays
  byte-identical to TNoodle's output — we never re-encode it, so scramble diagrams
  (Megaminx, Square-1, Clock, Pyraminx) cannot be corrupted in transit.
- Two independent layers survive: our envelope, and the PDF's own passcode.

**The master password is the crown jewel.** `SECRET.txt` sits in plaintext inside the
outer archive, so that one password is equivalent to every passcode for the competition.
It is read in-browser, used to build the envelopes, and discarded. It is never persisted
and never transmitted. `SECRET.txt` itself is never uploaded in any form.

### Key distribution — per set, at push time

The tablet caches the entire competition as ciphertext, but only ever holds the key for
the set currently on screen. Previous keys are wiped on each new push and on clear.

A lost or stolen tablet therefore leaks at most one group, not the weekend. The cost is
that the Delegate's phone must be online to push — which it must be anyway.

### Device pairing

- The device generates its own keypair and displays an activation code that is a
  **fingerprint of its public key**, so the phone can verify it is wrapping keys to the
  real tablet rather than to something a compromised server substituted. This is what
  makes "the server cannot read your scrambles" true rather than merely promised.
- Codes are single-use with a short TTL (~10 min), independent of the session they create.
- Sessions have a hard expiry in hours, chosen at setup, extendable with one tap from the
  phone. A session expiring mid-round is worse than the problem we are solving.
- Remote revoke, per device and all-devices.

### Preventing the wrong scramble being shown

Operator error is a bigger real risk than an attacker.

- The device shows a large, unmissable `event · round · set` header, verbatim from the file.
- **No navigation on the device.** No file list, no tabs, no back button, no split screen.
  One set per device. A scrambler cannot reach a set the Delegate did not push.
- The phone displays what the device **acknowledged** it is showing, never what the phone
  asked it to show.
- Confirmation step on push-to-all-devices specifically.
- Prominent "clear all screens".
- Audit log: which set, which device, which Delegate, when.

### Resilience

Competition venue wifi is assumed to be bad.

- At pairing, the device downloads every encrypted PDF for the competition into IndexedDB.
  Afterwards the network carries only a tiny "show set X, here is its key" message.
- Transport is **capped-duration SSE** (~25 s, then clean close and instant reconnect).
  Long-lived SSE does not survive serverless function duration limits; this is effectively
  long-polling at ~144 requests/hour/device, which is both cheaper and lower-latency than
  5-second polling.
- Wake Lock so the tablet does not sleep mid-round.
- The phone shows a real last-seen timestamp per device, not just a green dot.

### Hosting — three free tiers, no payment method

- **Vercel Hobby** — Next.js app and API routes.
- **Neon free tier** — Postgres. Chosen over Supabase specifically because Supabase pauses
  a project after a week of inactivity and needs a manual resume; a tool used two weekends
  a month would be paused exactly when needed. Neon's compute auto-suspends but resumes on
  connection in well under a second.
- **Encrypted blobs stored as `bytea` in Postgres**, not in a blob service. A large
  competition is roughly 10–20 MB, so Neon's free tier holds dozens at once. This removes
  an entire dependency and avoids Cloudflare R2, which wants a card on file.

Auto-purge all scramble data some days after the competition ends.

**GitHub Pages is not viable for the app** — see [Hosting notes](#hosting-notes) below.

### Auth

WCA OAuth. Gate on `delegate_status != null`.

Confirmed live values: `senior_delegate`, `delegate`, `junior_delegate`, `trainee_delegate`;
`null` for everyone else. Deliberately **not** an allowlist of those four strings — the WCA
has renamed ranks before (`candidate_delegate` became `junior_delegate`), and an allowlist
would silently lock out real Delegates on a competition morning. Non-null fails open toward
"is a Delegate", which is the correct direction.

Competitions are pulled from the WCA API rather than typed by hand, which also gives an
authoritative co-delegate list.

### Design

Minimal, dark, one accent.

| Token | Value |
|---|---|
| Background | `#0F1114` |
| Card | `#181B20` |
| Border | `#262A31` |
| Text | `#E6E8EB` |
| Text secondary | `#8B929E` |

One accent for live/active state; red reserved exclusively for revoke and clear. System
font stack. Generous tap targets — this gets used one-handed while holding a clipboard.

**Deliberate exception:** the PDF itself is never inverted. Several events carry
colour-coded diagrams that inversion would corrupt. The page renders on white, framed in
dark chrome. The scrambling area is brightly lit anyway.

Setup and upload are a **desktop** screen (the archive lives on a laptop). The day-of
dashboard is **phone-first**. Two genuinely different layouts, not one responsive compromise.

---

## The TNoodle archive

Confirmed against real data.

```
outer.zip                              encrypted with the competition master password
├── Interchange/                       ignored
├── Printing/                          ignored
├── <comp> - Computer Display PDF Passcodes - SECRET.txt    plaintext once outer is open
└── <comp> - Computer Display PDFs.zip                      not encrypted
    └── <label>.pdf                    each locked with its own passcode
```

`<label>` is `<Event> Round <N> Scramble Set <A|B|C…>`, e.g. `3x3x3 Blindfolded Round 2
Scramble Set A`. The filename minus `.pdf` is **byte-identical** to the key used in
`SECRET.txt`, so the join is an exact string match — no normalisation, no fuzzy matching.

Event names are TNoodle's own strings (`3x3x3`), **not** WCA event names (`3x3x3 Cube`) or
IDs (`333`). The mapping table must key off TNoodle's vocabulary.

`SECRET.txt` opens with a free-form warning block, so passcode lines are identified by
shape rather than position, and split on the **last** colon.

**Parser rule: never silently drop a PDF.** Anything unmatched or unrecognised is surfaced
for manual labelling. A missing scramble set discovered on Saturday is far worse than an
ugly row in a table.

---

## Build phases

| # | Phase | Status |
|---|---|---|
| 1 | Zip pipeline — parser module + CLI + self-test | **Done** |
| 2 | Scaffold, WCA OAuth, delegate gate, deployed to Vercel + Neon | **In progress** |
| 3 | Crypto identity — keypairs, competition keys, co-delegate wrapping, recovery phrase | |
| 4 | Device pairing — activation codes, session lifetime, revoke | |
| 5 | Display client — pre-cache, SSE, pdf.js, wake lock, ACK | |
| 6 | Phone dashboard — device cards, push, push-to-all, clear, audit log | |

Sequenced to retire risk early rather than to look impressive early. Phase 1 came first
because it was the most likely to surprise us and needed no infrastructure.

### Phase 1 — done

- `src/scrambles/parse.ts` — `parseScrambleZip(archive: Blob, masterPassword: string)`.
  Takes a `Blob`, so the same module runs in Node today and in the browser upload page
  later, unchanged.
- `src/scrambles/cli.ts` — `npm run parse -- "<zip>" <password>`. Masks passcodes by
  default; reports a `locked` column per PDF.
- `src/scrambles/selftest.ts` — `npm run selftest`. Synthetic archive covering multi-word
  event names, multiple sets per round, and all three warning kinds. No real scramble data
  needed.

Verified against a real competition archive.

### Phase 2 — in progress

Built and building clean; the OAuth round trip is untested until real credentials exist.

- Next.js 16 / React 19, hand-rolled rather than `create-next-app` (our `package.json`,
  `tsconfig.json` and `src/` would have collided with it).
- **Plain CSS with custom properties, not Tailwind.** The design is a handful of tokens and
  two layouts; Tailwind would add build config and a dependency for what CSS variables
  already do. Easy to add later if it starts hurting.
- `src/lib/wca.ts` — authorize URL, token exchange, `/api/v0/me`, delegate check. The
  redirect URI is derived from forwarded headers so localhost and the deployed origin both
  work with no extra configuration.
- `src/lib/session.ts` — signed JWT in an httpOnly cookie. Deliberately stateless for now;
  there is nothing to store until phase 3, so Neon is not yet wired up.
- Sign-in, callback with CSRF `state` check, sign-out, and a gated `/dashboard`.

Remaining: register the WCA OAuth application, verify the round trip, then deploy.

---

## Hosting notes

**GitHub Pages cannot host this app.** Pages serves static files only — no server-side
execution, no database. The app needs persistent shared state (competitions, wrapped keys,
device sessions, activation codes, audit log) and a push channel between phone and tablet.
Neither is possible on Pages.

Hosting the frontend on Pages and the backend elsewhere would mean two hosts and CORS,
for no saving — Vercel Hobby is free and serves static assets, API routes and streaming
responses together. There is no cost advantage to Pages, only added complexity.

Note that zero-knowledge encryption does not remove the need for a backend. It removes the
need to *trust* the backend, which is a different thing: the server still has to store and
relay ciphertext.

---

## Open questions

- Should a trainee Delegate be able to push unsupervised, or should the creating Delegate
  be able to downgrade someone to view-only?
- Exact retention period before scramble data is purged.
- Recovery: passphrase-derived key backup is planned, but the wording and placement of
  that flow matters — losing it means losing access to every uploaded competition.
- Whether to check in with WCA Software / Regulations before other Delegates use this at
  live competitions. Not a blocker for building, but better raised early than after
  someone objects. Zero-knowledge makes that a much easier conversation.
