package app.proxora

import android.app.Application
import android.app.NotificationManager
import android.os.Build

class ProxoraApp : Application() {
  override fun onCreate() {
    super.onCreate()
    instance = this
    clearLegacyKeepAlive()
    PushClient.start(this)
  }

  private fun clearLegacyKeepAlive() {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    manager.cancel(LEGACY_KEEPALIVE_ID)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.deleteNotificationChannel(LEGACY_KEEPALIVE_CHANNEL)
    }
  }

  companion object {
    private const val LEGACY_KEEPALIVE_ID = 0x50726F78
    private const val LEGACY_KEEPALIVE_CHANNEL = "proxora_push"

    lateinit var instance: ProxoraApp
      private set
  }
}
