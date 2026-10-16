# Hand-off: continuing Rouse in a new session

> Written at the end of the cloud build session (2026-10-16). Read this first, then `docs/DECISIONS.md`.
> Delete this file once the remaining work below is done.

## What Rouse is

Rouse is a free, open-source alternative to the **Alarmy** mission alarm clock. The original brief: build a better Alarmy, with no paid option and full access for everyone.

- Android app: Capacitor 8 shell, Preact + TypeScript UI, and a custom Java plugin that owns the alarm path.
- Every feature is free. No ads, no account, and **no INTERNET permission** (enforced by a CI gate on the APK).
- The web build is only a demo and e2e harness. It can't wake a locked phone, and it says so.

## Where things are

| Thing | Location |
|---|---|
| Repo | https://github.com/byessilyurt/rouse (moved from `byessilyurt/test-repo`, D-074) |
| `main` | Last fully green integrated commit (`f1094d9`) |
| Open work | Branch `ccr-111ccb1a-3znozm` → **draft PR #1** (gap filling). CI is green on head `1dd3345` |
| Old repo | `byessilyurt/test-repo` PR #2 has a "moved" comment. It is no longer updated; close it whenever |

## Status by phase

| Phase | Status | Output |
|---|---|---|
| 1. Analyze Alarmy | ✅ | `docs/analysis.md`: features, paywall, pain points, competitors, Android reliability rules |
| 2. Plan | ✅ | `docs/plan.md`: architecture, contracts, native design, normative next-fire algorithm, test plan |
| 2. Design | ✅ | `docs/design.md`: every screen, copy, routes, CSS tokens (WCAG-checked), flows |
| 3. Code | ✅ | `src/core`, `src/missions`, `src/ui`, `src/platform/{web,native}`, `android/` (24 Java classes) |
| 4. Test | ✅ | Unit 330/330 (Vitest), e2e 27/27 (Playwright), JUnit 37/37, real Gradle build with 0 lint errors |
| 5. Improve / fill gaps | ✅ (on PR #1) | Cancel test alarm, 10-minute VoIP call cap, copy diagnostics, README, LICENSE, release workflow, accessibility audit (`docs/accessibility.md`) |
| 6. Final verification | ⛔ **not finished** | The independent verifier hit a usage limit before reporting. **Re-run it (see next steps).** |

`docs/DECISIONS.md` logs 77 autonomous decisions (D-001…D-077), each with its reasoning. Check it before changing behaviour.

## Next steps (in order)

1. **Run the final verification pass.** It is report-only, and its output goes to `docs/verification.md`. Scope:
   - Gates: `npm run check`, plus the Android build below. Check the APK permissions with `aapt2 dump permissions`: there must be no INTERNET, and USE_EXACT_ALARM, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT, FOREGROUND_SERVICE_MEDIA_PLAYBACK and RECEIVE_BOOT_COMPLETED must be present.
   - A coverage matrix of every analysis §6 P0 item (1–11) and the D-007 P1 items: code location, tests, and a grade of ✅/🟡/❌.
   - A grep proving there is no premium, ads or analytics code and no network code.
   - Exploratory web testing (`?e2e=1` with `window.__rouseTest` hooks). Edge cases to try:
     - Alarms at 00:00 and 23:59, and a one-off whose time has already passed.
     - Snooze limit, wake-check expiry, the fallback mission.
     - Importing a malformed, future-version or huge backup.
     - Browser back/forward during a ring (it must not escape the mission).
     - America/New_York and Asia/Kolkata time zones, and 12-hour vs 24-hour display.
   - A targeted review of the high-risk files:
     - `schedule.ts` vs `ScheduleMath.java`
     - `ringController.ts` (can't dismiss without the mission, can't get stuck)
     - `storage.ts` import validation
     - `RingEngine.java` (no silently lost alarms, no endless ringing after dismiss)
   - README claims checked against the code.
2. **Fix confirmed findings** on the PR #1 branch, keep CI green, then mark PR #1 ready and merge it.
3. **Test on a real device.** This is the biggest remaining risk, because nothing has run on a phone yet. Follow `docs/android.md`. Priorities:
   - The WebView loads with the INTERNET permission removed. D-025 has a fallback if it doesn't.
   - The full-screen alarm shows over the lock screen on Android 14–16.
   - It rings after a reboot and when the phone is in Doze (`adb shell dumpsys deviceidle force-idle`).
   - The native fallback works before first unlock.
   - The volume lock holds on OEM skins (Samsung, Xiaomi).
   - Tune the motion-mission thresholds (shake, steps, squat) on a real phone (D-044 note).
4. **Release.** Push a tag such as `v0.1.0`. `.github/workflows/release.yml` builds a debug-signed APK and attaches it to a GitHub Release. Proper release signing is deferred (D-077).

## Working locally

```bash
git clone https://github.com/byessilyurt/rouse && cd rouse
git checkout ccr-111ccb1a-3znozm        # PR #1 branch (or main once merged)
npm ci
npm run check      # typecheck + no-network gate + sounds check + unit + build + e2e
npm run dev        # web demo; add ?e2e=1 for test hooks
```

- **Playwright** is pinned to **1.56.1**. That matched the cloud container's preinstalled Chromium. Locally, run `npx playwright install chromium` once, or bump the pin.
- **Android:** you need JDK 21 and an Android SDK (platform 36). Then:
  ```bash
  npm run build && npx cap sync android
  cd android && ./gradlew assembleDebug lintDebug testDebugUnitTest
  ```
  The APK is written to `android/app/build/outputs/apk/debug/`. To install it, use `adb install -r`, or open the `android/` folder in Android Studio.
- **Bundled tones:** `npm run gen:sounds` regenerates them from the recipes in `src/core/defaults.ts`. CI checks they haven't drifted.

## Ground rules the codebase relies on

- **Contracts first.** `src/core/types.ts`, `src/platform/AlarmBackend.ts` and `src/platform/native/RousePlugin.ts` are the shared contracts. Change them additively and update both backends together.
- **Shared constants.** Constants tagged `[JAVA]` in `src/core/defaults.ts` must match `RouseConstants.java`. `ConstantsParityTest` enforces this.
- **Next-fire golden vectors.** `tests/fixtures/next-fire-vectors.json` is shared by Vitest and JUnit. Any change to the scheduling math must keep both green.
- **Native owns ringing** (D-008). The WebView only renders missions. Any exception on the ring path must still leave the phone ringing (D-064).
- **No network APIs in `src/`.** The CI grep fails on `fetch(`, `XMLHttpRequest`, `WebSocket` and similar.

## Notes on how this was built

- The work was split across separate subagents per phase (analysis, planning, design, core, UI, native, native review, two gap-fillers, verifier), with the orchestrator verifying each output before committing. Later phases used Sonnet to save cost (D-069).
- The cloud session hit usage limits several times. That is why the history has `WIP snapshot … [skip ci]` commits: they preserved work between interruptions.
