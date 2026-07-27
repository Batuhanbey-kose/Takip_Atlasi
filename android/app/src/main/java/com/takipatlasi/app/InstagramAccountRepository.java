package com.takipatlasi.app;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.webkit.CookieManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class InstagramAccountRepository {

    private static final String APP_ID = "936619743392459";
    private static final String INSTAGRAM_ORIGIN = "https://www.instagram.com";
    private static final int MAX_METADATA_BATCH = 24;
    private static final int METADATA_WORKERS = 4;
    private static final int MAX_PHOTO_BATCH = 48;
    private static final int MAX_JSON_BYTES = 512 * 1024;
    private static final int MAX_PHOTO_BYTES = 2 * 1024 * 1024;
    private static final long METADATA_FRESH_MS = 24 * 60 * 60 * 1000L;
    private static final long FAILURE_COOLDOWN_MS = 30 * 60 * 1000L;
    private static final long PHOTO_FRESH_MS = 7 * 24 * 60 * 60 * 1000L;
    private static final long PHOTO_CACHE_LIMIT_BYTES = 100L * 1024 * 1024;

    private final Context context;
    private final String userAgent;
    private final File photoDirectory;
    private final AtomicInteger generation = new AtomicInteger();
    private final Object connectionLock = new Object();
    private final Set<HttpURLConnection> activeConnections = new HashSet<>();
    private final Map<String, JSObject> metadataCache = new HashMap<>();
    private final Map<String, Long> metadataFailures = new HashMap<>();
    private volatile long blockedUntil;

    InstagramAccountRepository(Context context, String userAgent) {
        this.context = context.getApplicationContext();
        this.userAgent = userAgent;
        this.photoDirectory = new File(this.context.getNoBackupFilesDir(), "profile_photos");
    }

    JSObject requestMetadata(JSArray sourceRecords) {
        int requestGeneration = generation.get();
        JSArray results = new JSArray();
        boolean sessionRequired = false;
        long retryAfterMs = Math.max(0, blockedUntil - System.currentTimeMillis());
        int limit = Math.min(sourceRecords == null ? 0 : sourceRecords.length(), MAX_METADATA_BATCH);
        List<Identity> pending = new ArrayList<>();

        for (int index = 0; index < limit; index += 1) {
            if (requestGeneration != generation.get() || Thread.currentThread().isInterrupted()) {
                break;
            }
            JSONObject source = sourceRecords.optJSONObject(index);
            Identity identity = Identity.from(source);
            if (identity == null) {
                continue;
            }

            JSObject cached = metadataCache.get(identity.cacheKey());
            if (isFresh(cached)) {
                results.put(cached);
                continue;
            }
            long now = System.currentTimeMillis();
            if (now < blockedUntil) {
                retryAfterMs = blockedUntil - now;
                break;
            }
            Long failedAt = metadataFailures.get(identity.cacheKey());
            if (failedAt != null && now - failedAt < FAILURE_COOLDOWN_MS) {
                continue;
            }
            pending.add(identity);
        }

        if (!pending.isEmpty() && retryAfterMs <= 0) {
            AtomicBoolean stop = new AtomicBoolean(false);
            ExecutorService workers = Executors.newFixedThreadPool(Math.min(METADATA_WORKERS, pending.size()));
            List<Callable<MetadataFetch>> tasks = new ArrayList<>();
            for (Identity identity : pending) {
                tasks.add(() -> {
                    if (stop.get() || requestGeneration != generation.get() || Thread.currentThread().isInterrupted()) {
                        return new MetadataFetch(identity, null, null);
                    }
                    sleepBeforeMetadataRequest(requestGeneration);
                    if (stop.get() || requestGeneration != generation.get() || Thread.currentThread().isInterrupted()) {
                        return new MetadataFetch(identity, null, null);
                    }
                    try {
                        return new MetadataFetch(identity, fetchMetadata(identity, requestGeneration), null);
                    } catch (InstagramRequestException error) {
                        if (error.statusCode == 401 || error.statusCode == 403 || error.statusCode == 429 || (error.statusCode >= 300 && error.statusCode < 400)) {
                            stop.set(true);
                        }
                        return new MetadataFetch(identity, null, error);
                    }
                });
            }

            try {
                List<Future<MetadataFetch>> futures = workers.invokeAll(tasks);
                for (Future<MetadataFetch> future : futures) {
                    MetadataFetch fetch;
                    try {
                        fetch = future.get();
                    } catch (Exception ignored) {
                        continue;
                    }
                    if (fetch.metadata != null) {
                        metadataCache.put(fetch.identity.cacheKey(), fetch.metadata);
                        metadataFailures.remove(fetch.identity.cacheKey());
                        results.put(fetch.metadata);
                        continue;
                    }
                    InstagramRequestException error = fetch.error;
                    if (error == null || error.statusCode == 499) {
                        continue;
                    }
                    metadataFailures.put(fetch.identity.cacheKey(), System.currentTimeMillis());
                    if (error.statusCode == 401 || error.statusCode == 403 || (error.statusCode >= 300 && error.statusCode < 400)) {
                        sessionRequired = true;
                    }
                    if (error.statusCode == 429) {
                        long backoff = Math.max(15 * 60 * 1000L, error.retryAfterMs);
                        blockedUntil = System.currentTimeMillis() + backoff;
                        retryAfterMs = Math.max(retryAfterMs, backoff);
                    }
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            } finally {
                workers.shutdownNow();
            }
        }

        JSObject response = new JSObject();
        response.put("records", results);
        response.put("sessionRequired", sessionRequired);
        response.put("retryAfterMs", retryAfterMs);
        return response;
    }

    JSObject requestProfilePhotos(JSArray sourceRecords) {
        int requestGeneration = generation.get();
        int limit = Math.min(sourceRecords == null ? 0 : sourceRecords.length(), MAX_PHOTO_BATCH);
        List<Callable<JSObject>> tasks = new ArrayList<>();
        for (int index = 0; index < limit; index += 1) {
            JSONObject source = sourceRecords.optJSONObject(index);
            Identity identity = Identity.from(source);
            String sourceUrl = normalizePhotoUrl(source == null ? "" : source.optString("profilePicUrl", ""));
            if (identity != null && !sourceUrl.isEmpty()) {
                tasks.add(() -> cachePhoto(identity.username, sourceUrl, requestGeneration));
            }
        }

        JSArray photos = new JSArray();
        if (!tasks.isEmpty()) {
            ExecutorService workers = Executors.newFixedThreadPool(Math.min(2, tasks.size()));
            try {
                List<Future<JSObject>> futures = workers.invokeAll(tasks);
                for (Future<JSObject> future : futures) {
                    try {
                        JSObject photo = future.get();
                        if (photo != null) {
                            photos.put(photo);
                        }
                    } catch (Exception ignored) {
                        // Initials remain visible when a single photo cannot be cached.
                    }
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            } finally {
                workers.shutdownNow();
            }
        }
        trimPhotoCache();

        JSObject response = new JSObject();
        response.put("records", photos);
        return response;
    }

    void cancelRequests() {
        generation.incrementAndGet();
        synchronized (connectionLock) {
            for (HttpURLConnection connection : activeConnections) {
                connection.disconnect();
            }
            activeConnections.clear();
        }
    }

    void clearCaches() {
        metadataCache.clear();
        metadataFailures.clear();
        blockedUntil = 0;
        deleteRecursively(photoDirectory);
    }

    private JSObject fetchMetadata(Identity identity, int requestGeneration) throws InstagramRequestException {
        String path = identity.userId.isEmpty()
            ? "/api/v1/users/web_profile_info/?username=" + urlEncode(identity.username)
            : "/api/v1/users/" + urlEncode(identity.userId) + "/info/";
        JSONObject payload = requestInstagramJson(path, requestGeneration);
        JSONObject user = extractUser(payload);
        if (user == null) {
            throw new InstagramRequestException(422, 0);
        }

        String username = normalizeUsername(user.optString("username", ""));
        String userId = normalizeUserId(firstString(user, "pk", "pk_id", "id"));
        if (!identity.username.equals(username)) {
            throw new InstagramRequestException(409, 0);
        }
        if (!identity.userId.isEmpty() && !userId.isEmpty() && !identity.userId.equals(userId)) {
            throw new InstagramRequestException(409, 0);
        }

        Long followerCount = readCount(user, "follower_count", "edge_followed_by");
        Long followingCount = readCount(user, "following_count", "edge_follow");
        Long postCount = readCount(user, "media_count", "edge_owner_to_timeline_media");
        if (followerCount == null || followingCount == null || postCount == null) {
            throw new InstagramRequestException(422, 0);
        }

        JSObject result = new JSObject();
        result.put("username", username);
        result.put("instagramUserId", userId.isEmpty() ? identity.userId : userId);
        result.put("followerCount", followerCount);
        result.put("followingCount", followingCount);
        result.put("postCount", postCount);
        result.put("profilePicUrl", normalizePhotoUrl(firstString(user, "profile_pic_url_hd", "profile_pic_url")));
        result.put("updatedAt", System.currentTimeMillis());
        return result;
    }

    private JSONObject requestInstagramJson(String path, int requestGeneration) throws InstagramRequestException {
        if (requestGeneration != generation.get()) {
            throw new InstagramRequestException(499, 0);
        }
        String cookies = CookieManager.getInstance().getCookie(INSTAGRAM_ORIGIN + "/");
        if (!hasSessionCookie(cookies)) {
            throw new InstagramRequestException(401, 0);
        }

        HttpsURLConnection connection = null;
        try {
            URL url = new URL(INSTAGRAM_ORIGIN + path);
            if (!isExactInstagramApiUrl(url)) {
                throw new InstagramRequestException(400, 0);
            }
            connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(12000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("User-Agent", userAgent);
            connection.setRequestProperty("Referer", INSTAGRAM_ORIGIN + "/");
            connection.setRequestProperty("X-IG-App-ID", APP_ID);
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Cookie", cookies);
            String csrfToken = cookieValue(cookies, "csrftoken");
            if (!csrfToken.isEmpty()) {
                connection.setRequestProperty("X-CSRFToken", csrfToken);
            }

            registerConnection(connection);
            int status = connection.getResponseCode();
            if (status != 200) {
                long retryAfterMs = status == 429 ? parseRetryAfter(connection.getHeaderField("Retry-After")) : 0;
                throw new InstagramRequestException(status, retryAfterMs);
            }
            byte[] body = readLimited(connection.getInputStream(), MAX_JSON_BYTES);
            JSONObject payload = new JSONObject(new String(body, StandardCharsets.UTF_8));
            if ("fail".equalsIgnoreCase(payload.optString("status"))) {
                throw new InstagramRequestException(422, 0);
            }
            return payload;
        } catch (InstagramRequestException error) {
            throw error;
        } catch (Exception error) {
            throw new InstagramRequestException(0, 0);
        } finally {
            unregisterConnection(connection);
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private JSObject cachePhoto(String username, String sourceUrl, int requestGeneration) {
        if (requestGeneration != generation.get()) {
            return null;
        }
        String key = sha256(username + "|" + sourceUrl);
        if (key.isEmpty()) {
            return null;
        }
        File cached = findCachedPhoto(key);
        if (cached != null && cached.length() > 0 && System.currentTimeMillis() - cached.lastModified() < PHOTO_FRESH_MS) {
            cached.setLastModified(System.currentTimeMillis());
            return photoResult(username, cached);
        }

        URL current;
        try {
            current = new URL(sourceUrl);
        } catch (Exception error) {
            return null;
        }

        for (int redirect = 0; redirect <= 2; redirect += 1) {
            if (requestGeneration != generation.get() || !isAllowedPhotoUrl(current)) {
                return null;
            }
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) current.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(20000);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5");
                connection.setRequestProperty("User-Agent", userAgent);
                connection.setRequestProperty("Referer", INSTAGRAM_ORIGIN + "/");
                registerConnection(connection);
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400 && redirect < 2) {
                    String location = connection.getHeaderField("Location");
                    current = location == null ? null : new URL(current, location);
                    if (current == null || !isAllowedPhotoUrl(current)) {
                        return null;
                    }
                    continue;
                }
                if (status != 200) {
                    return null;
                }
                int declaredLength = connection.getContentLength();
                if (declaredLength > MAX_PHOTO_BYTES) {
                    return null;
                }
                String extension = extensionForContentType(connection.getContentType());
                if (extension.isEmpty()) {
                    return null;
                }
                if (!photoDirectory.exists() && !photoDirectory.mkdirs()) {
                    return null;
                }
                File temporary = new File(photoDirectory, key + ".tmp");
                writeLimited(connection.getInputStream(), temporary, MAX_PHOTO_BYTES);
                if (!isValidImage(temporary)) {
                    temporary.delete();
                    return null;
                }
                File target = new File(photoDirectory, key + extension);
                if (target.exists()) {
                    target.delete();
                }
                if (!temporary.renameTo(target)) {
                    copyFile(temporary, target);
                    temporary.delete();
                }
                deleteOtherPhotoFormats(key, target);
                return photoResult(username, target);
            } catch (Exception error) {
                return null;
            } finally {
                unregisterConnection(connection);
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
        return null;
    }

    private JSObject photoResult(String username, File file) {
        JSObject result = new JSObject();
        result.put("username", username);
        result.put("fileUri", Uri.fromFile(file).toString());
        return result;
    }

    private File findCachedPhoto(String key) {
        if (!photoDirectory.isDirectory()) {
            return null;
        }
        File[] matches = photoDirectory.listFiles((directory, name) -> name.startsWith(key + ".") && !name.endsWith(".tmp"));
        return matches == null || matches.length == 0 ? null : matches[0];
    }

    private void deleteOtherPhotoFormats(String key, File keep) {
        File[] matches = photoDirectory.listFiles((directory, name) -> name.startsWith(key + "."));
        if (matches == null) {
            return;
        }
        for (File match : matches) {
            if (!match.equals(keep)) {
                match.delete();
            }
        }
    }

    private void trimPhotoCache() {
        if (!photoDirectory.isDirectory()) {
            return;
        }
        File[] files = photoDirectory.listFiles((directory, name) -> !name.endsWith(".tmp"));
        if (files == null) {
            return;
        }
        List<File> ordered = new ArrayList<>();
        Collections.addAll(ordered, files);
        Collections.sort(ordered, (left, right) -> Long.compare(left.lastModified(), right.lastModified()));
        long total = 0;
        for (File file : ordered) {
            total += file.length();
        }
        for (File file : ordered) {
            if (total <= PHOTO_CACHE_LIMIT_BYTES) {
                break;
            }
            long length = file.length();
            if (file.delete()) {
                total -= length;
            }
        }
    }

    private void sleepBeforeMetadataRequest(int requestGeneration) {
        long delay = nextMetadataDelayMillis();
        long deadline = System.currentTimeMillis() + delay;
        while (requestGeneration == generation.get() && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(Math.min(200, deadline - System.currentTimeMillis()));
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    static long nextMetadataDelayMillis() {
        return ThreadLocalRandom.current().nextLong(100, 251);
    }

    private void registerConnection(HttpURLConnection connection) {
        if (connection == null) {
            return;
        }
        synchronized (connectionLock) {
            activeConnections.add(connection);
        }
    }

    private void unregisterConnection(HttpURLConnection connection) {
        if (connection == null) {
            return;
        }
        synchronized (connectionLock) {
            activeConnections.remove(connection);
        }
    }

    private boolean isFresh(JSObject metadata) {
        return metadata != null && System.currentTimeMillis() - metadata.optLong("updatedAt", 0) < METADATA_FRESH_MS;
    }

    static boolean isExactInstagramApiUrl(URL url) {
        return url != null &&
            "https".equalsIgnoreCase(url.getProtocol()) &&
            "www.instagram.com".equalsIgnoreCase(url.getHost()) &&
            (url.getPort() == -1 || url.getPort() == 443) &&
            url.getUserInfo() == null;
    }

    static boolean isAllowedPhotoUrl(URL url) {
        if (url == null || !"https".equalsIgnoreCase(url.getProtocol()) || (url.getPort() != -1 && url.getPort() != 443) || url.getUserInfo() != null) {
            return false;
        }
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        return host.equals("instagram.com") ||
            host.endsWith(".instagram.com") ||
            host.equals("cdninstagram.com") ||
            host.endsWith(".cdninstagram.com") ||
            host.equals("fbcdn.net") ||
            host.endsWith(".fbcdn.net");
    }

    private String normalizePhotoUrl(String value) {
        if (value == null || value.length() > 3000) {
            return "";
        }
        try {
            URL url = new URL(value);
            return isAllowedPhotoUrl(url) ? url.toString() : "";
        } catch (Exception error) {
            return "";
        }
    }

    private static JSONObject extractUser(JSONObject payload) {
        if (payload == null) {
            return null;
        }
        JSONObject user = payload.optJSONObject("user");
        if (user != null) {
            return user;
        }
        JSONObject data = payload.optJSONObject("data");
        if (data != null && data.optJSONObject("user") != null) {
            return data.optJSONObject("user");
        }
        JSONObject graphql = payload.optJSONObject("graphql");
        if (graphql != null && graphql.optJSONObject("user") != null) {
            return graphql.optJSONObject("user");
        }
        return payload.has("username") ? payload : null;
    }

    private static Long readCount(JSONObject user, String directKey, String edgeKey) {
        Object direct = user.opt(directKey);
        Long count = normalizeCount(direct);
        if (count != null) {
            return count;
        }
        JSONObject edge = user.optJSONObject(edgeKey);
        return edge == null ? null : normalizeCount(edge.opt("count"));
    }

    private static Long normalizeCount(Object value) {
        if (value == null || value == JSONObject.NULL || value instanceof Boolean) {
            return null;
        }
        try {
            long count = value instanceof Number ? ((Number) value).longValue() : Long.parseLong(String.valueOf(value));
            return count >= 0 && count <= 5_000_000_000L ? count : null;
        } catch (Exception error) {
            return null;
        }
    }

    private static String firstString(JSONObject source, String... keys) {
        for (String key : keys) {
            String value = source.optString(key, "");
            if (!value.isEmpty() && !"null".equals(value)) {
                return value;
            }
        }
        return "";
    }

    private static String normalizeUsername(String value) {
        String username = value == null ? "" : value.trim().replaceFirst("^@", "").toLowerCase(Locale.ROOT);
        return username.matches("^[a-z0-9._]{1,30}$") ? username : "";
    }

    private static String normalizeUserId(String value) {
        String userId = value == null ? "" : value.trim();
        return userId.matches("^\\d{1,30}$") ? userId : "";
    }

    private static boolean hasSessionCookie(String cookies) {
        return !cookieValue(cookies, "sessionid").isEmpty();
    }

    private static String cookieValue(String cookies, String name) {
        if (cookies == null || cookies.isEmpty()) {
            return "";
        }
        for (String part : cookies.split(";")) {
            String item = part.trim();
            int separator = item.indexOf('=');
            if (separator > 0 && name.equals(item.substring(0, separator))) {
                return item.substring(separator + 1);
            }
        }
        return "";
    }

    private static long parseRetryAfter(String value) {
        try {
            long seconds = Long.parseLong(value == null ? "" : value.trim());
            return Math.max(0, Math.min(seconds, 24 * 60 * 60)) * 1000L;
        } catch (Exception error) {
            return 0;
        }
    }

    private static byte[] readLimited(InputStream input, int maximumBytes) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > maximumBytes) {
                    throw new IOException("Response is too large");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static void writeLimited(InputStream input, File target, int maximumBytes) throws IOException {
        try (InputStream source = input; FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > maximumBytes) {
                    throw new IOException("Image is too large");
                }
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
        } catch (IOException error) {
            target.delete();
            throw error;
        }
    }

    private static boolean isValidImage(File file) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        return options.outWidth > 0 && options.outHeight > 0 && options.outWidth <= 8192 && options.outHeight <= 8192;
    }

    private static String extensionForContentType(String contentType) {
        String normalized = contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if ("image/jpeg".equals(normalized) || "image/jpg".equals(normalized)) {
            return ".jpg";
        }
        if ("image/png".equals(normalized)) {
            return ".png";
        }
        if ("image/webp".equals(normalized)) {
            return ".webp";
        }
        if ("image/avif".equals(normalized)) {
            return ".avif";
        }
        return "";
    }

    private static void copyFile(File source, File target) throws IOException {
        try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
        }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder encoded = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) {
                encoded.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            }
            return encoded.toString();
        } catch (NoSuchAlgorithmException error) {
            return "";
        }
    }

    private static String urlEncode(String value) {
        try {
            return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (Exception error) {
            return "";
        }
    }

    private static void deleteRecursively(File target) {
        if (target == null || !target.exists()) {
            return;
        }
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        target.delete();
    }

    private static final class Identity {
        final String username;
        final String userId;

        private Identity(String username, String userId) {
            this.username = username;
            this.userId = userId;
        }

        static Identity from(JSONObject source) {
            if (source == null) {
                return null;
            }
            String username = normalizeUsername(source.optString("username", ""));
            if (username.isEmpty()) {
                return null;
            }
            return new Identity(username, normalizeUserId(source.optString("instagramUserId", "")));
        }

        String cacheKey() {
            return userId.isEmpty() ? "u:" + username : "i:" + userId;
        }
    }

    private static final class MetadataFetch {
        final Identity identity;
        final JSObject metadata;
        final InstagramRequestException error;

        MetadataFetch(Identity identity, JSObject metadata, InstagramRequestException error) {
            this.identity = identity;
            this.metadata = metadata;
            this.error = error;
        }
    }

    private static final class InstagramRequestException extends Exception {
        final int statusCode;
        final long retryAfterMs;

        InstagramRequestException(int statusCode, long retryAfterMs) {
            this.statusCode = statusCode;
            this.retryAfterMs = retryAfterMs;
        }
    }
}
