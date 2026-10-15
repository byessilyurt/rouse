package app.rouse.alarm;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.zone.ZoneRules;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Next-fire math. NORMATIVE: docs/plan.md §3.6. Must agree with src/core/schedule.ts; both are
 * tested against tests/fixtures/next-fire-vectors.json. Pure java.time (core-library desugaring
 * on API 24–25), no Android dependencies, so it is unit-testable on the JVM.
 */
public final class ScheduleMath {

    private ScheduleMath() {}

    public static final long DAY_MS = 86_400_000L;
    /** nextOccurrence searches today plus 14 days (i in 0..14). */
    public static final int SEARCH_DAYS = 15;

    /** The alarm fields the schedule needs (implemented by model.AlarmSpec). */
    public interface Schedulable {
        String getId();
        int getHour();
        int getMinute();
        /** 0 = Sunday … 6 = Saturday; empty = one-off. */
        int[] getDays();
        /** Occurrences at instants <= skipUntil are skipped; null = not skipping. */
        Long getSkipUntil();
        boolean isEnabled();
        long getCreatedAt();
    }

    /** Result of nextFire: the primary alarm, every alarm due at the same instant, and the instant. */
    public static final class NextFire {
        public final String alarmId;
        public final List<String> alarmIds;
        public final long fireAt;

        public NextFire(String alarmId, List<String> alarmIds, long fireAt) {
            this.alarmId = alarmId;
            this.alarmIds = Collections.unmodifiableList(new ArrayList<>(alarmIds));
            this.fireAt = fireAt;
        }
    }

    /** Offset of local wall time from UTC at `epochMs`, in milliseconds (east positive). */
    static long offsetMs(ZoneRules rules, long epochMs) {
        ZoneOffset off = rules.getOffset(Instant.ofEpochMilli(epochMs));
        return off.getTotalSeconds() * 1000L;
    }

    /** Local calendar date of `epochMs` in `zone`. */
    public static LocalDate localDateOf(long epochMs, ZoneId zone) {
        return Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate();
    }

    /** Day of week of a local date, 0 = Sunday … 6 = Saturday. */
    public static int weekdayOf(LocalDate date) {
        DayOfWeek dow = date.getDayOfWeek();
        return dow.getValue() % 7;
    }

    /**
     * Instant of wall time hour:minute on `date` in `zone` (§3.6):
     * overlap → earlier instant; gap → shifted later by the gap length.
     */
    public static long wallTimeToEpoch(LocalDate date, int hour, int minute, ZoneId zone) {
        ZoneRules rules = zone.getRules();
        long w = LocalDateTime.of(date, LocalTime.of(hour, minute)).toEpochSecond(ZoneOffset.UTC) * 1000L;
        long c1 = w - offsetMs(rules, w - DAY_MS);
        long c2 = w - offsetMs(rules, w + DAY_MS);
        boolean v1 = c1 + offsetMs(rules, c1) == w;
        boolean v2 = c2 + offsetMs(rules, c2) == w;
        if (v1 && v2) return Math.min(c1, c2);
        if (v1) return c1;
        if (v2) return c2;
        return c1;
    }

    static boolean containsDay(int[] days, int weekday) {
        for (int d : days) {
            if (d == weekday) return true;
        }
        return false;
    }

    /**
     * Next instant strictly after `now` at which the alarm would ring, honouring days and skipUntil.
     * Ignores `enabled`. Null if nothing within the 15-day window.
     */
    public static Long nextOccurrence(int hour, int minute, int[] days, Long skipUntil, long now, ZoneId zone) {
        LocalDate start = localDateOf(now, zone);
        int[] d = days == null ? new int[0] : days;
        for (int i = 0; i < SEARCH_DAYS; i++) {
            LocalDate date = start.plusDays(i);
            if (d.length > 0 && !containsDay(d, weekdayOf(date))) continue;
            long t = wallTimeToEpoch(date, hour, minute, zone);
            if (t <= now) continue;
            if (skipUntil != null && t <= skipUntil) continue;
            return t;
        }
        return null;
    }

    public static Long nextOccurrence(Schedulable a, long now, ZoneId zone) {
        return nextOccurrence(a.getHour(), a.getMinute(), a.getDays(), a.getSkipUntil(), now, zone);
    }

    /** Sort key for ties: (createdAt, id). */
    public static final Comparator<Schedulable> TIE_ORDER = new Comparator<Schedulable>() {
        @Override
        public int compare(Schedulable a, Schedulable b) {
            int c = Long.compare(a.getCreatedAt(), b.getCreatedAt());
            if (c != 0) return c;
            return a.getId().compareTo(b.getId());
        }
    };

    /** Earliest next occurrence across ENABLED alarms; alarms due at the same instant are merged. */
    public static NextFire nextFire(List<? extends Schedulable> alarms, long now, ZoneId zone) {
        Long best = null;
        List<Schedulable> due = new ArrayList<>();
        for (Schedulable a : alarms) {
            if (!a.isEnabled()) continue;
            Long t = nextOccurrence(a, now, zone);
            if (t == null) continue;
            if (best == null || t < best) {
                best = t;
                due.clear();
                due.add(a);
            } else if (t.longValue() == best.longValue()) {
                due.add(a);
            }
        }
        if (best == null) return null;
        Collections.sort(due, TIE_ORDER);
        List<String> ids = new ArrayList<>();
        for (Schedulable a : due) ids.add(a.getId());
        return new NextFire(ids.get(0), ids, best);
    }

    /** Enabled alarms whose occurrence is exactly `fireAt` (stale PendingIntents resolve to nothing). */
    public static List<Schedulable> dueAt(List<? extends Schedulable> alarms, long fireAt, ZoneId zone) {
        List<Schedulable> due = new ArrayList<>();
        for (Schedulable a : alarms) {
            if (!a.isEnabled()) continue;
            Long t = nextOccurrence(a, fireAt - 1, zone);
            if (t != null && t == fireAt) due.add(a);
        }
        Collections.sort(due, TIE_ORDER);
        return due;
    }

    /**
     * Bedtime reminder: from nextFire over enabled alarms that are not quick naps (the caller
     * filters deleteAfterRing). fireAt − sleepGoalMin; null if disabled, no next fire,
     * fireAt − now > 24 h, or the result is not in the future.
     */
    public static Long bedtimeReminderAt(List<? extends Schedulable> alarms, boolean enabled, int sleepGoalMin, long now, ZoneId zone) {
        if (!enabled) return null;
        NextFire nf = nextFire(alarms, now, zone);
        if (nf == null) return null;
        if (nf.fireAt - now > RouseConstants.BEDTIME_HORIZON_MS) return null;
        long at = nf.fireAt - sleepGoalMin * 60_000L;
        if (at <= now) return null;
        return at;
    }
}
