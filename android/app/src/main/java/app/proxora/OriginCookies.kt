package app.proxora

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

object OriginCookies {
  private val main = Handler(Looper.getMainLooper())

  fun snapshot(context: Context, url: String) {
    val header = CookieManager.getInstance().getCookie(url) ?: return
    Prefs.saveCookies(context, url, header)
    CookieManager.getInstance().flush()
  }

  fun clear(context: Context) {
    Prefs.clearCookies(context)
  }

  fun restore(context: Context, url: String, done: () -> Unit) {
    val manager = CookieManager.getInstance()
    manager.setAcceptCookie(true)
    val header = Prefs.cookieHeader(context, url)
    val pairs = header?.split(';')?.map { it.trim() }?.filter { '=' in it }.orEmpty()
    if (pairs.isEmpty()) {
      main.post(done)
      return
    }
    val suffix = buildString {
      append("; Path=/; Max-Age=604800")
      if (url.startsWith("https://", ignoreCase = true)) append("; Secure")
    }
    val left = AtomicInteger(pairs.size)
    val finished = AtomicBoolean(false)
    val complete = Runnable {
      if (!finished.compareAndSet(false, true)) return@Runnable
      manager.flush()
      done()
    }
    pairs.forEach { pair ->
      manager.setCookie(url, pair + suffix) {
        if (left.decrementAndGet() <= 0) main.post(complete)
      }
    }
    main.postDelayed(complete, 800)
  }
}
