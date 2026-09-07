-keep class app.proxora.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class app.proxora.AndroidDownloadBridge {
    <init>(...);
    @android.webkit.JavascriptInterface <methods>;
}
