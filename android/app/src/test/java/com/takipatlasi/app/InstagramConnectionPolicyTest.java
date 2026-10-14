package com.takipatlasi.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class InstagramConnectionPolicyTest {
    @Test
    public void loginIntermediatesAreNotReadyEvenWithAnExistingSessionCookie() {
        for (String path : new String[] {
            "/accounts/login/", "/accounts/onetap/", "/accounts/two_factor_authentication/",
            "/accounts/suspended/", "/challenge/", "/checkpoint/", "/consent/"
        }) {
            assertFalse(path, InstagramLoginState.isReadyUrl("https://www.instagram.com" + path));
        }
        assertTrue(InstagramLoginState.isReadyUrl("https://www.instagram.com/"));
        assertTrue(InstagramLoginState.isReadyUrl("https://www.instagram.com/owner/"));
    }

    @Test
    public void readinessRequiresTheExactSecureOrigin() {
        assertFalse(InstagramLoginState.isReadyUrl("http://www.instagram.com/"));
        assertFalse(InstagramLoginState.isReadyUrl("https://www.instagram.com:444/"));
        assertFalse(InstagramLoginState.isReadyUrl("https://user@www.instagram.com/"));
        assertFalse(InstagramLoginState.isReadyUrl("https://www.instagram.com.evil.example/"));
        assertFalse(InstagramLoginState.isReadyUrl(null));
        assertTrue(InstagramLoginState.isReadyUrl("https://www.instagram.com:443/"));
    }

    @Test
    public void cooldownHonorsValidDelaysAndBoundsInvalidInputs() {
        assertEquals(120000, InstagramRequestGate.normalizeDelay(120000));
        assertEquals(900000, InstagramRequestGate.normalizeDelay(0));
        assertEquals(900000, InstagramRequestGate.normalizeDelay(-1));
        assertEquals(86400000, InstagramRequestGate.normalizeDelay(Long.MAX_VALUE));
    }
}
