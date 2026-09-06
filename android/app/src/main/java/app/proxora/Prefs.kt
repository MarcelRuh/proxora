package app.proxora

import android.content.Context
import android.net.Uri

object Prefs {
  private const val FILE = "proxora"
  private const val KEY_URL = "server_url"
  private const val KEY_INSECURE = "allow_insecure_tls"
  private const val KEY_COOKIES = "origin_cookies"
  private const val KEY_COOKIES_URL = "origin_cookies_url"
  private const val KEY_LAST_URL = "last_page_url"

  private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun serverUrl(context: Context): String? =
    prefs(context).getString(KEY_URL, null)?.takeIf { it.isNotBlank() }

  fun allowInsecureTls(context: Context): Boolean =
    prefs(context).getBoolean(KEY_INSECURE, false)

  fun save(context: Context, url: String, allowInsecureTls: Boolean) {
    val previous = serverUrl(context)
    val editor = prefs(context).edit()
      .putString(KEY_URL, url)
      .putBoolean(KEY_INSECURE, allowInsecureTls)
    if (previous != url) {
      editor.remove(KEY_COOKIES).remove(KEY_COOKIES_URL).remove(KEY_LAST_URL)
    }
    editor.commit()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().commit()
  }

  fun saveCookies(context: Context, url: String, header: String) {
    if (header.isBlank()) return
    prefs(context).edit()
      .putString(KEY_COOKIES, header)
      .putString(KEY_COOKIES_URL, url)
      .commit()
  }

  fun cookieHeader(context: Context, url: String): String? {
    val stored = prefs(context)
    if (stored.getString(KEY_COOKIES_URL, null) != url) return null
    return stored.getString(KEY_COOKIES, null)?.takeIf { it.isNotBlank() }
  }

  fun clearCookies(context: Context) {
    prefs(context).edit().remove(KEY_COOKIES).remove(KEY_COOKIES_URL).commit()
  }

  fun lastPageUrl(context: Context, server: String): String? {
    val page = prefs(context).getString(KEY_LAST_URL, null) ?: return null
    return persistablePageUrl(server, page)
  }

  fun saveLastPageUrl(context: Context, server: String, page: String) {
    val persistable = persistablePageUrl(server, page) ?: return
    prefs(context).edit().putString(KEY_LAST_URL, persistable).commit()
  }
}

fun pageBelongsToServer(server: String, page: String): Boolean {
  if (page == server) return true
  return page.startsWith("$server/") || page.startsWith("$server?") || page.startsWith("$server#")
}

fun persistablePageUrl(server: String, page: String): String? {
  if (!page.startsWith("http://") && !page.startsWith("https://")) return null
  if (!pageBelongsToServer(server, page)) return null
  val path = Uri.parse(page).path.orEmpty()
  if (path == "/login" || path.startsWith("/login/")) return null
  return page
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
