package app.proxora

import okhttp3.OkHttpClient
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

object ProxoraHttp {
  fun client(insecure: Boolean): OkHttpClient {
    val builder = OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.SECONDS)
      .writeTimeout(20, TimeUnit.SECONDS)
      .pingInterval(20, TimeUnit.SECONDS)
      if (!insecure) return builder.build()
    val trust = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(null, arrayOf(trust), SecureRandom())
    builder.sslSocketFactory(ctx.socketFactory, trust)
    builder.hostnameVerifier { _, _ -> true }
    return builder.build()
  }

  fun jsonClient(insecure: Boolean): OkHttpClient =
    client(insecure).newBuilder()
      .readTimeout(15, TimeUnit.SECONDS)
      .pingInterval(0, TimeUnit.SECONDS)
      .build()
}
