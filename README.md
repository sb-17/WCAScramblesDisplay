# WCA Scrambles Display

Show scramble sets on a tablet in the scrambling area, without walking over and typing a
passcode before every group.

You upload a competition's TNoodle archive once, pair the tablets that will display
scrambles, and from then on send any set to any screen from your phone.

---

## How it works

There are two sides to the app.

**The Delegate dashboard**, on your phone or laptop. You sign in with your WCA account, set
up competitions, upload scrambles, and push sets to screens.

**The display**, on a tablet in the scrambling area. It never signs in. It is paired once
with a one-time code and then only ever shows what a Delegate sends it.

The two are connected through the server, but the server is only a courier. Scrambles are
encrypted in your browser before they are uploaded, and the keys never leave Delegates'
devices. Nobody running the server can read a scramble, a passcode, or your master
password.

---

## Installing it

The app works in any browser, but on the scrambling-area tablet it is worth installing to
the home screen. It then runs without an address bar, so there is nothing to type a
different URL into and no browser tabs to wander off into.

**iPad or iPhone.** Open the app in Safari, tap **Share**, then **Add to Home Screen**.

**Android or a laptop.** Open the app in Chrome or Edge and use **Install** from the address
bar or the browser menu.

Install it on your phone too, if you like — the dashboard is built for one-handed use while
holding a clipboard.

---

## Setting up before a competition

### 1. Sign in

Sign in with WCA. Only Delegates can use the app, at any rank.

The first time, you are asked to create an **encryption key**. It is generated in your
browser and never sent anywhere. You will be shown a **recovery phrase** once, like
`ZH73-AS2Y-RCGG-FW0Q-AZNZ`.

**Write it down.** It is the only way to get your key back on a new phone, or after clearing
your browser data. Nobody can reset it for you — that is exactly what stops the server being
able to read your scrambles. If you lose it, you have not lost the scrambles themselves: you
still have the TNoodle archive and can set the competition up again.

You can generate a fresh phrase at any time from **Settings**, as long as the browser you
are on still has your key.

### 2. Add the competition

On the dashboard:

- **A WCA competition** — start typing its name. Only competitions the WCA lists you as a
  Delegate of will appear, and only ones that have not already finished.
- **An unofficial competition** — give it a name and a last day. Use this for unofficial
  events, and for trying things out. There is no reason to generate scrambles for a real
  competition just to test.

If a co-delegate has already set up the same WCA competition, you will be told so and asked
to request access from them rather than creating a second copy. Two copies would mean two
encrypted sets of the same scrambles and no way to tell which tablet was paired to which.

### 3. Upload the scrambles

Open the competition and use **Upload scrambles**. Pick the TNoodle zip and enter the
competition's master password.

Everything happens in your browser: the archive is opened, each scramble set is encrypted
under its own key, and only the encrypted result is uploaded. The master password and the
passcode sheet never leave your machine.

You get a summary before anything is stored — how many sets were found, and anything
unusual. Check the competition name matches; the app warns you if the archive looks like it
belongs to a different competition, which is a much better time to notice than later.

**Fewest Moves is skipped.** Those scrambles are handed out on paper and will never appear
on a screen, so they are not imported at all.

The archive is easiest to upload from the laptop it is already on. The day-to-day dashboard
is designed for your phone.

### 4. Share with co-delegates

In **Delegates**, search for another Delegate and add them. They get full access to the
competition: its scrambles, its screens, everything.

They must have signed into this app at least once first. Sharing works by re-encrypting the
competition key to their personal key, so somebody who has never opened the app has nothing
to encrypt to.

Removing someone destroys their copy of the key, so their access genuinely ends rather than
merely being hidden. Only whoever created the competition can add or remove people, and they
cannot remove themselves.

---

## On the day

### Pairing a screen

1. On the competition page, under **Display devices**, add a device. Give it a name you will
   recognise across the room — "Scrambling table 1" beats "iPad".
2. Choose how long its session should last. Twelve hours covers a normal day.
3. You get an eight-character code, good for 30 minutes and usable once.
4. On the tablet, open the app and choose **Open display**, then type the code.

The tablet downloads the whole competition as encrypted files while it pairs. From then on
it needs almost nothing from the network, so a bad venue connection cannot stop a scramble
appearing.

**Pairing signs out any Delegate on that tablet and removes their key from it.** That is
deliberate. A tablet left in the scrambling area still signed in as you could open every
scramble of every competition you have access to, and remembering to sign out is exactly the
kind of thing that gets forgotten at 8am.

### Showing a scramble set

Pick a set next to a device and press **Show**. It appears within a few seconds.

The line above the controls tells you what that screen is **actually showing**, as reported
by the tablet itself — not what you asked for. While a set is on its way it says
"Sending…", and only changes to "Showing:" once the tablet confirms. A screen you cannot see
reporting its own state is the only signal worth trusting.

- **Clear** blanks one screen. **Clear all** blanks every screen.
- **All devices at once** sends the same set to every paired screen, for when they are all
  scrambling the same group.
- **Extend** adds hours to a session that is running out.
- **Remove** revokes a tablet immediately. It wipes its downloaded scrambles and returns it
  to the code screen.

Each tablet only ever holds the key for what is on its screen right now. Previous keys are
thrown away on every change, so a tablet that goes missing exposes one group, not the
weekend.

The display shows the event, round and set in large text above the sheet. Scramblers should
glance at it — it is the fastest way to catch a set being sent to the wrong table.

---

## Worth knowing

**There is no way to browse scrambles on the tablet.** No list, no tabs, no back button. It
shows what was sent and nothing else. That is the point: a scrambler must not be able to
reach a set you did not choose.

**The screen stays awake** by itself while a display is running.

**Scramble sheets are never recoloured.** Megaminx, Square-1, Clock and Pyraminx sheets
carry colour-coded diagrams, so the sheet is shown exactly as TNoodle drew it.

**For real lockdown, use the tablet's own controls.** iPadOS **Guided Access** (triple-click
the side button) pins the device to one app properly. No web page can enforce that on
itself, and at a competition it is worth the thirty seconds.

**Before using this at a real competition**, it is worth a word with the WCA Software and
Regulations teams. The encryption means the server cannot read your scrambles, which makes
that a much easier conversation, but it is better had early than after somebody asks.

---

## Running your own copy

Everything needed is in [`.env.example`](.env.example): a WCA OAuth application, a Postgres
database, and a secret for signing sessions. Then `npm install`, `npm run migrate`,
`npm run dev`.

[ROADMAP.md](ROADMAP.md) records the design decisions, why each was made, and what is still
outstanding.
