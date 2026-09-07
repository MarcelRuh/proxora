-keep class app.proxora.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class app.proxora.AndroidDownloadBridge {
    <init>(...);
    @android.webkit.JavascriptInterface <methods>;
}

# EncryptedSharedPreferences / Tink; annotations are compile-only.
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**
