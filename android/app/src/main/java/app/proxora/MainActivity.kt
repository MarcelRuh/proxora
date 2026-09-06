package app.proxora

import android.app.Dialog
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding
import java.util.ArrayDeque

class MainActivity : AppCompatActivity() {
  private lateinit var webView: WebView
  private lateinit var progress: ProgressBar
  private var fileCallback: ValueCallback<Array<Uri>>? = null
  private var loadedServer: String? = null
  private val extraWindows = ArrayDeque<Dialog>()

  companion object {
    const val ACTION_RELOAD = "app.proxora.RELOAD"
  }

  private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val uris = result.data?.let { extractUris(it) }
    fileCallback?.onReceiveValue(uris)
    fileCallback = null
  }

  private val setupLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
    if (Prefs.serverUrl(this).isNullOrBlank()) finish()
    else loadServer(reset = true)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (Prefs.serverUrl(this).isNullOrBlank()) {
      setupLauncher.launch(Intent(this, SetupActivity::class.java))
    }

    progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      isIndeterminate = false
      max = 100
      minimumHeight = (3 * resources.displayMetrics.density).toInt()
    }
    webView = WebView(this).apply {
      setOnLongClickListener {
        val type = hitTestResult.type
        if (
          type == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
          type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE ||
          type == WebView.HitTestResult.IMAGE_TYPE ||
          type == WebView.HitTestResult.EDIT_TEXT_TYPE
        ) {
          false
        } else {
          showQuickActions()
          true
        }
      }
    }
    ProxoraWeb.configure(webView)
    attachClients(webView)

    val root = FrameLayout(this).apply {
      setBackgroundColor(getColor(R.color.proxora_bg))
      addView(
        webView,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
      )
      addView(
        progress,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (3 * resources.displayMetrics.density).toInt()),
      )
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      view.updatePadding(left = cutout.left, right = cutout.right, bottom = nav.bottom)
      insets
    }
    setContentView(root)
    hideSystemBars()

    webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
      startDownload(url, userAgent, contentDisposition, mimeType)
    }

    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val overlay = extraWindows.peekLast()
          if (overlay != null) {
            overlay.dismiss()
            return
          }
          if (webView.canGoBack()) webView.goBack() else finish()
        }
      },
    )

    if (!Prefs.serverUrl(this).isNullOrBlank()) loadServer(reset = savedInstanceState == null)
    if (savedInstanceState == null) handleShortcut(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleShortcut(intent)
  }

  override fun onResume() {
    super.onResume()
    hideSystemBars()
    val server = Prefs.serverUrl(this)
    if (!server.isNullOrBlank() && server != loadedServer) loadServer(reset = true)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  override fun onDestroy() {
    while (extraWindows.isNotEmpty()) extraWindows.removeLast().dismiss()
    webView.destroy()
    super.onDestroy()
  }

  private fun hideSystemBars() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.statusBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
  }

  private fun handleShortcut(intent: Intent?) {
    if (intent?.action != ACTION_RELOAD) return
    if (webView.url.isNullOrBlank()) return
    reloadPage()
  }

  private fun reloadPage() {
    webView.reload()
  }

  private fun showQuickActions() {
    AlertDialog.Builder(this, R.style.Theme_Proxora)
      .setItems(arrayOf(getString(R.string.menu_reload), getString(R.string.menu_server))) { _, which ->
        when (which) {
          0 -> reloadPage()
          1 -> setupLauncher.launch(Intent(this, SetupActivity::class.java))
        }
      }
      .show()
  }

  private fun loadServer(reset: Boolean) {
    val url = Prefs.serverUrl(this) ?: return
    loadedServer = url
    if (reset) {
      CookieManager.getInstance().removeAllCookies(null)
      CookieManager.getInstance().flush()
      webView.clearCache(true)
      webView.clearHistory()
    }
    webView.loadUrl(url)
  }

  private fun attachClients(view: WebView) {
    view.webViewClient = object : WebViewClient() {
      @Suppress("OVERRIDE_DEPRECATION")
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleUrl(url)

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        handleUrl(request.url.toString())

      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
        if (Prefs.allowInsecureTls(this@MainActivity)) {
          handler.proceed()
        } else {
          handler.cancel()
          Toast.makeText(this@MainActivity, R.string.ssl_blocked, Toast.LENGTH_LONG).show()
        }
      }
    }
    view.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) {
        progress.progress = newProgress
        progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
      }

      override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean {
        val child = WebView(this@MainActivity)
        ProxoraWeb.configure(child)
        attachClients(child)
        child.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
          startDownload(url, userAgent, contentDisposition, mimeType)
        }
        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        transport.webView = child
        resultMsg.sendToTarget()

        val dialog = Dialog(this@MainActivity, R.style.Theme_Proxora)
        dialog.setContentView(
          child,
          ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        dialog.setOnDismissListener {
          extraWindows.remove(dialog)
          child.destroy()
        }
        extraWindows.addLast(dialog)
        dialog.show()
        return true
      }

      override fun onCloseWindow(window: WebView) {
        extraWindows.lastOrNull()?.dismiss()
      }

      override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
      ): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = filePathCallback
        val intent = fileChooserParams.createIntent().apply {
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        return try {
          filePicker.launch(intent)
          true
        } catch (_: Exception) {
          fileCallback = null
          false
        }
      }
    }
  }

  private fun handleUrl(url: String): Boolean {
    val uri = Uri.parse(url)
    val scheme = uri.scheme?.lowercase() ?: return true
    if (scheme == "http" || scheme == "https" || scheme == "blob" || scheme == "data") return false
    return try {
      startActivity(Intent(Intent.ACTION_VIEW, uri))
      true
    } catch (_: Exception) {
      true
    }
  }

  private fun startDownload(url: String, userAgent: String, contentDisposition: String, mimeType: String) {
    if (url.startsWith("blob:")) return
    val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
    val request = DownloadManager.Request(Uri.parse(url)).apply {
      setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
      setMimeType(mimeType)
      addRequestHeader("User-Agent", userAgent)
      CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
    }
    getSystemService(DownloadManager::class.java).enqueue(request)
    Toast.makeText(this, getString(R.string.download_started, name), Toast.LENGTH_SHORT).show()
  }

  private fun extractUris(data: Intent): Array<Uri>? {
    val clip = data.clipData
    if (clip != null && clip.itemCount > 0) {
      return Array(clip.itemCount) { clip.getItemAt(it).uri }
    }
    return data.data?.let { arrayOf(it) }
  }
}
