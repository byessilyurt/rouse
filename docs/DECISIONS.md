# Decision Log

Autonomous decisions made while building this project, with the reason for each.
Newest entries at the bottom. Format: **D-NNN — title** · context → decision → consequence.

---

**D-001 — Product goal: a free, open, no-paywall mission alarm**
Context: the request is a "better alternative to Alarmy, no paid option, full access for everyone".
Decision: every feature ships unlocked. No ads, no accounts, no subscriptions, no telemetry. Offline-first: all data stays on the device.
Consequence: no server, no cloud backup. Backup is a JSON export/import file the user controls.

**D-002 — An alarm app must be native on the phone; a pure web/PWA is rejected as the product**
Context: a browser tab cannot reliably fire while the phone is locked, the tab is closed, or the OS is dozing. An alarm that sometimes doesn't ring is worse than no alarm, and "Alarmy didn't ring" is already a top complaint.
Decision: the shipping target is an **Android app**. The alarm path (scheduling, waking the device, ringing, lock-screen UI) is native code. The web build exists only as a dev/demo surface, and it says plainly that it can't wake a locked phone.
Consequence: iOS is out of scope for v1. iOS doesn't allow third-party apps to keep ringing until a task is done; Alarmy works around this with notification spam, which is worse UX.

**D-003 — Stack: Capacitor (Android shell) + Vite + TypeScript + Preact UI + a small custom native alarm plugin (Java)**
Context: this build container can reach npm but **blocks Maven Central and Google Maven**, so it can't run an Android Gradle build. GitHub Actions runners can.
Options weighed:
- Pure Kotlin/Compose: best native fidelity, but nothing can be compiled or tested here. Every bug becomes a CI round-trip. Rejected.
- Flutter / React Native: not installed, and their builds need the same blocked Maven repos. Rejected.
- **Capacitor hybrid**: most logic (scheduling math, missions, UI, storage) is TypeScript, fully unit- and e2e-testable here with Vitest and Playwright/Chromium. The native layer is a small, reviewable plugin (AlarmManager.setAlarmClock, receiver, foreground ringing service, full-screen intent, boot re-scheduling). The APK is built by GitHub Actions.
Decision: Capacitor hybrid.
Consequence: native Java is checked by CI compilation plus careful review, not run on a device here. The README documents manual device test steps.

**D-004 — Platform abstraction**
Decision: the UI talks to an `AlarmBackend` interface. `NativeAlarmBackend` uses the Capacitor plugin. `WebAlarmBackend` uses in-page timers, Notification and WebAudio for the demo and for e2e tests. The dismissal rule ("must finish the mission") lives in shared TS, so both backends enforce it the same way.

**D-005 — Playwright pinned to the container's Chromium**
Context: Chromium 1194 is pre-installed at /opt/pw-browsers, and downloads are disabled.
Decision: pin `@playwright/test` to the version matching that browser build (1.56.x) so the e2e suite runs here without downloads.

**D-006 — CI uses the runner's preinstalled Android SDK**
Context: `android-actions/setup-android@v3` failed on the GitHub runner while installing the obsolete `tools` package. The web CI job passed on the first run.
Decision: drop the action and use the SDK that `ubuntu-latest` already ships (`ANDROID_HOME`). One fewer third-party action in the trust chain.

**D-007 — Scope for v1 follows the analysis P0 list, plus selected P1 items**
Context: `docs/analysis.md` §6.
Decision:
- **In v1, all free:**
  - P0 items 1–11.
  - From P1: re-ring after kill/reboot, local statistics, quick nap, bedtime reminder.
  - Squat mission, labelled honestly as cheatable.
- **Deferred:**
  - Photo mission. On-device matching is unreliable in low light, and a false "no match" traps a user (pain #7).
  - NFC.
  - Widget.
  - TTS reminders.
  - Weather briefing. It would need the INTERNET permission, which conflicts with D-001.
  - Sleep sounds and sleep tracking.
- **Rejected:** blocking power-off or uninstall. It needs Accessibility or Device Admin abuse (Play policy risk) and can be bypassed anyway. Re-ring on boot and the wake-up check give the same commitment honestly.

**D-008 — Native owns ringing; the WebView only renders missions**
Context: analysis §7.6. A WebView cold start takes 1–3 s and can crash.
Decision: the Java side schedules alarms, starts the foreground service, plays audio on USAGE_ALARM with a bundled backup tone, vibrates, posts the full-screen notification, and schedules a re-ring safety alarm before it starts ringing. Native storage (device-protected SharedPreferences) holds a JSON mirror of the alarms so boot rescheduling never needs JS. The mission UI runs in the WebView. If the WebView doesn't report "mission UI ready" within 10 s, the native side shows a native math fallback, so the user is never stuck.

## Planning phase (planner agent, adopted by the orchestrator)

**D-009 — Contract-first parallel build.** Shared types, the backend and plugin interfaces, and signature stubs for every core and missions module are written up front. Agents fill in bodies only and flag any signature change. The UI compiles before core exists.

**D-010 — Time math is explicit and zone-injectable; Java uses java.time with core-library desugaring.** A DST gap shifts the alarm later by the gap length (02:30 → 03:30, not the 03:00 the analysis suggested). An overlap uses the earlier instant. Both are the native java.time and ECMAScript semantics, so neither side needs custom rules.

**D-011 — Dual computation with a cross-check.** Native computes next-fire itself (it has to, for boot) and returns it from `syncAlarms`. TS compares, and a mismatch shows on the health screen. Both test suites use the same golden vectors file.

**D-012 — Shake, steps and squat use JS `devicemotion`, not the native step sensor.** No ACTIVITY_RECOGNITION permission, fully unit-testable, slightly more cheatable (disclosed in the UI).

**D-013 — One main alarm PendingIntent plus fixed request codes** for snooze, safety, wake-check, deadline, test, deferred start and bedtime. No PI leaks.

**D-014 — Collision policy.**
- Same instant: the alarms merge into one ring.
- An alarm that fires while another is ringing is logged as `merged`.
- An alarm that fires during a snooze or wake check supersedes it.
- Test rings never supersede a real episode.

**D-015 — Ring progress persists only for crash recovery.** A safety re-ring keeps completed missions; a snooze return or a wake-check re-ring starts fresh.

**D-016 — Snooze is capped at 10 and never unlimited.** There is no snooze on a wake-check re-ring.

**D-017 — Silence-while-solving is a native lease that fails loud** (at most 60 s; it unmutes at full volume on expiry or crash).

**D-018 — One WebView.** The ring UI is MainActivity with dynamic showWhenLocked. A separate directBootAware native activity handles the fallback.

**D-019 — Wake-up check.** Both the check and its deadline are scheduled with setAlarmClock. At most 2 re-rings. Confirming takes one tap, in the app or from the notification action.

**D-020 — FGS type `mediaPlayback`, started only from alarm-clock receivers or the foreground activity.** Boot and time-change paths defer ringing through `setAlarmClock(now+5 s)`.

**D-021 — Volume lock.** STREAM_ALARM is forced to the alarm's volume, restored if it changes, and the volume keys are consumed while ringing. The original is restored afterwards.

**D-022 — Custom sounds are copied into device-protected storage and excluded from backups.** On import, a missing custom sound becomes the default sound.

**D-023 — Quick nap is a one-off alarm with `deleteAfterRing`,** rounded up to the minute.

**D-024 — Bundled tones are synthesised from shared recipes.** They are rendered to WAV by a deterministic script and committed, and played via WebAudio on the web. CC0 by construction.

**D-025 — No INTERNET permission** (removed with `tools:node="remove"`). A CI no-network grep and an APK permission gate enforce it. If a device test shows the WebView needs it, revert to keeping INTERNET and rely on the grep.

**D-026 — Native → JS state changes go through a durable, seq-numbered log** (`getLog`/`ackLog`), applied idempotently.

**D-027 — Hash routing.** JS reads `getActiveRing()` at startup and routes itself.

**D-028 — Ringing never auto-stops.** Answer to planner open question 1: keep it. Auto-stop would break the product promise, and the safety re-ring, missed-stats and health screen already make failures visible.

**D-029 — Missing capability at ring time → fallback mission.** Saving a QR mission requires camera permission and a passing test scan.

**D-030 — Test rings use the full real pipeline** but write no stats, schedule no wake check and never supersede a real episode.

**D-031 — Java persistence uses device-protected SharedPreferences JSON with `commit()`.** No Room or Gson.

**D-032 — The native fallback is 5 two-digit math problems.**

## Orchestrator reconciliation

**D-033 — design.md vs plan.md precedence.** The planner and designer worked in parallel, and their route names differ (e.g. `#/` vs `#/alarms`, `#/wake-check` vs `#/wakecheck`). Rule: **plan.md + the TS contract win on behaviour, data and the native contract; design.md wins on screens, copy, visuals and route names.** Routing is entirely JS-side (D-027), so route names don't touch native code. Field names come from `src/core/types.ts`, so the design's `fallbackAfterFailures` maps to `settings.fallback.*`.

**D-034 — Wake-up check confirmation is a single tap** (planner open question 3). Requiring a mission for "I'm awake" would make a missed check punitive twice over. The re-ring itself already requires the full mission.

## Implementation phase: core (core agent, adopted)

**D-035 — No unmute right before dismiss or snooze.** Unsilencing on the way out would blast the alarm for a moment. The controller unsilences only when it returns to alerting.

**D-036 — "Back to alarm" from a mission** reuses `cancelSnoozeMission()` and keeps progress and the failure count. No contract change.

**D-037 — A mission that breaks mid-ring unlocks the fallback immediately.** If the camera is denied or the sensor goes silent, `missionFailed(MISSION_UNAVAILABLE)` makes the fallback available at once (design §3.8, D-029).

**D-038 — The dismissal plan is fixed for an episode.** Random missions don't change after a snooze. The plan is reused by sessionId, and capabilities are re-checked.

**D-039 — A rejected backend dismiss or snooze returns to alerting with progress kept.** Ring events that arrive mid-call are held and replayed. There is no false "ended" state.

**D-040 — Streaks count only days with an episode.** Days without one neither count nor break the streak, so weekday-only alarms keep their streak. A missed or superseded episode, or a failed wake check, breaks it. An unfinished episode today doesn't.

**D-041 — Each WakeRecord starts as 'abandoned'** and resolves from the native log (dismissed, superseded or missed).

**D-042 — A one-off-consumed event is ignored if the alarm was edited after it fired.** A user who re-enabled the alarm keeps it.

**D-043 — Quick nap takes its missions from the alarm defaults.** "Require mission: off" saves it with `missions: []`.

**D-044 — An empty custom typing phrase falls back to a bundled phrase.** The user never gets an empty or impossible task.

**Known limitation:** the motion thresholds (shake, steps, squat) were tuned on synthetic signals and still need on-device tuning. They are disclosed as cheatable in MISSION_META.

## Implementation phase: native (native agent, adopted)

**D-045 — The original alarm volume is saved in its own pref**, not inside the episode as plan §3.5 said. VolumeLock runs on the main thread and episode writes happen on the state thread, so sharing one record would race. On a crash, reconcile still restores the volume.

**D-046 — `lastHandledFireAt` de-duplicates a main fire against a catch-up ring,** and the next schedule is computed from max(now, lastHandledFireAt). A fire delivered a few milliseconds early can't double-ring.

**D-047 — Test-ring collisions.** A real alarm silently supersedes a test episode. A new test replaces an older test. A test is dropped while a real episode exists. Merged one-off alarms are consumed too.

**D-048 — A safety re-ring keeps `uiReady`** and doesn't re-arm the 10 s readiness timer when JS is already up, so the native fallback never pops over a live ring screen. Snooze and wake-check re-rings reset it.

**D-049 — Calls are detected by polling `AudioManager.getMode()` every 2 s,** so no READ_PHONE_STATE permission is needed. During a call the alarm vibrates even if vibration is off for that alarm.

**D-050 — The FGS is START_NOT_STICKY.** Recovery comes from the safety alarm (D-017), not a sticky restart.

**D-051 — Android 15+ FGS start fallback.** If starting the FGS from the receiver is refused, the ring notification is still posted and MainActivity starts the service when it opens.

**D-052 — Diagnostics.** `getNativeDiagnostics()` exists in the native backend, but the UI may only import `platform/index.ts` (import matrix). Exposing it in the UI is deferred.

Verification note: all 29 Java sources compile with `javac -Xlint:all` against hand-written stubs, and the 30 JUnit tests pass locally. That includes all 42 shared vectors and a year-long sweep over 9 zones matching `ZonedDateTime.of`. The real Gradle compile, lint, and the APK permission gate run only in CI. Device-only risks are listed in docs/android.md.

## Implementation phase: UI (UI agent, adopted)

**D-053 — "End test" stops a test ring** through a temporary RingController with an empty plan. The dismiss runs as 'no-mission' (test rings only), and nothing is recorded.

**D-054 — Ranges follow `LIMITS` in defaults.ts where design.md differs** (D-033: plan and contract win on data).

**D-055 — Random mission is the `randomMission` flag.** The Random tile toggles it with an explanation. There's no per-pick difficulty, because the contract has no field for it.

**D-056 — Design-only fields without a contract field are omitted** (Memory "tiles to remember", Tap "speed", the Steps permission row, which D-012 removed). A Volume stepper is exposed instead, since `volume` exists.

**D-057 — The e2e harness simulates the camera and motion hardware** through `__rouseTest` hooks. CI exercises the real flows without hardware. The real camera, torch and sensors still need manual device checks.

**D-058 — On web the status pill reads "Demo mode", never "Ready".** The web build never claims an alarm will ring (design principle 4).

**D-059 — Import offers "Add to my alarms" (merge) next to "Replace".**

**D-060 — New-alarm defaults are edited at `#/alarm/defaults`,** reusing the editor without time, repeat or label, and with QR disabled (a default can't carry a registered code).

**D-061 — Registering a QR code counts as the successful test scan,** which satisfies D-029. The user must have scanned the code once with camera permission granted.

**D-062 — On phones the time picker steppers stack vertically,** so 64 px targets fit at 412 px.

**D-063 — "I'm up: turn it off" from the Snoozed screen** runs the missions on the snoozed episode and dismisses it (design §3.9). Native `dismiss()` must accept the snoozed state; this was routed to the native review.

## Native review (independent reviewer agent, adopted)

**D-064 — Error isolation on the ring path.** Every helper step in RingService runs isolated (`safely()`), the notification falls back to a placeholder so `startForeground` always runs, and `player.start` is always reached. In RingEngine, `startRingService` + `emitRing` run in a `finally` after the episode is persisted. Reason: an uncaught exception there caused a crash loop where every safety re-ring crashed too, so the alarm never rang. This was the worst bug found.

**D-065 — `lastHandledFireAt` is reset on reconcile when it lies more than 60 s in the future** (the clock was set backwards). Otherwise real alarms would be dropped as "already handled".

**D-066 — Dismiss is valid from 'snoozed'** (implements D-063). It cancels RC_SNOOZE, then follows the normal dismiss path. `setSilenced` and `missionUiReady` are no-ops while snoozed.

**D-067 — The refused-FGS retry (D-051) moved to `onResume`** of MainActivity and FallbackMissionActivity. That is the first point where the activity is visible, so a foreground-service start is allowed there.

**D-068 — Real Android build verified locally.** The reviewer found that dl.google.com and a Google-hosted Maven Central mirror are reachable from this container, which contradicts the assumption in D-003. It ran `assembleDebug lintDebug testDebugUnitTest` for real: BUILD SUCCESSFUL, 0 lint errors, 30/30 JUnit, and the aapt2 permission gate passed. The mirror init script stays in the scratch directory only. No repo build files depend on it. CI remains the source of truth.

**Open, deferred to the gap phase:** D-049 call detection treats a stuck MODE_IN_COMMUNICATION (VoIP) as "in call", which could mean vibrate-only indefinitely. A cap is needed.
