package app.proxora

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class PushKeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(ID, notification)
    }
    PushClient.start(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.notify_keepalive_channel),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.notify_keepalive_desc)
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val open = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val pending = PendingIntent.getActivity(
      this,
      ID,
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_proxora)
      .setContentTitle(getString(R.string.notify_keepalive_title))
      .setContentText(getString(R.string.notify_keepalive_body))
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(pending)
      .build()
  }

  companion object {
    const val ID = 0x50726F78
    const val CHANNEL_ID = "proxora_push"
  }
}

object PushKeepAlive {
  fun sync(context: Context) {
    val app = context.applicationContext
    val intent = Intent(app, PushKeepAliveService::class.java)
    if (Prefs.serverUrl(app).isNullOrBlank()) {
      app.stopService(intent)
      return
    }
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(app, android.Manifest.permission.POST_NOTIFICATIONS) !=
      android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    if (!Prefs.pushEndpoint(app).isNullOrBlank()) {
      app.stopService(intent)
      return
    }
    ContextCompat.startForegroundService(app, intent)
  }
}
