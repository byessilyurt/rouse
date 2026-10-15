# Accessibility

Target: WCAG 2.1 AA plus the principles in [`design.md`](design.md) §1 (built for someone half asleep: 64 px targets on the ring and mission routes, 48 px elsewhere, nothing colour-only, nothing that needs a precise gesture).

**Status:** an automated audit of every route found layout, target-size and focus-trap problems. Those are fixed (below). **Nobody has yet used Rouse with TalkBack on a real phone.** Treat the audit as a floor, and run the [manual checklist](#manual-talkback-checklist) before a release.

## Method

Throwaway Playwright scripts (kept out of the repo) drove the production build served by `vite preview`, using `?e2e=1` and the `window.__rouseTest` hooks to reach every state, including ring, every mission, the fallback offer, snoozed, done and the wake-up check.

- **Coverage:** 45 scenes: the 3 onboarding steps; alarm list (empty and populated), its overflow sheet and quick-nap sheet; alarm editor (new, existing, sound sheet, discard dialog); mission picker; the config screen of all 8 mission types; QR register; ring; all 8 mission play screens (plus a second math problem and the QR fallback offer); fallback; snoozed; done; wake-up check; Reliability; Stats (empty and with data); Settings; Licences.
- **Matrix:** each scene in the **dark and light** themes, at **360 px** width (a small phone), at normal text size and at **200 % root font size** (`html{font-size:200%}`). That is 180 runs.
- **Checks per run:**
  - interactive elements without an accessible name, and inputs that rely on a placeholder;
  - target size (48 px; 64 px on locked ring routes);
  - horizontal page overflow, elements beyond the viewport, text clipped by `overflow` or ellipsis;
  - controls covered by a fixed bar or overlay (hit-testing the centre of each control after scrolling to it);
  - contrast of every text node against its computed background, with opacity applied (4.5:1, or 3:1 for large text);
  - heading outline (one `h1`, no skipped levels), `document.title`, `<main>` landmark, `lang`;
  - a `Tab` walk through each page (up to 80 stops), checking that every stop shows a focus indicator that isn't clipped;
  - for sheets and dialogs: `role`, `aria-modal`, a name, whether the page behind is inert, and whether Tab and Shift+Tab can leave the dialog.
- **Token contrast** (design tokens in `tokens.css`) was computed separately for both themes. Every text pair is at least 4.98:1 and every control border at least 3.9:1 against the surfaces it sits on. Focus colour is 5.6:1 or better. The only colours outside the tokens are `#000` and `#f2f4f8` in the camera box (19:1).

What this does **not** cover: real screen-reader speech, TalkBack gesture navigation, switch access, colour-vision simulation, the real camera and motion flows, or the native fallback screen (`FallbackMissionActivity`).

## Findings and fixes

Already fine (no change needed): every interactive element has a name; one `h1` per route with no skipped levels; page titles follow `"<Screen> · Rouse"`; a single `<main>`; all text meets contrast in both themes; focus is visible on all 610 tab stops checked (3 px outline, 5.6:1 or better against the page), never clipped; targets on ring and mission routes are at least 64 px (72 px for the primary button); memory tiles carry a symbol, not only colour; the stats chart has a text summary and a table alternative.

| # | Issue | Where | Fix |
|---|---|---|---|
| 1 | At 200 % text, the page scrolled sideways: the tab bar's "Settings" label overflowed its third, and the Reliability pill, "Demo mode" pill and New alarm button were pushed past the edge. | `app.css` (`.tabbar`, `.pill`, `.list-header`) | Tab columns use `minmax(0, 1fr)` and labels may wrap. Pills may wrap. The list header wraps. |
| 2 | The ringing clock stayed at a 5 rem minimum, which is 160 px at 200 % text. "06:00" was wider than a 360 px screen. | `.ring-clock` | `min(var(--fs-clock-ring), 26vw)`: still huge, but never wider than the screen. |
| 3 | The editor's hour and minute digits (64 px, 128 px at 200 %) overlapped the colon and each other. | `.stepper-value`, `.stepper-input`, `.colon` | Capped at `17vw`. |
| 4 | Top-bar titles ("New alarm", "Edit alarm", "Add a mission", "QR / barcode") were cut off at 200 %. The bar was a fixed 56 px with an ellipsis. | `.topbar` | The bar grows (`min-height`) and the title wraps. |
| 5 | Long alarm labels were truncated with "…" on the list (a 40-character label at 360 px), and more so at 200 %. | `AlarmList.tsx`, `.alarm-label` | The label wraps. (The card's accessible name always had the full label.) |
| 6 | The alarm time ("06:30", 88 px at 200 %) collided with the On/Off toggle. | `.alarm-time` | `min(var(--fs-3xl), 12.5vw)`. |
| 7 | The 2-column mission picker and stats grids overflowed at 200 %. | `.mission-grid`, `.stat-grid` | `auto-fit` columns with a rem-based minimum, so they become one column at large text. |
| 8 | The seven day chips were 43 px wide on a 360 px phone (design says 48 px). | `.daychips` | Below 392 px the row uses 8 px of each side gutter and a 1 px gap (48.3 px chips). Below 352 px it wraps. |
| 9 | "Back to alarm" and "Can't do this mission?" were 48 px high on mission routes (should be 64 px). | `.shell.locked .btn-text` | 64 px minimum on locked routes. |
| 10 | The "No alarm is ringing" and new "Cancel test" buttons on the ring route are sized for ring routes. | `Ring.tsx` | Both use the 64 px ring size. |
| 11 | While a sheet or dialog was open, the page behind it was still in the accessibility tree and reachable with Tab, because only `aria-modal` marked it modal and not every screen reader honours that. | `overlays.tsx` | Everything outside the modal is made `inert` while it is open (the scrim and live regions are exempt), and restored on close. |
| 12 | The focus trap failed for groups with a roving `tabindex` (quick-nap length) and for radio groups (sound sheet): Shift+Tab from the first real tab stop left the dialog. | `overlays.tsx` | First and last are now computed from actual tab stops. |
| 13 | A pending route-change focus move could take focus away from a dialog that had just opened (flaky e2e scenario 13). | `App.tsx` | The route-focus step skips when a modal is open. |

### Reported, not fixed

- Nothing to report against `Health.tsx` or `AlarmEditor.tsx`. The audit's one flag in the editor (a 22 px radio input in the sound sheet) sits inside a 48 px-high label row, and the label is the target.

## Residual issues

- **Not tested with TalkBack.** Names, roles and live-region announcements are checked in the DOM only. Verify the manual checklist.
- **Disabled primary buttons are below contrast** (2.8:1, opacity 0.55, e.g. the typing mission's "Check" before any input). WCAG exempts inactive controls, and they carry `aria-disabled`, but low-vision users may struggle to read them.
- **Text-style chips** ("Once", "Weekdays", "Weekends", "Every day") have a decorative 1.3:1 border. The accent-coloured label is what identifies them (5:1 or better).
- **Stats chart labels** are SVG text of about 11 units that scales with the chart width, not the font setting. The text summary and the "Show as table" view carry the same data.
- **The ring clock, alarm times and editor digits stop growing with font scale** once they reach a size that fits the screen (they are already large text).
- **Long values in list rows** (for example "30 s" in Volume ramp) can wrap at 200 %. Nothing is lost.
- **Mission accessibility is inherent to the task.** Math is hard with dyscalculia, shake and squats need mobility, QR needs aim. `MISSION_META` says so in the picker, and Typing and QR work with TalkBack. The backup mission means nobody is trapped.
- **Native fallback screen** (5 math problems, shown if the WebView fails) is plain Android views and was not audited.
- Contrast was measured on a 360 px Chromium render, not on a phone display in sunlight.

## Manual TalkBack checklist

Run on a real Android phone with TalkBack on, in both themes, and once at the largest font and display size (*Settings > Accessibility > Font size / Display size*).

**Basics**
- [ ] Swipe through the alarm list. Each card reads once, with time, label and repeat, and the toggle reads "On"/"Off".
- [ ] The next-alarm card reads its full sentence ("Next alarm in 7 hours 12 minutes, …").
- [ ] The status pill reads the full "Reliability: …" sentence and opens Reliability.
- [ ] Navigating between tabs and screens announces the new screen title, and focus lands on it.
- [ ] Toasts ("Alarm set for …", "Alarm deleted") are announced.

**Editor**
- [ ] Hour and minute steppers can be adjusted (swipe up/down, or the +/− buttons) and read their value ("07 hours").
- [ ] Day chips read the day name and "selected"/"not selected".
- [ ] Sheets (sound, quick nap, overflow menu): the first swipe lands inside the sheet, nothing behind it is reachable, and Back closes it and returns focus.
- [ ] Discard and delete dialogs read their title and body, with the safe choice focused.
- [ ] Mission rows read "1: Math, Easy, 3 problems. Edit" with move and remove buttons named.

**Ringing (use the test alarm in Reliability, phone locked)**
- [ ] The screen reader announces "Alarm, 06:30" once, assertively, over the lock screen.
- [ ] Focus starts on the primary button. "Start mission" and "Snooze" read their sub-labels and remaining count.
- [ ] Math: the keypad reads digits, "Delete digit" and "Check answer". The problem reads as words ("43 plus 17"). Wrong answers are announced.
- [ ] Memory: lit tiles read "highlighted", and selected tiles read "pressed".
- [ ] Typing: the phrase is readable, mismatches are announced, and the text field accepts input.
- [ ] QR: the scanner state (searching, found, wrong code) is announced, and the torch button is named and toggles.
- [ ] Shake, steps and squats: progress is announced and the progress bar reads its value.
- [ ] The wake-up check reads its countdown, and "I'm awake" is reachable and activates with a double tap.
- [ ] The "I can't do this mission" backup is offered with a clear label.
- [ ] Hardware Back does not leave a ring route, and TalkBack gestures can't get stuck.

**Other**
- [ ] Reliability: each check reads its status word ("OK", "Needs attention") as well as its icon, and the Fix buttons are named.
- [ ] Stats: the chart reads its summary, and "Show as table" exposes proper table navigation.
- [ ] Switch Access or keyboard (Bluetooth): Tab reaches every control, with a visible focus ring.
- [ ] Colour: at greyscale (*Colour correction > Greyscale*) every state is still distinguishable.
- [ ] Animation: with *Remove animations* on, nothing important depends on motion.
