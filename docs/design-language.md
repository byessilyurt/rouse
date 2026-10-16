# Rouse design language: "Awake"

Replaces the visual system in `design.md` §4–§6 (D-078). Screens, flows, copy rules and accessibility
requirements in `design.md` still apply unless this document says otherwise.

Three ideas, used together:

1. **The interface wakes up.** One number, `wake` (0–1), drives type weight and width, colour temperature,
   contrast and motion everywhere. The app is thin, narrow and warm at 2 AM, and heavy, wide and bright while it rings.
2. **Alarms are promises.** Each alarm is a short sentence you edit by tapping its words. The ring screen reads your
   promise back to you, and finishing the mission is keeping your word.
3. **Time is the layout.** Home is a vertical scale of the next 24 hours. Height on screen is real time, so "rings in
   7 h" becomes a distance you can see.

Why: every alarm app is a list of cards with toggles. Rouse's difference is commitment (missions, the wake-up
check), and these ideas make that visible instead of decorating it.

---

## 1. The wake system

### 1.1 Where `wake` comes from (`src/ui/wake.ts`)

| Context | `wake` |
|---|---|
| Normal screens | From the local time: 0.15 from 01:00 to 04:30, rising to 0.65 by 08:00, 0.70 during the day, falling to 0.30 by 23:00 |
| Snoozed | 0.15 (dim: you are allowed back to sleep) |
| Ringing | 1.0 |
| Mission | 0.55, rising evenly to 0.95 as missions are solved |
| Backup mission offer | 0.6 |
| Wake-up check | 0.8 |
| Good morning | 1.0 |

`wake` is set as `--wake` on `<html>`. It is registered with `@property`, so changes animate over 900 ms
(none with `prefers-reduced-motion`).

### 1.2 What `wake` drives

| Property | `wake` = 0 | `wake` = 1 |
|---|---|---|
| UI type (Bricolage Grotesque) weight, body | 300 | 450 |
| UI type weight, strong and headings | 500 | 760 |
| Clock weight | 200 | 800 |
| Type width (`wdth`) | 82 % | 100 % |
| Promise type (Fraunces) weight | 300 | 640 |
| Promise type softness (`SOFT`) | 100 | 0 |
| Accent | dim amber (about 2700 K) | vermilion |
| Surface | warm black | warm paper (light regime) |

**Two colour regimes, never a crossfade through grey.** Interpolating a dark theme into a light one passes
through mid-grey, where text fails contrast. So colour has two regimes:

- **Night** (`wake` < 0.5): warm black surfaces and light text. Inside the regime, text and accent brighten with `wake`.
- **Day** (`wake` ≥ 0.5): paper surfaces and dark text. Inside the regime, the paper warms to white and the accent deepens.

The switch is instant: a cross-fade would pass through mid-grey too. Every colour pair is checked at both ends of each regime
(`scripts/check-contrast.mjs`): body text 4.5:1, large text and controls 3:1.

### 1.3 The Theme setting

`Theme`: **Follow the day** (`wake`, the new default) · Dark · Light · System. Dark and Light pin the colour
regime; type weight, width and accent still follow `wake`. Only **Follow the day** and **Light** turn the ring
screen into the signal page; Dark and System (when the OS is dark) ring in the dark regime at full `wake`.

---

## 2. Type

- **Bricolage Grotesque** (OFL, variable `wght` 200–800, `wdth` 75–100, `opsz`): UI, labels, numbers and the clock.
  Its narrowing reads as "sleepy" without losing letter shapes.
- **Fraunces** (OFL, variable `wght`, `opsz`, `SOFT`): the promise sentences and the ring-screen quote only.
- Both fonts are bundled in `public/fonts/` (Latin and Latin Extended), since the app has no internet. Other scripts
  fall back to the system font.
- Sizes keep the rem scale from `design.md` §4, so the Android font scale still applies, and layouts still work at 200 %.
- Times use `font-variant-numeric: tabular-nums`.

## 3. Space and form

- **No cards.** Content sits on the page and is separated by hairline rules (1 px, `--rule`) and space.
  Only sheets and dialogs float.
- Corners: 0 for rules and rows, 6 px for buttons and fields, round only for toggles and the "now" dot.
- One left edge: everything aligns to a 16 px gutter, and the timeline rail sits on it.
- Shadows only on sheets and dialogs.

## 4. Components

- **Blank** (`.blank`): a tappable word inside a sentence. Accent-coloured text with a 2 px underline,
  48 px tall through line-height, and its own accessible name ("Time, 06:30, change"). Opens a sheet with the matching control.
- **Rail** (`.rail`): the timeline. A 2 px vertical line, hour ticks every hour, labels every 3 hours, a "now" dot
  at the top, and the stretch until the next alarm shaded as sleep.
- **Mark** (`.mark`): an alarm on the rail. A tick from the rail, the time in the clock face, the promise in one line,
  a toggle and a menu. Marks keep at least 72 px between them and are pushed down when they would overlap; the
  printed time stays exact.
- **Buttons**: primary is solid accent, secondary is a 2 px outline, text buttons are underlined accent words.
  Ring screens keep 64–72 px targets.
- **Toggle**: a flat track with a square-ish thumb and the word "On"/"Off" next to it (never colour alone).

## 5. Screens

### 5.1 Home (timeline)

1. Top: the current time (clock face), and one sentence: "Next: 06:30, in 7 h 12 min." The reliability pill sits beside it.
2. The rail: now → +24 h. Enabled alarms whose next ring is within 24 h sit on it as marks.
3. "Later": enabled alarms further out, as rows ("Sat 07:45").
4. "Off": disabled alarms, dimmed.
5. Actions: "New promise" (primary) and "Quick nap" (secondary).

Screen readers get a plain list in time order ("06:30, in 7 h 12 min, weekdays, math then QR, on").
Positions are visual only.

### 5.2 Promise editor

```
Wake me at [06:30] [on weekdays].
It's for [the 8:10 train].
I'll prove I'm up with [math, then a QR code].
Ring [Pulse], [rising over 30 s], [with vibration].
Let me snooze [3 times] for [5 min].
Then check I'm up [3 min] later.
```

- Each bracket is a blank that opens a sheet with the existing control (time steppers, day chips, text field,
  mission picker, sound list, steppers, toggles).
- Turning a feature off rewrites the sentence: "No snoozing." / "Don't check on me."
- "Try it now", "Test this alarm" and "Save" stay in the sticky bar.

### 5.3 Ringing

The day regime at full `wake`: the page is the signal colour, the clock is at weight 800 and full width, and below
it the promise is quoted in Fraunces: "You said you'd be up at 06:30 — for the 8:10 train." (without a label:
"You said you'd be up at 06:30."). Primary action: **Keep my word** (and which mission comes next). Snooze stays a
secondary button with its count.

### 5.4 Mission

The mission frame is unchanged in structure. `wake` steps up with each solved mission, so the page visibly brightens
and thickens as you go. That brightening is the progress indicator, alongside the text "2 of 3".

### 5.5 Good morning

"Promise kept." in Fraunces at full `wake`, then the existing summary.

### 5.6 Everything else

Settings, Reliability, Stats, onboarding and mission setup take the new type, rules, blanks and buttons, with
no structural change.

---

## 6. Tokens

They live in `src/ui/tokens.css`. The main ones:

```
--wake            0–1 (registered with @property)
--w-body          calc(300 + var(--wake) * 150)
--w-strong        calc(500 + var(--wake) * 260)
--w-clock         calc(200 + var(--wake) * 600)
--wd              calc(82% + var(--wake) * 18%)      /* font-stretch */
--soft            calc(100 - var(--wake) * 100)      /* Fraunces SOFT */
--bg --surface --text --text-muted --rule --border --accent --on-accent --accent-text
--signal --on-signal                                  /* ring screen */
--ok --warn --danger --info (+ -bg)                  /* status: always with an icon and a word */
```
