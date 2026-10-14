package com.takipatlasi.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "InstagramCollector")
public class InstagramCollectorPlugin extends Plugin {

    private static final String INSTAGRAM_LOGIN_URL = "https://www.instagram.com/accounts/login/";
    private static final int LOGIN_TIMEOUT_MS = 20 * 60 * 1000;
    private static final int COLLECTION_IDLE_TIMEOUT_MS = 90 * 1000;
    private static final int RESULT_CHUNK_LIMIT = 250;
    private static final int MAX_PAGE_USERS = 100;
    private static final int MAX_RECORDS_PER_RELATIONSHIP = 15000;
    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-z0-9._]{1,30}$");
    private static final Pattern USER_ID_PATTERN = Pattern.compile("^\\d{1,30}$");

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object resultLock = new Object();
    private final LinkedHashMap<String, JSObject> followers = new LinkedHashMap<>();
    private final LinkedHashMap<String, JSObject> following = new LinkedHashMap<>();
    private List<JSObject> followerResults = Collections.emptyList();
    private List<JSObject> followingResults = Collections.emptyList();
    private ExecutorService accountExecutor;
    private InstagramAccountRepository accountRepository;

    private PluginCall activeCall;
    private Dialog collectorDialog;
    private WebView collectorWebView;
    private WebView sessionWebView;
    private JSObject preparedWebAccount;
    private boolean preparingWebProfile;
    private PluginCall metadataCall;
    private int metadataRequestId;
    private Runnable metadataTimeout;
    private TextView collectorStatus;
    private TextView collectorStartButton;
    private ProgressBar collectorProgress;
    private Runnable loginPoll;
    private Runnable loginTimeout;
    private Runnable collectionWatchdog;
    private boolean collectorStarted;
    private boolean collectorPageLoading;
    private boolean loginReady;
    private long pageFinishedAt;
    private boolean cancelled;
    private String requestedUsername = "";
    private String scanTempo = "slow";
    private String accountUsername = "";
    private String accountUserId = "";
    private String accountProfilePicUrl = "";

    @Override
    public void load() {
        accountExecutor = Executors.newFixedThreadPool(2);
        accountRepository = new InstagramAccountRepository(getContext(), WebSettings.getDefaultUserAgent(getContext()));
    }

    @PluginMethod
    public void collect(PluginCall call) {
        String username = normalizeUsername(call.getString("username", ""));
        String requestedTempo = call.getString("tempo", "slow");
        String tempo = "original".equals(requestedTempo) || "steady".equals(requestedTempo) ? requestedTempo : "slow";
        mainHandler.post(() -> startCollection(call, username, tempo));
    }

    @PluginMethod
    public void getConnectionStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("blockedUntil", InstagramRequestGate.blockedUntil(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void cancelEnrichment(PluginCall call) {
        if (accountRepository != null) {
            accountRepository.cancelRequests();
        }
        mainHandler.post(() -> {
            cancelWebMetadata();
            call.resolve();
        });
    }

    @PluginMethod
    public void readResult(PluginCall call) {
        String relationship = call.getString("relationship", "");
        Integer requestedOffset = call.getInt("offset", 0);
        Integer requestedLimit = call.getInt("limit", RESULT_CHUNK_LIMIT);
        int offset = Math.max(0, requestedOffset == null ? 0 : requestedOffset);
        int limit = Math.max(1, Math.min(RESULT_CHUNK_LIMIT, requestedLimit == null ? RESULT_CHUNK_LIMIT : requestedLimit));
        List<JSObject> records;

        synchronized (resultLock) {
            if ("followers".equals(relationship)) {
                records = followerResults;
            } else if ("following".equals(relationship)) {
                records = followingResults;
            } else {
                call.reject("Geçersiz ilişki türü.");
                return;
            }
        }

        int end = Math.min(records.size(), offset + limit);
        JSArray chunk = new JSArray();
        for (int index = offset; index < end; index += 1) {
            chunk.put(records.get(index));
        }

        JSObject result = new JSObject();
        result.put("records", chunk);
        result.put("offset", offset);
        result.put("total", records.size());
        result.put("done", end >= records.size());
        call.resolve(result);
    }

    @PluginMethod
    public void clearResult(PluginCall call) {
        mainHandler.post(() -> {
            if (activeCall != null) {
                call.reject("Tarama sürerken sonuçlar temizlenemez.");
                return;
            }
            synchronized (resultLock) {
                followers.clear();
                following.clear();
                followerResults = Collections.emptyList();
                followingResults = Collections.emptyList();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        mainHandler.post(() -> {
            cancelActiveCollection(getContext().getString(R.string.collector_cancelled));
            call.resolve();
        });
    }

    @PluginMethod
    public void requestMetadata(PluginCall call) {
        mainHandler.post(() -> {
            if (sessionWebView == null) {
                JSObject result = new JSObject();
                result.put("records", new JSArray());
                result.put("sessionRequired", true);
                call.resolve(result);
                return;
            }
            if (metadataCall != null || activeCall != null) {
                call.reject("Başka bir profil isteği veya tarama sürüyor.");
                return;
            }
            JSArray source = call.getArray("records", new JSArray());
            JSArray records = new JSArray();
            for (int index = 0; index < Math.min(4, source.length()); index += 1) {
                JSObject record = sanitizeRecord(source.optJSONObject(index));
                if (record != null) records.put(record);
            }
            metadataCall = call;
            int requestId = ++metadataRequestId;
            metadataTimeout = () -> {
                if (metadataCall != null && metadataRequestId == requestId) {
                    PluginCall stalled = metadataCall;
                    metadataCall = null;
                    sessionWebView.evaluateJavascript("window.__TAKIP_WEB_OBSERVER__?.cancelMetadata();", null);
                    JSObject result = new JSObject();
                    result.put("records", new JSArray());
                    result.put("connectionFailed", true);
                    stalled.resolve(result);
                }
            };
            mainHandler.postDelayed(metadataTimeout, 90000);
            String script = "window.__TAKIP_WEB_OBSERVER__?.queryMetadata(" + requestId + "," + records.toString() + "," +
                InstagramRequestGate.blockedUntil(getContext()) + ");";
            sessionWebView.evaluateJavascript(script, null);
        });
    }

    @PluginMethod
    public void requestProfilePhotos(PluginCall call) {
        JSArray records = call.getArray("records", new JSArray());
        ExecutorService executor = accountExecutor;
        InstagramAccountRepository repository = accountRepository;
        if (executor == null || repository == null || executor.isShutdown()) {
            call.reject("Profil fotoğrafı servisi hazır değil.");
            return;
        }
        executor.execute(() -> {
            try {
                call.resolve(repository.requestProfilePhotos(records));
            } catch (Exception error) {
                call.reject("Profil fotoğrafları hazırlanamadı.");
            }
        });
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        mainHandler.post(this::destroySessionWebView);
        InstagramAccountRepository repository = accountRepository;
        ExecutorService executor = accountExecutor;
        if (repository != null) {
            repository.cancelRequests();
        }
        Runnable clearCookies = () -> mainHandler.post(() -> {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.removeAllCookies((removed) -> {
                cookieManager.flush();
                call.resolve();
            });
        });
        if (repository != null && executor != null && !executor.isShutdown()) {
            executor.execute(() -> {
                repository.clearCaches();
                clearCookies.run();
            });
        } else {
            clearCookies.run();
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancelActiveCollection(getContext().getString(R.string.collector_closed));
        destroySessionWebView();
        if (accountRepository != null) {
            accountRepository.cancelRequests();
        }
        if (accountExecutor != null) {
            accountExecutor.shutdownNow();
        }
        super.handleOnDestroy();
    }

    private void startCollection(PluginCall call, String username, String tempo) {
        if (activeCall != null) {
            call.reject("Başka bir Instagram taraması zaten çalışıyor.");
            return;
        }
        if (username.isEmpty()) {
            call.reject("Tarama için Instagram kullanıcı adını yaz.");
            return;
        }
        long retryAfterMs = InstagramRequestGate.blockedUntil(getContext()) - System.currentTimeMillis();
        if (retryAfterMs > 0) {
            JSObject data = new JSObject();
            data.put("retryAfterMs", retryAfterMs);
            call.reject("Instagram istekleri geçici olarak sınırladı (HTTP 429). Bekleme süresi henüz dolmadı.", "RATE_LIMITED", data);
            return;
        }

        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("Instagram ekranı açılamadı.");
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            call.reject(getContext().getString(R.string.collector_webview_update));
            return;
        }

        activeCall = call;
        destroySessionWebView();
        preparedWebAccount = null;
        preparingWebProfile = false;
        requestedUsername = username;
        scanTempo = tempo;
        if (accountRepository != null) {
            accountRepository.cancelRequests();
        }
        accountUsername = "";
        accountUserId = "";
        accountProfilePicUrl = "";
        collectorStarted = false;
        collectorPageLoading = true;
        loginReady = false;
        pageFinishedAt = 0;
        cancelled = false;
        synchronized (resultLock) {
            followers.clear();
            following.clear();
            followerResults = Collections.emptyList();
            followingResults = Collections.emptyList();
        }

        try {
            showCollectorDialog(activity);
        } catch (Exception error) {
            finishWithError("Instagram giriş ekranı açılamadı.");
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showCollectorDialog(Activity activity) {
        collectorDialog = new Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar);
        collectorDialog.setCancelable(false);
        collectorDialog.setCanceledOnTouchOutside(false);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(activity);
        toolbar.setOrientation(LinearLayout.VERTICAL);
        toolbar.setPadding(dp(16), dp(12), dp(16), dp(10));
        toolbar.setBackgroundColor(Color.rgb(23, 20, 45));

        LinearLayout titleRow = new LinearLayout(activity);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(activity);
        title.setText(R.string.collector_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        titleRow.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        TextView close = new TextView(activity);
        close.setText(R.string.collector_close);
        close.setTextColor(Color.rgb(199, 235, 85));
        close.setTextSize(14);
        close.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(14), dp(9), dp(14), dp(9));
        close.setContentDescription(getContext().getString(R.string.collector_close_description));
        close.setOnClickListener((view) -> cancelActiveCollection(getContext().getString(R.string.collector_cancelled)));
        titleRow.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        toolbar.addView(titleRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        collectorStatus = new TextView(activity);
        collectorStatus.setText(R.string.collector_waiting_login);
        collectorStatus.setTextColor(Color.argb(190, 255, 255, 255));
        collectorStatus.setTextSize(12);
        collectorStatus.setPadding(0, dp(4), 0, dp(9));
        toolbar.addView(collectorStatus, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        collectorProgress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        collectorProgress.setMax(100);
        collectorProgress.setProgress(8);
        collectorProgress.setProgressTintList(ColorStateList.valueOf(Color.rgb(115, 87, 246)));
        collectorProgress.setProgressBackgroundTintList(ColorStateList.valueOf(Color.argb(45, 255, 255, 255)));
        toolbar.addView(collectorProgress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4)));

        collectorStartButton = new TextView(activity);
        collectorStartButton.setText(R.string.collector_start);
        collectorStartButton.setTextColor(Color.rgb(199, 235, 85));
        collectorStartButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        collectorStartButton.setGravity(Gravity.CENTER);
        collectorStartButton.setPadding(dp(12), dp(12), dp(12), dp(8));
        collectorStartButton.setEnabled(false);
        collectorStartButton.setAlpha(0.4f);
        collectorStartButton.setOnClickListener((view) -> startCollectorAfterLogin());
        toolbar.addView(collectorStartButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView securityNote = new TextView(activity);
        securityNote.setText(R.string.collector_security_note);
        securityNote.setTextColor(Color.rgb(60, 56, 78));
        securityNote.setTextSize(11);
        securityNote.setGravity(Gravity.CENTER);
        securityNote.setPadding(dp(12), dp(7), dp(12), dp(7));
        securityNote.setBackgroundColor(Color.rgb(245, 241, 232));

        collectorWebView = new WebView(activity);
        WebSettings settings = collectorWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(collectorWebView, true);

        installMessageBridge(collectorWebView);
        installWebObserver(collectorWebView);
        collectorWebView.setWebChromeClient(new WebChromeClient());
        collectorWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                collectorPageLoading = false;
                pageFinishedAt = SystemClock.uptimeMillis();
                updateCollectorReadiness();
                beginCollectorWithWebProfile();
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                collectorPageLoading = true;
                if (collectorStartButton != null) {
                    collectorStartButton.setEnabled(false);
                    collectorStartButton.setAlpha(0.4f);
                }
                if (collectorStarted) {
                    finishWithError(getContext().getString(R.string.collector_navigation_error));
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && !collectorStarted) {
                    updateNativeProgress("waiting_login", getContext().getString(R.string.collector_network_error), 8, 0, 0);
                }
            }

        });

        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(securityNote, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(collectorWebView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        collectorDialog.setContentView(root);
        collectorDialog.setOnKeyListener((dialog, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                if (!collectorStarted && !preparingWebProfile && collectorWebView != null && collectorWebView.canGoBack()) {
                    collectorWebView.goBack();
                } else {
                    cancelActiveCollection(getContext().getString(R.string.collector_cancelled));
                }
                return true;
            }
            return false;
        });
        collectorDialog.show();

        Window window = collectorDialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            window.setStatusBarColor(Color.rgb(23, 20, 45));
            window.setNavigationBarColor(Color.rgb(23, 20, 45));
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }

        notifyProgress("waiting_login", getContext().getString(R.string.collector_waiting_login), 8, 0, 0);
        collectorWebView.loadUrl(INSTAGRAM_LOGIN_URL);
        startLoginPolling();
    }

    @SuppressLint("RequiresFeature")
    private void installMessageBridge(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw new IllegalStateException("WEB_MESSAGE_LISTENER is unavailable");
        }
        WebViewCompat.addWebMessageListener(
            webView,
            "TakipAtlasiNative",
            Collections.singleton("https://www.instagram.com"),
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (isMainFrame && isExactInstagramOrigin(sourceOrigin)) {
                    handleCollectorMessage(view, message.getData());
                }
            }
        );
    }

    @SuppressLint("RequiresFeature")
    private void installWebObserver(WebView view) {
        try {
            WebViewCompat.addDocumentStartJavaScript(view, readAssetScript("instagram-web-observer.js"), Collections.singleton("https://www.instagram.com"));
        } catch (IOException error) {
            throw new IllegalStateException("Web profile observer could not be loaded");
        }
    }

    private void startLoginPolling() {
        loginPoll = new Runnable() {
            @Override
            public void run() {
                if (activeCall == null || collectorStarted || collectorWebView == null) {
                    return;
                }
                updateCollectorReadiness();
                if (!collectorStarted) {
                    mainHandler.postDelayed(this, 900);
                }
            }
        };
        loginTimeout = () -> {
            if (activeCall != null && !collectorStarted) {
                finishWithError(getContext().getString(R.string.collector_login_timeout));
            }
        };
        mainHandler.post(loginPoll);
        mainHandler.postDelayed(loginTimeout, LOGIN_TIMEOUT_MS);
    }

    private void updateCollectorReadiness() {
        if (activeCall == null || collectorStarted || preparingWebProfile || collectorWebView == null) {
            return;
        }
        boolean ready = isCollectorPageReady();
        if (collectorStartButton != null) {
            collectorStartButton.setEnabled(ready);
            collectorStartButton.setAlpha(ready ? 1f : 0.4f);
        }
        if (ready != loginReady) {
            loginReady = ready;
            updateNativeProgress("waiting_login", getContext().getString(ready
                ? R.string.collector_ready : R.string.collector_waiting_login), 8, 0, 0);
        }
    }

    private boolean isCollectorPageReady() {
        return collectorWebView != null && !collectorPageLoading &&
            SystemClock.uptimeMillis() - pageFinishedAt >= 700 &&
            isReadyInstagramUrl(collectorWebView.getUrl()) && hasInstagramSession();
    }

    private void startCollectorAfterLogin() {
        if (activeCall == null || collectorStarted || preparingWebProfile || !isCollectorPageReady()) {
            updateCollectorReadiness();
            return;
        }

        preparingWebProfile = true;
        mainHandler.removeCallbacks(loginPoll);
        mainHandler.removeCallbacks(loginTimeout);
        if (collectorStartButton != null) {
            collectorStartButton.setEnabled(false);
            collectorStartButton.setVisibility(View.GONE);
        }
        updateNativeProgress("profile", getContext().getString(R.string.collector_session_found), 15, 0, 0);
        resetCollectionWatchdog();
        collectorWebView.loadUrl("https://www.instagram.com/" + Uri.encode(requestedUsername) + "/");
    }

    private void beginCollectorWithWebProfile() {
        if (activeCall == null || !preparingWebProfile || collectorStarted || preparedWebAccount == null || collectorWebView == null) return;
        if (collectorPageLoading) return;
        if (SystemClock.uptimeMillis() - pageFinishedAt < 700) {
            mainHandler.postDelayed(this::beginCollectorWithWebProfile, 750);
            return;
        }
        preparingWebProfile = false;
        collectorStarted = true;
        collectorWebView.setEnabled(false);
        resetCollectionWatchdog();

        try {
            String script = readCollectorScript();
            String bootstrap = "window.__TAKIP_ATLASI_REQUESTED_USERNAME__=" + JSONObject.quote(requestedUsername) +
                ";window.__TAKIP_ATLASI_SESSION_USER_ID__=" + JSONObject.quote(sessionUserId()) +
                ";window.__TAKIP_ATLASI_SCAN_TEMPO__=" + JSONObject.quote(scanTempo) +
                ";window.__TAKIP_ATLASI_VERIFIED_ACCOUNT__=" + preparedWebAccount.toString() +
                ";window.__TAKIP_ATLASI_WEBSITE_HEADERS__=window.__TAKIP_WEB_OBSERVER__.headers;window.__TAKIP_ATLASI_PAGE_SIZE__=12;\n" + script;
            collectorWebView.evaluateJavascript(bootstrap, null);
        } catch (IOException error) {
            finishWithError(getContext().getString(R.string.collector_script_error));
        }
    }

    private void handleCollectorMessage(WebView sourceView, String rawMessage) {
        if ((sourceView != collectorWebView && sourceView != sessionWebView) || rawMessage == null) {
            return;
        }
        if (rawMessage.length() > 512 * 1024) {
            finishWithError(getContext().getString(R.string.collector_invalid_response));
            return;
        }
        resetCollectionWatchdog();

        try {
            JSObject message = new JSObject(rawMessage);
            String type = message.getString("type", "");
            if ("metadata-result".equals(type)) {
                if (sourceView != sessionWebView || metadataCall == null || message.optInt("requestId", -1) != metadataRequestId) return;
                if (metadataTimeout != null) mainHandler.removeCallbacks(metadataTimeout);
                long retryAfterMs = message.optLong("retryAfterMs", 0);
                if (retryAfterMs > 0) InstagramRequestGate.blockFor(getContext(), retryAfterMs);
                PluginCall completed = metadataCall;
                metadataCall = null;
                completed.resolve(message);
                return;
            }
            if (activeCall == null || cancelled) return;
            if ("web-profile".equals(type)) {
                JSONObject account = message.optJSONObject("account");
                if (account != null && message.optBoolean("hasTemplate") &&
                    requestedUsername.equals(normalizeUsername(account.optString("username"))) &&
                    sessionUserId().equals(normalizeUserId(account.optString("userId"))) &&
                    !sessionUserId().isEmpty() && account.optLong("followerCount", -1) >= 0 && account.optLong("followingCount", -1) >= 0) {
                    preparedWebAccount = new JSObject(account.toString());
                    beginCollectorWithWebProfile();
                }
                return;
            }
            if ("progress".equals(type)) {
                handleProgressMessage(message);
            } else if ("account".equals(type)) {
                accountUsername = normalizeUsername(message.getString("username", ""));
                accountUserId = normalizeUserId(message.getString("userId", ""));
                accountProfilePicUrl = normalizeProfilePicUrl(message.getString("profilePicUrl", ""));
            } else if ("page".equals(type)) {
                handlePageMessage(message);
            } else if ("complete".equals(type)) {
                handleCompleteMessage(message);
            } else if ("error".equals(type)) {
                String code = message.getString("code", "COLLECTION_FAILED");
                JSObject data = new JSObject();
                if ("RATE_LIMITED".equals(code)) {
                    InstagramRequestGate.blockFor(getContext(), message.optLong("retryAfterMs", 0));
                    data.put("retryAfterMs", Math.max(0, InstagramRequestGate.blockedUntil(getContext()) - System.currentTimeMillis()));
                    if (accountRepository != null) {
                        accountRepository.cancelRequests();
                    }
                }
                finishWithError(safeMessage(message.getString("message", "")), code, data);
            }
        } catch (JSONException error) {
            finishWithError(getContext().getString(R.string.collector_invalid_response));
        }
    }

    private void handleProgressMessage(JSObject message) {
        String phase = message.getString("phase", "profile");
        String text = safeMessage(message.getString("message", ""));
        int progress = clamp(message.optInt("progress", 0), 0, 100);
        int followersCount = Math.max(0, message.optInt("followersCount", 0));
        int followingCount = Math.max(0, message.optInt("followingCount", 0));
        updateNativeProgress(phase, text, progress, followersCount, followingCount);
    }

    private void handlePageMessage(JSObject message) {
        String relationship = message.getString("relationship", "");
        JSONArray users = message.optJSONArray("users");
        if (users == null || users.length() > MAX_PAGE_USERS) {
            finishWithError(getContext().getString(R.string.collector_invalid_response));
            return;
        }

        synchronized (resultLock) {
            LinkedHashMap<String, JSObject> target;
            if ("followers".equals(relationship)) {
                target = followers;
            } else if ("following".equals(relationship)) {
                target = following;
            } else {
                finishWithError(getContext().getString(R.string.collector_invalid_response));
                return;
            }

            for (int index = 0; index < users.length(); index += 1) {
                JSONObject source = users.optJSONObject(index);
                JSObject record = sanitizeRecord(source);
                if (record == null) {
                    continue;
                }
                if (target.size() >= MAX_RECORDS_PER_RELATIONSHIP && !target.containsKey(record.getString("username", ""))) {
                    finishWithError(getContext().getString(R.string.collector_too_many_records));
                    return;
                }
                target.put(record.getString("username", ""), record);
            }
        }
    }

    private void handleCompleteMessage(JSObject message) {
        String completedUsername = normalizeUsername(message.getString("username", ""));
        String completedUserId = normalizeUserId(message.getString("userId", ""));
        String completedProfilePic = normalizeProfilePicUrl(message.getString("profilePicUrl", ""));
        if (!completedUsername.isEmpty()) {
            accountUsername = completedUsername;
        }
        if (!completedUserId.isEmpty()) {
            accountUserId = completedUserId;
        }
        if (!completedProfilePic.isEmpty()) {
            accountProfilePicUrl = completedProfilePic;
        }
        if (accountUsername.isEmpty() || accountUserId.isEmpty()) {
            finishWithError(getContext().getString(R.string.collector_invalid_response));
            return;
        }

        int followersCount;
        int followingCount;
        synchronized (resultLock) {
            followersCount = followers.size();
            followingCount = following.size();
            followerResults = new ArrayList<>(followers.values());
            followingResults = new ArrayList<>(following.values());
        }

        notifyProgress(
            "complete",
            getContext().getString(R.string.collector_complete),
            100,
            followersCount,
            followingCount
        );

        JSObject summary = new JSObject();
        summary.put("username", accountUsername);
        summary.put("accountUserId", accountUserId);
        summary.put("profilePicUrl", accountProfilePicUrl);
        summary.put("followersCount", followersCount);
        summary.put("followingCount", followingCount);
        CookieManager.getInstance().flush();
        PluginCall completedCall = activeCall;
        activeCall = null;
        sessionWebView = collectorWebView;
        collectorWebView = null;
        if (sessionWebView.getParent() instanceof ViewGroup) ((ViewGroup) sessionWebView.getParent()).removeView(sessionWebView);
        closeCollectorDialog();
        completedCall.resolve(summary);
    }

    private void updateNativeProgress(String phase, String message, int progress, int followersCount, int followingCount) {
        if (collectorStatus != null) {
            collectorStatus.setText(message);
        }
        if (collectorProgress != null) {
            collectorProgress.setProgress(progress);
        }
        notifyProgress(phase, message, progress, followersCount, followingCount);
    }

    private void notifyProgress(String phase, String message, int progress, int followersCount, int followingCount) {
        JSObject status = new JSObject();
        status.put("phase", phase);
        status.put("message", message);
        status.put("progress", clamp(progress, 0, 100));
        status.put("followersCount", Math.max(0, followersCount));
        status.put("followingCount", Math.max(0, followingCount));
        notifyListeners("progress", status);
    }

    private void cancelActiveCollection(String message) {
        if (activeCall == null) {
            closeCollectorDialog();
            return;
        }
        cancelled = true;
        if (collectorWebView != null && collectorStarted) {
            collectorWebView.evaluateJavascript("window.__TAKIP_ATLASI_NATIVE_CANCELLED__=true;", null);
        }
        PluginCall cancelledCall = activeCall;
        activeCall = null;
        closeCollectorDialog();
        cancelledCall.reject(message, "CANCELLED");
    }

    private void finishWithError(String message) {
        finishWithError(message, "COLLECTION_FAILED", null);
    }

    private void finishWithError(String message, String code, JSObject data) {
        if (activeCall == null) {
            closeCollectorDialog();
            return;
        }
        String safe = safeMessage(message);
        notifyProgress("error", safe, 0, currentFollowerCount(), currentFollowingCount());
        PluginCall failedCall = activeCall;
        activeCall = null;
        closeCollectorDialog();
        failedCall.reject(safe, code, data);
    }

    private void closeCollectorDialog() {
        if (loginPoll != null) {
            mainHandler.removeCallbacks(loginPoll);
        }
        if (loginTimeout != null) {
            mainHandler.removeCallbacks(loginTimeout);
        }
        if (collectionWatchdog != null) {
            mainHandler.removeCallbacks(collectionWatchdog);
        }
        loginPoll = null;
        loginTimeout = null;
        collectionWatchdog = null;

        WebView webView = collectorWebView;
        collectorWebView = null;
        collectorStatus = null;
        collectorStartButton = null;
        collectorProgress = null;
        collectorStarted = false;
        preparingWebProfile = false;
        collectorPageLoading = false;
        loginReady = false;
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
        }

        Dialog dialog = collectorDialog;
        collectorDialog = null;
        if (dialog != null && dialog.isShowing()) {
            dialog.dismiss();
        }
    }

    private void cancelWebMetadata() {
        if (sessionWebView != null) sessionWebView.evaluateJavascript("window.__TAKIP_WEB_OBSERVER__?.cancelMetadata();", null);
        if (metadataTimeout != null) mainHandler.removeCallbacks(metadataTimeout);
        if (metadataCall != null) {
            PluginCall cancelledMetadata = metadataCall;
            metadataCall = null;
            metadataRequestId += 1;
            JSObject result = new JSObject();
            result.put("records", new JSArray());
            cancelledMetadata.resolve(result);
        }
    }

    private void destroySessionWebView() {
        cancelWebMetadata();
        if (sessionWebView != null) {
            sessionWebView.stopLoading();
            sessionWebView.destroy();
            sessionWebView = null;
        }
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        boolean webUrl = "https".equals(scheme) || "http".equals(scheme);
        boolean allowedHost = isInstagramHost(host) || isFacebookHost(host);
        if (webUrl && allowedHost) {
            return false;
        }

        try {
            Intent external = new Intent(Intent.ACTION_VIEW, uri);
            getActivity().startActivity(external);
        } catch (Exception ignored) {
            // Unsupported links stay closed inside the dedicated login window.
        }
        return true;
    }

    private boolean hasInstagramSession() {
        String cookies = CookieManager.getInstance().getCookie("https://www.instagram.com/");
        if (cookies == null || cookies.isEmpty()) {
            return false;
        }
        for (String part : cookies.split(";")) {
            String cookie = part.trim();
            if (cookie.startsWith("sessionid=") && cookie.length() > "sessionid=".length()) {
                return true;
            }
        }
        return false;
    }

    private String sessionUserId() {
        String cookies = CookieManager.getInstance().getCookie("https://www.instagram.com/");
        if (cookies == null) {
            return "";
        }
        for (String part : cookies.split(";")) {
            String cookie = part.trim();
            if (cookie.startsWith("ds_user_id=")) {
                return normalizeUserId(cookie.substring("ds_user_id=".length()));
            }
        }
        return "";
    }

    private boolean isReadyInstagramUrl(String value) {
        return InstagramLoginState.isReadyUrl(value);
    }

    private boolean isExactInstagramOrigin(Uri uri) {
        return uri != null &&
            "https".equalsIgnoreCase(uri.getScheme()) &&
            "www.instagram.com".equalsIgnoreCase(uri.getHost());
    }

    private boolean isInstagramHost(String hostValue) {
        String host = hostValue == null ? "" : hostValue.toLowerCase(Locale.ROOT);
        return "instagram.com".equals(host) || host.endsWith(".instagram.com");
    }

    private boolean isFacebookHost(String hostValue) {
        String host = hostValue == null ? "" : hostValue.toLowerCase(Locale.ROOT);
        return "facebook.com".equals(host) || host.endsWith(".facebook.com") || "fb.com".equals(host) || host.endsWith(".fb.com");
    }

    private JSObject sanitizeRecord(JSONObject source) {
        if (source == null) {
            return null;
        }
        String username = normalizeUsername(source.optString("username", ""));
        if (username.isEmpty()) {
            return null;
        }

        JSObject record = new JSObject();
        record.put("username", username);
        record.put("timestamp", 0);
        String userId = normalizeUserId(source.optString("instagramUserId", ""));
        String profilePicUrl = normalizeProfilePicUrl(source.optString("profilePicUrl", ""));
        if (!userId.isEmpty()) {
            record.put("instagramUserId", userId);
        }
        if (!profilePicUrl.isEmpty()) {
            record.put("profilePicUrl", profilePicUrl);
        }
        copySafeCount(source, record, "followerCount");
        copySafeCount(source, record, "followingCount");
        copySafeCount(source, record, "postCount");
        return record;
    }

    private void copySafeCount(JSONObject source, JSObject target, String key) {
        if (source.isNull(key)) {
            return;
        }
        long count = source.optLong(key, -1);
        if (count >= 0 && count <= Integer.MAX_VALUE) {
            target.put(key, count);
        }
    }

    private String normalizeUsername(String value) {
        String username = value == null ? "" : value.trim().replaceFirst("^@", "").toLowerCase(Locale.ROOT);
        return USERNAME_PATTERN.matcher(username).matches() ? username : "";
    }

    private String normalizeUserId(String value) {
        String userId = value == null ? "" : value.trim();
        return USER_ID_PATTERN.matcher(userId).matches() ? userId : "";
    }

    private String normalizeProfilePicUrl(String value) {
        if (value == null || value.length() > 3000) {
            return "";
        }
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean allowedHost = isInstagramHost(host) || host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net");
            return "https".equalsIgnoreCase(scheme) && allowedHost ? uri.toString() : "";
        } catch (Exception error) {
            return "";
        }
    }

    private String safeMessage(String value) {
        String fallback = getContext().getString(R.string.collector_generic_error);
        if (value == null || value.trim().isEmpty()) {
            return fallback;
        }
        String normalized = value.trim();
        return normalized.length() <= 500 ? normalized : normalized.substring(0, 500);
    }

    private String readCollectorScript() throws IOException {
        return readAssetScript("instagram-collector.js");
    }

    private String readAssetScript(String name) throws IOException {
        StringBuilder script = new StringBuilder();
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(getContext().getAssets().open(name), StandardCharsets.UTF_8)
            )
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                script.append(line).append('\n');
            }
        }
        return script.toString();
    }

    private int currentFollowerCount() {
        synchronized (resultLock) {
            return followers.size();
        }
    }

    private int currentFollowingCount() {
        synchronized (resultLock) {
            return following.size();
        }
    }

    private int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    private void resetCollectionWatchdog() {
        if (collectionWatchdog != null) {
            mainHandler.removeCallbacks(collectionWatchdog);
        }
        collectionWatchdog = () -> {
            if (activeCall != null && (collectorStarted || preparingWebProfile)) {
                finishWithError(getContext().getString(R.string.collector_stalled));
            }
        };
        mainHandler.postDelayed(collectionWatchdog, COLLECTION_IDLE_TIMEOUT_MS);
    }
}
