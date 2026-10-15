package app.rouse.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import app.rouse.alarm.model.AlarmSpec;
import app.rouse.alarm.model.Episode;
import app.rouse.alarm.store.EventLog;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** ActiveRing JSON shape (contract), storage round-trip, and the durable log. */
public class EpisodeJsonTest {

    private static Episode sample() throws Exception {
        Episode e = new Episode();
        e.sessionId = "s-1";
        e.alarmId = "a1";
        e.alarm = AlarmSpec.fromJsonString(AlarmSpecTest.FULL);
        e.source = Episode.SOURCE_SCHEDULED;
        e.state = Episode.STATE_RINGING;
        e.scheduledFor = 1760500000000L;
        e.episodeStartedAt = 1760500000100L;
        e.ringStartedAt = 1760500000100L;
        e.snoozeCount = 1;
        e.uiReady = true;
        e.ringUiLaunchedAt = 1760500001000L;
        e.silenceUntil = null;
        return e;
    }

    @Test
    public void activeRingHasExactlyTheContractKeysWithNulls() throws Exception {
        JSONObject o = sample().toActiveRingJson();
        Set<String> keys = new HashSet<>();
        Iterator<String> it = o.keys();
        while (it.hasNext()) keys.add(it.next());
        assertEquals(new HashSet<>(Arrays.asList(Episode.ACTIVE_RING_KEYS)), keys);
        assertTrue(o.isNull("snoozeUntil"));
        assertTrue(o.isNull("wakeCheckAt"));
        assertTrue(o.isNull("wakeCheckDeadlineAt"));
        assertEquals(1760500000000L, o.getLong("scheduledFor"));
        assertEquals("ringing", o.getString("state"));
        assertFalse(o.getBoolean("isTest"));
        // The alarm snapshot round-trips verbatim (unknown fields included).
        AlarmSpecTest.assertJsonEquals(new JSONObject(AlarmSpecTest.FULL), o.getJSONObject("alarm"));
    }

    @Test
    public void nativeOnlyFieldsStayOutOfActiveRing() throws Exception {
        JSONObject o = sample().toActiveRingJson();
        assertFalse(o.has("uiReady"));
        assertFalse(o.has("ringUiLaunchedAt"));
        assertFalse(o.has("silenceUntil"));
    }

    @Test
    public void storageRoundTrip() throws Exception {
        Episode e = sample();
        e.state = Episode.STATE_WAKE_CHECK_PROMPT;
        e.wakeCheckDeadlineAt = 1760500600000L;
        e.wakeCheckReRings = 1;
        e.silenced = true;
        e.silenceUntil = 1760500030000L;
        e.nativeFallbackShown = true;
        Episode back = Episode.fromJson(new JSONObject(e.toStorageJson().toString()));
        AlarmSpecTest.assertJsonEquals(e.toStorageJson(), back.toStorageJson());
        assertTrue(back.uiReady);
        assertEquals(Long.valueOf(1760500001000L), back.ringUiLaunchedAt);
        assertEquals(Long.valueOf(1760500030000L), back.silenceUntil);
        assertTrue(back.isWakeCheck());
        assertFalse(back.isRinging());
    }

    @Test
    public void eventLogSeqIsMonotonicAndSurvivesAck() throws Exception {
        EventLog log = new EventLog();
        assertEquals(0, log.lastSeq());
        JSONObject f = new JSONObject();
        f.put("source", "scheduled");
        f.put("scheduledFor", JSONObject.NULL);
        JSONObject ev = log.append("ring-started", 5L, "s", "a", f);
        assertEquals(1, ev.getLong("seq"));
        assertEquals("ring-started", ev.getString("type"));
        assertTrue(ev.isNull("scheduledFor"));
        log.append("dismissed", 6L, "s", "a", null);
        log.append("episode-ended", 7L, "s", "a", null);
        assertEquals(3, log.lastSeq());
        assertEquals(2, log.after(1).length());
        log.ack(2);
        assertEquals(1, log.size());
        EventLog reloaded = EventLog.parse(log.serialize());
        assertEquals(3, reloaded.lastSeq());
        JSONObject next = reloaded.append("x", 8L, "s", "a", null);
        assertEquals(4, next.getLong("seq")); // never reused after ack
        JSONArray all = reloaded.after(0);
        assertEquals(3, all.getJSONObject(0).getLong("seq"));
    }

    @Test
    public void eventLogIsCapped() {
        EventLog log = new EventLog();
        for (int i = 0; i < RouseConstants.NATIVE_LOG_CAP + 25; i++) log.append("missed", i, "s" + i, "a", null);
        assertEquals(RouseConstants.NATIVE_LOG_CAP, log.size());
        assertEquals(26, log.after(0).optJSONObject(0).optLong("seq"));
        assertEquals(RouseConstants.NATIVE_LOG_CAP + 25, log.lastSeq());
    }
}
