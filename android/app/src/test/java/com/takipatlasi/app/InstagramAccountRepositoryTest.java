package com.takipatlasi.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.URL;
import org.junit.Test;

public class InstagramAccountRepositoryTest {

    @Test
    public void metadataRequestsUseTheConservativeDelay() {
        for (int index = 0; index < 100; index += 1) {
            long delay = InstagramAccountRepository.nextMetadataDelayMillis();
            assertTrue(delay >= 2000);
            assertTrue(delay <= 3000);
        }
    }

    @Test
    public void instagramApiRequiresExactSecureOrigin() throws Exception {
        assertTrue(
            InstagramAccountRepository.isExactInstagramApiUrl(
                new URL("https://www.instagram.com/api/v1/users/123/info/")
            )
        );
        assertFalse(
            InstagramAccountRepository.isExactInstagramApiUrl(
                new URL("https://evil.example/api/v1/users/123/info/")
            )
        );
        assertFalse(
            InstagramAccountRepository.isExactInstagramApiUrl(
                new URL("https://www.instagram.com.evil.example/api/v1/users/123/info/")
            )
        );
        assertFalse(
            InstagramAccountRepository.isExactInstagramApiUrl(
                new URL("http://www.instagram.com/api/v1/users/123/info/")
            )
        );
        assertFalse(
            InstagramAccountRepository.isExactInstagramApiUrl(
                new URL("https://www.instagram.com:444/api/v1/users/123/info/")
            )
        );
    }

    @Test
    public void photoAllowlistRejectsLookalikeAndInsecureHosts() throws Exception {
        assertTrue(
            InstagramAccountRepository.isAllowedPhotoUrl(
                new URL("https://scontent.cdninstagram.com/profile.jpg")
            )
        );
        assertTrue(
            InstagramAccountRepository.isAllowedPhotoUrl(
                new URL("https://scontent.fist1-1.fna.fbcdn.net/profile.webp")
            )
        );
        assertFalse(
            InstagramAccountRepository.isAllowedPhotoUrl(
                new URL("https://cdninstagram.com.evil.example/profile.jpg")
            )
        );
        assertFalse(
            InstagramAccountRepository.isAllowedPhotoUrl(
                new URL("http://scontent.cdninstagram.com/profile.jpg")
            )
        );
        assertFalse(
            InstagramAccountRepository.isAllowedPhotoUrl(
                new URL("https://user@scontent.cdninstagram.com/profile.jpg")
            )
        );
    }
}
