package com.takipatlasi.app;

import android.content.Context;

/** Shared, local cooldown for relationship and metadata requests. Contains no session data. */
final class InstagramRequestGate {
    static final long DEFAULT_DELAY_MS = 15 * 60 * 1000L;
    static final long MAX_DELAY_MS = 24 * 60 * 60 * 1000L;
    private static final String PREFERENCES = "instagram_request_gate";

    private InstagramRequestGate() {}

    static long normalizeDelay(long requestedMs) {
        return requestedMs > 0 ? Math.min(MAX_DELAY_MS, requestedMs) : DEFAULT_DELAY_MS;
    }

    static synchronized long blockedUntil(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getLong("blockedUntil", 0);
    }

    static synchronized void blockFor(Context context, long delayMs) {
        long until = Math.max(blockedUntil(context), System.currentTimeMillis() + normalizeDelay(delayMs));
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putLong("blockedUntil", until).apply();
    }
}
