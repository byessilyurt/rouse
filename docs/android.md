# Rouse on Android: build and on-device test checklist

The APK is built by GitHub Actions (`.github/workflows/ci.yml`); this container can't build Android. CI checks that the Java compiles, passes `lintDebug` and the JVM unit tests (`testDebugUnitTest`), and that the APK requests no `INTERNET` and does request `USE_EXACT_ALARM`. **None of that proves an alarm rings on a real phone.** Use the checklist below on at least one recent Pixel or emulator (API 34+) and, if possible, one OEM phone (Samsung, Xiaomi, OnePlus).

## 0. Get the APK

1. Open the latest green CI run and download the `rouse-debug-apk` artifact.
2. `adb install -r app-debug.apk` (add `-g` only if you want to skip the runtime permission prompts).
3. Keep a log window open: `adb logcat -s Rouse:*`. Every native step logs under the `Rouse` tag. In the app, **Settings → Copy diagnostics** shows the last 200 native lines; they contain no personal data.

Useful commands:

```sh
adb shell dumpsys alarm | grep -A3 app.rouse.alarm         # scheduled AlarmManager alarms
adb shell dumpsys activity services app.rouse.alarm         # is RingService running / foreground?
adb shell cmd appops get app.rouse.alarm                    # SCHEDULE_EXACT_ALARM, USE_FULL_SCREEN_INTENT ...
adb shell dumpsys notification | grep -B2 -A12 app.rouse.alarm
```

## 1. First launch and permissions

- [ ] The app opens offline (airplane mode on). The WebView still loads, which confirms that removing INTERNET (D-025) works. If it doesn't, see "Fallback for D-025" below.
- [ ] Android 13+: the notification permission prompt appears from the health screen. Grant it, and the "Notifications" check turns OK.
- [ ] Android 14+: "Full-screen alarms" is OK out of the box (alarm apps are auto-granted). Revoke it in *Settings → Apps → Rouse → Full screen intents*. The health screen flags it as critical, and **Fix** opens that settings page.
- [ ] "Exact alarms" is OK (USE_EXACT_ALARM is granted at install on 13+). On Android 12/12L, **Fix** opens *Alarms & reminders*.
- [ ] Battery optimisation: **Fix** shows the system "Let app always run in background?" dialog. After you allow it, the check turns OK.
- [ ] Camera: the permission is requested only when you register a QR mission.

## 2. Basic ringing (screen off, device locked)

1. Create an alarm 2 minutes ahead with a math mission. Lock the phone and turn the screen off.
2. Expected:
   - [ ] The screen turns on and Rouse shows **over the lock screen** (no unlock needed). The status bar shows the alarm icon before the alarm fires.
   - [ ] Sound starts within about 1 s of the fire time and ramps up over `volumeRampSec` (−30 dB to 0 dB).
   - [ ] Vibration, if enabled.
   - [ ] The volume keys do nothing while ringing; the alarm volume stays at the alarm's setting. Changing the volume from quick settings snaps back.
   - [ ] Back does nothing. Home leaves the app, but the alarm keeps ringing and the notification brings you back.
   - [ ] The notification has **no** Snooze or Dismiss action.
   - [ ] Solving the mission stops the sound. Rouse no longer shows over the lock screen, and the original alarm volume is restored.
3. Start solving, then stop touching the phone. After `silenceWhileSolvingSec` (30 s by default) the sound returns **at full volume**.

## 3. Native fallback and WebView failure

- [ ] **Readiness timeout:** while ringing, force the WebView to hang. For example, enable *Developer options → Don't keep activities*, or kill the renderer with `adb shell am crash com.google.android.webview` (or the device's WebView package). Within 10 s the native "Wake up" screen with 5 problems appears. Solving it dismisses the alarm.
- [ ] **Before first unlock:** set an alarm 3 minutes ahead and reboot. **Do not unlock.** At fire time the native fallback screen appears over the lock screen (the WebView can't run before first unlock) and the sound plays. Solving the 5 problems stops it.

## 4. Snooze, wake-up check, re-ring

- [ ] Snooze from the ring screen. The sound stops and a "Snoozed until HH:MM" notification appears. The alarm rings again at that time. After `maxCount` snoozes the button disappears.
- [ ] Wake-up check (delay 1 min, window 1 min): dismiss, then wait. "Are you awake?" appears full-screen with an **I'm awake** action. Tap it, and the episode ends.
- [ ] Ignore the check. When the window passes, the alarm re-rings with no snooze button and the full mission. After the second re-ring and dismissal, no further check appears.

## 5. Reliability: process death, reboot, Doze, time changes

- [ ] **Process killed while ringing:** `adb shell am kill app.rouse.alarm` does nothing to a foreground service, so use `adb shell kill -9 $(adb shell pidof app.rouse.alarm)`. Within about 60 s the **safety re-ring** starts the alarm again, loud (source `safety`). Missions already completed are kept.
- [ ] **Reboot while ringing or snoozed:** `adb reboot`. About 5 s after boot (or after the snooze time) the alarm rings again (deferred start, D-020).
- [ ] **Reboot before an alarm:** set an alarm 5 minutes ahead and reboot. It still rings on time (LOCKED_BOOT_COMPLETED rescheduling).
- [ ] **Device off at fire time:** set an alarm, power off, and power on within 30 minutes after the fire time. It rings as a catch-up. Powered on more than 30 minutes late, it is recorded as **missed** in statistics.
- [ ] **Doze:**
  ```sh
  adb shell dumpsys battery unplug
  adb shell dumpsys deviceidle force-idle      # enter deep Doze now
  # wait for the alarm (setAlarmClock must fire on time even in Doze)
  adb shell dumpsys deviceidle unforce && adb shell dumpsys battery reset
  ```
- [ ] **App standby bucket "restricted":** `adb shell am set-standby-bucket app.rouse.alarm restricted`. The alarm still fires (alarm-clock alarms are exempt). Reset with `active`.
- [ ] **Time and zone changes:** move the clock forward past an alarm, or change the time zone. The next alarm is recomputed from wall-clock fields (07:00 stays 07:00 local).
- [ ] **DST:** with the zone set to America/New_York and the date set to the night before the spring change, a 02:30 alarm rings at 03:30. On the fall-back night, 01:30 rings only once.
- [ ] **App update:** `adb install -r` a new build. Scheduled alarms survive (MY_PACKAGE_REPLACED).

## 6. Calls, DND, sound

- [ ] Start a phone call, then let an alarm fire. It **vibrates only**. Hang up, and the audio starts.
- [ ] Do Not Disturb with alarms allowed (the default): the alarm rings. DND "Total silence" or alarms blocked: the health screen flags it.
- [ ] Alarm volume at 0 in system settings: the alarm still rings at its own volume (forced while ringing). The health screen warns.
- [ ] Custom sound: pick an mp3 and use it. Then delete the original file; the alarm still plays (it was copied). Pick a corrupt or non-audio file: you get a clear error. A file over 20 MB is refused.
- [ ] Remove a custom sound that an alarm uses. That alarm plays the backup "Classic beep".
- [ ] Test alarm ("in 10 seconds") rings through the full pipeline, writes no statistics, and is ignored if a real alarm is ringing.

## 7. Known limits (document to users, don't treat as bugs)

- **Force stop** (*Settings → Apps → Rouse → Force stop*) cancels **all** alarms until Rouse is opened again. This is Android behaviour and no app can defend against it. The health screen and test alarm help users notice.
- **OEM battery managers** can still kill or block Rouse even with battery optimisation off. Point users to `https://dontkillmyapp.com/<manufacturer>` (the health status includes `manufacturer`). Known extra steps:
  - **Xiaomi / HyperOS / MIUI:** enable *Autostart*, set *Battery saver → No restrictions*, and lock Rouse in recents.
  - **Samsung (One UI):** remove Rouse from *Sleeping apps* / *Deep sleeping apps*, and set *Battery → Unrestricted*. Re-check after firmware updates.
  - **Huawei / Honor:** *App launch → Manage manually* with all three toggles on.
  - **OnePlus / Oppo / Realme / Vivo:** *Battery → Don't optimise*, allow *Auto-launch* and *Run in background*.
- **Volume lock** is best effort: some OEM skins change the alarm stream without notifying observers.
- **Full-screen intent revoked** (Android 14+): the alarm still rings, but appears only as a heads-up notification until tapped.

## Fallback for D-025 (no INTERNET)

If a device shows a blank WebView without the INTERNET permission, remove the `tools:node="remove"` line from `android/app/src/main/AndroidManifest.xml`. Then drop the INTERNET assertion from the "APK permission gate" step in CI, and keep relying on `npm run check:network` (the grep gate). Record this as a decision.
