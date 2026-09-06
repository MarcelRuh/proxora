package app.proxora

import android.app.Dialog
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.view.Menu
import android.view.MenuItem
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import java.util.ArrayDeque

class MainActivity : AppCompatActivity() {
  private lateinit var webView: WebView
  private lateinit var progress: ProgressBar
  private var fileCallback: ValueCallback<Array<Uri>>? = null
  private val extraWindows = ArrayDeque<Dialog>()

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
    super.onCreate(savedInstanceState)
    if (Prefs.serverUrl(this).isNullOrBlank()) {
      setupLauncher.launch(Intent(this, SetupActivity::class.java))
    }

    val toolbar = Toolbar(this).apply {
      setBackgroundColor(getColor(R.color.proxora_bg))
      setTitleTextColor(getColor(R.color.proxora_fg))
      title = getString(R.string.app_name)
    }
    setSupportActionBar(toolbar)

    progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      isIndeterminate = false
      max = 100
      minimumHeight = (3 * resources.displayMetrics.density).toInt()
    }
    webView = WebView(this)
    ProxoraWeb.configure(webView)
    attachClients(webView)

    val content = FrameLayout(this).apply {
      addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      addView(
        progress,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (3 * resources.displayMetrics.density).toInt()),
      )
    }
    val root = androidx.appcompat.widget.LinearLayoutCompat(this).apply {
      orientation = androidx.appcompat.widget.LinearLayoutCompat.VERTICAL
      setBackgroundColor(getColor(R.color.proxora_bg))
      addView(toolbar, androidx.appcompat.widget.LinearLayoutCompat.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ))
      addView(
        content,
        androidx.appcompat.widget.LinearLayoutCompat.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          0,
          1f,
        ),
      )
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.updatePadding(top = bars.top)
      insets
    }
    setContentView(root)

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
  }

  override fun onCreateOptionsMenu(menu: Menu): Boolean {
    menuInflater.inflate(R.menu.main, menu)
    return true
  }

  override fun onOptionsItemSelected(item: MenuItem): Boolean {
    when (item.itemId) {
      R.id.action_reload -> {
        webView.reload()
        return true
      }
      R.id.action_server -> {
        setupLauncher.launch(Intent(this, SetupActivity::class.java))
        return true
      }
    }
    return super.onOptionsItemSelected(item)
  }

  override fun onDestroy() {
    while (extraWindows.isNotEmpty()) extraWindows.removeLast().dismiss()
    webView.destroy()
    super.onDestroy()
  }

  private fun loadServer(reset: Boolean) {
    val url = Prefs.serverUrl(this) ?: return
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
        progress.visibility = if (newProgress in 1..99) android.view.View.VISIBLE else android.view.View.GONE
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
