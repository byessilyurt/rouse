# Product Analysis: Alarmy and the Case for a Free, Open Alternative

> Audience: the planner, designer, coder and verifier agents building **Rouse** (see `docs/DECISIONS.md`).
> Date: 2026-10-15. Analyst: analysis agent.

## 0. Sources and confidence

Research was limited by the container. `WebFetch` failed DNS resolution for **every** host tried
(alar.my, play.google.com, apps.apple.com, apkmirror.com, alternativeto.net, slimfaq.com).
`WebSearch` worked, so the findings below come from search-result snippets plus prior knowledge.

Confidence labels used in this doc:
- **[S]**: supported by a web search result (link given where possible).
- **[PK]**: from prior knowledge, **unverified**. Alarmy renames and re-tiers features often, so treat
  [PK] free/premium splits as "likely, as of 2024–2025".

Key sources (all reached through search snippets only):
- App Store listing, Alarmy (id1163786766): https://apps.apple.com/app/id1163786766
- Play listing (package `droom.sleepIfUCan`): https://play.google.com/store/apps/details?id=droom.sleepIfUCan
- APKMirror changelogs (5.24 – 25.41): https://apkmirror.com/apk/alarm-clock-alarmy/alarmy-challenge-alarm-clock
- Delight Room company page (82M cumulative downloads claim): https://alar.my/en/company
- Google Play case study: https://developer.android.com/stories/apps/alarmy
- Adapty paywall library (pricing): https://adapty.io/paywall-library/alarmy/
- App Pricing Lab IAP list: https://apppricinglab.com/iap/apple/1163786766
- AlternativeTo: https://alternativeto.net/software/alarmy/about
- Reddit r/GetOutOfBed "Alarmy not going off": https://reddit.birdcat.cafe/r/GetOutOfBed/comments/1kmvdv9/alarmy_app_not_going_off
- I Can't Wake Up! feedback board (power-off prevention discussion): https://i-cant-wake-up.nolt.io/20
- Android 14 exact alarms: https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
- Android 14 FGS types: https://developer.android.com/about/versions/14/changes/fgs-types-required
- AOSP full-screen intent limits: https://source.android.com/docs/core/permissions/fsi-limits
- DontKillMyApp (Samsung): https://dontkillmyapp.com/samsung
- QRAlarm (open source, F-Droid): https://f-droid.org/packages/com.sweak.qralarm

---

## 1. Executive summary

**What it is.** Alarmy (formerly "Sleep If U Can") is an alarm clock app by Delight Room (Seoul). It is
one of the top-grossing alarm apps on both stores. The company claims about **82M cumulative downloads** [S].
Store ratings sit around **4.6–4.8** [S]. It runs on Android (`droom.sleepIfUCan`) and iOS.

**Why people use it.** Heavy sleepers and chronic snoozers can't trust themselves to get up. Alarmy turns
"dismiss" from a reflex into a task. You can't tap the alarm off half-asleep; you have to *do something*
that needs you awake (and ideally out of bed).

**Core loop.**

```
schedule alarm ─► alarm rings (loud, full-screen, volume forced up)
                 └─► user must complete a MISSION (math / photo / QR / shake / steps / squats / typing / memory…)
                      ├─ (optional) snooze: limited count/interval, may itself require a mission
                      └─► alarm dismissed
                           └─► (optional, premium) WAKE-UP CHECK: X min later, "Are you awake?"
                                 └─ no response in time → alarm rings again
                           └─► morning briefing (weather / news / horoscope), ads (free tier)
```

**The critical insight.** Users trade comfort for **certainty**. The product promise is "you *will* get up".
So the two things that matter most are (a) **reliability**: the alarm must always ring, and
(b) **commitment**: you can't escape it cheaply. Everything else is upsell. Alarmy weakens its own
promise by putting the strongest commitment devices (wake-up check, step/squat/typing missions,
multiple missions) behind a subscription, and by running ads on a wake-up screen.

---

## 2. Feature inventory

Legend: **Free** / **Prem** (Premium) / **Mixed**. Tier splits marked [PK] are unverified and change between versions.

### 2.1 Missions (dismiss challenges)

| Feature | Description | Alarmy tier | Notes |
|---|---|---|---|
| Math | Solve N arithmetic problems. Difficulty runs from 1-digit addition to multi-term multiplication. | Free [S] | ~6 difficulty levels and a configurable problem count [PK]. Easiest to "brute force awake". |
| Memory (tiles) | Memorize a highlighted pattern of tiles in a grid, then tap it back. | Free [S] | Count and difficulty configurable [PK]. |
| Shake | Shake the phone N times (up to 999). | Free [S] | Easy to do in bed. Users say it's the weakest mission. Accelerometer threshold matters. |
| Photo | Register a reference photo (e.g., bathroom sink). The live photo must match it to dismiss. | Free [S] | Strong "get out of bed" device. Matching fails in dim light, which is a top frustration [PK]. Needs camera. |
| Barcode / QR scan | Register a code (e.g., toothpaste barcode), then scan it to dismiss. | Free [S] | The most reliable "get out of bed" mission. Users print QR codes and stick them in another room. |
| Typing / phrase | Type a quote or a custom phrase exactly. | Prem [S] | Often used for affirmations. |
| Step / walk | Walk 10/20/50+ steps (step detector). | Prem [S] | Shaking the phone can cheat it [PK]. Needs `ACTIVITY_RECOGNITION` on Android 10+. |
| Squat | Do N squats, detected by motion sensor. | Prem [S] | Changelog lists it with the premium items. |
| Tap challenge / mini-games | Tap targets quickly, color/pattern mini-games (names vary by version). | Mixed [PK] | Newer versions added several "brain game" style missions. Names unverified. |
| Multiple missions | Chain 2–3 missions in a row (e.g., QR then math). | Prem [S] | Strong anti-cheat. Locking it is a notable paywall choice. |
| Mission difficulty & count | Per-mission difficulty level and repetition count (problems, shakes, rounds). | Mostly free [PK] | Some high counts / options may be premium. |
| Mission time limit / mute during mission | The alarm goes quiet while you work on the mission and comes back if you idle (about 30 s) [PK]. | Free [PK] | Important UX detail: silence while solving, full volume if you stall. |
| Alarm preview / mission test | Try the mission at setup time. | Free [PK] | Very important for photo/QR (verify the code before you depend on it). |

### 2.2 Alarm configuration

| Feature | Description | Alarmy tier | Notes |
|---|---|---|---|
| Repeat schedule | Days-of-week repeat, one-off alarms. | Free | Holiday skip / "skip next occurrence" exists in some versions [PK]. |
| Label | Text label per alarm. | Free | "Label reminder" reads the label aloud every minute while ringing: Prem [S]. |
| Snooze controls | Interval (1–60 min), max count (1–10 / unlimited), or snooze off entirely. | Free [PK] | Snooze can be limited. Users want a "snooze needs a mission too" option. |
| Alarm sounds | Bundled tones (loud, "extremely loud", nature, etc.). | Mixed [PK] | Some packs premium. |
| Custom sound | Pick a song/file from the device. | Free [PK] | Fails if the file is moved or deleted. That is why the backup sound exists. |
| Gradual volume ("volume up") | Ramp from quiet to full over N seconds. | Free [PK] | |
| Extra loud / volume boost | Force max volume, override system volume. | Prem [S] | "Extra Loud Effect" listed with premium items. |
| Time reminder (TTS) | Speaks the current time every minute while ringing. | Prem [S] | Cheap to build with Android TTS. |
| Vibration | On/off, sometimes with patterns. | Free | |
| Backup sound | Plays a built-in tone if the chosen sound fails (no network, file missing). | Free [PK] | Must-have reliability feature. |
| Quick alarm / nap | One-shot "ring in X minutes". | Free [PK] | Also a timer. |
| Wake-up check | After dismiss, a notification asks you to confirm "I'm awake" within N min. If you don't, the alarm re-rings. | **Prem** [S] | Probably the single most valuable anti-oversleep feature, and it's paywalled. |
| Alarm cheat prevention: prevent uninstall | Blocks uninstalling the app while an alarm rings. | Tier unclear [S: exists] | Path: Settings → Alarm Setting → Alarm Cheat Prevention [S]. Likely uses Device Admin or Accessibility. |
| Alarm cheat prevention: prevent power-off | Blocks the power menu during the alarm. | Tier unclear [S: exists] | Community believes it uses an **AccessibilityService** [S, speculative]. Can be bypassed on One UI 6.1 [S]. |
| Force-stop resistance | Re-rings if killed / Settings blocked during alarm. | Unclear [PK] | |

### 2.3 Around-the-alarm features

| Feature | Description | Alarmy tier | Notes |
|---|---|---|---|
| Morning briefing / "Today's panel" | Weather, news headlines, horoscope after dismiss. | Free with ads [S] | Weather needs (background) location [S]. News/horoscope need network and third-party feeds. |
| Sleep sounds | White noise, rain, ASMR, with a sleep timer. | Free (8 sounds) / more Prem [S] | Streaming content, data use. |
| Sleep tracker / snore recorder | Records audio overnight, flags snoring, estimates sleep stages. | Mixed. "Unlimited snore recording" premium [S] | Accuracy complaints (logged 6 h awake during an 8 h sleep) [S]. Microphone all night is a privacy cost. |
| Bedtime reminder | Notification at a target bedtime. | Free [PK] | |
| Statistics / history | Wake-up records, streaks, sleep reports. | Mixed [PK] | |
| Routines / habits | Morning to-do list after waking (newer versions). | Mixed [PK] | Feature creep toward "wellness platform". |
| Themes / dark mode | App theme, alarm screen backgrounds. | Mixed [PK] | |
| Widgets | Home-screen next-alarm widget. | Free [PK] | |
| Account & cloud backup | Login, sync alarms across devices. | Free/Prem [PK] | Needs an account, so data goes to their servers. |
| Ads | Banner and interstitial ads (also on post-alarm screens). | Free tier | Removed by Premium [S]. |

### 2.4 Platform notes on Alarmy itself
- **iOS** can't show a custom alarm screen on the lock screen. The developer confirmed users must
  unlock the phone to dismiss [S]. On iOS, Alarmy fakes persistence with repeated notifications
  and needs background refresh, which causes battery complaints [S].
- **Android** is where the full concept works: full-screen intent, foreground service and exact alarms.

---

## 3. Monetization and paywall analysis

**Model.** Freemium with ads, plus an auto-renewing subscription with a 7-day free trial [S].

**Price points (vary by region and A/B test):**

| Plan | Price seen | Source |
|---|---|---|
| Weekly | $1.99 | App Store snippet [S] |
| Monthly | $3.99 – $7.49 ("Premium Standard" / "Premium Plus") | App Store, Adapty, App Pricing Lab [S] |
| Yearly | $19.99 (older) → **$59.99** (2025, Standard and Plus tiers) | App Store snippet, Adapty, SleepArise [S] |
| "Alarmy Pro" / lifetime-like | $69.99 | App Pricing Lab [S] |
| AlternativeTo summary | "$5–$9 per month" | [S] |

So the real yearly cost has roughly **tripled** ($19.99 → $59.99), and there are now **two premium tiers**
(Standard vs Plus). That is a classic price-discrimination ladder.

**Locked behind Premium (best evidence):** Wake-up check, typing, step, squat, multiple missions,
extra-loud effect, time/label TTS reminders, unlimited snore recording, some sound packs and themes, ad removal [S/PK].
A reviewer: "I can't use more than HALF of the wakeup actions without paying" [S].

**Ads.** The free tier is "full of ads" [S]. Ads on a just-woke-up screen are especially hostile. They
are also a reliability risk: ad SDKs add WebViews, network calls and memory pressure to the
most critical path of the app [analyst opinion].

**Dark patterns users complain about** (mostly [PK]; Alarmy-specific complaint data was thin in searchable sources):
1. **Paywall at the moment of need.** The best anti-oversleep features are shown in the mission list,
   and tapping them opens the paywall. The free user sees the solution and can't use it.
2. **Trial → auto-renew annual.** The default selection on the paywall is the 7-day trial of the yearly plan. Users report
   surprise annual charges [PK].
3. **Tier confusion.** "Standard" vs "Plus" vs "Pro" offerings, and the price differs by store region [S].
4. **Feature migration.** Features that were once free move to premium in later versions [PK].
5. **Account nudging.** Pushes to log in for "backup" [PK].

**Implication for Rouse:** "Everything unlocked" is a real differentiator, but only if the unlocked features
are **at least as good** as Alarmy Premium's. The marketing line writes itself: *"Wake-up check, step missions,
multiple missions: free, forever. No ads on your alarm screen."*

---

## 4. User pain points (ranked)

Ranking = frequency in the review snippets and press found, weighted by severity. Severity scale: alarm-critical > trust > annoyance.

| # | Pain point | Severity | Frequency | Evidence | Rouse response |
|---|---|---|---|---|---|
| 1 | **Alarm fails to ring / rings silently / only rings when the app is opened** | Critical | High | Reddit r/GetOutOfBed thread [S]; App Store reviewers advise a backup alarm [S]; old Alarmy FAQ blames memory cleaners [S] | Reliability engineering (§7) is P0. Self-test, permission health dashboard, OEM guidance, native backup tone. |
| 2 | **Paywall on core missions and wake-up check** | Trust | High | "can't use more than HALF of the wakeup actions" [S]; AlternativeTo [S] | Everything free. |
| 3 | **Ads** (banners, interstitials, around the alarm) | Annoyance → trust | High | AlternativeTo "full of ads" [S] | None. |
| 4 | **Battery drain** | Annoyance | Medium-high (iOS esp.) | "phone died overnight", "constant top item on battery usage" [S] | Use `setAlarmClock()` only. No persistent background service between alarms, no ad SDKs, no polling. |
| 5 | **Subscription price and renewals** | Trust | Medium | $19.99 → $59.99/yr [S] | N/A (free). |
| 6 | **Missions too easy to cheat** (shake in bed; step mission by shaking; photo matched with a photo of a photo; force-stop / reboot / volume-down) | Product | Medium | [PK]; I Can't Wake Up! board discussions about bypasses [S] | Volume can't be lowered while ringing, alarm re-rings after a kill, ring-again on reboot, multiple missions, wake-up check, QR in another room. |
| 7 | **Missions too hard / fail when half-asleep** (photo matching fails in the dark, barcode won't scan, camera permission revoked) → user stuck with a ringing phone | Critical | Medium | [PK] | Mission test at setup, torch toggle, documented **emergency escape** (harder fallback mission after N failures), never a dead end. |
| 8 | **Missions get repetitive** | Annoyance | Low-medium | "repetitive over time" [S] | Randomized mission pools, rotating math formats. |
| 9 | **Sleep tracking inaccurate** | Annoyance | Low-medium | "logged 6 hours awake during 8-hour sleep" [S] | Not in MVP. Only build if honest about limits. |
| 10 | **Privacy / permissions** (location for weather, all-night microphone, account, ad tracking, cloud upload) | Trust | Medium (under-reported) | Weather needs background location [S]; Play listing lists ad/analytics data [PK] | No network permission needed for core. Every permission is optional and requested only when its feature is enabled. |
| 11 | **Accessibility** (math under time pressure for dyscalculia, shake/squat for mobility-impaired users, color-memory game for color-blind users, photo matching for low-vision users) | Inclusion | Low (rarely voiced, real) | [PK] | Accessible mission set (typing, QR, step), no color-only encoding, TalkBack labels, large targets. |
| 12 | **Lock-screen friction on iOS** (must unlock first) | Annoyance | Medium (iOS) | Developer reply [S] | iOS out of scope for v1 (D-002). |
| 13 | **Feature bloat** (news, horoscope, routines, sleep sounds crowd the alarm UX) | Annoyance | Low | [PK] | Keep the app focused. |

---

## 5. Competitor glance

| App | Model | What it does better than Alarmy | Weaknesses |
|---|---|---|---|
| **Sleep as Android** (Urbandroid) | Free trial → one-time unlock | Huge set of CAPTCHA types: math, QR/barcode, **NFC tag**, sheep counting, shake, typing, laugh/smile [PK]. Sleep tracking via wearable integration. Smart wake within a light-sleep window. Very configurable. Mature reliability docs. | Overwhelming UI. Sleep tracking needs the phone in bed. Paid unlock. |
| **AMdroid** | Freemium, one-time pro | Reliability-first design: "alarm pre-check", backup alarm, **holiday/calendar-aware** skipping, location-based alarm skip, timeline UI [PK]. | Smaller mission set. Dated UI. |
| **Galarm** | Freemium / subscription | **Social accountability**: buddy alarms, a friend gets notified if you don't wake [PK]. | Needs an account and cloud. |
| **I Can't Wake Up!** (Kog Creations) | Free with ads + pro | 8+ wake-up tasks (math, memory, order tiles, rewrite text, barcode, shake, match), "wake-up check", **quit blocking** (renamed "Alarm Quitting Prevention" in 4.2.0) [S/PK]. | Old-fashioned UI, ads. |
| **Loud Alarm Clock** and similar | Ads | Extra-loud audio processing / booster [PK]. | Little else. |
| **QRAlarm** (sweakpl) | **GPL-3.0**, F-Droid build free of ads and tracking; Play build ad-supported + pro [S] | Proof that a focused, open-source mission alarm can be maintained (Kotlin, active through 2026 per F-Droid listing [S]). Clean single-purpose QR flow. | Basically one mission type. |
| **Fossify Clock / Simple Clock**, **Chrono** | FOSS | Clean, private, reliable stock-style alarms, timers, stopwatch [S/PK]. | No missions. No anti-snooze commitment. |
| **Google Clock / stock clock** | Free | Reliability baseline. System-privileged on Pixels. Sunrise alarm, Spotify/YT Music sounds, bedtime mode. | No missions at all. |
| Old FOSS "Alarm Clock" (za.co.neilson.alarm) | Apache-2.0 | Math-to-dismiss [S]. | Abandoned in 2015, upstream gone [S]. Shows the **open-source gap**: no maintained, multi-mission, FOSS Alarmy exists. |

**Takeaway.** No open-source app combines (a) a **rich mission set**, (b) **wake-up check**, (c) **anti-escape hardening**,
(d) **modern Android 14–16 reliability**, and (e) zero ads, accounts or tracking. That gap is the product.

---

## 6. Opportunity list (how Rouse can be **better**, not just equal)

Priority: **P0** = MVP; the app is pointless or unsafe without it. **P1** = next release, a strong differentiator. **P2** = later or optional.

### P0: must-have MVP
1. **Rock-solid ringing on Android** (see §7): `setAlarmClock()`, `USE_EXACT_ALARM`, full-screen intent, a foreground
   ringing service, boot/time-change/package-replaced re-scheduling, a native **backup tone** if custom audio fails, and audio on
   `USAGE_ALARM` so it ignores media volume and DND. **Ringing must not depend on the WebView or JS being alive.**
2. **Permission & reliability health screen**: shows exact-alarm, notifications, full-screen-intent, battery-optimization
   exemption and DND status, each with a one-tap fix. Includes OEM-specific guidance (link to dontkillmyapp.com).
   Also a **"Test alarm in 1 minute"** button. This answers pain #1 directly, and Alarmy doesn't do it well.
3. **Alarm CRUD**: time, repeat days, one-off, label, enable toggle, "skip next", next-alarm countdown ("rings in 7 h 12 m").
4. **Missions (free, all of them, MVP set):**
   - **Math**: difficulty levels plus problem count. Generated problems, no trivial repeats.
   - **Memory tiles**: grid size and rounds. Uses position plus shape/number, **not color only**.
   - **Typing/phrase**: random built-in phrases or a custom phrase. Case/whitespace-tolerant option.
   - **Shake**: count, with a sensible accelerometer threshold.
   - **QR/Barcode scan**: register a code at setup, require the *same* code. Torch toggle.
   - **Tap challenge**: hit N moving/random targets, with large targets.
   - **Steps**: step detector sensor, N steps. Falls back to a different mission if no sensor.
   - Mission count per alarm (**multiple missions, 1–3 chained**: free), plus a **random mission** option.
5. **Snooze controls**: interval, max count (0 = disabled), optional "snooze requires the mission too".
6. **Ringing behavior**: gradual volume ramp, vibration, **volume locked during ring** (hardware volume keys don't lower it),
   **silence while solving** (mission screen mutes for up to ~30 s of activity, then resumes if idle).
7. **Wake-up check (free)**: N minutes after dismiss, a high-priority notification or full-screen prompt.
   If it's not confirmed within the window, re-ring with the mission.
8. **Escape hatch that isn't a cheat**: if a mission is impossible (camera broken, QR lost), after N failed attempts or
   M minutes, offer a **harder fallback** mission (e.g., long typing or 20 math problems). The user is never trapped, and it is never easy. Document this honestly.
9. **Sounds**: several bundled loud tones (offline, CC0), custom sound picker, preview.
10. **Privacy baseline**: no INTERNET permission needed for core features. No analytics, no account. **JSON export/import backup** (D-001).
11. **Accessibility baseline**: TalkBack labels, large touch targets, no color-only cues, respects font scale, light/dark theme.

### P1: differentiators
1. **Photo mission**: on-device image matching (perceptual hash / feature matching) against a registered photo, with
   tolerance and a torch. Medium-hard to make robust in low light. Ship with an explicit "test now" step.
2. **NFC tag mission** (Sleep as Android's best trick): tap an NFC sticker in another room. Very cheat-resistant.
3. **Squat mission**: accelerometer vertical-motion pattern. Cheatable by hand-pumping the phone. Label it honestly.
4. **Anti-escape, soft version**: re-ring if the app is swiped away or killed (where the OS allows), re-ring after
   reboot if an alarm was mid-ring (persist "ringing" state, check it on BOOT_COMPLETED), raise volume on missed checks.
5. **Statistics**: wake-up time history, snoozes used, mission time, streaks. All local.
6. **TTS time/label reminder** while ringing (Android TextToSpeech, offline voices).
7. **Bedtime reminder** and **quick nap / timer**.
8. **Home-screen widget** for the next alarm.
9. **Holiday / calendar skip** (AMdroid's strength), done locally.
10. **Morning briefing, offline-first**: today's calendar events (local), next alarm, optional weather via a keyless
    open API (e.g., Open-Meteo) **only if the user opts in** with coarse location. No news or horoscope feeds.

### P2: later / optional
1. **Sleep sounds** (bundled CC0 loops plus a timer).
2. **Sleep / snore recorder**: local only, with honest accuracy disclaimers. All-night mic, battery and privacy costs.
3. **Smart wake window** (accelerometer light-sleep detection): unreliable without wearables.
4. **Buddy accountability** (Galarm-style): needs a server, which conflicts with offline-first. Possible later via share-intent "I'm up".
5. **Wear OS** companion.
6. **iOS**: out of scope (D-002).
7. **Themes**, more mini-game missions (sliding puzzle, sequence order, word unscramble).

### Explicitly **not recommended** (or opt-in only with strong warnings)

| Idea | Why it's hard / risky | Recommendation |
|---|---|---|
| **Prevent power-off** | Only possible by abusing an **AccessibilityService** to detect and dismiss the power menu. Google Play restricts Accessibility API use to genuine accessibility purposes. It also doesn't stop a forced hard reboot. Samsung One UI 6.1 reportedly bypasses it [S]. | **Don't ship.** Instead, **re-ring on boot** if the alarm was mid-ring or the wake-up check is pending. Same commitment, no abuse. |
| **Prevent uninstall** | Needs **Device Admin** (mostly deprecated, scary UX) or Accessibility. Policy risk. | Not in MVP. Possibly P2 as an explicit opt-in "commitment mode", F-Droid build only. |
| **Block Settings / force-stop during ring** | Accessibility abuse. | Don't ship. |
| **Override DND / silent mode** | Allowed: `USAGE_ALARM` audio plays through DND when "Alarms" are allowed (the default). | Do this (it's P0, not a hack). |
| **Ads / IAP / analytics SDKs** | Contradicts the mission. | Never. |

---

## 7. Platform-reliability notes (Android)

An alarm app's **only** non-negotiable requirement is that it rings. These rules apply as of Android 14–16 (API 34–36).

### 7.1 Scheduling
- **Use `AlarmManager.setAlarmClock(AlarmClockInfo, PendingIntent)`.** This is the highest-priority alarm type. It fires exactly,
  **wakes the device from Doze**, is exempt from standby buckets, and shows the status-bar alarm icon / system "next alarm".
  Don't use `setExactAndAllowWhileIdle` for the main alarm (Doze rate limits).
- **Exact-alarm permission:** API 31 introduced `SCHEDULE_EXACT_ALARM` (special access, user-revocable). API 33+ added
  **`USE_EXACT_ALARM`**: a normal permission granted at install, intended **only** for alarm-clock/calendar apps (Play-restricted; an alarm clock qualifies) [S].
  On Android 14+, `SCHEDULE_EXACT_ALARM` is **denied by default** for new installs [S].
  **Recommendation:** declare `USE_EXACT_ALARM` plus `SCHEDULE_EXACT_ALARM` with `android:maxSdkVersion="32"`. Still check
  `canScheduleExactAlarms()` at runtime, and handle `ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`.
- **Rescheduling triggers.** Alarms are cleared on reboot and app update. Receiver for `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`
  (direct-boot-aware receiver plus device-protected storage, so alarms survive a reboot before first unlock), `MY_PACKAGE_REPLACED`,
  `TIME_SET`, `TIMEZONE_CHANGED`. Recompute the next fire time from the stored schedule. **Never trust a stale absolute timestamp.**
- **Time math**: local wall-clock with DST handling (02:30 on a spring-forward day must still fire, e.g., at 03:00). Unit-test DST.

### 7.2 Ringing
- **Full-screen intent:** a `CATEGORY_ALARM` notification with `setFullScreenIntent()` launches the alarm activity over the lock
  screen (`setShowWhenLocked(true)`, `setTurnScreenOn(true)`). On Android 14+, `USE_FULL_SCREEN_INTENT` is auto-granted **only to
  calling/alarm apps**, and users can revoke it [S]. Check `NotificationManager.canUseFullScreenIntent()`; deep-link
  `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`. If FSI is denied, the alarm still rings but only as heads-up. Flag it on the health screen.
- **Notifications:** runtime **`POST_NOTIFICATIONS`** on Android 13+. Without it, no FSI notification is shown. Use a dedicated
  high-importance "Alarms" channel with sound null (audio comes from the service).
- **Foreground service:** start it from the alarm receiver. An FGS start from the background is exempt when triggered by an exact/alarm-clock
  alarm. Android 14+ requires a declared **`foregroundServiceType`**, or you get `MissingForegroundServiceTypeException` [S].
  Recommendation: `mediaPlayback` (+ `FOREGROUND_SERVICE_MEDIA_PLAYBACK`). `systemExempted` is an alternative for exact-alarm
  holders [PK, verify]. Android 15 restricts starting some FGS types from `BOOT_COMPLETED`, so only reschedule there [PK].
- **Audio:** `AudioAttributes.USAGE_ALARM` / `CONTENT_TYPE_SONIFICATION` (alarm stream, honored in DND by default, independent of
  media/ringer volume). Ramp by stepping player volume. Optionally raise `STREAM_ALARM` and restore it afterward. Audio focus
  `GAIN_TRANSIENT`. **On any playback error, fall back to a bundled raw resource.** For custom sounds, take a persistable URI
  permission or copy the file into app storage.
- **Wake lock** (partial) while ringing. **Vibration** via `VibratorManager` with alarm usage.
- **Process death:** persist "ringing" state, and schedule a **re-ring safety alarm** (+1–2 min) via `setAlarmClock` *before*
  ringing starts. Cancel it only on mission success. This covers OEM kills, crashes and reboot-during-ring (paired with the boot check).
  A user **Force Stop** cancels all alarms until the next manual launch. Nothing can fix that, so document it.

### 7.3 Doze, App Standby, OEM battery killers
- `setAlarmClock` bypasses Doze and standby on stock Android.
- OEM skins (Xiaomi/HyperOS, Huawei, OnePlus/Oppo, Vivo, Samsung "sleeping apps") may still kill or block apps [S]. Samsung
  promised standard behavior from One UI 6.0 for apps targeting 14, but re-restriction after firmware updates is reported [S].
  Xiaomi needs **Autostart**, or alarms can fail after reboot [S].
- Mitigations: request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (justifiable for alarm clocks), give vendor-specific instructions
  (link dontkillmyapp.com/<vendor>), and offer the 1-minute test alarm. **Don't** keep a permanent background service. It's unnecessary and drains battery.

### 7.4 Do Not Disturb, silent mode, calls
- Alarm-usage audio plays through DND when DND allows alarms (the default). Check the interruption filter/policy and warn if alarms are blocked.
- Don't request `ACCESS_NOTIFICATION_POLICY`; don't override the user's DND config.
- During a phone call: keep the notification and ring after the call ends.

### 7.5 Manifest checklist
```
uses-permission: USE_EXACT_ALARM; SCHEDULE_EXACT_ALARM (maxSdk 32); RECEIVE_BOOT_COMPLETED; POST_NOTIFICATIONS;
                 USE_FULL_SCREEN_INTENT; FOREGROUND_SERVICE; FOREGROUND_SERVICE_MEDIA_PLAYBACK; WAKE_LOCK; VIBRATE;
                 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS; CAMERA (QR/photo, runtime);
                 ACTIVITY_RECOGNITION (steps, runtime, API 29+); NFC (P1). NO INTERNET for core.
activity  AlarmRingActivity: showWhenLocked, turnScreenOn, excludeFromRecents, singleInstance/singleTask,
          separate taskAffinity; back button blocked
service   AlarmService foregroundServiceType="mediaPlayback"
receiver  AlarmReceiver (exported=false); BootReceiver (directBootAware: BOOT_COMPLETED, LOCKED_BOOT_COMPLETED,
          MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED)
```

### 7.6 Capacitor-specific cautions (given D-003)
- **Native owns the alarm**: scheduling, firing, audio, vibration, FSI notification, re-ring safety, reboot handling, all in Java.
  The WebView can take 1–3 s to cold-start or can crash. **Audio must already be playing before JS loads.**
- The ring activity may host the WebView for the mission UI, with dismiss going back through the plugin. If the WebView doesn't load within N s,
  show a **native fallback mission** (e.g., a native math dialog) so the user is never stuck.
- The **source of truth** for schedules and mission parameters (type, difficulty, QR payload) is native storage (SharedPreferences/Room,
  device-protected), synced from JS, because the boot receiver can't run JS.

### 7.7 Why a pure web app / PWA cannot be the alarm
- **No background execution**: closed tabs don't run, background tabs are throttled or frozen, and mobile Chrome freezes pages soon after they leave the foreground.
- **No scheduled local notifications**: the Notification Triggers API (`showTrigger`) was an abandoned origin trial. Web Push needs a
  server and network, delivers only a notification (Doze-delayed), and **can't play continuous audio** or open a full-screen UI over the lock screen.
- **Autoplay policies** block audio without a gesture. There is no access to the alarm stream, so DND and media volume can't be bypassed.
- **No lock-screen UI or screen-on**. The Wake Lock API only works while the page is visible, which means screen-on all night, and it dies on app switch or browser kill.
- **iOS Safari PWAs** are even more restricted.
- Conclusion: the web build is a **demo/dev harness only** (D-002, D-004) and must say on screen that it can't wake a locked phone.

---

## 8. Summary for the planner
- **The product is reliability + commitment.** Alarmy's moat is its mission catalogue. Its weaknesses are paywalled commitment features,
  ads on the wake screen, battery drain, and occasional failures to ring.
- **Win condition:** ring every time (verifiably: health screen + test alarm), offer every Alarmy Premium commitment feature for free
  (wake-up check, multiple missions, typing, steps), and give a no-trap fallback. Private by construction.
- **Don't** chase power-off/uninstall blocking via Accessibility or Device Admin. Get the same commitment from re-ring-on-kill/reboot plus the wake-up check.
- **Keep scope tight:** briefing, sleep tracking and sleep sounds are P1/P2 at most.
