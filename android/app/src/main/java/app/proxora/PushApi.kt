package app.proxora

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

object PushApi {
  fun vapidPublicKey(server: String, cookie: String, insecure: Boolean): String? {
    val req = Request.Builder()
      .url(server.trimEnd('/') + "/api/push/vapid")
      .header("Accept", "application/json")
      .header("Cookie", cookie)
      .header("User-Agent", "Mozilla/5.0 ${ProxoraWeb.UA_TOKEN}")
      .build()
    ProxoraHttp.jsonClient(insecure).newCall(req).execute().use { response ->
      if (!response.isSuccessful) return null
      val body = response.body?.string().orEmpty()
      val key = JSONObject(body).optString("publicKey")
      return key.takeIf { it.length >= 80 }
    }
  }

  fun subscribe(
    server: String,
    cookie: String,
    insecure: Boolean,
    endpoint: String,
    p256dh: String,
    auth: String,
  ): Boolean {
    val json = JSONObject()
      .put("endpoint", endpoint)
      .put("keys", JSONObject().put("p256dh", p256dh).put("auth", auth))
      .toString()
    val req = Request.Builder()
      .url(server.trimEnd('/') + "/api/push/subscribe")
      .header("Accept", "application/json")
      .header("Cookie", cookie)
      .header("User-Agent", "Mozilla/5.0 ${ProxoraWeb.UA_TOKEN}")
      .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
      .build()
    ProxoraHttp.jsonClient(insecure).newCall(req).execute().use { response ->
      return response.isSuccessful
    }
  }
}
