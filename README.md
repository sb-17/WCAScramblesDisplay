# WCA Scrambles Display

Show scramble sets on a tablet in the scrambling area, without walking over and typing a
passcode before every group.

---

## How it works

- **Dashboard** — your phone or laptop. Sign in with WCA, upload scrambles, push sets to screens.
- **Display** — a tablet in the scrambling area. Never signs in. Paired once with a code, then only shows what you send it.

Scrambles are encrypted in your browser before upload. The server is a courier — it cannot
read a scramble, a passcode, or your master password.

---

## Installing

Worth doing on the tablet: it then runs with no address bar and no tabs.

- **iPad / iPhone** — Safari → **Share** → **Add to Home Screen**
- **Android / laptop** — Chrome or Edge → **Install**

---

## Before the competition

**1. Sign in.** Delegates only, any rank.

First time, you get an **encryption key** and a one-time **recovery phrase**
(`ZH73-AS2Y-RCGG-FW0Q-AZNZ`). Write it down — it is the only way back on a new phone, and
nobody can reset it. Lose it and you re-upload the archive; the scrambles themselves are
never at risk. Settings can issue a new phrase while a browser still holds your key.

**2. Add the competition.**

- **WCA** — type its name. Only competitions you delegate, and only unfinished ones, appear.
- **Unofficial** — name and last day. Also how you test, without generating real scrambles.

Already set up by a co-delegate? Ask them for access rather than making a second copy.

**3. Upload.** Pick the TNoodle zip, enter the master password. Everything happens in your
browser. Check the summary before storing — it warns if the archive looks like a different
competition. Fewest Moves is skipped. Easiest from the laptop the zip is already on.

**4. Share.** **Delegates** → search → add. They need to have signed in here at least once,
since sharing re-encrypts the key to theirs. Removing someone destroys their copy of it.
Creator only, and they cannot remove themselves.

---

## On the day

**Pair a screen**

1. **Display devices** → add one. Name it for the room: "Scrambling table 1".
2. Set the session length. 12 hours covers a day.
3. Take the 8-character code — one use, 30 minutes.
4. On the tablet: **Open display** → type the code.

It downloads the whole competition encrypted while pairing, so a bad venue network cannot
stop a scramble appearing. Pairing also signs out any Delegate on that tablet and removes
their key — otherwise a forgotten session there opens every competition you can reach.

**Show a set**

Pick a set, press **Show**. The line above the controls reports what the tablet says it is
showing, not what you sent: "Sending…" until it confirms.

| | |
|---|---|
| **Clear** / **Clear all** | Blank one screen, or all of them |
| **All devices at once** | Same set everywhere |
| **Extend** | More hours on a session running out |
| **Remove** | Revoke a tablet, wipe its scrambles, back to the code screen |

Each tablet holds the key only for what is on screen. A lost tablet exposes one group.

---

## Worth knowing

- **No browsing on the tablet.** No list, no tabs, no back button — only what was sent.
- **The screen stays awake** on its own.
- **Sheets are never recoloured**, so Megaminx, Square-1, Clock and Pyraminx diagrams stay correct.
- **For real lockdown**, use iPadOS **Guided Access**. No web page can pin itself down.
- **Before a real competition**, worth a word with WCA Software and Regulations.

---

## Running your own copy

See [`.env.example`](.env.example), then `npm install`, `npm run migrate`, `npm run dev`.
[ROADMAP.md](ROADMAP.md) has the design decisions and what is still outstanding.
