package app.proxora

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import java.util.concurrent.Executors

object PushRegistrar {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  fun hasDistributor(context: Context): Boolean {
    val distributors = try {
      UnifiedPush.getDistributors(context)
    } catch (_: Exception) {
      emptyList()
    }
    val saved = try {
      UnifiedPush.getAckDistributor(context)
    } catch (_: Exception) {
      null
    }
    return saved?.isNotBlank() == true || distributors.isNotEmpty()
  }

  fun register(activity: Activity) {
    io.execute {
      val vapid = vapidKey(activity) ?: return@execute
      main.post { registerOnMain(activity, vapid) }
    }
  }

  fun unregister(context: Context) {
    try {
      UnifiedPush.unregister(context)
    } catch (_: Exception) {
      /* distributor missing */
    }
    Prefs.setPushEndpoint(context, null)
  }

  fun onNewEndpoint(context: Context, endpoint: PushEndpoint) {
    val keys = endpoint.pubKeySet ?: return
    io.execute {
      val app = context.applicationContext
      val server = Prefs.serverUrl(app) ?: return@execute
      val cookie = CookieManager.getInstance().getCookie(server) ?: Prefs.cookieHeader(app, server) ?: return@execute
      val ok = try {
        PushApi.subscribe(server, cookie, Prefs.allowInsecureTls(app), endpoint.url, keys.pubKey, keys.auth)
      } catch (_: Exception) {
        false
      }
      if (!ok) return@execute
      Prefs.setPushEndpoint(app, endpoint.url)
    }
  }

  fun onLost(context: Context) {
    Prefs.setPushEndpoint(context, null)
  }

  private fun registerOnMain(activity: Activity, vapid: String) {
    if (!hasDistributor(activity)) return
    try {
      UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { success ->
        if (!success) return@tryUseCurrentOrDefaultDistributor
        try {
          UnifiedPush.register(activity, messageForDistributor = "Proxora", vapid = vapid)
        } catch (_: Exception) {
          /* invalid vapid / no distributor */
        }
      }
    } catch (_: Exception) {
      /* no distributor activity */
    }
  }

  private fun vapidKey(context: Context): String? {
    val server = Prefs.serverUrl(context) ?: return null
    val cookie = CookieManager.getInstance().getCookie(server) ?: Prefs.cookieHeader(context, server) ?: return null
    return try {
      PushApi.vapidPublicKey(server, cookie, Prefs.allowInsecureTls(context))
    } catch (_: Exception) {
      null
    }
  }
}
