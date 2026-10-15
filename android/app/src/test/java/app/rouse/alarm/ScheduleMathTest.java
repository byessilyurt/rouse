package app.rouse.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** ScheduleMath against the golden vectors shared with Vitest (D-011) plus Java-only invariants. */
public class ScheduleMathTest {

    private static long iso(String s) {
        return OffsetDateTime.parse(s).toInstant().toEpochMilli();
    }

    private static int[] days(JSONArray arr) throws Exception {
        int[] d = new int[arr.length()];
        for (int i = 0; i < d.length; i++) d[i] = arr.getInt(i);
        return d;
    }

    @Test
    public void sharedGoldenVectors() throws Exception {
        JSONObject root = new JSONObject(TestFiles.read("tests/fixtures/next-fire-vectors.json"));
        JSONArray vectors = root.getJSONArray("vectors");
        assertTrue("expected the shared vectors file to contain cases", vectors.length() >= 20);
        List<String> failures = new ArrayList<>();
        for (int i = 0; i < vectors.length(); i++) {
            JSONObject v = vectors.getJSONObject(i);
            String name = v.getString("name");
            ZoneId zone = ZoneId.of(v.getString("zone"));
            long now = iso(v.getString("nowIso"));
            JSONObject a = v.getJSONObject("alarm");
            Long skip = a.isNull("skipUntilIso") ? null : iso(a.getString("skipUntilIso"));
            Long expected = v.isNull("expectedIso") ? null : iso(v.getString("expectedIso"));
            Long actual = ScheduleMath.nextOccurrence(a.getInt("hour"), a.getInt("minute"), days(a.getJSONArray("days")), skip, now, zone);
            if (expected == null ? actual != null : !expected.equals(actual)) {
                failures.add(name + ": expected " + expected + " got " + actual);
            }
        }
        assertTrue("vector mismatches:\n" + String.join("\n", failures), failures.isEmpty());
    }

    /** The literal §3.6 algorithm must equal java.time's gap/overlap semantics (D-010). */
    @Test
    public void wallTimeMatchesZonedDateTimeAcrossTransitions() {
        String[] zones = {
            "America/New_York", "Europe/Berlin", "Australia/Lord_Howe", "America/Santiago", "Asia/Kolkata",
            "Australia/Sydney", "Pacific/Chatham", "Europe/London", "UTC",
        };
        for (String z : zones) {
            ZoneId zone = ZoneId.of(z);
            LocalDate d = LocalDate.of(2026, 1, 1);
            while (d.getYear() == 2026) {
                for (int h = 0; h < 24; h++) {
                    for (int m = 0; m < 60; m += 15) {
                        long expected = ZonedDateTime.of(d, LocalTime.of(h, m), zone).toInstant().toEpochMilli();
                        long actual = ScheduleMath.wallTimeToEpoch(d, h, m, zone);
                        if (expected != actual) {
                            throw new AssertionError(z + " " + d + " " + h + ":" + m + " expected " + expected + " got " + actual);
                        }
                    }
                }
                d = d.plusDays(1);
            }
        }
    }

    @Test
    public void weekdayIsSundayZero() {
        assertEquals(0, ScheduleMath.weekdayOf(LocalDate.of(2026, 10, 18))); // Sunday
        assertEquals(4, ScheduleMath.weekdayOf(LocalDate.of(2026, 10, 15))); // Thursday
        assertEquals(6, ScheduleMath.weekdayOf(LocalDate.of(2026, 10, 17))); // Saturday
    }

    static final class A implements ScheduleMath.Schedulable {
        final String id;
        final int hour;
        final int minute;
        final int[] days;
        final boolean enabled;
        final long createdAt;

        A(String id, int hour, int minute, int[] days, boolean enabled, long createdAt) {
            this.id = id;
            this.hour = hour;
            this.minute = minute;
            this.days = days;
            this.enabled = enabled;
            this.createdAt = createdAt;
        }

        @Override public String getId() { return id; }
        @Override public int getHour() { return hour; }
        @Override public int getMinute() { return minute; }
        @Override public int[] getDays() { return days; }
        @Override public Long getSkipUntil() { return null; }
        @Override public boolean isEnabled() { return enabled; }
        @Override public long getCreatedAt() { return createdAt; }
    }

    @Test
    public void nextFireMergesTiesOrderedByCreatedAtThenId() {
        ZoneId utc = ZoneId.of("UTC");
        long now = iso("2026-10-15T06:00:00+00:00");
        List<A> alarms = Arrays.asList(
            new A("b", 7, 0, new int[0], true, 100),
            new A("a", 7, 0, new int[0], true, 100),
            new A("c", 7, 0, new int[0], true, 50),
            new A("late", 8, 0, new int[0], true, 1),
            new A("off", 6, 30, new int[0], false, 1)
        );
        ScheduleMath.NextFire nf = ScheduleMath.nextFire(alarms, now, utc);
        assertNotNull(nf);
        assertEquals(iso("2026-10-15T07:00:00+00:00"), nf.fireAt);
        assertEquals("c", nf.alarmId);
        assertEquals(Arrays.asList("c", "a", "b"), nf.alarmIds);
    }

    @Test
    public void nextFireNullWhenNothingEnabled() {
        List<A> alarms = Arrays.asList(new A("x", 7, 0, new int[0], false, 1));
        assertNull(ScheduleMath.nextFire(alarms, 0L, ZoneId.of("UTC")));
    }

    @Test
    public void dueAtFindsExactlyTheAlarmsAtThatInstant() {
        ZoneId utc = ZoneId.of("UTC");
        long fire = iso("2026-10-15T07:00:00+00:00");
        List<A> alarms = Arrays.asList(
            new A("a", 7, 0, new int[0], true, 2),
            new A("b", 7, 0, new int[] { 4 }, true, 1),
            new A("c", 7, 0, new int[] { 5 }, true, 0), // Friday only: not due on Thursday
            new A("d", 7, 1, new int[0], true, 0)
        );
        List<ScheduleMath.Schedulable> due = ScheduleMath.dueAt(alarms, fire, utc);
        assertEquals(2, due.size());
        assertEquals("b", due.get(0).getId());
        assertEquals("a", due.get(1).getId());
    }

    @Test
    public void bedtimeReminder() {
        ZoneId utc = ZoneId.of("UTC");
        long now = iso("2026-10-14T20:00:00+00:00");
        List<A> alarms = Arrays.asList(new A("a", 7, 0, new int[0], true, 1));
        assertEquals(Long.valueOf(iso("2026-10-14T23:00:00+00:00")), ScheduleMath.bedtimeReminderAt(alarms, true, 480, now, utc));
        assertNull(ScheduleMath.bedtimeReminderAt(alarms, false, 480, now, utc));
        // Result in the past → null.
        assertNull(ScheduleMath.bedtimeReminderAt(alarms, true, 720, now, utc));
        // Next fire more than 24 h away → null.
        List<A> far = Arrays.asList(new A("w", 7, 0, new int[] { 1 }, true, 1)); // Monday; now is Wednesday
        assertNull(ScheduleMath.bedtimeReminderAt(far, true, 480, now, utc));
    }
}
