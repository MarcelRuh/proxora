package app.proxora

import android.app.Dialog
import android.app.DownloadManager
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.LinearLayoutCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import java.util.ArrayDeque

class MainActivity : AppCompatActivity() {
  private lateinit var webView: WebView
  private lateinit var progress: ProgressBar
  private lateinit var errorPanel: FrameLayout
  private lateinit var errorTitle: TextView
  private lateinit var errorBody: TextView
  private var showingError = false
  private var pendingReload = false
  private var restoreBundle: Bundle? = null
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
    val url = Prefs.serverUrl(this)
    if (url.isNullOrBlank()) finish()
    else if (url != loadedServer) loadServer(clearSessionIfChanged = true)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    val barColor = 0xFF0A0A0F.toInt()
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(barColor),
      navigationBarStyle = SystemBarStyle.dark(barColor),
    )
    super.onCreate(savedInstanceState)
    restoreBundle = savedInstanceState
    if (Prefs.serverUrl(this).isNullOrBlank()) {
      setupLauncher.launch(Intent(this, SetupActivity::class.java))
    }

    progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      isIndeterminate = false
      max = 100
      minimumHeight = dp(3)
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
    errorPanel = buildErrorPanel()

    val statusSpacer = View(this).apply {
      setBackgroundColor(getColor(R.color.proxora_bg))
    }
    val content = FrameLayout(this).apply {
      clipToPadding = true
      clipChildren = true
      addView(
        webView,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
      )
      addView(
        progress,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)),
      )
      addView(
        errorPanel,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
      )
    }
    val root = LinearLayoutCompat(this).apply {
      orientation = LinearLayoutCompat.VERTICAL
      setBackgroundColor(getColor(R.color.proxora_bg))
      addView(
        statusSpacer,
        LinearLayoutCompat.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, statusBarFallbackPx()),
      )
      addView(
        content,
        LinearLayoutCompat.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
      )
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val top = maxOf(
        insets.getInsets(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()).top,
        statusBarFallbackPx(),
      )
      statusSpacer.layoutParams = LinearLayoutCompat.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, top)
      val sides = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.ime()).bottom
      view.updatePadding(left = sides.left, right = sides.right, bottom = bottom)
      WindowInsetsCompat.CONSUMED
    }
    setContentView(root)
    applySystemBars()
    ViewCompat.requestApplyInsets(root)

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

    if (!Prefs.serverUrl(this).isNullOrBlank()) loadServer(clearSessionIfChanged = false)
    if (savedInstanceState == null) handleShortcut(intent)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    webView.saveState(outState)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleShortcut(intent)
  }

  override fun onResume() {
    super.onResume()
    val server = Prefs.serverUrl(this)
    if (!server.isNullOrBlank() && server != loadedServer) loadServer(clearSessionIfChanged = true)
  }

  override fun onPause() {
    snapshotSession()
    super.onPause()
  }

  override fun onStop() {
    snapshotSession()
    super.onStop()
  }

  override fun onDestroy() {
    snapshotSession()
    while (extraWindows.isNotEmpty()) extraWindows.removeLast().dismiss()
    webView.destroy()
    super.onDestroy()
  }

  private fun applySystemBars() {
    WindowCompat.getInsetsController(window, window.decorView).apply {
      show(WindowInsetsCompat.Type.statusBars())
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
  }

  private fun statusBarFallbackPx(): Int {
    val id = resources.getIdentifier("status_bar_height", "dimen", "android")
    if (id > 0) return resources.getDimensionPixelSize(id)
    return dp(24)
  }

  private fun buildErrorPanel(): FrameLayout {
    errorTitle = TextView(this).apply {
      setTextColor(getColor(R.color.proxora_fg))
      textSize = 22f
    }
    errorBody = TextView(this).apply {
      setTextColor(getColor(R.color.proxora_muted))
      setPadding(0, dp(10), 0, dp(22))
    }
    val retry = proxoraFilledButton(getString(R.string.error_retry)) { retryLoad() }
    val change = proxoraOutlinedButton(getString(R.string.menu_server)) {
      setupLauncher.launch(Intent(this, SetupActivity::class.java))
    }
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundResource(R.drawable.quick_actions_card)
      setPadding(dp(20), dp(20), dp(20), dp(20))
      addView(errorTitle)
      addView(errorBody)
      addView(retry, buttonRowParams())
      addView(change, buttonRowParams(dp(12)))
    }
    return FrameLayout(this).apply {
      visibility = View.GONE
      setBackgroundColor(getColor(R.color.proxora_bg))
      addView(
        card,
        FrameLayout.LayoutParams(proxoraCardWidth(), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER),
      )
    }
  }

  private fun showError(title: String, body: String) {
    showingError = true
    errorTitle.text = title
    errorBody.text = body
    errorPanel.visibility = View.VISIBLE
    progress.visibility = View.GONE
  }

  private fun hideError() {
    showingError = false
    errorPanel.visibility = View.GONE
  }

  private fun retryLoad() {
    val url = Prefs.serverUrl(this) ?: return
    hideError()
    val current = webView.url
    if (current.isNullOrBlank() || current == "about:blank") webView.loadUrl(url)
    else webView.reload()
  }

  private fun handleShortcut(intent: Intent?) {
    if (intent?.action != ACTION_RELOAD) return
    if (webView.url.isNullOrBlank()) {
      pendingReload = true
      return
    }
    reloadPage()
  }

  private fun reloadPage() {
    hideError()
    webView.reload()
  }

  private fun showQuickActions() {
    val dialog = androidx.appcompat.app.AppCompatDialog(this, R.style.Theme_Proxora)
    val reload = proxoraFilledButton(getString(R.string.menu_reload)) {
      dialog.dismiss()
      reloadPage()
    }
    val change = proxoraOutlinedButton(getString(R.string.menu_server)) {
      dialog.dismiss()
      setupLauncher.launch(Intent(this, SetupActivity::class.java))
    }
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundResource(R.drawable.quick_actions_card)
      setPadding(dp(20), dp(20), dp(20), dp(20))
      addView(reload, buttonRowParams())
      addView(change, buttonRowParams(dp(12)))
    }
    val scrim = FrameLayout(this).apply {
      setBackgroundColor(0x99000000.toInt())
      setOnClickListener { dialog.dismiss() }
      addView(
        card,
        FrameLayout.LayoutParams(proxoraCardWidth(), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER),
      )
    }
    card.isClickable = true
    dialog.setContentView(
      scrim,
      ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
    )
    dialog.window?.apply {
      setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      setDimAmount(0.6f)
      setGravity(Gravity.CENTER)
    }
    dialog.show()
  }

  private fun snapshotSession() {
    val url = Prefs.serverUrl(this) ?: return
    OriginCookies.snapshot(this, url)
    webView.url?.let { Prefs.saveLastPageUrl(this, url, it) }
  }

  private fun loadServer(clearSessionIfChanged: Boolean) {
    val url = Prefs.serverUrl(this) ?: return
    val previous = loadedServer
    loadedServer = url
    if (clearSessionIfChanged && previous != null && previous != url) {
      OriginCookies.clear(this)
      CookieManager.getInstance().removeAllCookies(null)
      CookieManager.getInstance().flush()
      webView.clearCache(true)
      webView.clearHistory()
    }
    hideError()
    val bundle = restoreBundle
    restoreBundle = null
    OriginCookies.restore(this, url) {
      val restored = bundle?.let { webView.restoreState(it) }
      if (restored == null || restored.size == 0) {
        webView.loadUrl(Prefs.lastPageUrl(this, url) ?: url)
      }
    }
  }

  private fun attachClients(view: WebView) {
    view.webViewClient = object : WebViewClient() {
      @Suppress("OVERRIDE_DEPRECATION")
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleUrl(url)

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        handleUrl(request.url.toString())

      override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        if (view === webView) hideError()
      }

      override fun onPageFinished(view: WebView, url: String?) {
        if (view !== webView) return
        snapshotSession()
        if (pendingReload && !webView.url.isNullOrBlank()) {
          pendingReload = false
          webView.reload()
        }
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (view !== webView || !request.isForMainFrame) return
        showError(getString(R.string.error_title), getString(R.string.error_body))
      }

      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
        if (Prefs.allowInsecureTls(this@MainActivity)) {
          handler.proceed()
        } else {
          handler.cancel()
          if (view === webView) {
            showError(getString(R.string.error_ssl_title), getString(R.string.ssl_blocked))
          } else {
            Toast.makeText(this@MainActivity, R.string.ssl_blocked, Toast.LENGTH_LONG).show()
          }
        }
      }
    }
    view.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) {
        progress.progress = newProgress
        progress.visibility = if (!showingError && newProgress in 1..99) View.VISIBLE else View.GONE
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
    if (url.startsWith("blob:") || url.startsWith("data:")) return
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
