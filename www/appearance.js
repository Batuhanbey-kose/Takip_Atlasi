(function attachAppearance(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TakipAppearance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function appearance() {
  "use strict";
  const themes = {
    atlas: { name: "Atlas", mode: "light", themeColor: "#17142d", note: "Mor · krem" },
    ocean: { name: "Okyanus", mode: "light", themeColor: "#082f49", note: "Mavi · turkuaz" },
    forest: { name: "Orman", mode: "light", themeColor: "#173524", note: "Yeşil · adaçayı" },
    sunset: { name: "Gün Batımı", mode: "light", themeColor: "#3b1d2a", note: "Şeftali · sıcak tonlar" },
    sakura: { name: "Sakura", mode: "light", themeColor: "#3a1930", note: "Pembe · gül" },
    lavender: { name: "Lavanta", mode: "light", themeColor: "#241b45", note: "Lila · yumuşak" },
    mono: { name: "Mono", mode: "light", themeColor: "#111111", note: "Siyah · beyaz" },
    midnight: { name: "Gece", mode: "dark", themeColor: "#080914", note: "Lacivert · koyu" },
    aurora: { name: "Aurora", mode: "dark", themeColor: "#071e26", note: "Nane · kuzey ışığı" },
    amoled: { name: "AMOLED", mode: "dark", themeColor: "#000000", note: "Gerçek siyah · lila" },
  };
  const layouts = {
    atlas: { name: "Kartlar", note: "Dengeli kartlar ve özet panelleri" },
    bento: { name: "Modüler", note: "Büyük özet, asimetrik kutular" },
    glass: { name: "Cam", note: "Yüzen, yarı saydam yüzeyler" },
    editorial: { name: "Dergi", note: "Serif başlık, geniş tek sütun" },
    compact: { name: "Yoğun", note: "Tablo gibi sık ve yatay satırlar" },
    gallery: { name: "Portre", note: "Fotoğraf odaklı, ortalanmış kartlar" },
    terminal: { name: "Terminal", note: "Eş aralıklı yazı, çizgili listeler" },
    dashboard: { name: "Panel", note: "Sabit yan özet ve çalışma alanı" },
    ribbon: { name: "Şerit", note: "Yatay kategoriler, tam genişlik" },
    focus: { name: "Odak", note: "Ortalanmış, geniş ve sakin liste" },
  };
  const aliases = { ice: "ocean", sand: "sunset", neon: "aurora", cherry: "sakura", coffee: "forest", cyber: "midnight" };
  const themeId = (value) => Object.keys(themes).includes(value) ? value : Object.prototype.hasOwnProperty.call(aliases, value) ? aliases[value] : "atlas";
  const layoutId = (value) => Object.keys(layouts).includes(value) ? value : "atlas";
  return { themes, layouts, themeId, layoutId };
});
