package app.proxora

import android.annotation.SuppressLint
import android.os.Build
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView

object ProxoraWeb {
  const val UA_TOKEN = "ProxoraAndroid/${BuildConfig.VERSION_NAME}"

  @SuppressLint("SetJavaScriptEnabled")
  fun configure(view: WebView) {
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      javaScriptCanOpenWindowsAutomatically = true
      setSupportMultipleWindows(true)
      setSupportZoom(true)
      builtInZoomControls = true
      displayZoomControls = false
      useWideViewPort = true
      loadWithOverviewMode = true
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      mediaPlaybackRequiresUserGesture = false
      userAgentString = "$userAgentString $UA_TOKEN"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        safeBrowsingEnabled = true
      }
    }
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
    view.setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
  }
}
