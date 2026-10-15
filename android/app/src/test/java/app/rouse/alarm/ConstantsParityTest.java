package app.rouse.alarm;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

/** Every constant tagged [JAVA] in src/core/defaults.ts must equal RouseConstants (same name). */
public class ConstantsParityTest {

    private static final Pattern JAVA_CONST = Pattern.compile(
        "/\\*\\*((?:(?!\\*/)[\\s\\S])*?)\\*/\\s*export const (\\w+)(?:\\s*:\\s*[\\w<>\\[\\]]+)?\\s*=\\s*([^;]+);"
    );
    private static final Pattern SOUND = Pattern.compile(
        "id:\\s*'(\\w+)',\\s*name:\\s*'([^']*)',\\s*recipe:\\s*\\{\\s*loopMs:\\s*(\\d+)"
    );

    static Map<String, Object> javaTagged(String ts) {
        Map<String, Object> out = new LinkedHashMap<>();
        Matcher m = JAVA_CONST.matcher(ts);
        while (m.find()) {
            if (!m.group(1).contains("[JAVA]")) continue;
            out.put(m.group(2), evaluate(m.group(3).trim()));
        }
        return out;
    }

    /** Evaluates the literal forms used in defaults.ts: 'str', 10_000, 30 * 60_000. */
    static Object evaluate(String expr) {
        if (expr.startsWith("'") && expr.endsWith("'")) return expr.substring(1, expr.length() - 1);
        long product = 1;
        for (String part : expr.split("\\*")) {
            product *= Long.parseLong(part.trim().replace("_", ""));
        }
        return product;
    }

    @Test
    public void javaTaggedConstantsMatch() throws Exception {
        Map<String, Object> ts = javaTagged(TestFiles.read("src/core/defaults.ts"));
        assertTrue("found only " + ts.keySet(), ts.size() >= 11);
        List<String> mismatches = new ArrayList<>();
        for (Map.Entry<String, Object> e : ts.entrySet()) {
            Field f;
            try {
                f = RouseConstants.class.getField(e.getKey());
            } catch (NoSuchFieldException ex) {
                mismatches.add(e.getKey() + ": missing in RouseConstants");
                continue;
            }
            Object javaValue = f.get(null);
            Object tsValue = e.getValue();
            boolean equal = tsValue instanceof String
                ? tsValue.equals(javaValue)
                : javaValue instanceof Number && ((Number) javaValue).longValue() == (Long) tsValue;
            if (!equal) mismatches.add(e.getKey() + ": ts=" + tsValue + " java=" + javaValue);
        }
        assertTrue(String.join("\n", mismatches), mismatches.isEmpty());
    }

    @Test
    public void bundledSoundsMatch() throws Exception {
        Matcher m = SOUND.matcher(TestFiles.read("src/core/defaults.ts"));
        List<String> ids = new ArrayList<>();
        List<String> names = new ArrayList<>();
        List<Long> loops = new ArrayList<>();
        while (m.find()) {
            ids.add(m.group(1));
            names.add(m.group(2));
            loops.add(Long.parseLong(m.group(3)));
        }
        assertArrayEquals(RouseConstants.BUNDLED_SOUND_IDS, ids.toArray(new String[0]));
        assertArrayEquals(RouseConstants.BUNDLED_SOUND_NAMES, names.toArray(new String[0]));
        long[] l = new long[loops.size()];
        for (int i = 0; i < l.length; i++) l[i] = loops.get(i);
        assertArrayEquals(RouseConstants.BUNDLED_SOUND_LOOP_MS, l);
        assertEquals(RouseConstants.BACKUP_SOUND_ID, ids.get(0));
    }

    @Test
    public void healthCheckIdsMatchContractOrder() throws Exception {
        String ts = TestFiles.read("src/platform/AlarmBackend.ts");
        int start = ts.indexOf("export type HealthCheckId");
        int end = ts.indexOf(";", start);
        Matcher m = Pattern.compile("'(\\w+)'").matcher(ts.substring(start, end));
        List<String> ids = new ArrayList<>();
        while (m.find()) ids.add(m.group(1));
        assertArrayEquals(ids.toArray(new String[0]), HealthChecker.CHECK_IDS);
    }
}
