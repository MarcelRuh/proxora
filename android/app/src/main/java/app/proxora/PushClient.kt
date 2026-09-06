package app.proxora

import android.content.Context
import org.json.JSONObject

object AppForeground {
  @Volatile
  var resumed: Boolean = false
}

object PushClient {
  fun start(context: Context) {
    InboxNotifier.ensureChannel(context.applicationContext)
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
}
