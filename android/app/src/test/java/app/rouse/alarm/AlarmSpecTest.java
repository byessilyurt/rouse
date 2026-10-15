package app.rouse.alarm;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import app.rouse.alarm.model.AlarmSpec;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

public class AlarmSpecTest {

    static final String FULL =
        "{\"id\":\"a1\",\"hour\":6,\"minute\":45,\"days\":[5,1,3,3,9],\"enabled\":true,\"label\":\"Gym\","
            + "\"skipUntil\":1760000000000,\"deleteAfterRing\":false,"
            + "\"sound\":{\"kind\":\"custom\",\"id\":\"s-9\",\"name\":\"Birds\"},\"volume\":70,\"volumeRampSec\":45,"
            + "\"vibrate\":false,\"snooze\":{\"enabled\":true,\"intervalMin\":9,\"maxCount\":2,\"requireMission\":true},"
            + "\"missions\":[{\"type\":\"math\",\"difficulty\":3,\"count\":4},{\"type\":\"qr\",\"expectedCode\":\"X\",\"label\":\"Sink\"}],"
            + "\"randomMission\":false,\"wakeUpCheck\":{\"enabled\":true,\"delayMin\":7,\"windowMin\":4},"
            + "\"createdAt\":1700000000000,\"updatedAt\":1700000000500,\"futureField\":{\"x\":[1,2]}}";

    @Test
    public void parsesEveryField() throws Exception {
        AlarmSpec a = AlarmSpec.fromJsonString(FULL);
        assertEquals("a1", a.id);
        assertEquals(6, a.hour);
        assertEquals(45, a.minute);
        assertArrayEquals(new int[] { 1, 3, 5 }, a.days); // sorted, unique, 0..6 only
        assertTrue(a.enabled);
        assertEquals("Gym", a.label);
        assertEquals(Long.valueOf(1760000000000L), a.skipUntil);
        assertFalse(a.deleteAfterRing);
        assertEquals("custom", a.soundKind);
        assertEquals("s-9", a.soundId);
        assertEquals("Birds", a.soundName);
        assertEquals(70, a.volume);
        assertEquals(45, a.volumeRampSec);
        assertFalse(a.vibrate);
        assertTrue(a.snoozeEnabled);
        assertEquals(9, a.snoozeIntervalMin);
        assertEquals(2, a.snoozeMaxCount);
        assertTrue(a.snoozeRequireMission);
        assertTrue(a.wakeCheckEnabled);
        assertEquals(7, a.wakeCheckDelayMin);
        assertEquals(4, a.wakeCheckWindowMin);
        assertEquals(1700000000000L, a.createdAt);
        assertEquals(1700000000500L, a.updatedAt);
        assertFalse(a.isOneOff());
    }

    @Test
    public void roundTripsVerbatimIncludingUnknownFields() throws Exception {
        JSONObject original = new JSONObject(FULL);
        JSONObject back = AlarmSpec.fromJson(original).toJson();
        assertJsonEquals(original, back);
        assertTrue(back.has("futureField"));
        assertEquals(2, back.getJSONArray("missions").length());
    }

    @Test
    public void withEnabledChangesOnlyEnabled() throws Exception {
        AlarmSpec a = AlarmSpec.fromJsonString(FULL);
        AlarmSpec off = a.withEnabled(false);
        assertFalse(off.enabled);
        assertTrue(a.enabled);
        JSONObject expected = new JSONObject(FULL);
        expected.put("enabled", false);
        assertJsonEquals(expected, off.toJson());
    }

    @Test
    public void minimalAlarmGetsSafeDefaults() throws Exception {
        AlarmSpec a = AlarmSpec.fromJsonString("{\"id\":\"m\",\"hour\":0,\"minute\":0,\"skipUntil\":null}");
        assertTrue(a.isOneOff());
        assertFalse(a.enabled);
        assertNull(a.skipUntil);
        assertEquals("bundled", a.soundKind);
        assertEquals("pulse", a.soundId);
        assertEquals(80, a.volume);
        assertFalse(a.snoozeEnabled);
        assertFalse(a.wakeCheckEnabled);
        assertEquals("", a.label);
    }

    @Test
    public void rejectsMissingOrInvalidCoreFields() {
        String[] bad = {
            "{\"hour\":7,\"minute\":0}",
            "{\"id\":\"\",\"hour\":7,\"minute\":0}",
            "{\"id\":\"x\",\"minute\":0}",
            "{\"id\":\"x\",\"hour\":24,\"minute\":0}",
            "{\"id\":\"x\",\"hour\":7,\"minute\":60}",
            "{\"id\":\"x\",\"hour\":7.5,\"minute\":0}",
            "{\"id\":\"x\",\"hour\":\"7\",\"minute\":0}",
        };
        for (String s : bad) {
            try {
                AlarmSpec.fromJsonString(s);
                fail("should reject " + s);
            } catch (JSONException expected) {
                // ok
            }
        }
    }

    @Test
    public void clampsOutOfRangeValues() throws Exception {
        AlarmSpec a = AlarmSpec.fromJsonString(
            "{\"id\":\"c\",\"hour\":7,\"minute\":0,\"volume\":500,\"volumeRampSec\":-3,"
                + "\"snooze\":{\"enabled\":true,\"intervalMin\":0,\"maxCount\":99}}"
        );
        assertEquals(100, a.volume);
        assertEquals(0, a.volumeRampSec);
        assertEquals(1, a.snoozeIntervalMin);
        assertEquals(10, a.snoozeMaxCount);
    }

    /** Structural JSON equality (key order independent). */
    static void assertJsonEquals(Object expected, Object actual) throws JSONException {
        assertEquals(normalize(expected), normalize(actual));
    }

    private static Object normalize(Object o) throws JSONException {
        if (o instanceof JSONObject) {
            JSONObject j = (JSONObject) o;
            java.util.TreeMap<String, Object> m = new java.util.TreeMap<>();
            java.util.Iterator<String> it = j.keys();
            while (it.hasNext()) {
                String k = it.next();
                m.put(k, normalize(j.get(k)));
            }
            return m;
        }
        if (o instanceof org.json.JSONArray) {
            org.json.JSONArray a = (org.json.JSONArray) o;
            java.util.List<Object> l = new java.util.ArrayList<>();
            for (int i = 0; i < a.length(); i++) l.add(normalize(a.get(i)));
            return l;
        }
        if (o instanceof Number) {
            double d = ((Number) o).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 9.0e15) return (long) d;
            return d;
        }
        if (o == null || JSONObject.NULL.equals(o)) return "<null>";
        return o;
    }
}
