# Final verification (v0.1)

Run on 2026-10-16 against `main` at `05c366a`, locally on macOS (Node 22.23, JDK 21, Android SDK 36). Report-only; fixes are listed at the end.

## Verdict

No high or medium findings. The web, JVM and lint gates are green, the scope is covered, and the four high-risk areas hold their invariants on review. The biggest open risk is unchanged: **nothing has run on a real phone yet** (`docs/android.md`).

## 1. Gates

| Gate | Result |
|---|---|
| `npm run check` (typecheck, no-network, sounds, unit, build, e2e) | ✅ 330/330 unit, 27/27 e2e |
| `./gradlew assembleDebug lintDebug testDebugUnitTest` | ✅ 37/37 JUnit, lint 0 errors / 23 warnings (unused resources, dependency versions, icons, 2 `StaticFieldLeak`) |
| APK permissions (`aapt2 dump permissions`) | ✅ no INTERNET. Present: USE_EXACT_ALARM, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT, FOREGROUND_SERVICE_MEDIA_PLAYBACK, RECEIVE_BOOT_COMPLETED, plus CAMERA, VIBRATE, WAKE_LOCK, FOREGROUND_SERVICE, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, SCHEDULE_EXACT_ALARM (max SDK 32) |

## 2. Scope coverage (analysis §6 P0 and D-007 P1)

| Item | Code | Tests | Grade |
|---|---|---|---|
| P0-1 Native ringing | `AlarmScheduler` (`setAlarmClock`), `RingService`/`AlarmPlayer` (`USAGE_ALARM`, backup tone, `ToneGenerator`), `Notifications` (full-screen intent), boot/time/package receivers in the manifest | JUnit, `NativeAlarmBackend.test.ts` | 🟡 compiles and tested on JVM; not run on a device |
| P0-2 Health screen + test alarm | `HealthChecker.java`, `Health.tsx`, `testAlarm`/`cancelTest` | e2e 14, G1–G4 | 🟡 device checks unverified |
| P0-3 Alarm CRUD, skip next, countdown | `service.ts`, `schedule.ts`, `AlarmEditor.tsx`, `AlarmList.tsx` | e2e 1, 11; `schedule.test.ts` | ✅ |
| P0-4 Missions (8 types, chain ≤ 3, random) | `src/missions/*`, `src/ui/missions/*`, `resolveMissionPlan` | `engines.test.ts`, `motion.test.ts`, e2e 4, 7–9b | ✅ (motion thresholds need real-device tuning) |
| P0-5 Snooze controls | `ringController.ts`, `RingEngine.snooze` | e2e 6a, 6b | ✅ |
| P0-6 Ramp, vibration, volume lock, silence while solving | `AlarmPlayer`, `VolumeLock`, `RingService`, `ringController` silence lease | e2e 5 | 🟡 volume lock on OEM skins unverified |
| P0-7 Wake-up check | `RingEngine.dismiss/onWakeCheck/onWakeDeadline`, `WakeCheck.tsx` | e2e 10a, 10b | ✅ |
| P0-8 Fallback mission | `isFallbackOffered`, `acceptFallback`, `FallbackMissionActivity` | e2e 7, 9b | ✅ |
| P0-9 Sounds (6 bundled, custom, preview) | `defaults.ts` recipes, `SoundLibrary`, `SoundPreview` | `check:sounds` | ✅ |
| P0-10 Privacy + JSON backup | no INTERNET, `check-no-network.mjs`, `storage.ts` | `storage.test.ts`, e2e 13 | ✅ |
| P0-11 Accessibility | `docs/accessibility.md` | e2e 15a–c | 🟡 manual TalkBack pass pending |
| P1 Re-ring after kill/reboot | `RingEngine.onSafety`, `reconcileNow`, deferred start | JUnit | 🟡 device-only behaviour |
| P1 Stats, quick nap, bedtime, squat | `stats.ts`, `napTime`, `bedtimeReminderAt`, `motion.ts` | unit | ✅ |

## 3. No premium, ads, analytics or network code

- Grep over `src/`, `android/app/src/main` and the Gradle files for premium/paywall/billing/ads/analytics/Firebase/Sentry/telemetry: no matches (only unrelated `subscribe(` and the mission "interstitial" screen).
- Network APIs (`fetch(`, XHR, WebSocket, EventSource, sendBeacon, `HttpURLConnection`, OkHttp…): none in `src/` or the Java code. The built bundle contains two `fetch(` calls from `@capacitor/core` library code that Rouse never calls; with no INTERNET permission they could not reach the network anyway.
- Runtime dependencies: `@capacitor/android`, `@capacitor/core`, `jsqr`, `preact`. Android: AndroidX only.

## 4. Exploratory web testing

| Case | Result |
|---|---|
| Browser back ×4, forward, and manual hash edits (`/alarms`, `/settings`, `/health`, `/stats`, editor, `/ring/done`) during a mission | ✅ always redirected back to the ring; still ringing |
| 00:00, 23:59, past one-off (05:00 at 06:00), weekday 00:00 in America/New_York, Asia/Kolkata, Europe/London, 12 h and 24 h | ✅ correct labels; next fire is 23:59 today in every zone |
| Snooze limit, wake-check expiry, fallback mission | ✅ covered by e2e 6a, 10b, 7, 9b |
| Backup: malformed, future version, `__proto__` keys, 10 000 alarms, 100 000-level nesting, out-of-range values | ✅ rejected or sanitised; no prototype pollution; capped at 50 alarms in 0.16 s |

## 5. High-risk file review

- **`schedule.ts` vs `ScheduleMath.java`**: the same algorithm line for line (gap → later, overlap → earlier, 15-day window, tie order by `createdAt` then id). The 42 shared golden vectors cover DST gaps and overlaps in 4 zones, 30-minute Lord Howe shifts, Santiago's midnight gap, Kolkata, leap days and year rollover. No divergence found.
- **`ringController.ts`**: the only `DismissToken` mint is `complete()`, reachable only after the last mission (or fallback) succeeds, or for an alarm with no missions. Snooze limits and "mission required to snooze" are enforced before any backend call. A failed dismiss/snooze returns to the alarm face with progress kept. A fallback mission can't be camera or motion based (`isFallbackCapable`), so the user can't get stuck.
- **`storage.ts` import**: parsing is all-or-nothing before any write; alarms and settings are rebuilt field by field, so unknown keys are dropped.
- **`RingEngine.java`**: the episode is persisted before audio starts, and a `finally` block starts the ring service even if logging or rescheduling throws (D-064). Dismiss cancels the safety, snooze and readiness timers. Overlapping fires merge into a ringing episode or supersede a snoozed one (D-014). A clock moved backwards resets `lastHandledFireAt`. Missed fires within 30 minutes (reboot, Doze) are caught up, and older ones are logged as `missed`.

## 6. README claims

Checked against the code: native fallback after 10 s with 5 problems, back and volume keys blocked while ringing, safety re-ring within about a minute, 6 bundled tones, up to 3 chained missions, 30 s silence while solving, no INTERNET permission. All match.

## 7. Findings

| # | Sev | Where | Finding | Action |
|---|---|---|---|---|
| F1 | low | `src/ui/screens/Health.tsx:173` | The list of phone makers that kill background apps leaves out Motorola, Sony and Lenovo, which dontkillmyapp.com also lists. On those phones the row shows "ok" instead of a warning. | Fixed |
| F2 | low | `src/core/validation.ts` | An imported alarm with an out-of-range time is clamped (hour 24 → 23, minute 60 → 59) instead of skipped with a warning. Only hand-edited files can hit this. | Left as is |
| F3 | low | `src/ui/screens/Settings.tsx:96` | No size cap before reading an import file; a very large file could freeze the WebView briefly. The user picks the file themselves. | Left as is |
| F4 | low | `vite.config.ts:8` | `sourcemap: true` ships `.js.map` files inside the APK (larger APK, no functional effect; the code is open source). | Left as is |
| F5 | info | lint | 2 `StaticFieldLeak` warnings and 7 unused resources. | Left as is |

## 8. Still open

- **Real-device test** (`docs/android.md`). A debug build was installed on a moto g34 5G (Android 15) on 2026-10-16 for manual testing.
- Tune the motion-mission thresholds on a real phone.
- Manual TalkBack pass.
