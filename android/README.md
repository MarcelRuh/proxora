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

Release builds are signed with `android/proxora-release.jks` (gitignored). Locally, copy `keystore.properties.example` to `keystore.properties` and fill in the passwords. Without that file, Gradle falls back to the debug key. Tagged GitHub releases require the `ANDROID_KEYSTORE_*` secrets.

If you already installed a debug-signed APK (1.7.7 and earlier), uninstall it once before installing 1.7.8 or later — Android will not update over a different signing key.

## Use

1. Install the APK (sideload; not on Play Store).
2. Enter your Proxora URL, e.g. `https://proxora.home.arpa`.
3. Sign in as usual (TOTP included). The session stays until you change the server URL.
4. Optional: allow a self-signed TLS certificate for LAN installs.

Consoles and the file explorer open in the same view (Android has no desktop popups). Use the system back button to return.

The system status bar (clock, battery) stays visible. Long-press the app icon (or long-press in the app) for **Reload** or **Change server**.

Inbox events (host down, backup failed, disk full, …) appear as Android notifications as soon as the instance records them. Allow notifications when the app asks, and allow unrestricted battery use so the connection can stay up. A quiet **Alerts active** notification means the app can wake for events after you leave it. If you install a UnifiedPush distributor such as [ntfy](https://ntfy.sh/), Proxora uses that instead and drops the persistent notification.
