# Rouse

**A free, open-source mission alarm clock for Android. Every feature is unlocked. No ads, no account, no internet permission.**

Rouse rings until you prove you're awake: solve a math problem, scan a QR code in another room, do some steps, type a phrase. Then, if you like, it checks again a few minutes later and rings once more if you went back to sleep.

> Status: v0.1, pre-release. The Java alarm path compiles and passes its unit tests in CI, but it has had **no device testing yet**. Read [Limitations](#limitations) and run the [on-device checklist](docs/android.md) before you trust it with a job interview.

## Why it exists

[Alarmy](https://alar.my) made the "do a task to turn it off" idea popular, then put the parts that make it work behind a subscription. [`docs/analysis.md`](docs/analysis.md) has the research and its sources. The short version:

- **Paywall on the commitment features.** The wake-up check, typing, step and squat missions, and chained missions are Premium. The yearly price was seen rising from $19.99 to $59.99 (analysis §3, [S]).
- **Ads** on the free tier, including around the alarm itself (analysis §3, [S]).
- **"It didn't ring."** Missed alarms are the top complaint in the review snippets and threads we found (analysis §4, pain point 1, [S]).
- **Privacy cost.** Weather needs background location, sleep tracking wants the microphone all night, and cloud backup needs an account (analysis §4, pain point 10).

Rouse's answer: everything free, and the effort goes into ringing reliably instead of upselling. There's no server, so there's nothing to monetise or to leak.

## Features

**Missions** (chain up to 3 per alarm, or pick "random")

| Mission | What you do | Hard to cheat? |
|---|---|---|
| Math | Solve arithmetic problems, 5 difficulty levels | Medium: can be done in bed |
| Memory | Remember which tiles lit up (shapes as well as colour) | Medium |
| Typing | Type a phrase exactly, bundled or your own | Medium |
| QR / barcode | Scan the code you stuck on the bathroom mirror | High: the best way to get out of bed |
| Tap targets | Tap moving targets | Medium |
| Shake | Shake the phone N times | Low: easy lying down |
| Steps | Walk N steps | Low-medium: shaking can fool it |
| Squats | Do N squats | Low: hand-pumping can fool it |

The app labels the weak ones honestly. Motion missions use the phone's motion sensors from the WebView (no activity-recognition permission), and their thresholds still need tuning on real devices.

**Ringing**
- Rings on the alarm audio stream, so it ignores the media volume and plays through Do Not Disturb when alarms are allowed (the default).
- Shows over the lock screen. Back and the volume keys are ignored while it rings, and the alarm volume is held at the level you chose.
- Gradual volume ramp, vibration, 6 bundled tones plus your own sound. A built-in backup tone plays if a sound can't.
- The sound drops while you're solving a mission and comes back at full volume after 30 s of no touching.
- Snooze with a length and a count you set (or off). Optionally you must finish the mission to snooze.
- **Wake-up check:** after you turn the alarm off, Rouse asks "are you awake?" and rings again if you don't answer in time.

**Reliability**
- `setAlarmClock` scheduling, which wakes the device from Doze.
- Survives reboot, app update and time-zone or clock changes.
- If Rouse is killed mid-ring, a safety alarm brings it back within about a minute. A reboot mid-ring does the same.
- If the WebView fails to load within 10 s, a native fallback screen with 5 math problems appears, so you're never stuck.
- A mission that can't work (camera denied, no motion sensor) offers a longer backup mission, so you're never trapped either.
- A **Reliability** screen checks notifications, exact alarms, full-screen alerts, battery optimisation and Do Not Disturb, with a fix button for each, plus a **test alarm** that runs the whole real pipeline.

**Everything else**
- One-off and repeating alarms, labels, skip-next, quick nap, bedtime reminder.
- Local-only statistics and streaks.
- JSON export and import for backup. This is the only "sync" there is.
- Dark theme by default, a light theme, and "System". Large touch targets (64 px on the ring screens), screen-reader labels and font scaling. See [`docs/accessibility.md`](docs/accessibility.md).

## Rouse vs Alarmy

Alarmy changes its tiers often. We couldn't open the store listings from our research environment, only search-result snippets, so each Alarmy claim carries the confidence label from [`docs/analysis.md`](docs/analysis.md): **[S]** is backed by a search result, **[PK]** is prior knowledge that we haven't verified. Check the current Alarmy listing before you rely on a [PK] cell.

| | Rouse | Alarmy (free) | Alarmy Premium |
|---|---|---|---|
| Price | Free | Free, with ads [S] | Subscription; $19.99 to $59.99 per year seen [S] |
| Ads | None | Yes [S] | Removed [S] |
| Account needed | No | Pushed for backup [PK] | Same [PK] |
| Network permission | None, enforced by CI | Yes (ads, weather, news) [PK] | Same [PK] |
| Math, memory, shake missions | Yes | Yes [S] | Yes |
| QR / barcode mission | Yes | Yes [S] | Yes |
| Photo-matching mission | **No** (deferred) | Yes [S] | Yes |
| Typing mission | Yes | No [S] | Yes [S] |
| Steps and squat missions | Yes | No [S] | Yes [S] |
| Tap-target mission | Yes | Unclear: newer "brain game" missions [PK] | Unclear [PK] |
| Several missions per alarm | Up to 3 | No [S] | Yes [S] |
| Wake-up check | Yes | No [S] | Yes [S] |
| Snooze limits | Yes | Yes [PK] | Yes |
| Gradual volume, custom sound, backup sound | Yes | Yes [PK] | Yes |
| Extra-loud effect | No; alarm volume is forced to your setting while ringing | No [S] | Yes [S] |
| Time or label read aloud (TTS) | No (deferred) | No [S] | Yes [S] |
| Re-rings after kill or reboot | Yes | Unclear [PK] | Unclear [PK] |
| Blocks power-off or uninstall | **No**, on purpose (see below) | Exists; tier unclear [S] | Exists; tier unclear [S] |
| In-app reliability check and test alarm | Yes | Not known [PK] | Not known [PK] |
| Sleep tracking, snore recording | **No** | Limited [S] | More [S] |
| Sleep sounds, weather, news briefing | **No** | Some, with ads [S] | More [S] |
| Home-screen widget | **No** | Yes [PK] | Yes [PK] |
| Statistics | Local only | Mixed [PK] | Mixed [PK] |
| Platforms | **Android only** | Android and iOS [S] | Android and iOS [S] |
| Source code | MIT | Closed | Closed |

Rouse doesn't try to block power-off or uninstall. That needs an Accessibility service or Device Admin, which Google Play restricts, and it can be bypassed anyway (analysis §6, reported bypass on One UI 6.1 [S]). Re-ringing after a kill or reboot and the wake-up check give a similar commitment without that.

## Privacy

- **No `INTERNET` permission.** The manifest removes it, and CI fails the build if the APK ever requests it ([`ci.yml`](.github/workflows/ci.yml), "APK permission gate" step, using `aapt2 dump permissions`).
- A second gate, `npm run check:network`, fails if `src/` contains `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon`.
- No account, no analytics, no ad SDK, no crash reporter. Alarms, settings and statistics stay on the device. Backup is a file you export and keep.
- Permissions are the ones an alarm needs: exact alarms, notifications, full-screen alerts, boot, foreground service, wake lock, vibration, battery-optimisation exemption. **Camera** is requested only when you register a QR mission.
- Rouse requests no location, microphone, contacts or storage permissions. Custom sounds are copied in through the system file picker.

## Install

1. Download `rouse-<version>-debug.apk` from the [latest GitHub Release](https://github.com/byessilyurt/test-repo/releases/latest). If there is no release yet, open the newest green run of the **CI** workflow under *Actions* and download the `rouse-debug-apk` artifact (GitHub asks you to sign in to download artifacts).
2. Open the file on your phone. Android asks you to allow installs from this source ("unknown sources"). Allow it for your browser or file manager only.
3. Open Rouse. The first-run screens ask for:
   - **Notifications** (Android 13+), so the ring notification can appear.
   - **Alarms & reminders** (Android 12 only; later versions grant it at install).
   - **Full-screen alerts**, so the alarm opens over the lock screen.
   - **Battery: unrestricted**, so the system leaves Rouse alone.
4. Create an alarm, then run the **test alarm** in *Reliability*. It rings in a minute through the same path as a real alarm.

Needs Android 7.0 (API 24) or newer. Developed against Android 14 to 16 behaviour.

## Make sure it rings

An alarm that sometimes doesn't ring is worse than none, so check, don't assume.

1. Open **Reliability** (the status pill on the alarm list, or *Settings*). Fix every item marked "Needs attention".
2. Run the **test alarm** with the screen off and the phone locked. Do it again after a phone update.
3. **Phone-maker battery managers** (Xiaomi, Samsung, Huawei, OnePlus, Oppo, Vivo and others) can still kill apps after you disable battery optimisation. Rouse shows your phone maker on the Reliability screen. Look it up at [dontkillmyapp.com](https://dontkillmyapp.com) and follow its steps. [`docs/android.md`](docs/android.md) §7 lists the common ones.
4. Keep a second alarm until you've seen Rouse ring on your own phone a few times.

## Limitations

Please read these.

- **Android only.** iOS doesn't let a third-party app keep ringing over the lock screen until a task is done. Alarmy works around that with repeated notifications, which is a worse experience, so we left iOS out (D-002).
- **The web build is a demo.** A browser tab can't wake a locked phone or ring after the tab closes, and the demo says so on screen. It exists for development and the end-to-end tests.
- **Force Stop kills every alarm.** *Settings > Apps > Rouse > Force stop* cancels all scheduled alarms until you open Rouse again. This is Android's rule and no app can prevent it.
- **Phone-maker battery managers** can still interfere. Use the test alarm.
- **Motion missions can be cheated.** Shake, steps and squats can be done lying down or by waving the phone. Chain them with QR or typing. Sensor thresholds were tuned on synthetic signals and need real-device tuning.
- **A photo of your QR code works.** Don't keep a copy by the bed.
- **Debug-signed APK.** Releases are signed with the Android debug key, not a private release key. They're fine for sideloading, but they aren't on Google Play or F-Droid, there's no automatic update, and a build signed with a different key can only replace this one after you uninstall it.
- **Not yet verified on hardware.** CI proves the code compiles, lints and passes JVM tests. Nobody has yet run the ringing path on a real phone. The checklist in [`docs/android.md`](docs/android.md) is how that gets done.
- **Left out for now:** photo mission, NFC tag, widget, spoken time, weather, sleep sounds and sleep tracking (D-007).
- **The accessibility audit is automated.** A manual TalkBack pass is still needed ([`docs/accessibility.md`](docs/accessibility.md)).

## Development

Node 22 and, for Android builds, JDK 21 and the Android SDK.

```sh
npm ci
npm run dev        # Vite dev server; the web demo backend runs in the browser
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ on :4173
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests
npm run e2e        # Playwright end-to-end tests against the preview build
npm run check      # everything CI's web job runs: typecheck, no-network grep, sounds, unit, build, e2e
npm run cap:sync   # copy the web build into the Android project
```

`npm run check:network` and `npm run check:sounds` run on their own. `npm run gen:sounds` regenerates the bundled WAV tones (they're synthesised from recipes in `src/core/defaults.ts`, so they're CC0 by construction).

To build the APK locally: `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`. The result is `android/app/build/outputs/apk/debug/app-debug.apk`.

**End-to-end tests** (`e2e/`) run on Chromium with Pixel 7 emulation against `vite preview`. Open the app with `?e2e=1` and `window.__rouseTest` exposes hooks to ring an alarm now, fire the next timer, and inject a QR scan. Chromium comes pre-installed in the dev container; elsewhere run `npx playwright install chromium` once.

### Architecture

```
Preact UI (src/ui)  ->  core: service, schedule maths, ring controller, missions (src/core, src/missions)
                                  |
                          AlarmBackend interface (src/platform)
                     /                                   \
        NativeAlarmBackend (Capacitor plugin)      WebAlarmBackend (timers + WebAudio; demo and e2e only)
                     |
        Java: RingEngine, AlarmManager.setAlarmClock, foreground ring service, boot receivers, fallback screen
```

- **Native owns ringing.** The Java side schedules, wakes the device, plays audio and shows the full-screen notification. The WebView only renders the mission UI (D-008).
- **One rule in two places.** The "you must finish the mission" logic lives in shared TypeScript, and both backends obey it (D-004). Native and TypeScript both compute the next fire time and a mismatch shows on the Reliability screen (D-011); both test suites use the same golden vectors.
- Full design: [`docs/plan.md`](docs/plan.md) (architecture, native contract, test plan) and [`docs/design.md`](docs/design.md) (screens and copy).

### How CI builds the APK

`.github/workflows/ci.yml` has two jobs. **web** runs the gates, typecheck, unit tests, build and the Playwright suite. **android** then runs `npm run build`, `npx cap sync android`, and `./gradlew assembleDebug lintDebug testDebugUnitTest`, checks the APK's permissions with `aapt2`, and uploads the `rouse-debug-apk` artifact. It uses the Android SDK preinstalled on the runner rather than a setup action (D-006).

### Releasing

Push a tag: `git tag v0.1.0 && git push origin v0.1.0`. [`release.yml`](.github/workflows/release.yml) builds the debug APK, names it `rouse-v0.1.0-debug.apk`, and publishes a GitHub Release with generated notes. Running the workflow by hand from a branch uploads the APK as an artifact instead.

## Documentation

| File | What's in it |
|---|---|
| [`docs/analysis.md`](docs/analysis.md) | Alarmy research: features, pricing, complaints, competitors, Android reliability rules |
| [`docs/design.md`](docs/design.md) | Screens, copy, design tokens, components |
| [`docs/plan.md`](docs/plan.md) | Architecture, native design, module ownership, test plan |
| [`docs/android.md`](docs/android.md) | On-device test checklist and known Android limits |
| [`docs/accessibility.md`](docs/accessibility.md) | Accessibility audit method, findings, fixes and a TalkBack checklist |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every decision made while building, with the reason |

## Licence

[MIT](LICENSE) © 2026 Rouse contributors. Bundled third-party licences are listed in the app under *Settings > Licences*. The alarm tones are CC0.
