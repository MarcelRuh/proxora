# Proxora for Android

Official Android client. It is a Chromium WebView around your self-hosted Proxora, so **every server feature is available**: dashboard, hosts, VMs/LXC, console, guest files (upload/download/WebSocket), backups, storage, RBAC, WireGuard, updates.

This is not a second API. Login, cookies, CSRF and your existing roles apply unchanged.

## Build

**Android Studio (recommended)**

1. Open the `android/` folder as a project (or File → Open → `android`).
2. Let Gradle sync (JDK 17).
3. Run on a device or emulator (API 26+).

**CLI** (JDK 17 + Android SDK):

```bash
cd android
gradle :app:assembleRelease
```

The APK is `app/build/outputs/apk/release/app-release.apk`. CI on `main` also uploads that artifact.

## Use

1. Install the APK (sideload; not on Play Store).
2. Enter your Proxora URL, e.g. `https://proxora.home.arpa`.
3. Sign in as usual (TOTP included).
4. Optional: allow a self-signed TLS certificate for LAN installs.

Consoles and the file explorer open in the same view (Android has no desktop popups). Use the system back button to return.

Pull down from the top of a page to reload. Change the server anytime by long-pressing the app icon and choosing **Change server**.
