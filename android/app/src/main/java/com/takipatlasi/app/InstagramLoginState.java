package com.takipatlasi.app;

import java.net.URI;
import java.util.Locale;

/** Page readiness is separate from account verification; a cookie alone is not a valid login. */
final class InstagramLoginState {
    private InstagramLoginState() {}

    static boolean isReadyUrl(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) ||
                !"www.instagram.com".equalsIgnoreCase(uri.getHost()) || uri.getUserInfo() != null ||
                (uri.getPort() != -1 && uri.getPort() != 443)) {
                return false;
            }
            String path = uri.getPath() == null ? "/" : uri.getPath().toLowerCase(Locale.ROOT);
            return !path.equals("/accounts") && !path.startsWith("/accounts/") &&
                !path.startsWith("/challenge") && !path.startsWith("/checkpoint") &&
                !path.startsWith("/consent");
        } catch (Exception error) {
            return false;
        }
    }
}
