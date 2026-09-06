package app.proxora

import android.content.Context
import android.net.Uri

object Prefs {
  private const val FILE = "proxora"
  private const val KEY_URL = "server_url"
  private const val KEY_INSECURE = "allow_insecure_tls"

  fun serverUrl(context: Context): String? =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY_URL, null)?.takeIf { it.isNotBlank() }

  fun allowInsecureTls(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_INSECURE, false)

  fun save(context: Context, url: String, allowInsecureTls: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString(KEY_URL, url)
      .putBoolean(KEY_INSECURE, allowInsecureTls)
      .apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().clear().apply()
  }
}

object ServerUrl {
  fun normalize(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
    val uri = Uri.parse(withScheme)
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (!uri.userInfo.isNullOrEmpty()) return null
    val host = uri.host?.trim()?.trim('.') ?: return null
    if (host.isEmpty()) return null
    val port = if (uri.port != -1) ":${uri.port}" else ""
    val path = uri.encodedPath?.trimEnd('/') ?: ""
    return "$scheme://$host$port$path"
  }
}
