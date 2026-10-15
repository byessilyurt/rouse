package app.rouse.alarm;

/** A plugin-visible failure: `code` is one of RousePluginErrorCode (RousePlugin.ts). */
public final class RouseError extends Exception {

    public static final String INVALID_ARGUMENT = "INVALID_ARGUMENT";
    public static final String NO_ACTIVE_RING = "NO_ACTIVE_RING";
    public static final String SESSION_MISMATCH = "SESSION_MISMATCH";
    public static final String SNOOZE_NOT_ALLOWED = "SNOOZE_NOT_ALLOWED";
    public static final String UNSUPPORTED = "UNSUPPORTED";
    public static final String IO_ERROR = "IO_ERROR";

    private static final long serialVersionUID = 1L;

    public final String code;

    public RouseError(String code, String message) {
        super(message);
        this.code = code;
    }
}
