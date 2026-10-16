# Rouse — UX/UI Design Spec

> The visual system (§4–§6) is replaced by the "Awake" language in [`design-language.md`](design-language.md) (D-078). Screens, flows, copy rules and accessibility requirements here still apply.

> Audience: the coder and verifier agents. Scope follows D-007 (P0 items 1–11, plus re-ring after kill/reboot, local stats,
> quick nap, bedtime reminder, and a squat mission labelled as cheatable). Platform rules follow D-002, D-004 and D-008.
> Field names such as `alarm.snooze.maxCount` are indicative. Where they differ, the planner's domain model wins and
> this spec's behaviour still applies.

---

## 1. Design principles

1. **Built for someone half asleep.** The ringing and mission screens assume blurry eyes, one thumb, and shaky aim.
   Targets there are at least 64 px (the primary action is 72 px). Each screen has one primary action, the clock is the
   biggest text, and nothing needs a precise drag, swipe, long-press or pinch. Elsewhere targets are at least 48 px.
2. **Readable without colour.** Every status uses an icon *and* a word ("OK", "Needs attention"). Selected chips get a
   check mark. Memory tiles use shapes and numbers. Errors get text, not just a red border. All text meets WCAG AA
   (4.5:1, or 3:1 at 24 px and up). Control boundaries and focus rings meet 3:1. Ratios are in §4.
3. **Little reading.** Titles are 1–4 words, helper text is one sentence, and buttons say what they do ("Start mission",
   not "OK").
4. **Honest about reliability.** Rouse never says "your alarm will ring" unless the checks agree. The health screen shows
   every risk in plain words, with a fix button. The web demo says on screen that it cannot wake a locked phone.
5. **No dark patterns.** No ads, upsells, streak guilt, fake urgency, pre-ticked consent, or hidden snooze. Limits are
   shown before they apply ("2 left"). Destructive actions ask once, and the safe choice comes first.
6. **Calm at night.** Dark is the default theme. It uses a near-black blue-grey background, warm amber for the accent,
   no pure white, and no large bright areas. A light theme is available, and "System" follows the OS. Motion is subtle,
   and it switches off with `prefers-reduced-motion`.
7. **Never a dead end.** Every mission has a visible way forward: a backup mission after N tries or M minutes, or right
   away when the hardware is unavailable. The backup is longer on purpose, so it is never an easy way out.

---

## 2. Information architecture & navigation

**Shell.** The root `App` renders `<header>` (when the route has one), `<main id="main">`, and the `TabBar` (`<nav aria-label="Main">`)
on tab routes only. Content is centred with `max-width: 480px` and padded by the safe-area insets
(`env(safe-area-inset-*)`). The router is a ~40-line hash router using `hashchange`. An unknown hash redirects to `#/alarms`.

**Tabs (bottom bar, 3 items, 64 px plus the safe area):** Alarms (`#/alarms`), Stats (`#/stats`), Settings (`#/settings`).
Each tab shows an icon and a text label. The active tab gets `aria-current="page"`, the accent colour, and a 3 px top indicator bar.

| Route | Screen | Chrome | Notes |
|---|---|---|---|
| `#/onboarding` and `#/onboarding/:step` (1–3) | Onboarding | none | Shown on first launch, when `settings.onboarded` is false |
| `#/alarms` | Alarm list | tab bar | Default route |
| `#/alarm/new` | Alarm editor (draft) | top bar | The draft lives in an in-memory store until Save |
| `#/alarm/:id` | Alarm editor | top bar | `:id` = alarm id, or `new` for the draft |
| `#/alarm/:id/missions` | Mission picker | top bar | Adds to the editor's draft |
| `#/alarm/:id/missions/:index` | Mission config | top bar | `index` 0–2. Index `n` (append) comes from the picker as `?type=qr` |
| `#/alarm/:id/missions/:index/qr` | QR register | top bar | Camera |
| `#/ring` | Ringing | none, locked | Query: `alarmId`, `test=1`, `reason=reboot|killed|wakecheck` |
| `#/ring/mission/:step` | Mission play | none, locked | `step` 0..n-1 of the chain. `?snooze=1` when snoozing needs the mission |
| `#/ring/fallback` | Backup mission offer | none, locked | |
| `#/snoozed` | Snoozed | none | |
| `#/done` | Good morning | none | |
| `#/wakecheck` | Wake-up check prompt | none, locked | |
| `#/health` | Reliability | top bar | Also reachable from the list's status pill and from Settings |
| `#/stats` | Statistics | tab bar | |
| `#/settings` | Settings | tab bar | |
| `#/settings/licences` | Open-source licences | top bar | |

**"Locked" routes** (ring, mission, fallback, wakecheck) have no back arrow, no tab bar, and ignore hardware Back (native
blocks it, and the web build calls `history.pushState` again on `popstate`). They set `overscroll-behavior: none`,
`user-select: none`, and request a screen wake lock. The native side opens them with the full-screen intent (D-008).

**Route change contract.** Set `document.title` to `"<Screen title> · Rouse"`. Move focus to the screen's `<h1 tabindex="-1">`.
Restore scroll to the top, except for back navigation to the list, which restores the list's scroll position.

**Top bar (non-tab routes):** 56 px tall. It holds a back `IconButton` (aria-label "Back"), a centred `<h1>` title, and an
optional right text action (for example "Save").

---

## 3. Screens

Copy is final unless it is marked *(example)*. `{x}` is an interpolated value. Times follow the 24 h setting. `{in}` is the
relative format from §7.4.

### 3.1 Onboarding (`#/onboarding/1..3`)

All three steps share one layout. The top shows "Step {n} of 3" as text, with 3 dots below it (`aria-hidden`). The middle
holds the content. The bottom has a primary button and an optional text button. **Web build only:** a `Banner` (warning)
sits above the content on every step: **"Demo only. This web version can't wake a locked phone or ring when the tab is
closed. Use the Android app for real alarms."**

**Step 1: Welcome.** Sun icon (64 px). H1 **"Rouse gets you out of bed."** Body: **"Choose a mission (math, a QR
code in another room, steps…) and the alarm keeps ringing until you've done it."** Below it, three lines, each with a check
icon: **"Every feature is free"**, **"No ads, no account"**, **"No internet: nothing leaves your phone"**. Primary button:
**"Get started"**.

**Step 2: Make sure it rings.** H1 **"Make sure it rings"**. Helper: **"Android can block alarms. Allow these so Rouse
works when your phone is locked."** Below that is a list of 4 `CheckRow`s, the same component the health screen uses (§3.12):
Notifications, Alarms & reminders, Full-screen alerts, Battery: unrestricted. Each row shows its status and an **"Allow"**
button, and re-checks when the app resumes (`visibilitychange`). Primary button: **"Continue"**, always enabled. When any
row is not OK, a text line sits above the button: **"Rouse might not ring reliably until these are allowed. You can fix
them later in Reliability."** On the web build, each row reads "Not available in the web demo" with an info icon and no button.

**Step 3: Your first alarm.** H1 **"Your first alarm"**. It has a `TimePicker` (default 07:00), DayChips with the
"Weekdays" preset applied, and a read-only line, **"Mission: Math · Easy · 3 problems"**, with a **"Change"** text
button that opens the full editor later. Primary button: **"Create alarm"**, which saves, sets `onboarded`, and goes to
`#/alarms` with the toast "Alarm set for {time}, {in}". Text button: **"I'll do it later"** sets `onboarded` and goes to
`#/alarms`.

Accessibility: each step's H1 gets focus. "Step 2 of 3" is real text, not only dots.

### 3.2 Alarm list (`#/alarms`)

Layout, top to bottom:
1. **Header row.** H1 "Alarms" on the left. On the right, a `StatusPill` linking to `#/health`: ok "Ready", warn
   "{n} issues", or error "Can't ring". The aria-label is the full sentence, for example "Reliability: 2 issues. Open reliability check".
2. **Web demo banner** (web build only, same copy as §3.1). It can be collapsed to a one-line "Demo mode · can't wake a
   locked phone" with an info icon, and it never fully disappears.
3. **Next-alarm hero card.** Overline "Next alarm". Countdown in `--fs-2xl`: **"in 7 h 12 m"**. Sub-line: **"Tue 06:30 ·
   Wake up"**. It updates every 30 s. Its `aria-label` is "Next alarm in 7 hours 12 minutes, Tuesday 6:30, Wake up". With no
   enabled alarms it reads **"No alarms on"** with the sub-line "Turn one on below or create a new one." When the next one is
   being skipped, it adds a line with the skip icon: "Skipping Mon 06:30".
4. **Quick nap** (secondary button, full width, moon icon): **"Quick nap"**. It opens a sheet (see below).
5. **Alarm cards**, sorted by time of day.
6. **Extended FAB** in the bottom-right above the tab bar: 64 px tall, accent colour, plus icon and **"New alarm"**. It goes to `#/alarm/new`.

**AlarmCard.** It is a `Card` with the whole card as a link to `#/alarm/:id`. The toggle and the overflow menu stop
propagation. Layout:
- Left column. Time `--fs-3xl` with tabular numbers ("06:30", or "6:30" plus a small "AM"). Label below (1 line,
  ellipsis), or "Alarm" if empty. Repeat summary ("Weekdays", "Mon, Wed, Fri", "Once · tomorrow"). Then a mission icon row of up
  to 3 icons at 20 px, with a `+n` text when random, and `aria-label="Missions: QR code, then Math"`. Zero missions shows the text "No mission".
- Right column. `Toggle` (role=switch) with a visible "On" or "Off" text below it. The aria-label is "Alarm 06:30, Wake up, Weekdays".
  Below it, an overflow `IconButton` ("More options for 06:30 alarm") opens a menu sheet: **"Skip next (Tue 06:30)"** /
  **"Don't skip"**, **"Duplicate"**, **"Delete"**. Delete asks for the same confirmation as in the editor.
- Off state: the time and label switch to `--text-muted`, and the "Off" text shows. It is not only dimmed.
- Skipped state: a `StatusPill` (info, skip icon) reading "Skipping Tue".

**States.**
- Loading (>150 ms): 3 skeleton cards in `--surface-2`, with no shimmer.
- Empty: sun icon, H2 **"No alarms yet"**, body **"Set one up and choose how you'll prove you're awake."**, and a primary
  **"Create your first alarm"** button. The hero and FAB stay hidden.
- Error: Banner (error) **"Couldn't load your alarms. Alarms already set will still ring."** with a **"Try again"** button.
- Toggle on: toast "Alarm set for {in}". Toggle off: toast "Alarm off". Toasts use a polite live region, last 4 s, and are never stacked.

**Quick nap sheet.** Title "Quick nap". Chips 10 / 20 / 30 / 45 / 60 min, single-select (role=radio, default 20). A Toggle
**"Require mission"** (default off; when on, it uses the default mission from settings). Primary **"Start nap · rings at
{time}"**. It creates a one-off, unlabelled "Nap" alarm.

### 3.3 Alarm editor (`#/alarm/new`, `#/alarm/:id`)

Top bar: Back, title **"New alarm"** or **"Edit alarm"**, and a right action **"Save"**. The body is a single scroll of sections,
each with an H2. A sticky bottom bar holds the primary button **"Save alarm"** (full width). Back with unsaved changes opens a
Dialog: **"Discard changes?"** with "Keep editing" (primary, focused) and "Discard" (danger text).

**Section: Time.** `TimePicker` (§5). Below it, live text **"Rings {in}"** (`aria-live="polite"`, debounced 600 ms).
- Hour stepper and minute stepper sit side by side. Each has a 64×64 "−" button, a value display 96 px wide in `--fs-clock-hero`,
  and a 64×64 "+" button. Tapping the value turns it into `<input inputmode="numeric" maxlength=2>` with the text selected.
  Enter or blur commits, and an invalid value reverts with the helper text **"Enter 0–23"** (or 1–12 / 0–59).
- Hold-to-repeat starts after 400 ms at 8 steps/s. Minutes switch to 5-minute jumps after 2 s held. Values wrap around.
- In 12 h mode, an AM/PM segmented control (2 × 64 px) sits under the steppers.

**Section: Repeat.** `DayChips`: 7 chips in locale week order, each 48 px or more, single letter, with a full-name aria-label
("Monday"). Below is a preset row of text chips: **"Once" · "Weekdays" · "Weekends" · "Every day"**. A summary line
follows: **"Weekdays"** or **"Once · tomorrow, Thu 16 Oct"**.

**Section: Label.** A text input with placeholder **"Label (optional)"**, a maximum of 40 characters, and a counter shown from 30 characters.

**Section: Sound.**
- A `ListRow` **"Sound"** whose value is the tone name. It opens a Sheet with a radio list of bundled tones:
  *Sunrise Bell, Rising Chimes, Classic Bell, Digital Beep, Rooster, Klaxon (extra loud)*. On native, it adds
  **"Choose from phone…"**. Each row has a play/stop `IconButton` ("Preview Sunrise Bell"). The preview plays for at most
  10 s at the alarm volume, and only one plays at a time. The sheet footnote reads: **"If a sound can't play, Rouse uses its
  built-in backup tone."** A sheet's own preview stops when the sheet closes.
- `ListRow` **"Volume ramp"**: Sheet radio *Off · 15 s · 30 s (default) · 1 min · 2 min*. Helper: **"Starts quiet and gets
  louder."**
- `ListRow` with Toggle **"Vibrate"** (default on).

**Section: Snooze.**
- Toggle **"Allow snooze"** (default on).
- When it is on: Stepper **"Snooze length"**, 1–30 min, default 5, aria-valuetext "5 minutes". Stepper **"Snoozes allowed"**,
  1–10, default 3. Toggle **"Snoozing needs the mission too"** (default off), with helper **"You'll finish the mission
  to snooze, not just to turn off."**

**Section: Missions.** H2 "Missions", with a counter **"{n} of 3"**.
- 0–3 `MissionRow`s. Each has the mission icon, its name, and a summary ("Medium · 3 problems", "Bathroom sink"). Tapping
  the row goes to `#/alarm/:id/missions/:i`. Next to it: move up / move down IconButtons ("Move Math up"), shown only when
  there are 2 or more missions, plus a remove IconButton ("Remove Math"). Rows run in chain order and are labelled "1", "2", "3".
- Secondary button **"Add mission"** goes to the picker. At 3 missions it is disabled, with the helper **"Up to 3 missions."**
- With 0 missions, a helper reads: **"No mission: one tap turns the alarm off. Add one to make sure you get up."**
- A QR mission with no registered code gets a warning `StatusPill` **"Code not set"**, and Save is blocked by the error
  **"Scan a code for the QR mission, or remove it."**, which scrolls to and focuses the row.

**Section: Wake-up check.** Toggle **"Wake-up check"**, with helper **"A few minutes after you turn the alarm off, Rouse
asks if you're still up. No answer means it rings again."** When it is on: Select **"Ask after"** *3 · 5 (default) · 10 · 15
min*, and Select **"Time to answer"** *60 · 90 (default) · 120 s*.

**Section: Test.** Secondary button **"Test this alarm"** (play icon) opens `#/ring?alarmId=:id&test=1` using the draft's
current settings, including sound. It does not save.

**Delete** (existing alarms only, at the bottom): danger-outline button **"Delete alarm"**. Dialog: **"Delete this
alarm?"**, body "{time} · {label}". Buttons: "Keep" (primary, focused) and "Delete" (danger). After deleting, it goes to `#/alarms`
with the toast "Alarm deleted".

Save: validate, persist, sync to native, go to `#/alarms`, toast **"Alarm set for {in}"**. Errors show inline under
the section, and focus moves to the first error. On a native sync failure, show the Banner (error) **"Saved, but Android
didn't accept the schedule. Open Reliability to fix it."** with the button "Open Reliability".

### 3.4 Mission picker (`#/alarm/:id/missions`)

Title **"Add a mission"**. A 2-column grid of `MissionTile`s, each at least 120 px tall, with icon, name and a one-line
description. Tiles are `<button>`s.

| Type | Name | Description | Badge |
|---|---|---|---|
| math | Math | Solve a few sums | |
| memory | Memory | Repeat a pattern of tiles | |
| typing | Typing | Type a phrase exactly | |
| shake | Shake | Shake your phone | "Easy to do in bed" |
| qr | QR / barcode | Scan a code in another room | "Gets you up" |
| tap | Tap | Hit moving targets | |
| steps | Steps | Walk around | "Gets you up" |
| squat | Squats | Do squats holding the phone | "Can be faked" |
| random | Random | A different mission each time | |

Unavailable on this device (no step sensor, no camera, no accelerometer): the tile stays visible but has
`aria-disabled="true"`, an info icon, and the text **"Not available on this phone"**. It is never silently hidden.
Selecting a tile goes to the config screen for a new index, which adds the mission when you tap "Done".

### 3.5 Mission config (`#/alarm/:id/missions/:index`)

Title = the mission name. Common footer: a secondary **"Try it now"** button runs the play screen in practice mode, with no
sound and a "Practice" pill, and then comes back. The primary is **"Done"**. When editing an existing mission, a "Remove
mission" text button is added. Every config shows a live **example** line.

- **Math.** Difficulty `Segmented` with 5 levels (role=radiogroup): *Very easy · Easy · Medium · Hard · Very hard*. Examples:
  "3 + 4", "12 + 25", "34 × 3", "47 × 6 + 18", "128 × 7 − 345". Answers are never negative, and division always comes out
  exact. Stepper **"Problems"** 1–10, default 3.
- **Memory.** Segmented **"Grid"** *3×3 · 4×4 · 5×5*. Stepper **"Tiles to remember"** 3–8, capped at grid cells / 2, default 4.
  Stepper **"Rounds"** 1–5, default 2.
- **Typing.** Segmented **"Phrase"** *Built-in · My own*. With "My own": a textarea of 10–200 characters with placeholder
  **"Today I'm getting up because…"**. Stepper **"Phrases"** 1–5, default 2 (built-in only). Toggle **"Ignore capitals and extra
  spaces"**, default on.
- **Shake.** Stepper **"Shakes"** 10–300, step 10, default 30. Segmented **"Strength needed"** *Light · Normal · Hard*.
- **Tap.** Stepper **"Targets"** 10–60, step 5, default 20. Segmented **"Speed"** *Slow · Normal · Fast* (time a target
  stays: 3 s / 2 s / 1.2 s; a missed target respawns and doesn't count as a failure).
- **Steps.** Stepper **"Steps"** 10–300, step 10, default 30. Needs the `ACTIVITY_RECOGNITION` permission. Before it is
  granted, an inline `CheckRow` reads "Physical activity · Needed to count steps" with an **"Allow"** button. When it is denied:
  **"Without this, Rouse can't count steps. Choose another mission or allow it in Android settings."** with "Open settings".
- **Squats.** Stepper **"Squats"** 5–50, default 10. A Banner (info), always visible: **"Squats are detected from phone
  motion, so they can be faked by moving the phone up and down. Add a second mission if that worries you."**
- **Random.** Chips (multi-select, at least 2) **"Pick from"**: Math, Memory, Typing, Tap, Shake. These are the missions
  that need no setup or permission, so a random pick can never be impossible. Segmented **"Difficulty"** *Easy · Medium · Hard*.
- **QR / barcode.** A Label input **"Where is it?"** with placeholder **"Bathroom sink"**. Status: **"Code saved"** (check
  icon, plus the last 4 characters of the payload) or **"No code yet"**. Primary **"Scan a code"** (or **"Scan a different
  code"**) goes to the register screen. Secondary **"Test scan now"** opens the scanner in test mode and reports **"That's the
  one. ✓"** or **"Different code. This alarm wants the one at {where}."** Tip text: **"Print a QR code or use a product
  barcode, and keep it outside your bedroom."**

**QR register (`…/qr`).** A full-width camera preview (4:3) with a 240 px square guide frame. A torch `IconButton` (64 px,
"Turn on light" / "Turn off light", `aria-pressed`). Instruction **"Point at a QR code or barcode."** On detection: a short
haptic, the preview freezes, and a Sheet opens with **"Code found"**, the payload preview (first 24 characters), and the buttons
"Use this code" (primary) and "Scan again". States: while the camera starts, a spinner and "Starting camera…". When
permission is denied: H2 **"Rouse can't use the camera"**, body "Allow camera access to register a code.", buttons "Allow
camera" or "Open settings" (if permanently denied), and "Cancel". With no camera: "This phone has no camera Rouse can use." If
nothing is found within 20 s, a hint appears: **"Having trouble? Turn on the light or move a bit further away."**

### 3.6 Ringing (`#/ring`)

The audio is native (D-008) and already playing before this screen exists. The background is `--bg`. There is no
chrome, and nothing is clickable outside the controls.

Layout, top to bottom:
1. Context banner, only when it applies: **"Test alarm · won't count in stats"** with an **"End test"** text button (test
   mode only). **"The alarm was interrupted, so it's ringing again."** (`reason=killed|reboot`). **"You didn't answer the
   wake-up check, so the alarm is back."** (`reason=wakecheck`).
2. Date, `--fs-lg`, muted: "Thursday 16 October".
3. Clock, `--fs-clock-ring`, tabular, weight 300: "06:30". It updates every second, with no visible seconds.
4. Label, `--fs-xl`: "Wake up". The empty case shows nothing.
5. Snooze info when snoozed before: "Snoozed {k} of {max}".
6. Spacer (flex: 1).
7. **Primary** (72 px, full width, accent): **"Start mission"**, with a sub-label in `--fs-sm`: "Math, then QR code"
   (or "Random mission"). With 0 missions it reads **"Turn off"**.
8. **Snooze** (64 px, full width, secondary, snooze icon): **"Snooze {len} min · {left} left"**. When snooze needs the
   mission, the sub-label is "Finish the mission to snooze". With the limit reached, it stays visible but
   `aria-disabled="true"` and reads **"No snoozes left"**, with the line above it: **"Finish the mission to turn the alarm
   off."** When snooze is turned off for this alarm, the button is not rendered.

Interaction: initial focus goes to Primary. The screen announces through the assertive live region: "Alarm, 06:30, Wake up."
Tapping Primary sends `silenceForMission()` to the backend, which mutes the audio and starts the idle timer (§3.7), then goes
to `#/ring/mission/0`. Snooze: the backend snoozes, then `#/snoozed`. With snooze-needs-mission, it goes to the mission chain
with `?snooze=1`. The hardware volume keys do nothing (native).

### 3.7 Mission play frame (shared by every mission)

Layout:
1. **Top strip** (sticky, 56 px). Left: **"Mission {i} of {n} · {Name}"** (or "Practice · {Name}"). Right: the step progress
   "{k} of {total}" (problems, rounds, phrases). A "Back to alarm" text button sits on its own row below this.
   It returns to `#/ring`, and the sound resumes immediately.
2. **Idle meter.** It is always visible. The text **"Sound off while you work"** sits beside a 4 px bar that depletes over
   30 s. At ≤10 s the text becomes **"Alarm returns in {s} s"** in `--warn`, with a warning icon. The live region announces
   at 10 s and 5 s. At 0, the backend resumes audio, the bar fills red, and the text becomes **"Alarm is back. Keep going to
   turn it off."** Progress is kept. Any pointer, key or sensor progress event (shake, step, squat counted) calls
   `silenceForMission()` again and resets the meter to 30 s. Practice mode hides the meter.
3. **Mission content** (below).
4. **Footer** (shown after the first failure, after 60 s, or immediately when the mission's hardware or permission is unavailable): text button **"Can't do this mission?"** (48 px) goes to
   `#/ring/fallback`.

Success on the last step of the last mission: success haptic, a large check icon with "Done" for 600 ms (instant with
reduced motion), then the backend dismisses and the app goes to `#/done`. If `?snooze=1`, it snoozes instead and goes to `#/snoozed`.
Between chained missions: a 1 s interstitial, **"Next: {Name}"**, while the meter keeps running.

**Failure feedback** (wrong answer, wrong tile, wrong code): a text message in the assertive live region plus an
error icon, and a 300 ms horizontal shake (none with reduced motion). It never uses colour alone.

#### Missions
- **Math.** The problem is centred at `--fs-3xl`, "34 × 3 = ?", and announced as "34 times 3". The answer display is a
  64 px tall box, with `aria-live="off"` and a label of "Your answer". Below is a **custom keypad** in a 3×4 grid: 1–9, "⌫" ("Delete
  digit"), 0, and "✓" (Enter, accent, "Check answer"). Keys are at least 72×64. A physical keyboard also works. Wrong: **"Not quite. Try
  again."** The answer clears, the problem stays the same, and the failure count goes up by one.
- **Memory.** It has two phases. *Show*: H2 **"Remember these tiles"**. A grid of square tiles at least 64 px (5×5 fits at
  360 px width with 6 px gaps). Highlighted tiles use the accent fill, a 3 px border, and a **filled star glyph**. They show
  for 2 s + 0.4 s per tile, and the live region lists them ("Row 1, column 3; row 2, column 1…"). *Recall*: H2 **"Tap the tiles
  you saw"**, with a counter "{k} of {n}". Each tile is a `<button>` labelled "Row r, column c". A tapped correct tile shows a
  check glyph and gets `aria-pressed=true`. A wrong tap shows an X glyph on that tile and the message **"That one wasn't in the
  pattern. Watch again."**, then the round replays and counts one failure.
- **Typing.** A Card shows the phrase in `--fs-xl`, line-height 1.5. It is not selectable or copyable
  (`user-select:none`, `oncopy` prevented). Below it is a textarea with `autocomplete=off autocorrect=off autocapitalize=off
  spellcheck=false`, paste blocked, and the message **"Type it, don't paste it."** if a paste is attempted. Live progress
  "{k} of {n} characters correct". The first mismatched character is marked in the phrase card with a wavy underline and a "▲"
  marker below it (not colour only). The primary **"Check"** is enabled once the length matches. Wrong: **"A few characters
  don't match. Look for the ▲ mark."**
- **Shake.** A `ProgressRing` (240 px) with "{k}" big and "of {n}" below, and the instruction **"Shake the phone hard"**.
  A native haptic tick per shake. Screen readers hear "{k} of {n}" at every 25%. If no motion events arrive within 5 s
  (web: permission needed), it shows the button **"Allow motion sensor"**.
- **QR scan.** The camera preview is 4:3 or larger, with the guide frame and a torch IconButton (64 px). Instruction: **"Scan
  the code at {where}"**. Wrong code: **"That's a different code. Find the one at {where}."** (counts one failure). Camera
  denied or unavailable: **"Rouse can't use the camera right now."** with the buttons **"Allow camera"** and **"Use backup
  mission"**. The backup is offered immediately in this case.
- **Tap.** A full-width arena (60% of viewport height) with a dashed border. One target at a time: a 72 px circle with a
  "+" glyph and a 3 px border, placed randomly at least 8 px inside the edges. Counter "{k} of {n}". Each target is a
  `<button aria-label="Target {k}">`, and focus follows the new target so keyboard and switch users can still finish.
  Respawn timing comes from Speed.
- **Steps.** ProgressRing "{k} of {n} steps", with **"Walk around. Keep this screen on."** A sensor or permission problem shows
  **"Rouse can't count steps on this phone right now."** and makes the backup available immediately.
- **Squats.** ProgressRing "{k} of {n} squats", with **"Hold the phone to your chest and squat."**

### 3.8 Backup mission offer (`#/ring/fallback`)

**When it unlocks.** It unlocks at `failures ≥ settings.fallbackAfterFailures` (default 3), after `elapsed ≥
settings.fallbackAfterMinutes` (default 5) on the current mission, or immediately when the hardware or permission is
unavailable. Before then, tapping "Can't do this mission?" opens a Sheet: **"The backup mission unlocks after {N} tries or {M}
minutes. So far: {k} tries, {m} min."** with the button "Keep trying".

Once unlocked, the full screen shows H1 **"Switch to the backup mission?"** Body: **"This mission isn't working right now.
The backup is longer on purpose: {20 math problems, medium}. It still turns the alarm off."** Primary **"Start backup
mission"**, secondary **"Keep trying"**. The backup replaces only the current mission in the chain; the remaining
missions still run. The backup itself never offers another backup. Its "Can't do this mission?" is hidden, because math
needs no hardware. The idle meter stays active.

### 3.9 Snoozed (`#/snoozed`)

H1 **"Snoozed"**. Big text **"Rings again at 06:40"**, then "{mm:ss} to go" (updates each second, with `aria-live` off. A
polite announcement happens only on mount). Line: "Snoozes left: {left}". Primary **"I'm up: turn it off"** runs the mission
chain, and finishing it dismisses the alarm and cancels the snooze. Off-screen behaviour belongs to native. This screen is a
courtesy view.

### 3.10 Good morning (`#/done`)

No ads, no feeds. A sun icon, then H1 **"Good morning"**. Lines:
- **"You're up at 06:34."** plus "Mission took 1 min 48 s." (omitted in test mode)
- Streak (flame icon): **"{n}-day streak"** when n ≥ 2. Otherwise nothing. Never "streak lost".
- If a wake-up check is pending (info Banner): **"Wake-up check in 5 min. Keep your phone nearby."**
- Next alarm: **"Next alarm: Tue 06:30 · {in}"**, or "No other alarms on."
- Primary **"Done"** goes to `#/alarms`. Test mode shows the line **"Test finished. Nothing was recorded."**

### 3.11 Wake-up check (`#/wakecheck`)

Native fires a high-priority notification with a full-screen intent and a short chime, not the alarm tone. Screen:
H1 **"Still up?"** A `ProgressRing` (240 px) counts down from the answer window, showing "1:30" in the centre (`role="timer"`).
The primary (72 px) is **"I'm awake"**, and it gets initial focus. The line below: **"If you don't answer, the alarm rings
again with your mission."** When confirmed, the screen shows **"Nice. Have a good day."** for 2 s, then goes to `#/alarms`. On
timeout, native re-rings and the app opens `#/ring?reason=wakecheck`. Screen-reader announcements at 60, 30 and 10 s remaining.

### 3.12 Reliability / Health (`#/health`)

Title **"Reliability"**. Summary card at the top:
- All OK: check-circle icon, **"Rouse can ring"**, with "Last test: rang OK on {date}." or "Run a test to be sure."
- Some warn: alert icon, **"{n} things could stop your alarm"**.
- Any error: x-octagon icon, **"Your alarms may not ring"**.
- Web: info icon, **"Web demo: alarms only ring while this tab is open and the screen is on."**

**CheckRow** list. Each row has a status icon (24 px), a title, the status word, and a one-line explanation, plus a fix button
(48 px, secondary) when not OK:

| Check | OK text | Problem text | Fix button |
|---|---|---|---|
| Notifications | "Allowed" | "Off: Rouse can't show the alarm screen." | "Allow" |
| Alarms & reminders | "Allowed" | "Off: alarms may ring late or not at all." | "Allow" |
| Full-screen alerts | "Allowed" | "Off: the alarm shows as a small banner instead of full screen." | "Allow" |
| Battery | "Unrestricted" | "Optimised: Android may stop Rouse overnight." | "Fix" |
| Do Not Disturb | "Alarms allowed" | "Do Not Disturb is blocking alarms." | "Open settings" |
| Alarm volume | "{p}%" | "Alarm volume is at {p}%. Rouse raises it while ringing, but check it's not muted." (warn) | "Open sound settings" |
| Phone maker | "{Brand}: no known issues" | "{Brand} phones often stop apps in the background." (warn) | "Read the steps" opens `https://dontkillmyapp.com/{vendor}` in the external browser |
| Test alarm | "Rang OK on {date}" | "Never tested" (warn) / "Last test didn't ring" (error) | (see below) |

Status words with icons: **OK** (check-circle, `--ok`), **Needs attention** (alert-triangle, `--warn`), **Blocked**
(x-octagon, `--danger`), **Unknown** (help-circle, muted), **Not in web demo** (info). Each row is a single
`<li>` whose accessible name is "{Title}: {status word}. {explanation}".

Bottom: primary **"Test alarm in 1 minute"**. It schedules a native alarm 60 s ahead, using the default sound and a 1-problem
very-easy math mission, and does not count in stats. The button then becomes a disabled countdown, **"Test rings in 0:58"**,
with a "Cancel test" text button. Helper: **"Lock your phone now. If it doesn't ring, the checks above should show why."**
When the test rings and is dismissed, the result is recorded. Footnote (muted): **"If you Force stop Rouse in Android
settings, Android cancels its alarms until you open Rouse again."**

All rows re-check on mount and on `visibilitychange` → visible, with "Checking…" and a spinner per row (Unknown status) while pending.

### 3.13 Stats (`#/stats`)

H1 "Stats". A Segmented range selector, **"7 days" · "30 days"**. A 2×2 grid of stat cards (each `<section aria-labelledby>`):
- **"Streak"**: "{n} days". Helper "Mornings in a row you got up with your alarm."
- **"Average wake time"**: "06:41" (the time of the final dismissal).
- **"Snoozes"**: "{n}", with helper "in the last 7 days".
- **"Mission time"**: "1 min 32 s" average.

Chart card. H2 **"Time to get up"**, subtitle "Minutes from first ring to alarm off". Bars are SVG, one per day, labelled
with the day initial. A bar's height is the minutes, with a value label above any bar ≥1. Bars use `--accent` with a 1 px
`--border` outline. Days without an alarm show a "–" label (no bar). The chart has `role="img"` with an `aria-label` summary:
"Over 7 days, you took 2 to 9 minutes to get up, 4 on average." A toggle text button **"Show as table"** reveals a `<table>`
(Day, Alarm, Off at, Minutes, Snoozes). Test alarms are excluded.

Empty: chart icon, **"No mornings yet"**, and "Stats appear after your first alarm." There are no fake or sample numbers.

### 3.14 Settings (`#/settings`)

H1 "Settings". Grouped `ListRow`s under H2s:
- **Appearance.** Segmented **"Theme"** *Dark (default) · Light · System*. Toggle **"24-hour clock"** (default from locale).
- **New alarm defaults.** Rows for Sound, Volume ramp, Snooze, Mission (opens a picker + config, scoped to the defaults), and
  Wake-up check. Helper: **"Used for new alarms. Existing alarms don't change."**
- **Missions.** Stepper **"Backup mission after"** 2–10 tries (default 3). Select **"or after"** 3 / 5 / 10 min (default 5).
  Select **"Backup mission"** *20 math problems (medium)* · *Type 3 long phrases*. Helper: **"So you're never stuck if a
  mission can't work. It's longer on purpose."**
- **Bedtime.** Toggle **"Bedtime reminder"**. When it is on: Select **"Remind me"** *7 h · 7 h 30 · 8 h (default) · 8 h 30 · 9 h
  before my next alarm*. Helper: **"A quiet notification. It doesn't ring."** Notification text: "Bedtime. Your
  alarm is set for {time}."
- **Quick nap.** Select "Default length" (same values as the sheet).
- **Reliability.** A ListRow linking to `#/health`, with its StatusPill.
- **Backup.** **"Export alarms & settings"** saves `rouse-backup-YYYY-MM-DD.json` (Android share/save sheet; web uses a download),
  with the toast "Backup saved". **"Import from file"** opens the file picker, then a preview Dialog: **"Restore this
  backup?"**, body "From {date}: {n} alarms, your settings{, and stats}. This replaces your {m} current alarms." Buttons:
  "Cancel" (focused) and "Replace". Errors (Banner, error): **"This file isn't a Rouse backup."** / **"This backup is from a newer
  version of Rouse. Update the app, then try again."** / **"Couldn't read the file. Try exporting it again."** Helper: **"Backups
  include QR codes and stats. Keep the file private."**
- **Data.** Danger text button **"Clear statistics"**. Dialog: **"Clear all statistics?"** with "Keep" and "Clear".
- **About.** "Rouse {version}". **Privacy statement** (a Card with a shield icon): **"Rouse has no internet permission.
  Your alarms, codes and stats never leave this phone. No ads, no analytics, no account."** Rows: "Source code" (external
  link), "Licences" (`#/settings/licences`: MIT for Rouse, plus third-party notices for Preact MIT, Capacitor MIT, jsQR
  Apache-2.0, and sounds CC0), and "Show the welcome screens again".

---

## 4. Visual system (paste into `src/ui/tokens.css`)

The theme is set by `<html data-theme="dark|light">`. With "System", the app sets the attribute from
`matchMedia('(prefers-color-scheme: dark)')` and updates it on change. Also update `<meta name="theme-color">` to `--bg`.

```css
:root, [data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1115;        --surface: #181b22;   --surface-2: #232733;
  --text: #f2f4f8;      --text-muted: #aeb6c4;
  --border: #7a8396;    /* control outlines: ≥3:1 */
  --divider: #2a2f3a;   /* decorative only, never the sole boundary of a control */
  --accent: #ffb547;    --on-accent: #1a1206; --accent-text: #ffc46b;
  --danger: #ff8a80;    --on-danger: #1f0705; --danger-bg: #3a1715;
  --ok: #6fdc8c;        --ok-bg: #16301f;
  --warn: #ffd166;      --warn-bg: #33290f;
  --info: #9cc2ff;      --focus: #9cc2ff;
  --scrim: rgb(0 0 0 / 0.6);
  --shadow-1: 0 0 0 1px var(--divider);
  --shadow-2: 0 8px 24px rgb(0 0 0 / 0.5), 0 0 0 1px var(--divider);
}
[data-theme="light"] {
  color-scheme: light;
  --bg: #f7f5f0;        --surface: #ffffff;   --surface-2: #ece8de;
  --text: #1b1d22;      --text-muted: #4f5562;
  --border: #767264;    --divider: #dcd7cb;
  --accent: #a34f00;    --on-accent: #ffffff; --accent-text: #8f4500;
  --danger: #b3261e;    --on-danger: #ffffff; --danger-bg: #fbe4e1;
  --ok: #1d6b35;        --ok-bg: #e3f3e7;
  --warn: #7a5000;      --warn-bg: #fbf0d6;
  --info: #1f5fbf;      --focus: #1f5fbf;
  --scrim: rgb(0 0 0 / 0.4);
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.06);
  --shadow-2: 0 8px 24px rgb(0 0 0 / 0.16);
}
:root {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  /* rem-based so the Android font scale applies; layouts must work at 200% */
  --fs-sm: 0.9375rem;  /* 15px, secondary/meta only */
  --fs-body: 1.0625rem;/* 17px */
  --fs-lg: 1.25rem;    /* 20 */
  --fs-xl: 1.5rem;     /* 24 */
  --fs-2xl: 2rem;      /* 32 */
  --fs-3xl: 2.75rem;   /* 44: card time, math problem */
  --fs-clock-hero: 4rem;                      /* 64: editor steppers */
  --fs-clock-ring: clamp(5rem, 26vw, 8rem);   /* 80–128: ringing clock */
  --lh-tight: 1.15; --lh-body: 1.5;
  --fw-regular: 400; --fw-medium: 500; --fw-bold: 700; --fw-clock: 300;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
  --r-sm: 8px; --r-md: 12px; --r-lg: 20px; --r-pill: 999px;
  --tap-min: 48px; --tap-ring: 64px; --tap-ring-primary: 72px;
  --dur-fast: 120ms; --dur-med: 200ms; --dur-slow: 320ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 5px var(--focus);
}
body { margin: 0; background: var(--bg); color: var(--text); font: var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans);
       -webkit-tap-highlight-color: transparent; }
.tabular, time, [data-clock] { font-variant-numeric: tabular-nums; }
:focus { outline: none; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: inherit; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
                           transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

**Contrast (WCAG 2.x, computed).**

| Pair | Dark | Light | Use |
|---|---|---|---|
| text / bg · surface · surface-2 | 17.2 · 15.7 · 13.5 | 15.5 · 16.9 · 13.8 | body text (AAA) |
| text-muted / bg · surface · surface-2 | 9.3 · 8.4 · 7.3 | 6.9 · 7.5 · 6.1 | helper text (AA+) |
| on-accent / accent | 10.6 | 5.7 | primary button label |
| accent-text / bg · surface | 12.0 · 11.0 | 6.4 · 7.0 | links, active tab |
| on-danger / danger | 8.4 | 6.5 | danger button |
| danger / bg · surface | 8.3 · 7.6 | 6.0 · 6.5 | error text |
| ok / bg · surface | 11.1 · 10.1 | 6.0 · 6.6 | status text/icon |
| warn / bg · surface | 13.1 · 12.0 | 6.5 · 7.1 | status text/icon |
| info / surface | 9.5 | 6.1 | info icon/text |
| ok/warn/danger on their *-bg | 8.3 / 9.9 / 7.0 | 5.7 / 6.2 / 5.4 | Banner text |
| text on ok/warn/danger-bg | 12.9 / 13.0 / 14.5 | 14.7 / 14.9 / 13.9 | Banner body |
| border / bg · surface | 5.0 · 4.5 | 4.4 · 4.8 | control outlines (≥3:1) |
| focus / bg · surface | 10.4 · 9.5 | 5.6 · 6.1 | focus ring (≥3:1) |
| accent / bg · surface (as a shape) | 10.8 · 9.8 | 5.2 · 5.7 | toggle-on track, bars, selected chip |

---

## 5. Component inventory (`src/ui/components/`)

All components forward `class` and `...rest`. Interactive components have a minimum hit area of `--tap-min`, or `--tap-ring`
when `size="ring"`. Disabled controls use `aria-disabled="true"`, not the `disabled` attribute, so they stay focusable and
announce why. Clicks are ignored, and the reason is shown as adjacent text.

| Component | Props | States & notes |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'text'\|'danger'\|'danger-outline'`, `size: 'md'(48)\|'ring'(64)\|'ring-primary'(72)`, `icon?`, `subLabel?`, `block?`, `onClick`, `ariaDisabled?` | default / pressed (scale .98, `--dur-fast`) / focus-visible / aria-disabled (opacity .55 + `cursor:not-allowed`). Primary = `--accent` bg + `--on-accent`. Secondary = `--surface-2` bg + 2 px `--border`. Text = `--accent-text`, underline on focus. Radius `--r-md`; ring sizes use `--r-lg`. Label `--fs-lg`, weight 700 for ring sizes. |
| `IconButton` | `icon`, `label` (required → aria-label), `size: 48\|64`, `pressed?` (toggle → aria-pressed) | Round, `--surface-2`. The icon is 24 px at size 48 and 32 px at size 64. |
| `Toggle` | `checked`, `onChange`, `label`, `description?`, `showStateText=true` | `<button role="switch" aria-checked>`. Track 52×32 with a 2 px `--border` outline. Off: thumb on the left, `--text-muted` thumb. On: accent track, `--on-accent` thumb, and a check glyph inside the thumb. The visible "On"/"Off" text is optional. The whole row is the target. Space/Enter toggle. |
| `DayChips` | `value: number[]` (0=Sun…6), `weekStart: 0\|1`, `onChange`, `locale` | `role="group" aria-label="Repeat on"`. Each chip is a `<button aria-pressed aria-label="Monday">` with a 1-letter visible label (from `Intl` narrow). Selected: accent bg + a 12 px check badge in the corner. Unselected: 2 px border. |
| `Stepper` | `label`, `value`, `min`, `max`, `step`, `wrap?`, `format(v)→string`, `valueText(v)→string`, `size`, `editable?` | `role="spinbutton"` on the value with `aria-valuenow/min/max/valuetext`. Arrow keys ±step, PageUp/Down ±5×step, Home/End. − and + buttons (`aria-label="Decrease {label}"`). Hold-to-repeat (400 ms delay, 8/s). At a bound without wrap, the button is aria-disabled. |
| `TimePicker` | `hour`, `minute`, `use24h`, `onChange` | 2 `Stepper`s (`size=ring`, `editable`, `wrap`) + AM/PM `Segmented`. Group label "Alarm time". |
| `Segmented` | `options: {value,label}[]`, `value`, `onChange`, `label` | `role="radiogroup"`. Each option is `role="radio"` with a roving tabindex and arrow keys. Selected: accent fill + check glyph. |
| `Card` | `as?`, `href?`, `padding?` | `--surface`, `--r-lg`, `--shadow-1`. When `href` is set, the whole card is a link with a visible focus ring. |
| `ListRow` | `title`, `value?`, `description?`, `href?\|onClick?`, `trailing?` (Toggle, chevron, pill) | Min 56 px, chevron for navigation, divider between rows. |
| `Sheet` | `open`, `title`, `onClose`, `children`, `footer?` | Bottom sheet, `role="dialog" aria-modal="true" aria-labelledby`. Focus trap. Initial focus on the first control. Esc/Back/scrim close it (not on locked routes). Slides up over `--dur-slow` (fade only with reduced motion). Max height 85vh. |
| `Dialog` | `open`, `title`, `body`, `actions: {label,variant,onClick,autofocus?}[]` | Centred, `role="alertdialog"` for destructive ones. The safe action comes first and gets focus. |
| `ProgressRing` | `value`, `max`, `size`, `label`, `center: VNode`, `mode: 'progress'\|'timer'` | SVG circle, 12 px stroke: track `--surface-2`, value `--accent`, round cap. `role="progressbar"` (or `timer`) with values. The centre text is the real information. |
| `IdleMeter` | `remainingMs`, `totalMs=30000`, `state: 'quiet'\|'warning'\|'ringing'` | Text + 4 px bar (see §3.7). The icon changes per state: volume-x / alert-triangle / volume-2. |
| `Banner` | `tone: 'info'\|'ok'\|'warn'\|'error'`, `title?`, `children`, `action?`, `collapsible?` | Tone bg (`--*-bg`) + 4 px left border + tone icon. `role="status"` (error: `role="alert"` only when it appears after a user action). |
| `StatusPill` | `tone`, `text`, `href?` | Pill shape, 32 px tall (the 48 px hit area comes from padding when it is interactive), icon + text, 2 px tone border on `--surface`. |
| `TabBar` | `items: {href,label,icon}[]`, `current` | `<nav aria-label="Main">`. Each item is a link, min 64 px tall, icon over a `--fs-sm` label, `aria-current="page"`. |
| `MissionRow` / `MissionTile` | `mission`, `index`, `onMove?`, `onRemove?` / `type`, `available`, `badge?` | See §3.3 and §3.4. |
| `Keypad` | `onDigit`, `onDelete`, `onEnter`, `allowMinus=false` | 3×4 grid of `Button size=ring`. `aria-label="Number pad"`. |
| `Toast` | singleton `toast(text, {action?})` | Bottom, above the tab bar, 4 s, polite live region. Never covers primary buttons on locked routes (not used there). |
| `CheckRow` | `status: 'ok'\|'warn'\|'error'\|'unknown'\|'unsupported'`, `title`, `statusText`, `detail`, `fix?: {label,onClick}` | See §3.12. |
| `LiveRegions` | — | Mounted once in App: `#live-polite` and `#live-assertive` (visually hidden). Helper `announce(text, 'polite'\|'assertive')` clears and then sets the text after 50 ms. |

---

## 6. Iconography

Icons are inline SVG Preact components in `src/ui/icons.tsx`. There is no icon font, no sprite file, and no network.
Each icon uses `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
stroke-linejoin="round"`, with a default size of 24. Icons are `aria-hidden="true" focusable="false"` unless they stand
alone, in which case the IconButton supplies the label. Draw simple original paths, or copy them from Lucide (ISC). If you
copy from Lucide, add its notice to Licences.

| Icon | Used for | Path suggestion / description |
|---|---|---|
| plus | FAB, add | `M12 5v14M5 12h14` |
| check | selected, success | `M5 12l5 5L20 7` |
| x | close, wrong tile | `M6 6l12 12M18 6L6 18` |
| chevron-left / -right / -up / -down | back, row nav, reorder | `M15 6l-6 6 6 6` (rotate for the others) |
| more-vertical | overflow | three `circle r=1` at y 5/12/19 |
| alarm-clock | Alarms tab, app | `circle cx12 cy13 r8` + `M12 9v4l2 2` + `M5 3L2 6M19 3l3 3` |
| bar-chart | Stats tab | `M4 20V10M10 20V4M16 20v-7M22 20H2` |
| sliders | Settings tab (simpler than a gear) | `M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0` + `circle r=2` at 16,6 / 10,12 / 18,18 |
| shield-check | Reliability, privacy | `M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z` + `M8.5 12l2.5 2.5 4.5-5` |
| check-circle / alert-triangle / x-octagon / help-circle / info | status | circle + check; `M12 3L2 21h20L12 3zM12 10v4M12 17.5v.01`; octagon `M8 3h8l5 5v8l-5 5H8l-5-5V8z` + x; circle + `?`; circle + `M12 11v5M12 8v.01` |
| play / square | preview, test | `M7 4l13 8-13 8z` / `rect x6 y6 w12 h12 rx1` |
| volume-2 / volume-x | ramp, idle meter | speaker `M4 9h4l5-4v14l-5-4H4z` + waves / + x |
| vibrate | vibrate row | phone `rect x8 y4 w8 h16 rx2` + `M4 9v6M20 9v6` |
| snooze | snooze button | "Z" strokes: `M4 8h6l-6 8h6M13 4h7l-7 9h7` |
| sun / moon | done screen, theme, nap | circle r4 + 8 rays / crescent `M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z` |
| bed | bedtime | `M3 18v-8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5` + `circle 7,11 r1.5` |
| flame | streak | teardrop flame outline |
| math | Math | `M5 7h6M8 4v6M14 7h6M5 17h6M14 15h6M14 19h6` (plus, minus, equals) |
| grid | Memory | 4 `rect`s 7×7 at (3,3)(14,3)(3,14)(14,14) |
| keyboard | Typing | `rect x2 y6 w20 h12 rx2` + dots + `M7 15h10` |
| shake | Shake | phone rect + `M3 8l-1 4 1 4M21 8l1 4-1 4` |
| qr | QR | three 6×6 `rect`s in the corners + small squares bottom-right |
| target | Tap | `circle r9` + `circle r4` + `circle r.5` |
| footprints | Steps | two rounded soles (ellipses) offset diagonally |
| squat | Squats | `M12 4v.01` head circle + `M12 7v5l-4 4v4M12 12l4 4v4M8 9h8` |
| shuffle | Random | `M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3` |
| flashlight | torch | `M8 3h8v4l-2 3v11h-4V10L8 7z` + `M12 13v2` |
| camera | QR register | body `rect x3 y7 w18 h13 rx2` + `M8 7l2-3h4l2 3` + `circle 12,13 r3.5` |
| skip-forward | skip next | `M5 5l10 7-10 7zM19 5v14` |
| download / upload | export / import | `M12 4v12M7 11l5 5 5-5M4 20h16` / reversed arrow |
| external-link | dontkillmyapp, source | `M14 4h6v6M20 4l-9 9M18 14v6H4V6h6` |
| trash | delete | `M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3` |
| arrow-up / arrow-down | reorder | `M12 19V5M5 12l7-7 7 7` |
| Memory glyphs | tiles | filled star (highlight), check (correct), x (wrong); shapes drawn with `fill="currentColor"` |

---

## 7. Microcopy guide

### 7.1 Voice
Warm, direct and plain, like a friend who set your alarm for you. Use second person ("you"). Use contractions. Write in
sentence case everywhere, including buttons. No exclamation marks except "Good morning" contexts (and only if one fits).
No jokes on the ringing screen.

### 7.2 Rules
- **Never shame.** Don't use "lazy", "failed to wake", "you broke your streak", "cheater", "oops" on the user. For missed
  things, describe what happens next: "You didn't answer the wake-up check, so the alarm is back."
- **Be honest about the product.** Say what doesn't work ("can be faked", "can't wake a locked phone", "Android may stop
  Rouse") and what to do about it.
- **Error pattern:** what happened + what to do, in at most 2 short sentences. Never use error codes alone (log them; show text).
- **Buttons are verbs plus objects:** "Start mission", "Scan a code", "Allow camera". No "OK", "Submit", "Yes/No". The safe
  choice is worded positively ("Keep", "Keep editing").
- **Words we use / avoid:** "turn off" (not "dismiss"), "mission" (not "challenge"/"task"), "backup mission" (not
  "emergency escape"/"cheat"), "Reliability" (not "Health" in the UI), "snooze", "wake-up check", "QR code" (in prose; the tile reads "QR / barcode").
- **Numbers:** use digits ("3 problems", "2 left"). Use ×, − and ÷ symbols in math, read aloud as "times", "minus", "divided by".
- **No urgency theatre:** no countdowns except real ones (snooze, wake-up check, idle meter, test alarm).

### 7.3 Accessibility copy
Every IconButton gets a verb label ("Preview Sunrise Bell", "Remove Math", "Turn on light"). Aria-labels for cards
combine the visible facts in reading order. Status is spoken as a word, never only as an icon name.

### 7.4 Formats (`src/ui/format.ts`, all via `Intl`)
- Time: `06:30` (24 h, zero-padded hour) / `6:30 AM` (12 h).
- Relative "in": `in under a minute` · `in 45 m` · `in 7 h 12 m` · `in 1 d 3 h`. The aria version spells out the units:
  "in 7 hours 12 minutes".
- Date in context: "Tue 06:30"; when more than 6 days away: "Tue 22 Oct, 06:30"; full: "Thursday 16 October".
- Duration: "1 min 48 s", "45 s".
- Repeat summary: all 7 → "Every day"; Mon–Fri → "Weekdays"; Sat+Sun → "Weekends"; none → "Once · {today|tomorrow|Thu 16 Oct}";
  otherwise short days joined with ", " in week order.

---

## 8. Key flows

**8.1 First run.**
1. App starts → `settings.onboarded` is false → `#/onboarding/1`. On web, the demo banner is visible.
2. "Get started" → step 2. The user taps "Allow" on Notifications (runtime prompt), Alarms & reminders (system page), and
   Full-screen alerts (system page). On return, each row re-checks and shows OK.
3. Battery "Allow" → the system dialog for ignoring battery optimisations → OK. "Continue" → step 3.
4. Leave 07:00, Weekdays → "Create alarm" → `#/alarms` with the toast "Alarm set for in 9 h 4 m" and the hero showing the
   countdown. The pill reads "Ready", or "{n} issues" if something was skipped.

**8.2 Create an alarm with a QR mission.**
1. `#/alarms` → "New alarm" → `#/alarm/new`. Set 06:30 with the steppers, or tap the hour and type "6". Choose "Weekdays".
2. Missions → "Add mission" → picker → "QR / barcode" → config. Type "Bathroom sink" into "Where is it?".
3. "Scan a code" → camera permission prompt → allow → scan → the "Code found" sheet → "Use this code" → back to config, which shows "Code saved".
4. Walk away, then "Test scan now" → scan → "That's the one. ✓". "Done" → the editor lists "1 · QR / barcode · Bathroom sink".
5. Optionally "Add mission" → Math (Medium, 3) → Done. The order is QR, then Math.
6. "Test this alarm" → the ringing screen in test mode with the real sound → "Start mission" → complete it, or "End test" → back to the editor.
7. "Save alarm" → `#/alarms`, toast "Alarm set for in 15 h 2 m". The card shows the QR and Math icons.

**8.3 Alarm rings → mission → turn off → wake-up check.**
1. 06:30: native fires, the foreground service plays the tone with a ramp, the full-screen intent opens `#/ring` over the
   lock screen, and the WebView reports "mission UI ready" within 10 s (otherwise native shows its own math fallback, D-008).
2. The user taps "Start mission" → the sound mutes → `#/ring/mission/0` (QR). The idle meter shows "Sound off while you work".
3. The user walks to the bathroom. 20 s pass with no touch → the meter shows "Alarm returns in 10 s". At 0 the sound comes
   back. The user taps the screen → it mutes again and the meter resets.
4. Scans the right code → "Next: Math" → solves 3 problems → "Done" → native turns off the alarm and cancels the re-ring
   safety alarm → `#/done`, which shows "You're up at 06:34", the streak, "Wake-up check in 5 min", and the next alarm.
5. At 06:39, native posts the wake-up check → `#/wakecheck` with a 90 s ring → "I'm awake" → "Nice. Have a good day." →
   `#/alarms`. A stats entry is written.
6. Variant: no answer in 90 s → re-ring → `#/ring?reason=wakecheck` with the banner "You didn't answer the wake-up check, so
   the alarm is back." → the full mission chain again.

**8.4 Snooze limit reached.**
1. The alarm allows 2 snoozes of 5 min. Ring → "Snooze 5 min · 2 left" → `#/snoozed` ("Rings again at 06:35").
2. 06:35 ring → the screen shows "Snoozed 1 of 2" → "Snooze 5 min · 1 left" → snoozed.
3. 06:40 ring → the snooze button reads "No snoozes left" (aria-disabled, still visible), with the line "Finish the mission to
   turn the alarm off." above it. Tapping it does nothing except re-announce that line politely. "Start mission" is the only way out.

**8.5 Mission impossible → backup.**
1. The QR mission is running, but the sticker fell behind the sink. Wrong code ×1 → "That's a different code…". "Can't do
   this mission?" appears.
2. Tapped at 1 try → a sheet: "The backup mission unlocks after 3 tries or 5 minutes. So far: 1 try, 1 min." → "Keep trying".
3. After 3 wrong scans (or 5 min, or straight away if the camera is denied) → "Can't do this mission?" → `#/ring/fallback`
   → "Start backup mission" → 20 medium math problems, with the idle meter active → done → any remaining chained missions
   run → `#/done`. The stats entry is tagged `usedFallback: true`. Stats don't display it as a failure.

**8.6 Restore a backup.**
1. Old phone: Settings → Backup → "Export alarms & settings" → share to files or another device.
2. New phone: finish onboarding (step 3 "I'll do it later") → Settings → "Import from file" → choose the file.
3. The file is parsed and validated (schema version; unknown fields are ignored) → Dialog "Restore this backup? From 12 Oct:
   4 alarms, your settings, and stats. This replaces your 0 current alarms." → "Replace".
4. The app replaces the stores, re-syncs every enabled alarm to native, and applies the theme → toast "Backup restored · 4 alarms".
   It then checks Reliability. If any issue is found, it shows a Banner on `#/alarms`: "Alarms restored. Check Reliability so they
   ring on this phone." with the button "Open Reliability".
5. Errors use the messages from §3.14, and nothing is changed on error (the import is atomic).
