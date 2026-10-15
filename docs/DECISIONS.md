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
