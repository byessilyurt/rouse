package app.rouse.alarm;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Locates repo files shared with the TypeScript side (Gradle runs unit tests from android/app). */
final class TestFiles {

    private TestFiles() {}

    /** Resolve `repoRelative` (e.g. "tests/fixtures/x.json") from android/app or any parent. */
    static File repoFile(String repoRelative) {
        File primary = new File("../../" + repoRelative);
        if (primary.isFile()) return primary;
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        while (dir != null) {
            File f = new File(dir, repoRelative);
            if (f.isFile()) return f;
            dir = dir.getParentFile();
        }
        throw new AssertionError("Shared file not found: " + repoRelative + " (cwd " + System.getProperty("user.dir") + ")");
    }

    static String read(String repoRelative) throws IOException {
        return new String(Files.readAllBytes(repoFile(repoRelative).toPath()), StandardCharsets.UTF_8);
    }
}
