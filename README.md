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
> Takip Atlası Android APK ve PC'de yerel tarayıcı arayüzü sunar. Instagram veya Meta tarafından geliştirilmemiş, desteklenmemiş ya da onaylanmamıştır. Yalnızca kendi hesabında ve sorumluluğunda kullan.

## İndirme

En güncel imzalı APK için yukarıdaki **Tek Tıkla İndir** düğmesini kullan. Bağlantı her zaman son GitHub sürümündeki `Takip-Atlasi.apk` dosyasını indirir.

Android ilk kurulumda, APK'yı açtığın uygulamaya **Bilinmeyen uygulamaları yükleme** izni vermeni isteyebilir. Yeni sürümler aynı imzayla üretildiği için APK'yı mevcut kurulumun üzerine yükleyerek verilerini koruyabilirsin.

**PC'de kullanmak için:** Kaynak kodu indir, Node.js 22 kur ve proje klasöründe `npm ci` ardından `npm start` çalıştır. `http://127.0.0.1:4173` adresini tarayıcıda aç. Yerel sunucu yalnızca bu bilgisayardan erişilir; Instagram parolası istemez ve verini başka bir sunucuya yüklemez.
**Kurulumsuz Windows paketi:** GitHub Release'teki `Takip-Atlasi-PC.zip` dosyasının tamamını bir klasöre çıkartıp `Takip-Atlasi-PC.bat` dosyasına çift tıkla. Node/npm kurulumu gerekmez; Windows 10/11 x64 ve Edge veya Chrome gerekir.
PC'de **Instagram'a bağlan (PC)** düğmesi normal Edge/Chrome penceresi açar. Girişi gerçek Instagram sayfasında tamamla, ardından Takip Atlası sayfasındaki **Listeleri tara** düğmesine bas. PC ve Android aynı liste toplayıcı kodunu kullanır; tarayıcı oturumları ayrı olduğundan iki platform ayrıca doğrulanmalıdır. Instagram 429 döndürürse PC taraması da durur ve yerel bekleme süresini korur.
PC bağlantısı hesap toplamlarını Instagram'ın güncel web profil yanıtından doğrular ve web oturumunun istek başlıklarını kullanır. Liste istekleri 12 hesaplık sayfalarla, tek sırada ve temkinli aralıklarla çalışır. Instagram daha küçük sayfalar döndürebilir; ilerleme cursor ile sürdürülür.
Liste taraması ilişki sayfalarını sırayla okur. Sonuç ekranında eksik takipçi sayıları görünür hesaplardan başlayarak **birer birer** tamamlanır; dörtlü sayaç grubu kullanılmaz. Liste yanıtındaki sıfır değerleri korunur; yükleme sırasında sayı uydurulmaz. Hazırlanan sayaçlar kimlik ve gözlem zamanı ile kaydedilir, güncel önbellek tekrar kullanılabilir.
**Seni takip etmeyenler** kartında fotoğraf, kullanıcı adı, profil takipçi sayısı ve ilişki etiketi gösterilir. Instagram sayıyı paylaşmazsa sıfır uydurulmaz; sayı bulunamadığı belirtilir. Fotoğraflar oturum çerezi gönderilmeden CDN'den alınır. Hata/düzeltme/yöntem geçmişi `docs/releases` klasöründedir.

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
| Son 8 taramanın karşılaştırmalı geçmişi | 10 tasarım düzeni × 10 renk teması | Uygulama içinden oturum ve veri silme |
| Yıldızlı hesaplar ve filtrelenmiş listeyi kopyalama | Sık / rahat kart görünümü | Profil bazında yerel yıldızlılar |

## Nasıl Çalışır?

**PC ve Android'de güvenilir arşiv yolu:** Instagram'da **Hesaplar Merkezi → Bilgilerin ve izinlerin → Bilgilerini indir** yolundan yalnızca **Takipçiler ve takip edilenler** verisini **JSON** biçiminde iste. İndirilen ZIP'i açmadan uygulamada **Instagram ZIP / JSON arşivini seç** düğmesine bas; istersen ZIP'ten çıkardığın `followers_1.json` ve `following.json` dosyalarını birlikte seç. Kullanıcı adını profil alanına yaz. Dosya yalnızca cihazında açılır; iki liste eksikse veri kaydedilmez. Instagram arşivi güncel olmayabilir; değişim analizi yalnızca içe aktardığın kayıtların farkını gösterir.

**Android'de doğrudan bağlantı:** **Instagram'a bağlan** düğmesine bas, veri kullanım açıklamasını onayla ve açılan gerçek `instagram.com` ekranında girişini tamamla. Hesabın açılınca **Listeleri tara** düğmesine bas. Instagram'ın resmi olmayan API'si istekleri reddederse ZIP/JSON arşivi yolunu kullan.

Instagram kullanıcı adın otomatik okunamazsa başlangıç ekranındaki profil alanına yazıp tekrar dene. Uygulama adı yalnızca açık oturumun hesap kimliğiyle eşleşirse kabul eder; yeşil tik tek başına hesap doğrulaması değildir.
Hesap sorguları Instagram tarafından reddedilirse uygulama hangi sorguda hangi HTTP yanıtını aldığını gösterir. Bu hata kodları oturum çerezlerini veya hesap kimliğini içermez.
**HTTP 429** alınırsa tarama ve takip hesabı bilgisi istekleri durur; Instagram'ın `Retry-After` süresi, belirtilmediyse 15 dakikalık yerel bekleme uygulanır. Bekleme bittikten sonra da Instagram erişimi reddedebilir; süre bir başarı garantisi değildir. **HTTP 400** tek başına hatanın sebebini açıklamaz; tanınan istemci uyumsuzluğu veya giriş doğrulama yanıtları ayrıca belirtilir.

Takibi bırakanları ve yeni takipçileri görebilmek için farklı zamanlarda en az iki tarama gerekir. Tarama ilerlemesi liste sayfaları üzerinden gösterilir; her kişiden sonra tek tek sayaç hazırlanmaz. İlerleme alanında geçen süreyi görebilir, işlemi durdurabilirsin. Bildirim veya periyodik arka plan taraması yoktur.

**Tarama temposu:** Varsayılan **Temkinli**, liste istekleri arasında 2–3 saniye bekler; **Daha yavaş** seçeneği 3–4 saniyedir. Önceki hızlı tercihler yeni varsayılanı geçersiz kılmaz. Profil sayaçları tek hesaplık çağrılarla ve aralarında 1,5–2,2 saniye aralıkla alınır. 429 ve oturum hatalarında yeni istekler durur.

**Eksik liste:** Sayfa sonu geldiğinde toplam beklenenden belirgin azsa liste bir kez daha temkinli kontrol edilir. Küçük fark devam ederse (örneğin 58/62), erişilen hesaplar **sınırlı analiz** olarak saklanır ve ekranda açıkça belirtilir. Eksik listenin yokluk bilgisi kesin ilişki veya takipten çıkma sonucuna dönüştürülmez. Büyük eksiklikler, boş/bozuk ara sayfalar ve kesilmiş sayfalama hâlâ reddedilir.

**Liste araçları:** Karttaki yıldız, hesabı **Yıldızlılar** bölümüne kaydeder. **Listeyi kopyala**, mevcut filtreye uyan bütün kullanıcı adlarını kopyalar. Sayısal filtrelerde sayısı henüz yüklenmeyen hesaplar eşleşmiş gibi sayılmaz veya kesin sonuç yok diye gizlenmez; ayrı bekleme alanında gösterilir. Sayılar geldikçe filtre ve sıralama otomatik yenilenir.

**Tasarım ve çıkış:** Üstteki **Görünüm** düğmesi Kartlar, Modüler, Cam, Dergi, Yoğun, Portre, Terminal, Panel, Şerit ve Odak düzenlerini açar. Bunlar 10 renk temasından bağımsız seçilir ve cihazda hatırlanır. **Çıkış yap**, Instagram oturumunu kapatır; analiz geçmişi saklanır. Sayaç yükleme çıkışta, tarama başlatıldığında ve uygulama arka plana geçtiğinde durdurulur. Yerel APK `com.takipatlasi.app.local` kimliği ve **Takip Atlası Yerel** adıyla kurulur.

## Gizlilik

- Instagram parolası Takip Atlası tarafından okunmaz veya saklanmaz.
- Oturum çerezi yalnızca tam `https://www.instagram.com` API isteklerine gönderilir.
- Profil fotoğrafı çerez kullanılmadan doğrudan izin verilen Instagram CDN alanlarından alınır.
- Android bulut yedeklemesi ve cihazlar arası sistem aktarımı kapalıdır.
- Yerel analiz geçmişi, fotoğraf önbelleği ve uygulama içi oturum tek işlemle silinebilir.

Tam açıklama uygulamanın içindeki **Gizlilik ve veri kullanımı** bölümünde bulunur.

## Teknoloji

`Java` · `Capacitor 7` · `Android WebView` · `Node.js` · `fflate` · `IndexedDB` · `GitHub Actions`

<details>
<summary><strong>Kaynaktan derleme</strong></summary>

Android APK için gereksinimler: Node.js 22, Android Studio, JDK 21 ve Android SDK.

```powershell
npm ci
npm run check
npm test
npm run desktop:smoke
npm run android:sync
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

`www` hem PC yerel sunucusu hem de Capacitor Android WebView tarafından kullanılan ortak arayüzdür.

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

Android doğrudan bağlantısı takip listesi ve herkese açık hesap bilgilerini resmi olmayan Instagram uçlarından okur. Instagram değişiklikleri bu özelliği bozabilir veya hız sınırı uygulayabilir. ZIP/JSON arşiv içe aktarma bu uçlara bağlanmaz. Kaynak kodunu ve APK'yı kullanma sorumluluğu kullanıcıya aittir.

<div align="center">
  <sub>Takip Atlası · Android'de yerel takip analizi</sub>
</div>
