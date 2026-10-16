(function startTakipAtlasi() {
  "use strict";

  const logic = window.TakipLogic;
  const archive = window.TakipArchive;
  const storage = window.TakipStorage;
  const PAGE_SIZE = 48;
  const DATA_DISCLOSURE_KEY = "takip-atlasi-data-disclosure-v1";
  const themes = {
    atlas: { name: "Atlas", mode: "light", themeColor: "#17142d" },
    ocean: { name: "Okyanus", mode: "light", themeColor: "#082f49" },
    forest: { name: "Orman", mode: "light", themeColor: "#173524" },
    sunset: { name: "Gün Batımı", mode: "light", themeColor: "#3b1d2a" },
    sakura: { name: "Sakura", mode: "light", themeColor: "#3a1930" },
    lavender: { name: "Lavanta", mode: "light", themeColor: "#241b45" },
    ice: { name: "Buz", mode: "light", themeColor: "#172a3a" },
    sand: { name: "Kum", mode: "light", themeColor: "#3b2e24" },
    mono: { name: "Mono", mode: "light", themeColor: "#111111" },
    midnight: { name: "Gece", mode: "dark", themeColor: "#080914" },
    neon: { name: "Neon", mode: "dark", themeColor: "#050908" },
    cherry: { name: "Vişne", mode: "light", themeColor: "#34111f" },
    aurora: { name: "Aurora", mode: "dark", themeColor: "#071e26" },
    amoled: { name: "AMOLED", mode: "dark", themeColor: "#000000" },
    coffee: { name: "Kahve", mode: "light", themeColor: "#35251e" },
    cyber: { name: "Siber", mode: "dark", themeColor: "#101027" },
  };
  const numberFormatter = new Intl.NumberFormat("tr-TR");
  const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const relativeFormatter = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });
  const clockFormatter = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const compactFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
  const countFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isAndroidRuntime = Boolean(
    window.Capacitor &&
    window.Capacitor.isNativePlatform?.() &&
    window.Capacitor.getPlatform?.() === "android",
  );
  const collectorState = {
    busy: false,
    fromDashboard: false,
    startedAt: 0,
  };
  const nativeCollector = {
    available: false,
    plugin: null,
    listenerHandle: null,
    pendingConsentOptions: null,
    blockedUntil: 0,
    cooldownTimer: null,
    scanTempo: "steady",
  };

  const categoryMeta = {
    overview: {
      eyebrow: "TAKİP MERKEZİ",
      kicker: "BUGÜNÜN HARİTASI",
      title: "Genel Bakış",
      description: "Takip ilişkilerinin dengesi ve son değişimler.",
    },
    all: {
      eyebrow: "ÇEVRE HARİTASI",
      kicker: "BÜTÜN BAĞLANTILAR",
      title: "Tüm Hesaplar",
      description: "Takipçi ve takip edilen listelerindeki bütün benzersiz hesaplar.",
    },
    followers: {
      eyebrow: "SENİ TAKİP EDENLER",
      kicker: "TAKİPÇİ LİSTEN",
      title: "Takipçilerin",
      description: "Seni takip eden hesapların telefonda toplanan güncel listesi.",
    },
    following: {
      eyebrow: "SENİN SEÇTİKLERİN",
      kicker: "TAKİP ETTİKLERİN",
      title: "Takip Ettiklerin",
      description: "Instagram'da takip ettiğin bütün hesaplar.",
    },
    mutual: {
      eyebrow: "GÜÇLÜ BAĞLAR",
      kicker: "KARŞILIKLI TAKİP",
      title: "Karşılıklı",
      description: "Hem senin takip ettiğin hem de seni takip eden hesaplar.",
    },
    notFollowingBack: {
      eyebrow: "TEK YÖNLÜ TAKİP",
      kicker: "GERİ DÖNMEYENLER",
      title: "Seni Takip Etmeyenler",
      description: "Senin takip ettiğin fakat seni takip etmeyen hesaplar.",
    },
    youDontFollowBack: {
      eyebrow: "BEKLEYEN BAĞLAR",
      kicker: "SENİN DÖNMEDİKLERİN",
      title: "Takip Etmediklerin",
      description: "Seni takip eden fakat senin takip etmediğin hesaplar.",
    },
    newFollowers: {
      eyebrow: "SON DEĞİŞİMLER",
      kicker: "YENİ GELENLER",
      title: "Yeni Takipçiler",
      description: "Bir önceki yenilemeden sonra seni takip etmeye başlayanlar.",
    },
    lostFollowers: {
      eyebrow: "SON DEĞİŞİMLER",
      kicker: "AYRILANLAR",
      title: "Takibi Bırakanlar",
      description: "Önceki kayıtta takipçin olup güncel listede bulunmayanlar.",
    },
    favorites: {
      eyebrow: "SANA ÖZEL",
      kicker: "YILDIZLI HESAPLAR",
      title: "Yıldızlılar",
      description: "Yıldızla işaretlediğin hesaplar. İşaretler yalnızca bu cihazda saklanır.",
    },
  };

  const state = {
    profile: null,
    snapshots: [],
    analysis: null,
    currentSnapshot: null,
    previousSnapshot: null,
    category: "overview",
    search: "",
    sort: "recent",
    filters: {
      relationship: "all",
      details: "all",
      audience: "all",
      photo: "all",
      minFollowers: null,
      maxFollowers: null,
    },
    limit: PAGE_SIZE,
    listPeople: [],
    favorites: new Set(),
    favoritesProfile: "",
    listDensity: "compact",
    nativeProfilePhotos: new Map(),
    nativePhotoAttempts: new Set(),
    nativePhotoRequestInProgress: false,
    nativePendingPhotoPeople: [],
    nativeEnrichmentSnapshotId: "",
  };

  const elements = {};
  let pendingArchiveUsername = "";

  document.addEventListener("DOMContentLoaded", initialize);

  async function initialize() {
    cacheElements();
    bindEvents();
    initializeScanTempo();
    if (isAndroidRuntime && await clearLegacyWebRuntime()) {
      return;
    }
    initializeTheme();
    initializeListDensity();
    updateSetupValidity();
    await initializeNativeCollector();

    let savedState;
    try {
      savedState = await storage.load();
    } catch (error) {
      showError(elements.setupError, "Yerel takip kayıtları okunamadı. Cihazındaki boş alanı kontrol edip tekrar aç.");
      return;
    }
    if (savedState.profile && savedState.snapshots.length) {
      state.profile = savedState.profile;
      state.snapshots = savedState.snapshots.filter(
        (snapshot) => snapshot.username === savedState.profile.username,
      );

      if (state.snapshots.length) {
        showDashboard();
      }
    }

    window.setInterval(updateRelativeTime, 60000);
  }

  function cacheElements() {
    const ids = [
      "onboardingView",
      "dashboardView",
      "dashboardMain",
      "confirmDialog",
      "setupForm",
      "profileName",
      "profileCheck",
      "instagramConnectButton",
      "instagramConnectTitle",
      "instagramConnectHint",
      "scanTempoPanel",
      "scanTempoSelect",
      "dashboardScanTempoPanel",
      "dashboardScanTempoSelect",
      "archiveButton",
      "archiveInput",
      "archiveRefreshButton",
      "collectorPanel",
      "collectorPulse",
      "collectorTitle",
      "collectorMessage",
      "collectorPercent",
      "collectorProgress",
      "collectorDetails",
      "liveFollowersCount",
      "liveFollowingCount",
      "cancelCollectorButton",
      "desktopScanButton",
      "setupError",
      "demoButton",
      "sidebar",
      "mobileScrim",
      "menuButton",
      "mobileMoreButton",
      "sidebarCloseButton",
      "profileAvatar",
      "sidebarProfileName",
      "changeProfileButton",
      "themeButton",
      "currentThemeName",
      "themeDialog",
      "privacyButton",
      "privacyDialog",
      "dataDisclosureDialog",
      "openPrivacyFromDisclosureButton",
      "cancelDisclosureButton",
      "acceptDisclosureButton",
      "categoryEyebrow",
      "categoryTitle",
      "searchInput",
      "sortSelect",
      "listDetailStatus",
      "openFilterButton",
      "activeFilterCount",
      "filterDialog",
      "filterTitle",
      "filterHint",
      "relationshipFilter",
      "detailsFilter",
      "audienceFilter",
      "photoFilter",
      "minFollowersFilter",
      "maxFollowersFilter",
      "resetFiltersButton",
      "applyFiltersButton",
      "syncStatus",
      "lastSyncText",
      "refreshButton",
      "overviewPanel",
      "listPanel",
      "welcomeName",
      "healthScore",
      "healthText",
      "relationshipDonut",
      "mutualPercent",
      "historyCount",
      "pulseSummary",
      "attentionPeople",
      "listKicker",
      "listTitle",
      "listDescription",
      "visibleResultCount",
      "activeFilter",
      "activeFilterText",
      "clearSearchButton",
      "peopleGrid",
      "emptyState",
      "emptyTitle",
      "emptyText",
      "loadMoreButton",
      "copyListButton",
      "densityButton",
      "copyDialog",
      "copyText",
      "keepDataButton",
      "deleteDataButton",
      "loadingOverlay",
      "loadingTitle",
      "loadingText",
      "toastRegion",
    ];

    ids.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => button.closest("dialog").close());
    });

    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => closeDialogFromBackdrop(event, dialog));
    });

    elements.profileName.addEventListener("input", updateSetupValidity);
    elements.setupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (isAndroidRuntime || nativeCollector.available) {
        requestNativeInstagramConnection();
      } else {
        openArchivePicker();
      }
    });
    elements.demoButton.addEventListener("click", startDemo);
    elements.archiveButton.addEventListener("click", () => openArchivePicker());
    elements.archiveInput.addEventListener("change", importSelectedArchive);
    elements.archiveRefreshButton.addEventListener("click", () => openArchivePicker(state.profile && state.profile.username));
    elements.instagramConnectButton.addEventListener("click", () => requestNativeInstagramConnection());
    elements.cancelCollectorButton.addEventListener("click", cancelInstagramConnection);
    elements.desktopScanButton.addEventListener("click", async () => {
      elements.desktopScanButton.disabled = true;
      try {
        await nativeCollector.plugin.beginScan();
      } catch (error) {
        showToast(error.message || "PC taraması başlatılamadı.", "!");
      }
    });
    elements.scanTempoSelect.addEventListener("change", () => selectScanTempo(elements.scanTempoSelect.value));
    elements.dashboardScanTempoSelect.addEventListener("change", () => selectScanTempo(elements.dashboardScanTempoSelect.value));

    document.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => switchCategory(button.dataset.category));
    });

    document.querySelectorAll("[data-nav-category]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        switchCategory(button.dataset.navCategory);
      });
    });

    document.querySelectorAll("[data-open-category]").forEach((button) => {
      button.addEventListener("click", () => switchCategory(button.dataset.openCategory));
    });

    elements.searchInput.addEventListener("input", handleSearch);
    elements.clearSearchButton.addEventListener("click", clearListFilters);
    elements.openFilterButton.addEventListener("click", openFilterDialog);
    elements.resetFiltersButton.addEventListener("click", resetFilterDialog);
    elements.applyFiltersButton.addEventListener("click", applyFilterDialog);
    elements.sortSelect.addEventListener("change", () => {
      state.sort = elements.sortSelect.value;
      state.limit = PAGE_SIZE;
      renderList();
    });
    elements.loadMoreButton.addEventListener("click", () => {
      state.limit += PAGE_SIZE;
      renderList();
    });
    elements.peopleGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-toggle-favorite]");
      if (button) toggleFavorite(button.dataset.toggleFavorite);
    });
    elements.copyListButton.addEventListener("click", copyFilteredList);
    elements.densityButton.addEventListener("click", () => applyListDensity(state.listDensity === "compact" ? "comfortable" : "compact"));

    elements.refreshButton.addEventListener("click", openRefreshDialog);

    elements.menuButton.addEventListener("click", openMobileSidebar);
    elements.mobileMoreButton.addEventListener("click", openMobileSidebar);
    elements.sidebarCloseButton.addEventListener("click", closeMobileSidebar);
    elements.mobileScrim.addEventListener("click", closeMobileSidebar);

    elements.changeProfileButton.addEventListener("click", () => openDialog(elements.confirmDialog));
    elements.themeButton.addEventListener("click", () => openDialog(elements.themeDialog));
    elements.privacyButton.addEventListener("click", () => openDialog(elements.privacyDialog));
    elements.openPrivacyFromDisclosureButton.addEventListener("click", () => {
      elements.dataDisclosureDialog.close();
      openDialog(elements.privacyDialog);
    });
    elements.cancelDisclosureButton.addEventListener("click", () => {
      nativeCollector.pendingConsentOptions = null;
      elements.dataDisclosureDialog.close();
    });
    elements.acceptDisclosureButton.addEventListener("click", acceptNativeDataDisclosure);
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.addEventListener("click", () => selectTheme(button.dataset.themeOption));
    });
    elements.keepDataButton.addEventListener("click", leaveProfileWithoutDeleting);
    elements.deleteDataButton.addEventListener("click", deleteLocalData);

    document.addEventListener("error", handleProfilePhotoError, true);
  }

  function initializeTheme() {
    let savedTheme = "atlas";
    try {
      savedTheme = localStorage.getItem("takip-atlasi-theme") || "atlas";
    } catch (error) {
      savedTheme = "atlas";
    }
    applyTheme(themes[savedTheme] ? savedTheme : "atlas", false);
  }

  function selectTheme(themeId) {
    if (!themes[themeId]) {
      return;
    }

    const changeTheme = () => applyTheme(themeId, true);
    if (!reducedMotion && typeof document.startViewTransition === "function") {
      document.startViewTransition(changeTheme);
    } else {
      changeTheme();
    }
  }

  function applyTheme(themeId, announce) {
    const theme = themes[themeId] || themes.atlas;
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.themeMode = theme.mode;
    try {
      localStorage.setItem("takip-atlasi-theme", themeId);
    } catch (error) {
      // The selected theme still applies for the current private session.
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute("content", theme.themeColor);
    }
    elements.currentThemeName.textContent = theme.name;
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === themeId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (announce) {
      elements.themeDialog.close();
      showToast(`${theme.name} teması uygulandı.`, "◐");
    }
  }

  function initializeListDensity() {
    let density = "compact";
    try { density = localStorage.getItem("takip-atlasi-list-density") || density; } catch (error) { /* Use the compact layout. */ }
    applyListDensity(density, false);
  }

  function applyListDensity(value, persist = true) {
    state.listDensity = value === "comfortable" ? "comfortable" : "compact";
    document.body.dataset.listDensity = state.listDensity;
    elements.densityButton.textContent = state.listDensity === "compact" ? "Sık görünüm" : "Rahat görünüm";
    elements.densityButton.setAttribute("aria-pressed", String(state.listDensity === "compact"));
    if (persist) {
      try { localStorage.setItem("takip-atlasi-list-density", state.listDensity); } catch (error) { /* The layout still applies to this session. */ }
    }
  }

  function loadFavorites() {
    const key = `takip-atlasi-favorites-v1:${state.profile.isDemo ? "demo:" : ""}${state.profile.username}`;
    if (state.favoritesProfile === key) return;
    state.favoritesProfile = key;
    state.favorites = new Set();
    try {
      const entries = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(entries)) state.favorites = new Set(entries.slice(0, 15000).map(logic.normalizeUsername).filter(Boolean));
    } catch (error) { /* Corrupt or blocked preferences do not prevent analysis. */ }
  }

  function syncFavorites() {
    if (!state.analysis) return;
    const people = new Map([...state.analysis.lostFollowers, ...state.analysis.all].map((person) => [person.username, person]));
    state.analysis.favorites = Array.from(state.favorites, (username) => people.get(username) || {
      username, timestamp: 0, followerCount: null, followingCount: null, postCount: null, favoriteOnly: true,
    });
    document.querySelectorAll('[data-count="favorites"]').forEach((element) => { element.textContent = formatNumber(state.favorites.size); });
  }

  function toggleFavorite(value) {
    const username = logic.normalizeUsername(value);
    if (!username || !state.profile) return;
    const next = new Set(state.favorites);
    if (next.has(username)) next.delete(username);
    else next.add(username);
    try { localStorage.setItem(state.favoritesProfile, JSON.stringify(Array.from(next))); }
    catch (error) { showToast("Yıldızlı hesap cihazına kaydedilemedi. Depolama alanını kontrol et.", "!"); return; }
    state.favorites = next;
    syncFavorites();
    renderList(true);
    showToast(next.has(username) ? `@${username} yıldızlılara eklendi.` : `@${username} yıldızlılardan çıkarıldı.`, "★");
  }

  async function copyFilteredList() {
    const people = state.listPeople.filter(matchesAdvancedFilters).sort(comparePeople);
    if (!people.length) return;
    const text = people.map((person) => `@${person.username}`).join("\n");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      showToast(`${formatNumber(people.length)} kullanıcı adı kopyalandı.`, "✓");
    } catch (error) {
      elements.copyText.value = text;
      openDialog(elements.copyDialog);
      elements.copyText.focus();
      elements.copyText.select();
    }
  }

  async function initializeNativeCollector() {
    const capacitor = window.Capacitor;
    const plugin = isAndroidRuntime
      ? capacitor && capacitor.Plugins && capacitor.Plugins.InstagramCollector
      : window.TakipDesktopCollector;
    nativeCollector.available = Boolean(
      plugin &&
      (!isAndroidRuntime || !capacitor.isPluginAvailable || capacitor.isPluginAvailable("InstagramCollector")),
    );
    if (!isAndroidRuntime && plugin) {
      try {
        nativeCollector.available = Boolean(await plugin.isAvailable());
      } catch (error) {
        nativeCollector.available = false;
      }
    }
    nativeCollector.plugin = nativeCollector.available ? plugin : null;
    await refreshNativeConnectionStatus();
    updateInstagramConnectButton();

    if (!nativeCollector.plugin || typeof nativeCollector.plugin.addListener !== "function") {
      return;
    }

    try {
      nativeCollector.listenerHandle = await nativeCollector.plugin.addListener(
        "progress",
        (status) => {
          if (collectorState.busy) {
            renderCollectorStatus(status || {});
          }
        },
      );
    } catch (error) {
      nativeCollector.available = false;
      nativeCollector.plugin = null;
      updateInstagramConnectButton();
    }
  }

  function updateInstagramConnectButton() {
    [elements.archiveButton, elements.archiveRefreshButton, elements.changeProfileButton, elements.demoButton, elements.profileName]
      .forEach((element) => { element.disabled = collectorState.busy; });
    const connectionRuntime = isAndroidRuntime || Boolean(window.TakipDesktopCollector);
    elements.instagramConnectButton.hidden = !connectionRuntime;
    elements.refreshButton.hidden = !connectionRuntime;
    elements.scanTempoPanel.hidden = !connectionRuntime;
    elements.dashboardScanTempoPanel.hidden = !connectionRuntime;
    if (!connectionRuntime) {
      return;
    }
    const remaining = Math.max(0, nativeCollector.blockedUntil - Date.now());
    window.clearTimeout(nativeCollector.cooldownTimer);
    if (remaining) {
      nativeCollector.cooldownTimer = window.setTimeout(updateInstagramConnectButton, Math.min(remaining, 60000));
    }
    elements.instagramConnectButton.disabled = !nativeCollector.available || collectorState.busy || remaining > 0;
    elements.refreshButton.disabled = !nativeCollector.available || collectorState.busy || remaining > 0;
    if (collectorState.busy) {
      elements.instagramConnectTitle.textContent = "Instagram taraması sürüyor";
      elements.instagramConnectHint.textContent = "Açılan Instagram ekranını işlem bitene kadar kapatma";
      return;
    }
    if (remaining) {
      elements.instagramConnectTitle.textContent = "Instagram istek sınırı (429)";
      elements.instagramConnectHint.textContent = `En erken ${Math.ceil(remaining / 60000)} dakika sonra yeniden denenebilir`;
      return;
    }
    if (nativeCollector.available) {
      elements.instagramConnectTitle.textContent = isAndroidRuntime ? "Instagram'a bağlan" : "Instagram'a bağlan (PC)";
      elements.instagramConnectHint.textContent = "Giriş yap ve takip listelerini bu cihazda analiz et";
      return;
    }
    elements.instagramConnectTitle.textContent = isAndroidRuntime ? "Android toplayıcısı bulunamadı" : "PC tarayıcı bağlantısı bulunamadı";
    elements.instagramConnectHint.textContent = isAndroidRuntime ? "Takip Atlası'nın güncel Android sürümünü yükle" : "Edge veya Chrome kurup npm start ile aç";
  }

  function initializeScanTempo() {
    let tempo = "steady";
    try {
      tempo = localStorage.getItem("takip-atlasi-scan-tempo-v2") || tempo;
    } catch (error) {
      // Balanced mode applies if preferences cannot be read.
    }
    selectScanTempo(tempo);
  }

  function selectScanTempo(value) {
    const tempo = ["slow", "steady", "fast"].includes(value) ? value : "steady";
    nativeCollector.scanTempo = tempo;
    elements.scanTempoSelect.value = tempo;
    elements.dashboardScanTempoSelect.value = tempo;
    try {
      localStorage.setItem("takip-atlasi-scan-tempo-v2", tempo);
    } catch (error) {
      // The selected tempo still applies to this session.
    }
  }

  async function refreshNativeConnectionStatus() {
    const plugin = nativeCollector.plugin;
    if (!plugin || typeof plugin.getConnectionStatus !== "function") {
      return;
    }
    try {
      const status = await plugin.getConnectionStatus();
      const blockedUntil = Number(status && status.blockedUntil);
      nativeCollector.blockedUntil = Number.isFinite(blockedUntil) ? Math.max(0, blockedUntil) : 0;
    } catch (error) {
      // Keep a known cooldown if the native status cannot be read temporarily.
    }
    updateInstagramConnectButton();
  }

  function requestNativeInstagramConnection(options = {}) {
    const requested = logic.normalizeUsername(options.username || (options.fromDashboard && state.profile ? state.profile.username : getValidProfileName()));
    if (!requested || requested.length > 30) {
      showError(elements.setupError, "Instagram'a bağlanmadan önce kullanıcı adını yaz.");
      return;
    }
    if (Date.now() < nativeCollector.blockedUntil) {
      const message = "Instagram bekleme süresi henüz dolmadı (HTTP 429). Yeni istek gönderilmedi.";
      if (options.fromDashboard) {
        showToast(message, "!");
      } else {
        showError(elements.setupError, message);
      }
      return;
    }
    let consented = false;
    try {
      consented = localStorage.getItem(DATA_DISCLOSURE_KEY) === "1";
    } catch (error) {
      consented = false;
    }
    if (!consented) {
      nativeCollector.pendingConsentOptions = options;
      openDialog(elements.dataDisclosureDialog);
      return;
    }
    startNativeInstagramConnection(options);
  }

  function acceptNativeDataDisclosure() {
    try {
      localStorage.setItem(DATA_DISCLOSURE_KEY, "1");
    } catch (error) {
      showError(elements.setupError, "Veri onayı bu cihazda kaydedilemedi.");
      return;
    }
    const options = nativeCollector.pendingConsentOptions || {};
    nativeCollector.pendingConsentOptions = null;
    elements.dataDisclosureDialog.close();
    startNativeInstagramConnection(options);
  }

  async function startNativeInstagramConnection(options = {}) {
    const plugin = nativeCollector.plugin;
    const fromDashboard = Boolean(options.fromDashboard);
    const requestedUsername = logic.normalizeUsername(
      options.username || (fromDashboard && state.profile ? state.profile.username : getValidProfileName()),
    );

    if (!nativeCollector.available || !plugin) {
      const message = isAndroidRuntime ? "Instagram bağlantısı için güncel Takip Atlası Android sürümünü yükle." : "PC bağlantısı için yerel sunucu ve Edge veya Chrome hazır olmalı.";
      if (fromDashboard) {
        showToast(message, "!");
      } else {
        showError(elements.setupError, message);
      }
      return;
    }
    if (collectorState.busy) {
      return;
    }

    hideError(elements.setupError);
    collectorState.busy = true;
    collectorState.fromDashboard = fromDashboard;
    collectorState.startedAt = Date.now();
    if (fromDashboard) elements.dashboardMain.prepend(elements.collectorPanel);
    else elements.setupError.before(elements.collectorPanel);
    elements.collectorPanel.hidden = false;
    elements.refreshButton.classList.toggle("is-spinning", fromDashboard);
    updateInstagramConnectButton();
    renderCollectorStatus({
      phase: "waiting_login",
      message: "Instagram girişini tamamla; hesabın açılınca “Listeleri tara” düğmesine bas.",
      progress: 8,
      followersCount: 0,
      followingCount: 0,
    });

    try {
      const summary = await plugin.collect({ username: requestedUsername || "", tempo: nativeCollector.scanTempo });
      const username = logic.normalizeUsername(summary && summary.username);
      if (!username) {
        throw new Error("Instagram kullanıcı adı okunamadı.");
      }
      if (
        fromDashboard &&
        state.profile &&
        !state.profile.isDemo &&
        username !== state.profile.username
      ) {
        throw new Error(
          `@${state.profile.username} yerine @${username} hesabı açık. Doğru Instagram hesabıyla tekrar dene.`,
        );
      }

      renderCollectorStatus({
        phase: "saving",
        message: "Listeler yerel analiz alanına aktarılıyor...",
        progress: 98,
        followersCount: Number(summary.followersCount) || 0,
        followingCount: Number(summary.followingCount) || 0,
      });
      const [followers, following] = await Promise.all([
        readNativeRelationship(plugin, "followers"),
        readNativeRelationship(plugin, "following"),
      ]);
      const dataset = {
        followers,
        following,
        profilePicUrl: logic.normalizeProfilePicUrl(summary.profilePicUrl),
        sourceFiles: [isAndroidRuntime ? "Instagram Android oturumu" : "Instagram PC oturumu"],
        foundFollowers: true,
        foundFollowing: true,
      };

      elements.profileName.value = username;
      showLoading("Instagram listeleri hazır", "Takip ilişkilerin karşılaştırılıp cihazına kaydediliyor...");
      await Promise.all([saveAnalysisDataset(username, dataset), waitForLoadingAnimation()]);
      state.category = "overview";
      state.search = "";
      state.sort = "recent";
      elements.searchInput.value = "";
      showDashboard();
      hideError(elements.setupError);
      elements.collectorPanel.hidden = true;

      if (fromDashboard && state.analysis && state.analysis.hasPrevious) {
        showToast(
          `Yenileme tamamlandı: ${formatNumber(state.analysis.newFollowers.length)} yeni, ${formatNumber(state.analysis.lostFollowers.length)} ayrılan takipçi.`,
          "↻",
        );
      } else {
        showToast(
          `${formatNumber(followers.length)} takipçi ve ${formatNumber(following.length)} takip edilen analiz edildi.`,
          "✓",
        );
      }

      collectorState.busy = false;
      collectorState.fromDashboard = false;
      elements.refreshButton.classList.remove("is-spinning");
      restoreRefreshButtonLabel();
      updateInstagramConnectButton();
    } catch (error) {
      const message = error && error.message
        ? error.message
        : "Instagram taraması tamamlanamadı.";
      const cancelled = error && error.code === "CANCELLED" ||
        !(error && error.code) && /^(?:Instagram taraması durduruldu|Tarama durduruldu|Instagram ekranı kapatıldı)\.$/i.test(message);
      const rateLimited = error && error.code === "RATE_LIMITED";
      if (rateLimited) {
        const retryAfterMs = Number(error.data && error.data.retryAfterMs);
        nativeCollector.blockedUntil = Math.max(nativeCollector.blockedUntil, Date.now() +
          (Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, 86400000) : 900000));
      }
      finishInstagramConnection(cancelled ? "cancelled" : rateLimited ? "rate_limited" : "error", message);
    } finally {
      hideLoading();
      if (plugin && typeof plugin.clearResult === "function") {
        await plugin.clearResult().catch(() => {});
      }
      await refreshNativeConnectionStatus();
    }
  }

  async function readNativeRelationship(plugin, relationship) {
    const records = [];
    let offset = 0;
    let expectedTotal = null;

    for (let chunkNumber = 0; chunkNumber < 100; chunkNumber += 1) {
      const chunk = await plugin.readResult({ relationship, offset, limit: 250 });
      const chunkRecords = Array.isArray(chunk && chunk.records) ? chunk.records : [];
      const total = Math.max(0, Number(chunk && chunk.total) || 0);
      if (expectedTotal === null) {
        expectedTotal = total;
      } else if (total !== expectedTotal) {
          throw new Error("Takip listesi aktarım sırasında değişti.");
      }
      records.push(...chunkRecords);
      offset += chunkRecords.length;

      if (chunk && chunk.done) {
        if (records.length !== total) {
          throw new Error("Takip listesi eksik aktarıldı.");
        }
        return records;
      }
      if (!chunkRecords.length) {
        throw new Error("Takip listesi okunamadı.");
      }
    }

    throw new Error("Takip listesi güvenlik sınırını aştı.");
  }

  function renderCollectorStatus(currentStatus) {
    const titles = {
      launching: "Instagram açılıyor",
      waiting_login: "Girişini tamamla",
      profile: "Hesap doğrulanıyor",
      followers: "Takipçiler toplanıyor",
      following: "Takip ettiklerin toplanıyor",
      saving: "Listeler hazırlanıyor",
      complete: "Tarama tamamlandı",
      cancelled: "Tarama durduruldu",
      error: "Bağlantı kurulamadı",
      rate_limited: "Instagram istek sınırı",
    };
    const progress = Math.max(0, Math.min(100, Number(currentStatus.progress) || 0));
    const terminal = ["complete", "cancelled", "error", "rate_limited"].includes(currentStatus.phase);

    elements.collectorPanel.hidden = false;
    elements.collectorPanel.classList.toggle("is-error", ["error", "rate_limited"].includes(currentStatus.phase));
    elements.collectorPanel.classList.toggle("is-complete", currentStatus.phase === "complete");
    elements.collectorTitle.textContent = titles[currentStatus.phase] || "Instagram bağlantısı";
    elements.collectorMessage.textContent = currentStatus.message || "İşlem sürüyor...";
    elements.collectorPercent.textContent = `${Math.round(progress)}%`;
    elements.collectorProgress.style.width = `${progress}%`;
    elements.liveFollowersCount.textContent = formatNumber(currentStatus.followersCount);
    elements.liveFollowingCount.textContent = formatNumber(currentStatus.followingCount);
    const elapsed = Math.max(0, Math.floor((Date.now() - collectorState.startedAt) / 1000));
    const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)} dk ${elapsed % 60} sn` : `${elapsed} sn`;
    const size = Number(currentStatus.pageSize) || (nativeCollector.scanTempo === "fast" ? 100 : nativeCollector.scanTempo === "slow" ? 25 : 50);
    const counters = Number(currentStatus.profilesTotal) > 0
      ? `${formatNumber(currentStatus.profilesReady)} / ${formatNumber(currentStatus.profilesTotal)} profil takipçi sayısı · ` : "";
    elements.collectorDetails.textContent = `${counters}${size} hesaplık istek · Geçen süre: ${duration}`;
    elements.cancelCollectorButton.hidden = terminal;
    elements.desktopScanButton.hidden = isAndroidRuntime || !collectorState.busy || terminal || currentStatus.phase !== "waiting_login";
    elements.desktopScanButton.disabled = !currentStatus.ready;

    if (collectorState.fromDashboard) {
      const refreshLabel = elements.refreshButton.querySelector("span");
      if (refreshLabel) {
        refreshLabel.textContent = currentStatus.phase === "waiting_login"
          ? "Giriş bekleniyor"
          : "Taranıyor";
      }
    }
  }

  function finishInstagramConnection(phase, message) {
    const wasDashboardRefresh = collectorState.fromDashboard;
    collectorState.busy = false;
    collectorState.fromDashboard = false;
    elements.refreshButton.classList.remove("is-spinning");
    restoreRefreshButtonLabel();
    updateInstagramConnectButton();
    renderCollectorStatus({
      phase,
      message,
      progress: 0,
      followersCount: Number(elements.liveFollowersCount.textContent.replace(/\D/g, "")) || 0,
      followingCount: Number(elements.liveFollowingCount.textContent.replace(/\D/g, "")) || 0,
    });

    if (wasDashboardRefresh) {
      showToast(message || "Instagram taraması tamamlanamadı.", phase === "cancelled" ? "×" : "!");
    } else if (phase === "error" || phase === "rate_limited") {
      showError(elements.setupError, message || "Instagram taraması tamamlanamadı.");
    }
  }

  async function cancelInstagramConnection() {
    elements.cancelCollectorButton.disabled = true;
    try {
      if (nativeCollector.plugin) {
        await nativeCollector.plugin.cancel();
        return;
      }
      finishInstagramConnection("cancelled", "Instagram taraması durduruldu.");
    } catch (error) {
      finishInstagramConnection("error", error.message);
    } finally {
      elements.cancelCollectorButton.disabled = false;
    }
  }

  function restoreRefreshButtonLabel() {
    const refreshLabel = elements.refreshButton.querySelector("span");
    if (refreshLabel) {
      refreshLabel.textContent = "Verileri yenile";
    }
  }

  function updateSetupValidity() {
    const username = getValidProfileName();
    elements.profileCheck.classList.toggle("is-visible", Boolean(username));
  }

  function getValidProfileName() {
    const username = logic.normalizeUsername(elements.profileName.value);
    return username && username.length <= 30 ? username : "";
  }

  async function saveAnalysisDataset(username, dataset) {
    const savedState = await storage.load();
    if (savedState.profile && savedState.profile.username !== username) {
      await storage.clear();
    }

    const profile = {
      username,
      profilePicUrl:
        logic.normalizeProfilePicUrl(dataset.profilePicUrl) ||
        (savedState.profile && savedState.profile.username === username
          ? logic.normalizeProfilePicUrl(savedState.profile.profilePicUrl)
          : ""),
      createdAt:
        savedState.profile && savedState.profile.username === username
          ? savedState.profile.createdAt
          : Date.now(),
      isDemo: false,
    };
    const snapshot = logic.createSnapshot(username, dataset);

    await storage.saveProfile(profile);
    const snapshots = await storage.addSnapshot(snapshot);
    state.profile = profile;
    state.snapshots = snapshots.filter((entry) => entry.username === username);
  }

  function openArchivePicker(username = getValidProfileName()) {
    const validUsername = logic.normalizeUsername(username);
    if (!validUsername || validUsername.length > 30) {
      showError(elements.setupError, "Arşiv için önce Instagram kullanıcı adını yaz.");
      return;
    }
    pendingArchiveUsername = validUsername;
    elements.archiveInput.click();
  }

  async function importSelectedArchive(event) {
    const files = Array.from(event.target.files || []);
    const username = pendingArchiveUsername;
    pendingArchiveUsername = "";
    if (!files.length || !username) {
      return;
    }
    elements.archiveButton.disabled = true;
    hideError(elements.setupError);
    showLoading("Instagram arşivi okunuyor", "İki takip listesi cihazında doğrulanıyor...");
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const dataset = await archive.importFiles(files);
      await saveAnalysisDataset(username, dataset);
      state.category = "overview";
      state.search = "";
      state.sort = "recent";
      elements.searchInput.value = "";
      elements.profileName.value = username;
      showDashboard();
      elements.collectorPanel.hidden = true;
      showToast(`${formatNumber(dataset.followers.length)} takipçi ve ${formatNumber(dataset.following.length)} takip edilen arşivden okundu.`, "✓");
    } catch (error) {
      const message = error && error.message ? error.message : "Instagram arşivi okunamadı.";
      if (elements.onboardingView.hidden) {
        showToast(message, "!");
      } else {
        showError(elements.setupError, message);
      }
    } finally {
      event.target.value = "";
      elements.archiveButton.disabled = false;
      hideLoading();
    }
  }

  async function startDemo() {
    showLoading("Örnek harita kuruluyor", "Renkler ve kategoriler hazırlanıyor...");
    const demo = logic.createDemoData(getValidProfileName());
    await waitForLoadingAnimation();
    state.profile = demo.profile;
    state.snapshots = demo.snapshots;
    state.category = "overview";
    state.search = "";
    state.sort = "recent";
    showDashboard();
    hideLoading();
    showToast("Örnek moddasın. Bu kişiler yalnızca arayüzü göstermek için oluşturuldu.", "✨");
  }

  function showDashboard() {
    state.snapshots.sort((a, b) => b.importedAt - a.importedAt);
    state.currentSnapshot = state.snapshots[0] || null;
    state.previousSnapshot = state.snapshots[1] || null;

    if (!state.currentSnapshot) {
      showOnboarding();
      return;
    }

    const enrichmentSnapshotId = `${state.profile.username}:${state.currentSnapshot.id}`;
    if (state.nativeEnrichmentSnapshotId !== enrichmentSnapshotId) {
      state.nativeEnrichmentSnapshotId = enrichmentSnapshotId;
      state.nativeProfilePhotos.clear();
      state.nativePhotoAttempts.clear();
      state.nativePendingPhotoPeople = [];
    }

    state.analysis = logic.analyzeDataset(state.currentSnapshot, state.previousSnapshot);
    loadFavorites();
    syncFavorites();
    elements.onboardingView.hidden = true;
    elements.dashboardView.hidden = false;
    elements.archiveRefreshButton.hidden = Boolean(state.profile.isDemo);
    document.body.classList.add("has-dashboard");
    renderDashboard();
    switchCategory(state.category, false);
    requestNativeProfilePhotos([
      ...(state.profile.profilePicUrl
        ? [{ username: state.profile.username, profilePicUrl: state.profile.profilePicUrl }]
        : []),
      ...state.analysis.notFollowingBack.slice(0, 4),
    ]);
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function showOnboarding() {
    elements.dashboardView.hidden = true;
    elements.onboardingView.hidden = false;
    document.body.classList.remove("has-dashboard");
    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderDashboard() {
    const analysis = state.analysis;
    const profileName = state.profile.username;
    const countKeys = [
      "all",
      "followers",
      "following",
      "mutual",
      "notFollowingBack",
      "youDontFollowBack",
      "newFollowers",
      "lostFollowers",
      "favorites",
    ];

    elements.profileAvatar.style.setProperty("--avatar-hue", hashHue(profileName));
    elements.profileAvatar.innerHTML = avatarContentMarkup(
      profileName,
      state.profile.profilePicUrl,
      false,
    );
    elements.sidebarProfileName.textContent = `@${profileName}`;
    elements.welcomeName.textContent = profileName.split(/[._]/)[0] || profileName;
    elements.historyCount.textContent = `${state.snapshots.length} kayıt`;

    countKeys.forEach((key) => {
      const count = analysis[key].length;
      document.querySelectorAll(`[data-count="${key}"]`).forEach((element) => {
        element.textContent = formatNumber(count);
      });
      document.querySelectorAll(`[data-stat="${key}"]`).forEach((element) => {
        animateCount(element, count);
      });
    });

    renderDeltas();
    renderRelationshipChart();
    renderPulse();
    renderAttentionPeople();
    updateRelativeTime();
  }

  function renderDeltas() {
    const analysis = state.analysis;
    const followersDelta = document.querySelector('[data-delta="followers"]');
    const followingDelta = document.querySelector('[data-delta="following"]');
    const mutualDelta = document.querySelector('[data-delta="mutual"]');
    const notFollowingDelta = document.querySelector('[data-delta="notFollowingBack"]');

    if (analysis.hasPrevious) {
      followersDelta.innerHTML = `<i></i> ${formatSigned(analysis.deltas.followers)} net değişim`;
      followingDelta.innerHTML = `<i></i> ${formatSigned(analysis.deltas.following)} net değişim`;
      mutualDelta.innerHTML = `<i></i> ${formatNumber(analysis.mutual.length)} güçlü bağ`;
      notFollowingDelta.innerHTML = `<i></i> ${formatNumber(analysis.notFollowingBack.length)} tek yönlü takip`;
    } else {
      followersDelta.innerHTML = "<i></i> Yenileyince değişim görünür";
      followingDelta.innerHTML = "<i></i> Güncel listen";
      mutualDelta.innerHTML = "<i></i> Güçlü bağların";
      notFollowingDelta.innerHTML = "<i></i> Seni takip etmiyor";
    }
  }

  function renderRelationshipChart() {
    const analysis = state.analysis;
    const total = analysis.all.length;
    const mutualRatio = total ? (analysis.mutual.length / total) * 100 : 0;
    const followingOnlyRatio = total
      ? (analysis.notFollowingBack.length / total) * 100
      : 0;
    const followingAngle = Math.min(100, mutualRatio + followingOnlyRatio);

    elements.relationshipDonut.style.setProperty("--mutual-angle", `${mutualRatio.toFixed(2)}%`);
    elements.relationshipDonut.style.setProperty("--following-angle", `${followingAngle.toFixed(2)}%`);
    elements.mutualPercent.textContent = `${Math.round(mutualRatio)}%`;
  }

  function renderPulse() {
    const analysis = state.analysis;
    if (!analysis.hasPrevious) {
      elements.pulseSummary.textContent = "Bir sonraki yenilemede değişimleri burada göreceksin.";
      return;
    }

    const newCount = analysis.newFollowers.length;
    const lostCount = analysis.lostFollowers.length;
    if (!newCount && !lostCount) {
      elements.pulseSummary.textContent = "Son iki kayıt arasında takipçi değişimi bulunmadı.";
      return;
    }

    elements.pulseSummary.textContent = `${formatNumber(newCount)} yeni takipçi geldi, ${formatNumber(lostCount)} kişi takibi bıraktı.`;
  }

  function renderAttentionPeople() {
    const people = state.analysis.notFollowingBack.slice(0, 4);
    if (!people.length) {
      elements.attentionPeople.innerHTML = `
        <div class="empty-mini">
          <strong>Harika bir denge!</strong>
          <span>Takip ettiğin herkes seni de takip ediyor.</span>
        </div>
      `;
      return;
    }

    elements.attentionPeople.innerHTML = people
      .map(
        (person, index) => `
          <div class="mini-person" style="--delay: ${index * 50}ms">
            ${avatarMarkup(person.username, person.profilePicUrl)}
            <div class="mini-person__name">
              <strong>@${escapeHtml(person.username)}</strong>
              <span>${relationshipDate(person.timestamp)}</span>
            </div>
            <span>Tek yönlü</span>
          </div>
        `,
      )
      .join("");
  }

  function switchCategory(category, shouldScroll = true) {
    if (!categoryMeta[category] || !state.analysis) {
      return;
    }

    state.category = category;
    state.limit = PAGE_SIZE;
    const simpleList = category === "notFollowingBack";
    const simpleSorts = ["az", "za", "followers-desc", "followers-asc"];
    Array.from(elements.sortSelect.options).forEach((option) => {
      option.hidden = simpleList && !simpleSorts.includes(option.value);
      option.disabled = option.hidden;
    });
    if (simpleList) {
      state.filters.relationship = "all";
      state.filters.details = "all";
      state.filters.photo = "all";
      if (!simpleSorts.includes(state.sort)) state.sort = "az";
    }
    elements.sortSelect.value = state.sort;

    if (category === "overview" && state.search) {
      state.search = "";
      elements.searchInput.value = "";
    }

    document.querySelectorAll("[data-category]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.category === category);
    });

    const meta = categoryMeta[category];
    elements.categoryEyebrow.textContent = meta.eyebrow;
    elements.categoryTitle.textContent = meta.title;
    elements.overviewPanel.hidden = category !== "overview";
    elements.listPanel.hidden = category === "overview";

    if (category !== "overview") {
      elements.listKicker.textContent = meta.kicker;
      elements.listTitle.textContent = meta.title;
      elements.listDescription.textContent = meta.description;
      renderList();
    }

    closeMobileSidebar();
    if (shouldScroll) {
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    }
  }

  function renderList(skipPhotoRequest = false) {
    if (state.category === "overview" || !state.analysis) {
      return;
    }

    const source = state.analysis[state.category] || [];
    const query = state.search.trim().toLowerCase().replace(/^@/, "");
    const queryMatches = source.filter((person) => !query || person.username.includes(query));
    const filtered = queryMatches
      .filter(matchesAdvancedFilters)
      .sort(comparePeople);

    const visible = filtered.slice(0, state.limit);
    elements.visibleResultCount.textContent = formatNumber(filtered.length);
    elements.copyListButton.disabled = filtered.length === 0;
    renderActiveFilters(query);
    elements.peopleGrid.innerHTML = visible
      .map((person, index) => personCardMarkup(person, index, !skipPhotoRequest))
      .join("");

    const isEmpty = !filtered.length;
    elements.emptyState.hidden = !isEmpty;
    if (isEmpty) {
      const hasFilters = Boolean(query || activeAdvancedFilterCount());
      elements.emptyTitle.textContent = hasFilters ? "Filtreye uyan hesap yok" : "Burada kimse yok";
      elements.emptyText.textContent = hasFilters
        ? "Aramayı veya gelişmiş filtreleri temizleyip tekrar dene."
        : emptyCategoryMessage(state.category);
      if (state.category === "notFollowingBack" && followerFilterActive() &&
        queryMatches.some((person) => !Number.isFinite(personDetails(person).followerCount))) {
        elements.emptyTitle.textContent = "Bu aralıkta bilinen takipçi sayısı yok";
        elements.emptyText.textContent = "Instagram'ın sayacını paylaşmadığı hesaplar sayı filtresine dahil edilmez. Tüm hesaplar için filtreyi temizle.";
      }
    }

    const remaining = Math.max(0, filtered.length - visible.length);
    elements.loadMoreButton.hidden = remaining === 0;
    elements.loadMoreButton.textContent = remaining
      ? `Daha fazla göster (${formatNumber(remaining)} kaldı)`
      : "Daha fazla göster";

    const visibleNames = new Set(visible.map((person) => person.username));
    const listPeople = [...visible, ...queryMatches.filter((person) => !visibleNames.has(person.username))];
    state.listPeople = listPeople;
    if (!skipPhotoRequest) {
      requestNativeProfilePhotos(visible);
    }
    updateListDetailStatus(listPeople);
  }

  function personDetails(person) {
    return person;
  }

  function hasCompleteDetails(person) {
    const details = personDetails(person);
    if (state.category === "notFollowingBack") return Number.isFinite(details.followerCount);
    return [details.followerCount, details.followingCount, details.postCount].every(
      (value) => Number.isFinite(value),
    );
  }

  function matchesAdvancedFilters(person) {
    const filters = state.filters;
    const details = personDetails(person);
    const followerCount = Number.isFinite(details.followerCount) ? details.followerCount : null;
    const hasPhoto = Boolean(
      state.nativeProfilePhotos.get(person.username) || logic.normalizeProfilePicUrl(person.profilePicUrl),
    );

    if (filters.relationship === "mutual" && !(person.isFollower && person.isFollowing)) {
      return false;
    }
    if (filters.relationship === "follows-you" && !(person.isFollower && !person.isFollowing)) {
      return false;
    }
    if (filters.relationship === "you-follow" && !(!person.isFollower && person.isFollowing)) {
      return false;
    }
    if (filters.relationship === "new" && person.change !== "newFollower") {
      return false;
    }
    if (filters.relationship === "lost" && person.change !== "lostFollower") {
      return false;
    }
    if (filters.details === "ready" && !hasCompleteDetails(person)) {
      return false;
    }
    if (filters.details === "pending" && hasCompleteDetails(person)) {
      return false;
    }
    if (filters.photo === "with" && !hasPhoto) {
      return false;
    }
    if (filters.photo === "without" && hasPhoto) {
      return false;
    }
    if (filters.audience !== "all") {
      if (followerCount === null) {
        return false;
      }
      if (filters.audience === "under-1k" && followerCount >= 1000) {
        return false;
      }
      if (filters.audience === "1k-10k" && (followerCount < 1000 || followerCount >= 10000)) {
        return false;
      }
      if (filters.audience === "10k-100k" && (followerCount < 10000 || followerCount >= 100000)) {
        return false;
      }
      if (filters.audience === "over-100k" && followerCount < 100000) {
        return false;
      }
    }
    if (filters.minFollowers !== null && (followerCount === null || followerCount < filters.minFollowers)) {
      return false;
    }
    if (filters.maxFollowers !== null && (followerCount === null || followerCount > filters.maxFollowers)) {
      return false;
    }
    return true;
  }

  function comparePeople(a, b) {
    if (state.sort === "az") {
      return a.username.localeCompare(b.username, "tr");
    }
    if (state.sort === "za") {
      return b.username.localeCompare(a.username, "tr");
    }
    if (state.sort === "details") {
      return Number(hasCompleteDetails(b)) - Number(hasCompleteDetails(a)) || a.username.localeCompare(b.username, "tr");
    }
    const metricSorts = {
      "followers-desc": ["followerCount", -1],
      "followers-asc": ["followerCount", 1],
      "following-desc": ["followingCount", -1],
      "posts-desc": ["postCount", -1],
    };
    if (metricSorts[state.sort]) {
      const [key, direction] = metricSorts[state.sort];
      const aValue = personDetails(a)[key];
      const bValue = personDetails(b)[key];
      const aKnown = Number.isFinite(aValue);
      const bKnown = Number.isFinite(bValue);
      if (aKnown !== bKnown) {
        return aKnown ? -1 : 1;
      }
      if (aKnown && aValue !== bValue) {
        return (aValue - bValue) * direction;
      }
      return a.username.localeCompare(b.username, "tr");
    }

    const aTime = Number(a.detectedAt) || (Number(a.timestamp) || 0) * 1000;
    const bTime = Number(b.detectedAt) || (Number(b.timestamp) || 0) * 1000;
    if (Boolean(aTime) !== Boolean(bTime)) {
      return aTime ? -1 : 1;
    }
    if (aTime !== bTime) {
      return state.sort === "oldest" ? aTime - bTime : bTime - aTime;
    }
    return a.username.localeCompare(b.username, "tr");
  }

  function activeAdvancedFilterCount() {
    const filters = state.filters;
    return [
      filters.relationship !== "all",
      filters.details !== "all",
      filters.audience !== "all",
      filters.photo !== "all",
      filters.minFollowers !== null,
      filters.maxFollowers !== null,
    ].filter(Boolean).length;
  }

  function renderActiveFilters(query) {
    const labels = [];
    if (query) {
      labels.push(`@${query}`);
    }
    const relationshipLabels = {
      mutual: "Karşılıklı",
      "follows-you": "Seni takip ediyor",
      "you-follow": "Sen takip ediyorsun",
      new: "Yeni",
      lost: "Ayrılan",
    };
    const audienceLabels = {
      "under-1k": "1K altı",
      "1k-10k": "1K–10K",
      "10k-100k": "10K–100K",
      "over-100k": "100K+",
    };
    if (state.filters.relationship !== "all") {
      labels.push(relationshipLabels[state.filters.relationship]);
    }
    if (state.filters.details !== "all") {
      labels.push(state.filters.details === "ready" ? "Bilgisi hazır" : "Bilgisi bekleniyor");
    }
    if (state.filters.audience !== "all") {
      labels.push(audienceLabels[state.filters.audience]);
    }
    if (state.filters.photo !== "all") {
      labels.push(state.filters.photo === "with" ? "Fotoğraflı" : "Fotoğrafsız");
    }
    if (state.filters.minFollowers !== null) {
      labels.push(`En az ${formatNumber(state.filters.minFollowers)}`);
    }
    if (state.filters.maxFollowers !== null) {
      labels.push(`En fazla ${formatNumber(state.filters.maxFollowers)}`);
    }

    const filterCount = activeAdvancedFilterCount();
    elements.activeFilterCount.textContent = String(filterCount);
    elements.openFilterButton.classList.toggle("has-filters", filterCount > 0);
    elements.activeFilter.hidden = labels.length === 0;
    elements.activeFilterText.textContent = labels.join(" · ");
  }

  function personCardMarkup(person, index, animate = true) {
    const badges = statusBadges(person);
    const safeUsername = escapeHtml(person.username);
    const delay = Math.min(index, 14) * 32;
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(person.username)}/`;
    const compact = state.category === "notFollowingBack" || state.category === "favorites";
    const favorite = state.favorites.has(person.username);

    return `
      <article class="person-card${compact ? " person-card--compact" : ""}${animate ? "" : " is-enriched"}" style="--delay: ${delay}ms" data-person-username="${safeUsername}">
        ${avatarMarkup(person.username, person.profilePicUrl)}
        <div class="person-card__content">
          <strong>@${safeUsername}</strong>
          ${compact ? "" : `<div class="person-card__meta">
            <span>${relationshipMoment(person)}</span><i></i><span>${relationshipLabel(person)}</span>
          </div>`}
          ${compact ? followerStatsMarkup(person) : accountStatsMarkup(person)}
          <div class="status-badges">${badges}</div>
        </div>
        <div class="person-card__actions">
          <button class="favorite-button${favorite ? " is-active" : ""}" type="button" data-toggle-favorite="${safeUsername}" aria-pressed="${favorite}" aria-label="@${safeUsername} hesabının yıldızını ${favorite ? "kaldır" : "ekle"}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.8 9.7l6.4-.9L12 3Z" fill="${favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <a class="profile-link" href="${profileUrl}" target="_blank" rel="noreferrer" aria-label="@${safeUsername} profilini Instagram'da aç">↗</a>
        </div>
      </article>
    `;
  }

  function statusBadges(person) {
    if (person.favoriteOnly) return '<span class="status-badge">Bu kayıtta yok</span>';
    if (person.change === "lostFollower") {
      return '<span class="status-badge status-badge--coral">Takibi bıraktı</span>';
    }

    if (person.change === "newFollower") {
      const secondBadge = person.isFollowing
        ? '<span class="status-badge status-badge--lime">Karşılıklı</span>'
        : "";
      return `<span class="status-badge status-badge--cyan">Yeni takipçi</span>${secondBadge}`;
    }

    if (person.isFollower && person.isFollowing) {
      return '<span class="status-badge status-badge--lime">Karşılıklı</span>';
    }

    if (person.isFollowing) {
      return '<span class="status-badge status-badge--coral">Seni takip etmiyor</span>';
    }

    return '<span class="status-badge status-badge--cyan">Seni takip ediyor</span>';
  }

  function relationshipLabel(person) {
    if (person.favoriteOnly) return "Güncel listede yok";
    if (person.change === "lostFollower") {
      return "Önceki kayıtta vardı";
    }
    if (person.change === "newFollower") {
      return "Yeni bağlantı";
    }
    if (person.isFollower && person.isFollowing) {
      return "Çift yönlü";
    }
    return "Tek yönlü";
  }

  function relationshipMoment(person) {
    if (person.change === "lostFollower" || person.change === "newFollower") {
      const start = Number(person.detectedAfter) || 0;
      const end = Number(person.detectedAt) || 0;
      if (start && end) {
        return `${formatClock(start)}–${formatClock(end)} arasında`;
      }
      if (end) {
        return `${formatClock(end)}'de tespit edildi`;
      }
    }
    return relationshipDate(person.timestamp);
  }

  function accountStatsMarkup(person) {
    if (state.profile && state.profile.isDemo) {
      return '<div class="account-stats"><span>Örnek hesap · canlı sayaç yok</span></div>';
    }
    const metadata = personDetails(person);
    return `
      <div class="account-stats" aria-label="Hesap istatistikleri">
        <span title="Takipçi sayısı"><b>${formatCompactNumber(metadata.followerCount)}</b> takipçi</span>
        <i></i>
        <span title="Takip edilen sayısı"><b>${formatCompactNumber(metadata.followingCount)}</b> takip</span>
        <i></i>
        <span title="Gönderi sayısı"><b>${formatCompactNumber(metadata.postCount)}</b> gönderi</span>
      </div>
    `;
  }

  function followerStatsMarkup(person) {
    if (state.profile && state.profile.isDemo) return '<div class="person-card__followers">Örnek hesap · canlı sayaç yok</div>';
    const count = personDetails(person).followerCount;
    return Number.isFinite(count)
      ? `<div class="person-card__followers" title="${formatNumber(count)} takipçi"><b>${formatNumber(count)}</b> takipçi</div>`
      : '<div class="person-card__followers is-unavailable">Takipçi sayısı paylaşılmadı</div>';
  }

  async function requestNativeProfilePhotos(people) {
    if (collectorState.busy || document.hidden) {
      return;
    }
    const plugin = nativeCollector.plugin;
    if (state.nativePhotoRequestInProgress) {
      state.nativePendingPhotoPeople = people;
      return;
    }
    if (
      !plugin ||
      typeof plugin.requestProfilePhotos !== "function" ||
      !state.currentSnapshot
    ) {
      return;
    }

    const candidates = people
      .filter((person) => {
        const sourceUrl = logic.normalizeProfilePicUrl(person && (personDetails(person).profilePicUrl || person.profilePicUrl));
        return person &&
          person.username &&
          /^https:\/\//i.test(sourceUrl) &&
          !state.nativeProfilePhotos.has(person.username) &&
          !state.nativePhotoAttempts.has(person.username);
      })
      .slice(0, 12);
    if (!candidates.length) {
      return;
    }

    const snapshotId = state.nativeEnrichmentSnapshotId;
    candidates.forEach((person) => state.nativePhotoAttempts.add(person.username));
    state.nativePhotoRequestInProgress = true;
    updateListDetailStatus(people);
    try {
      const result = await plugin.requestProfilePhotos({
        records: candidates.map((person) => ({
          username: person.username,
          instagramUserId: person.instagramUserId || "",
          profilePicUrl: personDetails(person).profilePicUrl || person.profilePicUrl,
        })),
      });
      if (snapshotId !== state.nativeEnrichmentSnapshotId) {
        return;
      }
      const requested = new Set(candidates.map((person) => person.username));
      ((result && result.records) || []).forEach((entry) => {
        const username = logic.normalizeUsername(entry && entry.username);
        const localUrl = isAndroidRuntime
          ? normalizeNativePhotoUrl(entry && entry.fileUri)
          : normalizeDesktopPhotoUrl(entry && entry.photoUrl);
        if (username && requested.has(username) && localUrl) {
          state.nativeProfilePhotos.set(username, localUrl);
        }
      });
      elements.profileAvatar.innerHTML = avatarContentMarkup(
        state.profile.username,
        state.profile.profilePicUrl,
        false,
      );
      renderAttentionPeople();
      if (state.category !== "overview") {
        renderList(true);
      }
    } catch (error) {
      // Initials remain visible when Android cannot cache a photo.
    } finally {
      state.nativePhotoRequestInProgress = false;
      if (snapshotId !== state.nativeEnrichmentSnapshotId) {
        return;
      }
      updateListDetailStatus(people);
      const pendingPeople = state.nativePendingPhotoPeople;
      state.nativePendingPhotoPeople = [];
      if (pendingPeople.length) {
        window.setTimeout(() => requestNativeProfilePhotos(pendingPeople), 100);
        return;
      }
      const hasMore = people.some((person) =>
        /^https:\/\//i.test(logic.normalizeProfilePicUrl(person && person.profilePicUrl)) &&
        !state.nativeProfilePhotos.has(person.username) &&
        !state.nativePhotoAttempts.has(person.username),
      );
      if (hasMore) {
        window.setTimeout(() => requestNativeProfilePhotos(people), 250);
      }
    }
  }

  function normalizeNativePhotoUrl(fileUri) {
    if (
      !/^file:\/\//i.test(String(fileUri || "")) ||
      !window.Capacitor ||
      typeof window.Capacitor.convertFileSrc !== "function"
    ) {
      return "";
    }
    try {
      const converted = window.Capacitor.convertFileSrc(fileUri);
      const url = new URL(converted);
      const path = decodeURIComponent(url.pathname);
      const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return localHost &&
        ["http:", "https:"].includes(url.protocol) &&
        /\/_capacitor_file_\/.*\/profile_photos\/[a-f0-9]{64}\.(?:jpg|png|webp|avif)$/i.test(path)
        ? url.href
        : "";
    } catch (error) {
      return "";
    }
  }

  function normalizeDesktopPhotoUrl(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      return url.origin === location.origin && /^\/api\/instagram\/photo\/[a-f0-9]{64}$/.test(url.pathname)
        ? url.href : "";
    } catch (error) { return ""; }
  }

  function updateListDetailStatus(people) {
    // A photo or cancelled batch may finish after navigation. Report the active list.
    if (state.category !== "overview") {
      people = state.listPeople;
    }
    if (!people || !people.length || state.category === "overview") {
      elements.listDetailStatus.hidden = true;
      return;
    }
    const ready = people.filter((person) => Number.isFinite(personDetails(person).followerCount)).length;
    elements.listDetailStatus.hidden = ready === people.length || Boolean(state.profile?.isDemo);
    elements.listDetailStatus.textContent = ready
      ? `${formatNumber(ready)}/${formatNumber(people.length)} takipçi sayısı taramada alındı · kalan sayaçlar paylaşılmadı`
      : "Bu kayıtta profil takipçi sayıları yok. Bir sonraki Instagram taramasında otomatik alınır.";
  }

  function emptyCategoryMessage(category) {
    const messages = {
      notFollowingBack: "Takip ettiğin herkes seni de takip ediyor. Güzel denge!",
      youDontFollowBack: "Seni takip edip senin takip etmediğin hesap yok.",
      newFollowers: state.analysis.hasPrevious
        ? "Son yenilemeden beri yeni takipçi görünmüyor."
        : "Bu liste için en az iki veri yenilemesi gerekli.",
      lostFollowers: state.analysis.hasPrevious
        ? "Son yenilemeden beri takibi bırakan görünmüyor."
        : "Bu liste için en az iki veri yenilemesi gerekli.",
      mutual: "Henüz karşılıklı bir takip ilişkisi bulunmuyor.",
      favorites: "Bir hesabın yanındaki yıldıza dokun; burada kolayca bul.",
    };
    return messages[category] || "Bu kategori şu an boş görünüyor.";
  }

  function handleSearch(event) {
    state.search = event.target.value;
    state.limit = PAGE_SIZE;
    if (state.search && state.category === "overview") {
      switchCategory("all", false);
    } else if (state.category !== "overview") {
      renderList();
    }
  }

  function clearListFilters() {
    state.search = "";
    elements.searchInput.value = "";
    state.filters = {
      relationship: "all",
      details: "all",
      audience: "all",
      photo: "all",
      minFollowers: null,
      maxFollowers: null,
    };
    elements.searchInput.focus();
    renderList();
  }

  function openFilterDialog() {
    const simpleList = state.category === "notFollowingBack";
    [elements.relationshipFilter, elements.detailsFilter, elements.photoFilter].forEach((field) => {
      field.closest("label").hidden = simpleList;
    });
    elements.filterDialog.classList.toggle("is-simple-filter", simpleList);
    elements.filterTitle.textContent = simpleList ? "Takipçi sayısına göre filtrele" : "Hesapları filtrele";
    elements.filterHint.textContent = simpleList ? "Kişilerin profilinde yazan takipçi sayısına göre bir aralık seç." : "İlişki durumunu ve hesap büyüklüğünü birlikte daralt.";
    elements.relationshipFilter.value = state.filters.relationship;
    elements.detailsFilter.value = state.filters.details;
    elements.audienceFilter.value = state.filters.audience;
    elements.photoFilter.value = state.filters.photo;
    elements.minFollowersFilter.value = state.filters.minFollowers ?? "";
    elements.maxFollowersFilter.value = state.filters.maxFollowers ?? "";
    openDialog(elements.filterDialog);
  }

  function resetFilterDialog() {
    state.filters = {
      relationship: "all",
      details: "all",
      audience: "all",
      photo: "all",
      minFollowers: null,
      maxFollowers: null,
    };
    elements.filterDialog.close();
    state.limit = PAGE_SIZE;
    renderList();
  }

  function applyFilterDialog() {
    let minimum = parseFilterNumber(elements.minFollowersFilter.value);
    let maximum = parseFilterNumber(elements.maxFollowersFilter.value);
    if (minimum !== null && maximum !== null && minimum > maximum) {
      [minimum, maximum] = [maximum, minimum];
    }
    state.filters = {
      relationship: state.category === "notFollowingBack" ? "all" : elements.relationshipFilter.value,
      details: state.category === "notFollowingBack" ? "all" : elements.detailsFilter.value,
      audience: elements.audienceFilter.value,
      photo: state.category === "notFollowingBack" ? "all" : elements.photoFilter.value,
      minFollowers: minimum,
      maxFollowers: maximum,
    };
    state.limit = PAGE_SIZE;
    elements.filterDialog.close();
    renderList();
  }

  function followerFilterActive() {
    return state.filters.audience !== "all" || state.filters.minFollowers !== null || state.filters.maxFollowers !== null;
  }

  function parseFilterNumber(value) {
    if (String(value).trim() === "") {
      return null;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= 5000000000
      ? number
      : null;
  }

  function openRefreshDialog() {
    if (state.profile && state.profile.isDemo) {
      showToast("Gerçek veriyi yenilemek için önce “Profili değiştir” ile kendi profilini oluştur.", "💡");
      return;
    }

    if (nativeCollector.available) {
      requestNativeInstagramConnection({
        username: state.profile.username,
        fromDashboard: true,
      });
      return;
    }
    showToast("Instagram bağlantısı kullanılamıyor. PC sunucusunu veya uygulama kurulumunu kontrol et.", "!");
  }

  function leaveProfileWithoutDeleting() {
    elements.confirmDialog.close();
    showOnboarding();
    elements.profileName.value = state.profile && !state.profile.isDemo ? state.profile.username : "";
    hideError(elements.setupError);
    updateSetupValidity();
    showToast("Kayıtların telefonunda korunuyor.", "🔒");
  }

  async function deleteLocalData() {
    elements.confirmDialog.close();
    showLoading("Yerel kasa temizleniyor", "Takip kayıtları bu cihazdan kaldırılıyor...");

    try {
      const forgetInstagramSession = nativeCollector.plugin
        ? nativeCollector.plugin.clearSession().catch(() => null)
        : Promise.resolve();
      await Promise.all([storage.clear(), forgetInstagramSession, waitForLoadingAnimation()]);
      state.profile = null;
      state.snapshots = [];
      state.analysis = null;
      state.currentSnapshot = null;
      state.previousSnapshot = null;
      state.category = "overview";
      state.nativeProfilePhotos.clear();
      state.nativePhotoAttempts.clear();
      state.nativePendingPhotoPeople = [];
      state.nativeEnrichmentSnapshotId = "";
      try {
        localStorage.removeItem(DATA_DISCLOSURE_KEY);
        Object.keys(localStorage).filter((key) => key.startsWith("takip-atlasi-favorites-v1:")).forEach((key) => localStorage.removeItem(key));
      } catch (error) {
        // Local analytics data is already cleared even if consent storage is blocked.
      }
      elements.profileName.value = "";
      state.favorites.clear();
      state.favoritesProfile = "";
      hideError(elements.setupError);
      updateSetupValidity();
      elements.collectorPanel.hidden = true;
      showOnboarding();
      showToast("Yerel profil ve analiz geçmişi silindi.", "✓");
    } catch (error) {
      showToast(error.message || "Yerel kayıtlar silinemedi.", "!");
    } finally {
      hideLoading();
    }
  }

  function openMobileSidebar() {
    elements.sidebar.classList.add("is-open");
    elements.mobileScrim.hidden = false;
  }

  function closeMobileSidebar() {
    elements.sidebar.classList.remove("is-open");
    elements.mobileScrim.hidden = true;
  }

  function openDialog(dialog) {
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function closeDialogFromBackdrop(event, dialog) {
    if (event.target !== dialog) {
      return;
    }

    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) {
      dialog.close();
    }
  }

  function updateRelativeTime() {
    if (!state.currentSnapshot || !elements.lastSyncText) {
      return;
    }

    const difference = state.currentSnapshot.importedAt - Date.now();
    const absolute = Math.abs(difference);
    let value;
    let unit;

    if (absolute < 60000) {
      elements.lastSyncText.textContent = "Az önce";
      return;
    }

    if (absolute < 3600000) {
      value = Math.round(difference / 60000);
      unit = "minute";
    } else if (absolute < 86400000) {
      value = Math.round(difference / 3600000);
      unit = "hour";
    } else if (absolute < 604800000) {
      value = Math.round(difference / 86400000);
      unit = "day";
    } else {
      elements.lastSyncText.textContent = dateFormatter.format(state.currentSnapshot.importedAt);
      return;
    }

    elements.lastSyncText.textContent = capitalize(relativeFormatter.format(value, unit));
  }

  function animateCount(element, target) {
    if (reducedMotion) {
      element.textContent = formatNumber(target);
      element.dataset.countValue = String(target);
      return;
    }

    const start = Number(element.dataset.countValue || 0);
    const difference = target - start;
    const duration = 600;
    const startedAt = performance.now();

    if (element.countAnimationFrame) {
      cancelAnimationFrame(element.countAnimationFrame);
    }

    function step(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatNumber(Math.round(start + difference * eased));
      if (progress < 1) {
        element.countAnimationFrame = requestAnimationFrame(step);
      } else {
        element.dataset.countValue = String(target);
      }
    }

    element.countAnimationFrame = requestAnimationFrame(step);
  }

  function avatarMarkup(username, profilePicUrl) {
    const hue = hashHue(username);
    return `<div class="person-avatar" style="--avatar-hue: ${hue}">${avatarContentMarkup(username, profilePicUrl)}</div>`;
  }

  function avatarContentMarkup(username, profilePicUrl, lazy = true) {
    const safeUrl = state.nativeProfilePhotos.get(logic.normalizeUsername(username)) || "";
    const fallback = `<span class="avatar-fallback">${escapeHtml(initialsFor(username))}</span>`;
    if (!safeUrl) {
      return fallback;
    }
    return `${fallback}<img class="profile-photo" src="${escapeHtml(safeUrl)}" alt="" referrerpolicy="no-referrer" decoding="async"${lazy ? ' loading="lazy"' : ""}>`;
  }

  function handleProfilePhotoError(event) {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.classList.contains("profile-photo")) {
      image.remove();
    }
  }

  function initialsFor(username) {
    const parts = String(username || "")
      .split(/[._-]+/)
      .filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return String(username || "TA").slice(0, 2).toUpperCase();
  }

  function hashHue(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = value.charCodeAt(index) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  }

  function relationshipDate(timestamp) {
    if (!timestamp) {
      return "Tarih bilgisi yok";
    }
    return dateFormatter.format(timestamp * 1000);
  }

  function formatClock(timestamp) {
    return clockFormatter.format(timestamp);
  }

  function formatCompactNumber(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }
    return (value >= 10000 ? compactFormatter : countFormatter).format(value);
  }

  function formatSigned(number) {
    if (number > 0) {
      return `+${formatNumber(number)}`;
    }
    return formatNumber(number);
  }

  function formatNumber(number) {
    return numberFormatter.format(Number(number) || 0);
  }

  function capitalize(value) {
    return value ? value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1) : value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  function hideError(element) {
    element.textContent = "";
    element.hidden = true;
  }

  function showLoading(title, text) {
    elements.loadingTitle.textContent = title;
    elements.loadingText.textContent = text;
    elements.loadingOverlay.hidden = false;
  }

  function hideLoading() {
    elements.loadingOverlay.hidden = true;
  }

  function waitForLoadingAnimation() {
    return new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : 420));
  }

  function showToast(message, icon) {
    const toast = document.createElement("div");
    toast.className = "toast";

    const iconElement = document.createElement("span");
    iconElement.textContent = icon || "✓";
    const messageElement = document.createElement("span");
    messageElement.textContent = message;

    toast.append(iconElement, messageElement);
    while (elements.toastRegion.childElementCount >= 2) elements.toastRegion.firstElementChild.remove();
    elements.toastRegion.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 260);
    }, 4200);
  }

  async function clearLegacyWebRuntime() {
    const hadController = Boolean(
      "serviceWorker" in navigator && navigator.serviceWorker.controller,
    );
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }
    } catch (error) {
      return false;
    }

    const resetKey = "takip-atlasi-android-web-cache-reset-v1";
    if (hadController && sessionStorage.getItem(resetKey) !== "1") {
      sessionStorage.setItem(resetKey, "1");
      location.reload();
      return true;
    }
    return false;
  }
})();
