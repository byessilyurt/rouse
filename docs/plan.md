# Rouse: Implementation Plan

> Planner/architecture agent, 2026-10-15. This builds on `docs/analysis.md` and `docs/DECISIONS.md`. New decisions D-009 to D-032 are in §5 and in DECISIONS.md.
> **Precedence:** where `docs/design.md` and this plan differ, **this plan wins on behaviour, data and the native contract**, and **design.md wins on screens, copy, visuals and route names** (D-033).

## 0. Contract (written by the planner, compiles)

| File | Kind | Notes |
|---|---|---|
| `src/core/types.ts` | **Contract (frozen)** | Domain model: Alarm, the MissionConfig union (8 types), RingSession, Settings, WakeRecord, PersistedState, BackupFile, ImportResult, ValidationIssue |
| `src/core/defaults.ts` | **Contract (frozen)** | Limits, timing constants (constants tagged `[JAVA]` must be mirrored in Java), `BUNDLED_SOUNDS` tone recipes, `MISSION_META` (honesty, accessibility and cheat-resistance notes), factories. Uses only `import type`, so plain `node` can import it |
| `src/platform/AlarmBackend.ts` | **Contract (frozen)** | UI-facing backend interface, `ActiveRing`, the durable `AlarmLogEvent` log, `HealthStatus`, the `DismissToken` brand, `RouseTestHooks` (`window.__rouseTest`) |
| `src/platform/native/RousePlugin.ts` | **Contract (frozen)** | `registerPlugin<RousePluginApi>('Rouse')`. Every Java `@PluginMethod`, with argument and result shapes, error codes, events and semantics |
| `src/platform/index.ts` | Contract (trivial implementation) | `createBackend()`: native on Android, otherwise web (`?e2e=1` installs test hooks) |
| `src/core/{zone,schedule,validation,storage,ringController,stats,service}.ts` | **Signature stubs** | Exported API frozen. Bodies call `notImplemented()`. CORE fills them in |
| `src/missions/{rng,math,memory,typing,motion,tap,qr}.ts` | **Signature stubs** | Same. CORE fills them in |
| `src/platform/native/NativeAlarmBackend.ts` | Stub | NATIVE fills it in |
| `src/platform/web/WebAlarmBackend.ts` | Stub | UI fills it in |
| `src/core/notImplemented.ts` | Temporary helper | Delete once `grep -r notImplemented src` is empty |

**Rule:** don't change an exported name or signature in these files without listing it under **"CONTRACT CHANGES"** in your report, with the reason. Adding non-exported internals is fine.

## 1. Architecture

### 1.1 Overview

```
┌──────────────────────────── WebView (Preact UI, TS) ────────────────────────────┐
│  src/ui/**  hash routes (see design.md §2)                                       │
│        │ hooks (useService, useRing)                                             │
│        ▼                                                                         │
│  core: RouseService ── Repository(localStorage, versioned) ── schedule/stats     │
│        │        ▲                                                                │
│        │        └── RingController (mission chain, snooze, fallback, silence)    │
│        │                 │  (only caller of dismiss; mints DismissToken)         │
│        ▼                 ▼                                                       │
│  ┌──────────────── AlarmBackend (interface) ────────────────┐                    │
│  │  NativeAlarmBackend              WebAlarmBackend          │                    │
│  └──────┬───────────────────────────────┬───────────────────┘                    │
└─────────┼───────────────────────────────┼────────────────────────────────────────┘
          │ Capacitor bridge              │ setTimeout + WebAudio + localStorage
          ▼                               ▼ (demo / e2e only; can't wake a locked phone)
┌──────────────────────── Android (Java, app.rouse.alarm) ─────────────────────────┐
│ RousePlugin ─► RingEngine (single "rouse-state" HandlerThread; all transitions)  │
│                  ├─ MirrorStore / EpisodeStore / LogStore  (device-protected prefs)│
│                  ├─ ScheduleMath (java.time) ─► AlarmScheduler (setAlarmClock)   │
│                  ├─ RingService (FGS mediaPlayback): AlarmPlayer, VolumeLock, vib │
│                  └─ HealthChecker, SoundLibrary, DiagLog                          │
│ AlarmReceiver / SystemEventReceiver / WakeCheckReceiver  (directBootAware)        │
│ MainActivity (BridgeActivity; showWhenLocked while ringing)                       │
│ FallbackMissionActivity (native math; directBootAware)                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Source of truth.**
- **Alarm definitions and settings:** JS `localStorage` (`rouse.state`). The native mirror is derived from it and pushed with a full-state `syncAlarms` after every change.
- **Episode state:** native, while an episode exists. JS reads it with `getActiveRing` and requests transitions.
- **What native did while JS was dead:** a durable log, read with `getLog(afterSeq)` and acknowledged with `ackLog`. Applied idempotently by seq.

### 1.2 Data flows

**A. Create an alarm**
1. The editor gets a draft from `service.newAlarmDraft()` and validates it live with `validateAlarm()`.
2. A QR mission needs camera permission plus a successful test scan before Save is enabled.
3. `service.saveAlarm(a)`:
   - normalise and validate;
   - clear `skipUntil` if hour, minute or days changed;
   - `repo.upsertAlarm`;
   - `backend.sync(allAlarms, settings)`.
4. Native `Rouse.syncAlarms`:
   - `MirrorStore.write` (`commit()`);
   - `ScheduleMath.nextFire`;
   - `AlarmManager.setAlarmClock(RC_MAIN, AlarmClockInfo(fireAt, showPI→MainActivity), PI→AlarmReceiver{ACTION_FIRE, fireAt, alarmIds[]})`;
   - bedtime PI;
   - resolves `{next, alarms[{alarmId,nextFireAt}], bedtimeReminderAt}`.
5. The service compares each `nextFireAt` with TS `nextOccurrence`. Mismatches are stored and shown on the health screen (D-011).

**B. Alarm fires on a locked phone (native-first ringing)**
1. `AlarmReceiver.onReceive(ACTION_FIRE)` → `goAsync()` → `RingEngine.onMainFire(fireAt, ids)` on the state thread:
   1. Reload the mirror. Drop ids that are no longer enabled or no longer due: `nextOccurrence(alarm, fireAt-1) != fireAt` means stale, so reschedule and stop.
   2. If `now - fireAt > MISSED_GRACE_MS`, log `missed`, reschedule and stop.
   3. Apply the collision policy (D-014).
   4. Create the Episode: new UUID sessionId, `state=ringing`, `source=scheduled`. **Persist it before anything is audible.**
   5. Arm `RC_SAFETY` at now+60 s.
   6. For a one-off alarm, set `enabled=false` in the mirror and log `one-off-consumed`. Log `ring-started`.
   7. Reschedule `RC_MAIN`.
   8. `startForegroundService(RingService, ACTION_RING)`.
2. `RingService.onStartCommand` calls `startForeground` immediately with:
   - a CATEGORY_ALARM notification on the `ring` channel (HIGH, sound null, ongoing, **no actions**);
   - a `fullScreenIntent` → MainActivity with `EXTRA_RING_SESSION`, or → FallbackMissionActivity if `!UserManager.isUserUnlocked()`;
   - type MEDIA_PLAYBACK.

   It then:
   - takes a partial wakelock and audio focus GAIN_TRANSIENT;
   - runs `VolumeLock.save()`, sets STREAM_ALARM to `alarm.volume%` and starts observing;
   - starts `AlarmPlayer` on USAGE_ALARM, looping, with a dB-linear ramp from −30 dB to 0 dB over `volumeRampSec`. Any error, or no playback within 3 s, switches to `rouse_classic`;
   - starts vibration if enabled;
   - emits plugin event `ring`.
3. The FSI launches MainActivity:
   - `setShowWhenLocked(true)`, `setTurnScreenOn(true)` and FLAG_KEEP_SCREEN_ON;
   - Back is blocked and volume keys are consumed while ringing;
   - `RingEngine.ringUiLaunched(sessionId)` starts the **10 s readiness timer**.
4. In the WebView, `main.tsx` runs `createBackend()` → `service.init()` → `backend.getActiveRing()`, then routes to the ring screen. RingScreen mounts a `RingController` and calls `uiReady()` → `Rouse.missionUiReady`, which cancels the timer.
5. **Native fallback:** if the timer expires, or the device is still locked before first unlock, FallbackMissionActivity opens with 5 problems, then `RingEngine.dismiss(via native-fallback)`.
6. **Solving:**
   - The RingController enters `solving` and calls `setSilenced(id, true, 30 000)`. Interactions call `activity()`, which renews the lease at most every 5 s.
   - If the user is idle for 30 s, native resumes full volume by itself, so a dead JS means a loud alarm (D-017).
   - Wrong answers call `missionFailed()`. After N failures or M minutes, a fallback-mission button appears.
   - On the last success: `backend.dismiss(token)` → native stops the FGS and audio, cancels `RC_SAFETY`, restores volume, clears showWhenLocked, schedules the wake check, logs `dismissed` and emits `ringState`.

**C. Snooze**
1. "Snooze (n left)" is hidden or disabled if snooze is off, `snoozeCount >= maxCount`, or the source is `wake-check`.
2. If `requireMission`, the user first solves `plan[0]` (purpose=snooze) and can cancel back to alerting.
3. `backend.snooze(id)`. Native re-validates, stops ringing, cancels safety, increments `snoozeCount`, sets `RC_SNOOZE` at now+interval, sets `state=snoozed`, logs and emits.
4. `RC_SNOOZE` fires → `RingEngine.startRing(source='snooze')`, with the same sessionId and fresh mission progress.

**D. Mission success → dismiss → wake-up check → re-ring**
1. Dismiss with wake check enabled, not a test, and `wakeCheckReRings < 2`: `state=wake-check-wait` and `RC_WAKE_CHECK` at dismiss + delayMin.
2. When `RC_WAKE_CHECK` fires:
   - `state=wake-check-prompt`, `RC_WAKE_DEADLINE` armed at now + windowMin;
   - a `wake_check` notification with a fullScreenIntent to the wake-check route and an **"I'm awake"** action → WakeCheckReceiver;
   - log and emit `wakeCheck`.
3. Confirming (`confirmAwake`) cancels both PIs, logs `wake-check-confirmed` and `episode-ended`, and emits `ringState(null)`.
4. If the deadline fires first: `wakeCheckReRings++`, `startRing(source='wake-check')`. Full missions run again and snooze is not allowed. After the 2nd re-ring the episode ends with no further check.

**E. Reboot, update or time change**
1. `SystemEventReceiver` (directBootAware) handles BOOT_COMPLETED, LOCKED_BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED and SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED, and calls `RingEngine.reconcile(reason)`. The same call runs when the plugin loads.
2. reconcile **never starts the FGS directly**. Anything that must ring now goes through `setAlarmClock(now+5 s, RC_DEFERRED_START)` (D-020). Per episode state:
   - `ringing` → deferred start, `source=safety`;
   - `snoozed` → deferred start if overdue, otherwise re-arm;
   - `wake-check-wait` and `wake-check-prompt` → re-arm, or advance if overdue;
   - no episode and `scheduled.fireAt` in (now−30 min, now] → catch-up ring; older → log `missed`.
3. Finally, recompute and arm `RC_MAIN` and bedtime from wall-clock fields. Never trust a stale absolute time.

## 2. Module map and ownership

### 2.1 CORE agent: `src/core/**`, `src/missions/**`, `tests/unit/core/**`, `tests/unit/missions/**`, `tests/fixtures/**`

| Module | Responsibilities |
|---|---|
| `zone.ts` | `ianaZone(tz)` via `Intl.DateTimeFormat(..., {timeZone, hourCycle:'h23', ...})`; offset = (wall-as-UTC − instant)/60000 |
| `schedule.ts` | The §3.6 algorithm exactly, plus `skipNext`, `isSkipping`, `snoozeUntil`, `bedtimeReminderAt`, `napTime`, `splitDuration` |
| `validation.ts` | `validateAlarm` (LIMITS, ≤ MAX_MISSIONS, QR code non-empty, custom phrase non-empty, days sorted/unique 0..6), `normalizeAlarm`, `parseAlarm`, `parseSettings` (lenient, defaults per field) |
| `storage.ts` | `Repository` write-through over `StorageLike`. `migrateState`: v0 → v1; unknown or newer version → back up the raw text to `rouse.state.corrupt.<ts>` and start fresh with a warning flag. Export/import with `parseBackup`: invalid alarms skipped with warnings, ids regenerated on merge, missing custom sounds → `DEFAULT_SOUND` |
| `ringController.ts` | State machine: plan resolution (random; missing capability → fallback), silence lease, idle timer, fallback offer, DismissToken minting, persisted progress, `onFinished` |
| `stats.ts` | `computeStats` |
| `service.ts` | Orchestration. `applyLog` idempotent by seq. `recordRingOutcome` merges JS metrics |
| `missions/rng.ts` | mulberry32 and helpers |
| `missions/math.ts` | Difficulty 1 `a+b` (2–9) · 2 `a+b` (11–99) · 3 `a×b+c` · 4 `a×b` (12–49 each) · 5 `a×b+c×d`. No 0/1/10 operands, no duplicates, `spoken` text |
| `missions/memory.ts` | Round r highlights `gridSize+r` cells for `1500 + 300×cells` ms. Tap in any order; a wrong tap fails the round |
| `missions/typing.ts` | ≥40 short and ≥20 long original ASCII phrases. `normalizePhrase`, `comparePhrase` |
| `missions/motion.ts` | Shake, step and squat `RepDetector`s |
| `missions/tap.ts` | Target sequence with a minimum distance and the top 15 % excluded; `isHit` |
| `missions/qr.ts` | `normalizeCode` (case preserved), `codesMatch`, `describeCode` |
| `tests/fixtures/next-fire-vectors.json` | Golden vectors shared with JUnit |

Core purity:
- No Preact, no `@capacitor/*`, no DOM except crypto and an injectable `TimerApi`.
- Storage comes in through `StorageLike`.
- `import type` only from `src/platform/AlarmBackend.ts`.

### 2.2 UI agent: `src/ui/**`, `src/main.tsx`, `index.html`, `public/**`, `src/platform/web/**`, `e2e/**`, `tests/unit/ui/**`, `playwright.config.ts`

- **Screens and routes:** per design.md. A mission-test route lets the user try a mission without an alarm.
- **Bootstrap (`main.tsx`):**
  1. `createBackend()`, `new RouseService({...})`, `await service.init()`.
  2. `getActiveRing()` → route.
  3. Subscribe to ring and wake-check events.
  4. `visibilitychange` → `getHealth()`.
- **Mission components** share `MissionProps { config; rng; onSuccess(); onFailure(reason); onActivity(); }`.
  - Motion missions use `devicemotion`. If no event arrives within 1 s, `capabilities.motion=false`.
  - QR uses `getUserMedia`, then `BarcodeDetector` or jsQR (640-px canvas, ~8 fps), with a torch toggle. In e2e it listens to `__rouseTest.injectScan`.
- **WebAlarmBackend:**
  - next fire from `core/schedule.ts`; one `setTimeout`, re-armed on sync, on `visibilitychange` and every 30 s;
  - state in localStorage `rouse.web.backend`, so a reload mid-ring resumes ringing;
  - WebAudio synthesis of `BUNDLED_SOUNDS`, starting on the first user gesture; if blocked, a "tap to start sound" overlay;
  - the same snooze rules as native;
  - test hooks on `window.__rouseTest`.
- **Accessibility:**
  - every control has a role and name; targets ≥ 48 px;
  - no colour-only state;
  - `aria-live` on ring and mission feedback;
  - rem-based fonts;
  - `prefers-reduced-motion` and `prefers-color-scheme` respected.
- The UI imports only `src/platform/index.ts`, never `native/**` or `web/**`.

### 2.3 NATIVE agent: `android/**`, `src/platform/native/**` (except `RousePlugin.ts`), `scripts/**`, `.github/workflows/**`, `tests/unit/native/**`, the `scripts` section of package.json, `docs/android.md`

- `NativeAlarmBackend.ts`: a thin pass-through to `Rouse`, unit-tested with a mocked plugin.
- `scripts/gen-sounds.ts`:
  - renders `BUNDLED_SOUNDS` to `android/app/src/main/res/raw/rouse_<id>.wav` (22 050 Hz, 16-bit mono);
  - deterministic output, committed;
  - `--check` mode for CI.

### 2.4 Import matrix

| From ↓ / may import → | core/types, defaults | core/* public | missions/* | platform/AlarmBackend | platform/index | platform/native/* | platform/web/* | preact | @capacitor/core |
|---|---|---|---|---|---|---|---|---|---|
| core, missions | ✓ | ✓ | ✓ | type-only | ✗ | ✗ | ✗ | ✗ | ✗ |
| ui, main.tsx | ✓ | ✓ | ✓ | type-only | ✓ | ✗ | ✗ | ✓ | ✗ |
| platform/web | ✓ | schedule, zone | ✗ | ✓ | ✗ | ✗ | — | ✗ | ✗ |
| platform/native | ✓ | ✗ | ✗ | ✓ | ✗ | — | ✗ | ✗ | ✓ |

No edits to `tsconfig.json` or package.json dependencies.

### 2.5 Integration order
All three agents work in parallel against the stubs. The orchestrator then:
1. merges;
2. checks `grep -r notImplemented src` is empty;
3. runs `npm run check`;
4. pushes for the Android CI build.

## 3. Native Android design

### 3.1 Classes (`app.rouse.alarm`)

| Class | Role |
|---|---|
| `MainActivity extends BridgeActivity` | `registerPlugin(RousePlugin.class)` before `super.onCreate`. Handles ring and wake-check extras: showWhenLocked, turnScreenOn, keep-screen-on, `RingEngine.ringUiLaunched`. While ringing it consumes volume keys and blocks Back. Clears the flags when the ring ends |
| `RousePlugin` | `@CapacitorPlugin(name="Rouse", permissions={notifications, camera})`. Thin. `handleOnResume` → `healthChanged`. `load()` → `reconcile("app-start")` |
| `RouseConstants` | Copies of the `[JAVA]` constants; a JUnit parity test checks them against `defaults.ts` |
| `model.AlarmSpec`, `model.Episode` | Parsed JSON views |
| `store.MirrorStore`, `EpisodeStore`, `LogStore`, `SoundStore` | Device-protected SharedPreferences `rouse_native`, JSON, `commit()` |
| `ScheduleMath` | Pure java.time (§3.6), JUnit-tested with the shared vectors |
| `AlarmScheduler` | `setAlarmClock` with fixed request codes RC_MAIN=1 … RC_DEFERRED_START=7. RC_BEDTIME=8 uses `setExactAndAllowWhileIdle`. PIs are FLAG_IMMUTABLE |
| `RingEngine` | Singleton. All transitions on HandlerThread "rouse-state". Readiness timer, silence lease, collision policy |
| `AlarmReceiver` (exported=false, directBootAware) | FIRE, SNOOZE_END, SAFETY, WAKE_CHECK, WAKE_DEADLINE, TEST, DEFERRED_START, BEDTIME |
| `SystemEventReceiver` (exported, directBootAware) | System broadcasts → `reconcile` |
| `WakeCheckReceiver` (exported=false, directBootAware) | "I'm awake" → `confirmAwake` |
| `RingService` (FGS `mediaPlayback`, directBootAware) | Notification, AlarmPlayer, VolumeLock, vibration, wakelock. During a call: vibrate only, and start audio when the call ends |
| `AlarmPlayer` | MediaPlayer USAGE_ALARM, looping, dB ramp, mute/unmute, backup tone on any failure or no playback within 3 s |
| `VolumeLock` | Forces STREAM_ALARM to the alarm's volume, restores it on change via ContentObserver, restores the original afterwards; the saved value is persisted |
| `FallbackMissionActivity` (directBootAware, showWhenLocked) | Native math, 5 problems; Back and volume keys blocked |
| `HealthChecker`, `SoundLibrary`, `DiagLog` | Health status; bundled and custom sounds (copied into device-protected storage, ≤ 20 MB); 200-line diagnostics log with no personal data |

### 3.2 Manifest
```xml
<uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<uses-permission android:name="android.permission.VIBRATE"/>
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>   <!-- D-025 -->
<uses-feature android:name="android.hardware.camera" android:required="false"/>
<uses-feature android:name="android.hardware.sensor.accelerometer" android:required="false"/>
```
- No ACTIVITY_RECOGNITION (D-012) and no ACCESS_NOTIFICATION_POLICY.
- Gradle: core-library desugaring (`desugar_jdk_libs`) for java.time on API 24–25, plus `testImplementation 'org.json:json'`.

### 3.3 Notification channels
| id | Importance | Use |
|---|---|---|
| `ring` | HIGH, sound null, lockscreen PUBLIC | Ringing FGS + FSI. **No snooze or dismiss actions** |
| `wake_check` | HIGH | "Are you awake?" + FSI + "I'm awake" action |
| `bedtime` | DEFAULT | Bedtime reminder |
| `status` | LOW | "Snoozed until 07:10" |

### 3.4 Health checks
| Check | How it's evaluated |
|---|---|
| exactAlarm | API < 31 → ok, else `canScheduleExactAlarms()` |
| notifications | `areNotificationsEnabled()` and ring channel importance ≠ NONE |
| fullScreenIntent | API < 34 → ok, else `canUseFullScreenIntent()` |
| batteryOptimization | `isIgnoringBatteryOptimizations` |
| backgroundRestricted | `isBackgroundRestricted()` (API 28+) |
| dndAllowsAlarms | Interruption filter and policy alarm category; unknown on exception |
| alarmVolume | STREAM_ALARM > 0 |
| camera, motionSensors | Permission or sensor present |

Severity: the first three are critical, battery/background/DND/volume are recommended, camera/motion are optional.

### 3.5 Storage (device-protected prefs `rouse_native`)
```
mirror    = {"mirrorVersion":1,"syncedAt":ms,"alarms":[<Alarm JSON verbatim>],"settings":{...}}
scheduled = {"fireAt":ms|null,"alarmIds":[..],"bedtimeAt":ms|null}
episode   = <ActiveRing JSON> + {"uiReady","ringUiLaunchedAt","silenceUntil","savedAlarmVolume"} | absent
log       = {"nextSeq":n,"events":[...]}   (cap 500)
sounds    = [{"id","name","file","durationMs","addedAt"}]
```

### 3.6 Next-fire algorithm (normative: TS and Java must agree)
```
wallTimeToEpoch(date, h, m):
  W  = Date.UTC(date.y, date.m-1, date.d, h, m)
  c1 = W − zone(W − 86 400 000)·60 000
  c2 = W − zone(W + 86 400 000)·60 000
  valid(c) ⇔ c + zone(c)·60 000 == W
  both valid → min(c1, c2)       // overlap → earlier instant
  one valid  → that one
  none valid → c1                // gap → shifted later by the gap length (02:30 → 03:30)

nextOccurrence(alarm, now):      // ignores `enabled`
  for i in 0..14 from localDate(now):
    skip days not in alarm.days (when non-empty)
    t = wallTimeToEpoch(d, h, m); require t > now and (skipUntil == null or t > skipUntil)
    return t
  return null

nextFire(alarms, now): over enabled alarms; ties sorted by (createdAt, id)
```
- Java: `ZonedDateTime.of(d, LocalTime.of(h, m), ZoneId.systemDefault())` has the same gap and overlap semantics.
- Fall-back: only one instant per date, so a time like 01:30 never rings twice.
- Shared golden vectors: `tests/fixtures/next-fire-vectors.json`.
- Required cases: NY spring gap, NY fall overlap, Berlin, Lord_Howe 30-min gap, Santiago midnight gap, Kolkata, skip-next daily and weekly, boundaries, Feb 29.

### 3.7 Other native rules
- **Collision (D-014):** same instant → merge. Fires while ringing → logged `merged`. Fires during snooze or wake check → supersedes. Test rings never supersede real ones.
- **Silence lease:** at most 60 s, persisted, unmutes at full gain. A safety re-ring always starts loud.
- **Safety re-ring:** every 60 s while ringing. Restarts the ring if the service is dead. A user Force Stop can't be defended against; documented.
- **No auto-silence (D-028).**
- **One-off and nap:** the mirror disables the alarm at fire time. JS applies `one-off-consumed`.

## 4. Test plan

### 4.1 Unit tests (Vitest)

**CORE:**
- **schedule:** all vectors, ties, skip, bedtime, nap.
- **zone:** offsets.
- **validation:** every bound ±1.
- **storage:** migrate, corrupt and future-version handling, write-through, trim, export/import round-trip (replace and merge).
- **ringController:** every transition, snooze limits, requireMission, fallback by failures and by time, capability-missing → fallback, random determinism, silence lease and throttle, idle timer, empty plan, DismissToken, `onFinished` once.
- **stats:** streaks across DST, missed breaks the streak.
- **service:** sync on save, mismatch, `applyLog` idempotent, quick nap.
- **missions:** math ranges and no duplicates; memory; typing normalisation; motion synthetic signals (walking vs shaking); tap distances; QR normalisation.

**UI:**
- mission components;
- editor validation;
- WebAlarmBackend (fake timers, persistence, test hooks).

**NATIVE:**
- NativeAlarmBackend mapping, tested with a mocked plugin;
- JUnit: ScheduleMath vectors, AlarmSpec round-trip, Episode JSON, constants parity, collision policy.

### 4.2 E2E (Playwright, Pixel 7, `?e2e=1`, `page.clock`)
1. CRUD with countdown, toggle, skip-next, delete.
2. Validation (QR unregistered blocks Save; a 4th mission is disabled).
3. Ring → math dismiss (wrong answer keeps ringing).
4. Chained missions.
5. Silence while solving and resume after 30 s idle.
6. Snooze limits and requireMission.
7. Fallback after 3 wrong QR scans.
8. QR success and mismatch.
9. Shake and steps via synthetic `DeviceMotionEvent`.
10. Wake-up check confirm and deadline re-ring.
11. One-off and nap consumed.
12. Reload mid-ring resumes.
13. Export/import (replace, merge, malformed).
14. Health screen web banner.
15. Accessibility: names, keyboard flow, ≥ 48 px targets, memory `aria-pressed`.

### 4.3 CI gates
- **Web:**
  - typecheck, unit, build, e2e;
  - `scripts/check-no-network.mjs`: no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon` in `src/**`;
  - no `notImplemented`;
  - `gen-sounds --check`.
- **Android:**
  - `assembleDebug lintDebug testDebugUnitTest`;
  - APK permission gate: no INTERNET, has USE_EXACT_ALARM;
  - upload the APK and reports.
- **Optional:** an emulator smoke job (non-blocking).

## 5. Risks

| Risk | Mitigation |
|---|---|
| Removing INTERNET breaks the WebView load on some versions | Capacitor serves assets via interception, and the emulator/device check verifies it. Fallback: keep INTERNET and rely on the CI no-network grep |
| TS and Java next-fire disagree | Normative algorithm, shared vectors, runtime cross-check (D-011) |
| OEM kills | Health screen, dontkillmyapp link, test alarm, safety re-ring, `missed` stats |
| FSI revoked | Critical health item; audio still plays |
| WebView cold start or crash | Native audio first, 10 s native fallback, safety re-ring, persisted progress |
| Before first unlock | directBootAware components; the FSI targets the native fallback |
| Camera permission at ring time | QR save requires permission and a test scan; denied → fallback mission |
| Motion detectors miscount | Time-based fallback offer, conservative thresholds, synthetic tests |
| Volume lock bypass | Best-effort observer, documented |
| Parallel agents diverge | Frozen stubs, import matrix, contract-change reporting, integration gate |

Decisions D-009 to D-032 are recorded in `docs/DECISIONS.md`.
