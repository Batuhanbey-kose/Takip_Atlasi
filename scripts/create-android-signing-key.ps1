$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "android"
$keystore = Join-Path $android "github-release.jks"
$properties = Join-Path $android "keystore.properties"
$keytool = "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"

if ((Test-Path -LiteralPath $keystore) -or (Test-Path -LiteralPath $properties)) {
    throw "Signing files already exist. Existing keys were not changed."
}
if (-not (Test-Path -LiteralPath $keytool)) {
    throw "Android Studio keytool was not found: $keytool"
}

$bytes = New-Object byte[] 36
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$password = [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
$alias = "takip-atlasi-release"

& $keytool -genkeypair -v -keystore $keystore -storetype PKCS12 -storepass $password -keypass $password -alias $alias -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Takip Atlasi, O=Takip Atlasi, C=TR"
if ($LASTEXITCODE -ne 0) {
    throw "Signing key could not be created."
}

$content = "storeFile=github-release.jks`nstorePassword=$password`nkeyAlias=$alias`nkeyPassword=$password`n"
[IO.File]::WriteAllText($properties, $content, [Text.UTF8Encoding]::new($false))

"Release signing key created under android/. Back up github-release.jks and keystore.properties together."
