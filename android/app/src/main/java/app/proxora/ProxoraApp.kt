package app.proxora

import android.app.Application
import android.app.NotificationManager
import android.os.Build

class ProxoraApp : Application() {
  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java) ?: return
    manager.cancelAll()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.deleteNotificationChannel("proxora_push")
      manager.deleteNotificationChannel("proxora_inbox")
    }
  }
}
