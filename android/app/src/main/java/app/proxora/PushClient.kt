package app.proxora

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

object AppForeground {
  @Volatile
  var resumed: Boolean = false
}

object PushClient {
  private val main = Handler(Looper.getMainLooper())
  private var socket: WebSocket? = null
  private var app: Context? = null
  private var delayMs = 1_000L
  @Volatile private var open = false

  fun start(context: Context) {
    app = context.applicationContext
    InboxNotifier.ensureChannel(app!!)
    connect()
  }

  fun restart() {
    delayMs = 1_000L
    connect()
  }

  fun onSessionReady() {
    if (open) return
    delayMs = 1_000L
    connect()
  }

  private fun connect() {
    val ctx = app ?: return
    main.removeCallbacksAndMessages(null)
    socket?.cancel()
    socket = null
    val server = Prefs.serverUrl(ctx) ?: return
    val cookie = CookieManager.getInstance().getCookie(server) ?: Prefs.cookieHeader(ctx, server)
    if (cookie.isNullOrBlank()) {
      scheduleReconnect()
      return
    }
    val url = websocketUrl(server) ?: return
    val request = Request.Builder()
      .url(url)
      .header("Cookie", cookie)
      .header("User-Agent", "Mozilla/5.0 ${ProxoraWeb.UA_TOKEN}")
      .build()
    socket = ProxoraHttp.client(Prefs.allowInsecureTls(ctx)).newWebSocket(
      request,
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          open = true
          delayMs = 1_000L
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          val event = parse(text) ?: return
          if (AppForeground.resumed) return
          InboxNotifier.show(ctx, event)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (webSocket !== socket) return
          open = false
          scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          if (webSocket !== socket) return
          open = false
          scheduleReconnect()
        }
      },
    )
  }

  private fun scheduleReconnect() {
    delayMs = (delayMs * 2).coerceAtMost(30_000L)
    main.postDelayed({ connect() }, delayMs)
  }

  internal fun parse(text: String): InboxEvent? {
    val row = try {
      JSONObject(text)
    } catch (_: Exception) {
      return null
    }
    if (row.optString("type") == "ping") return null
    val id = row.optString("id")
    if (id.isBlank()) return null
    val title = row.optString("title")
    val message = row.optString("message")
    if (title.isBlank() && message.isBlank()) return null
    val href = row.optString("href").takeIf { it.isNotBlank() && it != "null" }
    return InboxEvent(id, title.ifBlank { "Proxora" }, message, href)
  }

  private fun websocketUrl(server: String): String? {
    val trimmed = server.trimEnd('/')
    return when {
      trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}/ws/push"
      trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}/ws/push"
      else -> null
    }
  }
}
