package app.proxora

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object AndroidUpdateChecker {
  private const val REPO = "MarcelRuh/proxora"
  private val io = Executors.newSingleThreadExecutor()

  data class ReleaseApk(
    val version: String,
    val name: String,
    val url: String,
  )

  fun check(
    context: Context,
    onResult: (ReleaseApk?) -> Unit,
    onError: (String) -> Unit,
  ) {
    val app = context.applicationContext
    io.execute {
      try {
        val apk = fetchLatestApk()
        val current = BuildConfig.VERSION_NAME
        val update =
          if (apk != null && compareSemver(apk.version, current) > 0) apk else null
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          onResult(update)
        }
      } catch (error: Exception) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          onError(error.message ?: "update check failed")
        }
      }
    }
  }

  fun downloadApk(context: Context, apk: ReleaseApk): Long {
    val request = DownloadManager.Request(Uri.parse(apk.url)).apply {
      setTitle(apk.name)
      setDescription("Proxora ${apk.version}")
      setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, apk.name)
      setMimeType("application/vnd.android.package-archive")
    }
    val id = context.getSystemService(DownloadManager::class.java).enqueue(request)
    Toast.makeText(context, context.getString(R.string.download_started, apk.name), Toast.LENGTH_SHORT).show()
    return id
  }

  private fun fetchLatestApk(): ReleaseApk? {
    val url = URL("https://api.github.com/repos/$REPO/releases/latest")
    val conn = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = 12_000
      readTimeout = 12_000
      setRequestProperty("Accept", "application/vnd.github+json")
      setRequestProperty("User-Agent", "Proxora-Android/${BuildConfig.VERSION_NAME}")
    }
    try {
      if (conn.responseCode !in 200..299) {
        throw IllegalStateException("GitHub HTTP ${conn.responseCode}")
      }
      val body = conn.inputStream.bufferedReader().use { it.readText() }
      val json = JSONObject(body)
      if (json.optBoolean("draft", false) || json.optBoolean("prerelease", false)) return null
      val tag = json.optString("tag_name", "").trim().removePrefix("v")
      if (tag.isEmpty()) return null
      val assets = json.optJSONArray("assets") ?: return null
      for (i in 0 until assets.length()) {
        val asset = assets.optJSONObject(i) ?: continue
        val name = asset.optString("name", "")
        if (!name.endsWith(".apk", ignoreCase = true)) continue
        val download = asset.optString("browser_download_url", "")
        if (download.isBlank()) continue
        return ReleaseApk(version = tag, name = name, url = download)
      }
      return null
    } finally {
      conn.disconnect()
    }
  }

  /** Positive if a > b. */
  fun compareSemver(a: String, b: String): Int {
    fun parts(v: String): List<Int> =
      v.trim().removePrefix("v").split(Regex("[-+]"))[0]
        .split('.')
        .map { it.toIntOrNull() ?: 0 }
        .let { if (it.size >= 3) it.take(3) else it + List(3 - it.size) { 0 } }
    val pa = parts(a)
    val pb = parts(b)
    for (i in 0 until 3) {
      val diff = pa[i] - pb[i]
      if (diff != 0) return diff
    }
    return 0
  }
}
