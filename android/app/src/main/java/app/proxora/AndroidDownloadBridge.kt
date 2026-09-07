package app.proxora

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

class AndroidDownloadBridge(context: Context) {
  private val app = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val jobs = ConcurrentHashMap<String, Job>()

  private data class Job(val file: File, val name: String, val mime: String)

  @JavascriptInterface
  fun beginDownload(id: String, filename: String, mime: String) {
    abortDownload(id)
    val safeId = sanitizeId(id)
    val tmp = File(app.cacheDir, "proxora-dl-$safeId")
    if (tmp.exists()) tmp.delete()
    tmp.createNewFile()
    jobs[safeId] = Job(tmp, sanitizeName(filename), mime.ifBlank { "application/octet-stream" })
  }

  @JavascriptInterface
  fun appendDownload(id: String, base64Chunk: String) {
    val job = jobs[sanitizeId(id)] ?: return
    val bytes = try {
      Base64.decode(base64Chunk, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      abortDownload(id)
      toast(app.getString(R.string.download_failed))
      return
    }
    job.file.appendBytes(bytes)
  }

  @JavascriptInterface
  fun finishDownload(id: String) {
    val key = sanitizeId(id)
    val job = jobs.remove(key) ?: return
    try {
      publish(job)
      toast(app.getString(R.string.download_started, job.name))
    } catch (_: Exception) {
      toast(app.getString(R.string.download_failed))
    } finally {
      job.file.delete()
    }
  }

  @JavascriptInterface
  fun abortDownload(id: String) {
    jobs.remove(sanitizeId(id))?.file?.delete()
  }

  @JavascriptInterface
  fun setCookieMaxAge(seconds: Int) {
    Prefs.saveCookieMaxAge(app, seconds)
  }

  @Suppress("DEPRECATION")
  private fun publish(job: Job) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, job.name)
        put(MediaStore.Downloads.MIME_TYPE, job.mime)
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val uri = app.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IOException("insert")
      app.contentResolver.openOutputStream(uri)?.use { out ->
        job.file.inputStream().use { it.copyTo(out) }
      } ?: throw IOException("open")
      values.clear()
      values.put(MediaStore.Downloads.IS_PENDING, 0)
      app.contentResolver.update(uri, values, null, null)
      return
    }
    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (!dir.exists() && !dir.mkdirs()) throw IOException("downloads")
    val dest = uniqueFile(dir, job.name)
    job.file.copyTo(dest, overwrite = false)
    MediaScannerConnection.scanFile(app, arrayOf(dest.absolutePath), arrayOf(job.mime), null)
  }

  private fun toast(message: String) {
    main.post { Toast.makeText(app, message, Toast.LENGTH_SHORT).show() }
  }

  companion object {
    fun sanitizeId(id: String): String =
      id.replace(Regex("[^A-Za-z0-9_-]"), "").take(80).ifEmpty { "dl" }

    fun sanitizeName(filename: String): String {
      val base = filename.substringAfterLast('/').substringAfterLast('\\').trim()
      val cleaned = base.replace(Regex("[\\x00-\\x1f]"), "_").take(180)
      return cleaned.ifBlank { "download" }
    }

    fun uniqueFile(dir: File, name: String): File {
      val dot = name.lastIndexOf('.')
      val stem = if (dot > 0) name.substring(0, dot) else name
      val ext = if (dot > 0) name.substring(dot) else ""
      var candidate = File(dir, name)
      var i = 1
      while (candidate.exists()) {
        candidate = File(dir, "$stem ($i)$ext")
        i++
      }
      return candidate
    }
  }
}
