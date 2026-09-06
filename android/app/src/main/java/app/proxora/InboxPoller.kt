package app.proxora

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

object AppForeground {
  @Volatile
  var resumed: Boolean = false
}

object InboxPoller {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private const val INTERVAL_MS = 45_000L
  private lateinit var app: Context

  private val tick = object : Runnable {
    override fun run() {
      val ctx = app
      io.execute { poll(ctx, notify = !AppForeground.resumed) }
      main.postDelayed(this, INTERVAL_MS)
    }
  }

  fun start(context: Context) {
    app = context.applicationContext
    InboxNotifier.ensureChannel(app)
    InboxWorker.schedule(app)
    main.removeCallbacks(tick)
    main.postDelayed(tick, 8_000)
  }

  fun poll(context: Context, notify: Boolean) {
    val app = context.applicationContext
    val server = Prefs.serverUrl(app) ?: return
    val cookie = Prefs.cookieHeader(app, server)
      ?: CookieManager.getInstance().getCookie(server)
      ?: return
    val events = try {
      fetchInbox(server, cookie, Prefs.allowInsecureTls(app))
    } catch (_: Exception) {
      return
    }
    val plan = InboxDiff.plan(events, Prefs.inboxSeenId(app))
    Prefs.setInboxSeenId(app, plan.lastSeenId)
    if (!notify) return
    if (plan.items.isEmpty() && plan.overflow > 0) {
      InboxNotifier.showOverflow(app, plan.overflow)
      return
    }
    for (event in plan.items) InboxNotifier.show(app, event)
  }

  private fun fetchInbox(server: String, cookie: String, insecure: Boolean): List<InboxEvent> {
    val endpoint = URL(server.trimEnd('/') + "/api/inbox")
    val conn = open(endpoint, insecure)
    try {
      conn.requestMethod = "GET"
      conn.connectTimeout = 12_000
      conn.readTimeout = 12_000
      conn.useCaches = false
      conn.setRequestProperty("Accept", "application/json")
      conn.setRequestProperty("Cookie", cookie)
      conn.setRequestProperty("User-Agent", "Mozilla/5.0 ${ProxoraWeb.UA_TOKEN}")
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      if (code !in 200..299) return emptyList()
      return parseEvents(body)
    } finally {
      conn.disconnect()
    }
  }

  internal fun parseEvents(body: String): List<InboxEvent> {
    val root = JSONObject(body)
    val array = root.optJSONArray("events") ?: return emptyList()
    val out = ArrayList<InboxEvent>(array.length())
    for (i in 0 until array.length()) {
      val row = array.optJSONObject(i) ?: continue
      val id = row.optString("id")
      if (id.isBlank()) continue
      out.add(
        InboxEvent(
          id = id,
          title = row.optString("title"),
          message = row.optString("message"),
          href = row.optString("href").takeIf { it.isNotBlank() && it != "null" },
          read = !row.isNull("readAt") && row.optString("readAt").isNotBlank(),
        ),
      )
    }
    return out
  }

  private fun open(url: URL, insecure: Boolean): HttpURLConnection {
    val conn = url.openConnection() as HttpURLConnection
    if (insecure && conn is HttpsURLConnection) {
      val trust = arrayOf(object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      })
      val ctx = SSLContext.getInstance("TLS")
      ctx.init(null, trust, SecureRandom())
      conn.sslSocketFactory = ctx.socketFactory
      conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
    }
    return conn
  }
}
