<div align="center">
  <img src="assets/github-hero.svg" width="100%" alt="Takip Atlası animasyonlu kapak">

  <br>

  <a href="https://github.com/Batuhanbey-kose/Takip_Atlasi/releases/latest/download/Takip-Atlasi.apk">
    <img src="https://img.shields.io/badge/TEK%20TIKLA%20%C4%B0ND%C4%B0R-Android%20APK-c7eb55?style=for-the-badge&logo=android&logoColor=17142d&labelColor=17142d" alt="Takip Atlası APK indir">
  </a>

  <br><br>

  <a href="https://github.com/Batuhanbey-kose/Takip_Atlasi/actions/workflows/android-ci.yml"><img src="https://github.com/Batuhanbey-kose/Takip_Atlasi/actions/workflows/android-ci.yml/badge.svg" alt="Android CI"></a>
  <a href="https://github.com/Batuhanbey-kose/Takip_Atlasi/releases/latest"><img src="https://img.shields.io/github/v/release/Batuhanbey-kose/Takip_Atlasi?style=flat&color=7357f6" alt="Son sürüm"></a>
  <img src="https://img.shields.io/badge/Android-6.0%2B-3DDC84?logo=android&logoColor=white" alt="Android 6 ve üzeri">
  <img src="https://img.shields.io/badge/veri-yaln%C4%B1zca%20telefonda-4dceca" alt="Veri yalnızca telefonda">

  <p><strong>Takip çevrendeki değişimi bilgisayarsız, sunucusuz ve tek bakışta gör.</strong></p>
</div>

> [!IMPORTANT]
> Takip Atlası yalnızca Android içindir. Instagram veya Meta tarafından geliştirilmemiş, desteklenmemiş ya da onaylanmamıştır. Yalnızca kendi hesabında ve sorumluluğunda kullan.

## İndirme

En güncel imzalı APK için yukarıdaki **Tek Tıkla İndir** düğmesini kullan. Bağlantı her zaman son GitHub sürümündeki `Takip-Atlasi.apk` dosyasını indirir.

Android ilk kurulumda, APK'yı açtığın uygulamaya **Bilinmeyen uygulamaları yükleme** izni vermeni isteyebilir. Yeni sürümler aynı imzayla üretildiği için APK'yı mevcut kurulumun üzerine yükleyerek verilerini koruyabilirsin.

> [!NOTE]
> **Play Protect indirmeyi veya kurulumu bekletirse:** Takip Atlası Google Play'de yayımlanmadığı için bazı cihazlar APK'yı `İndiriliyor...` ekranında tutabilir ya da bilinmeyen uygulama uyarısı gösterebilir. Önce sunulan **Yine de yükle** seçeneğini kullan. Bu seçenek yoksa:
>
> 1. Yalnızca yukarıdaki resmi GitHub bağlantısını kullandığından emin ol.
> 2. Play Store > profil resmi > **Play Protect** > Ayarlar bölümündeki **Uygulamaları Play Protect ile tara** seçeneğini geçici olarak kapat.
> 3. APK'yı indirip kurduktan sonra aynı seçeneği hemen yeniden aç.
> 4. Play Protect ekranındaki **Tara** düğmesiyle kontrol yap; resmi yayın APK'sında sorun bulunmamalıdır.
>
> Play Protect'i kapalı bırakma ve APK'yı başka kaynaklardan indirme.

## Neler Sunuyor?

| Takip haritası | Hesap detayları | Yerel ve özel |
|---|---|---|
| Takipçiler, takip ettiklerin ve karşılıklı hesaplar | Takipçi, takip edilen ve gönderi sayaçları | Parola Takip Atlası arayüzüne girmez |
| Seni takip etmeyenler ve senin takip etmediklerin | Profil fotoğrafları ve güvenli baş harf yedeği | Analizler yalnızca telefonda tutulur |
| Yeni takipçiler ve takibi bırakanlar | Gelişmiş sıralama, arama ve filtreleme | Reklam, analiz SDK'sı ve geliştirici sunucusu yoktur |
| Son 8 taramanın karşılaştırmalı geçmişi | 12 kalıcı görünüm teması | Uygulama içinden oturum ve veri silme |

## Nasıl Çalışır?

1. **Instagram'a bağlan** düğmesine bas ve veri kullanım açıklamasını onayla.
2. Uygulama içindeki gerçek `instagram.com` ekranında girişini tamamla.
3. Takip listeleri telefonda toplanır, karşılaştırılır ve analiz ekranı açılır.

Takibi bırakanları ve yeni takipçileri görebilmek için farklı zamanlarda en az iki tarama gerekir. Sayaç tabanlı sıralama seçildiğinde ilgili listedeki bütün hesap bilgileri kontrollü paralel isteklerle hazırlanır.

## Gizlilik

- Instagram parolası Takip Atlası tarafından okunmaz veya saklanmaz.
- Oturum çerezi yalnızca tam `https://www.instagram.com` API isteklerine gönderilir.
- Profil fotoğrafı çerez kullanılmadan doğrudan izin verilen Instagram CDN alanlarından alınır.
- Android bulut yedeklemesi ve cihazlar arası sistem aktarımı kapalıdır.
- Yerel analiz geçmişi, fotoğraf önbelleği ve uygulama içi oturum tek işlemle silinebilir.

Tam açıklama uygulamanın içindeki **Gizlilik ve veri kullanımı** bölümünde bulunur.

## Teknoloji

`Java` · `Capacitor 7` · `Android WebView` · `IndexedDB` · `GitHub Actions`

<details>
<summary><strong>Kaynaktan derleme</strong></summary>

Gereksinimler: Node.js 22, Android Studio, JDK 21 ve Android SDK.

```powershell
npm ci
npm run check
npm test
npm run android:sync
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

`www` bir web ürünü değildir; Capacitor tarafından APK içine gömülen Android WebView arayüzünün kaynak dizinidir.

</details>

<details>
<summary><strong>İmzalı GitHub Release hazırlama</strong></summary>

Yerel release anahtarı bir kez oluşturulur:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-android-signing-key.ps1
```

`android\github-release.jks` ve `android\keystore.properties` birlikte ve güvenli biçimde yedeklenmelidir. Bu dosyalar Git tarafından yok sayılır. `v*` etiketi gönderildiğinde `.github/workflows/android-release.yml` testleri çalıştırır, APK'yı aynı anahtarla imzalar ve GitHub Release'e ekler.

</details>

## Sorumluluk

Takip listesi ve herkese açık hesap bilgileri resmi olmayan Instagram uçlarından okunur. Instagram değişiklikleri özelliği geçici olarak bozabilir veya hız sınırı uygulayabilir. Kaynak kodunu ve APK'yı kullanma sorumluluğu kullanıcıya aittir.

<div align="center">
  <sub>Takip Atlası · Android'de yerel takip analizi</sub>
</div>
