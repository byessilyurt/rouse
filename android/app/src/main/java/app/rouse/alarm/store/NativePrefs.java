package app.rouse.alarm.store;

import android.content.Context;
import android.content.SharedPreferences;
import app.rouse.alarm.RouseConstants;

/**
 * Device-protected SharedPreferences "rouse_native" (D-031): readable before first unlock, so
 * boot / LOCKED_BOOT_COMPLETED rescheduling and ringing never depend on credential storage.
 */
public final class NativePrefs {

    private NativePrefs() {}

    /** Device-protected storage context (API 24+, always available at minSdk 24). */
    public static Context deviceContext(Context context) {
        Context app = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        if (app.isDeviceProtectedStorage()) return app;
        return app.createDeviceProtectedStorageContext();
    }

    public static SharedPreferences get(Context context) {
        return deviceContext(context).getSharedPreferences(RouseConstants.PREFS_NAME, Context.MODE_PRIVATE);
    }
}
