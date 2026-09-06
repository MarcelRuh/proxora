package app.proxora

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

data class InboxEvent(
  val id: String,
  val title: String,
  val message: String,
  val href: String?,
)

object InboxNotifier {
  const val CHANNEL_ID = "proxora_inbox"
  const val ACTION_OPEN = "app.proxora.OPEN"
  const val EXTRA_PATH = "open_path"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.notify_channel),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = context.getString(R.string.notify_channel_desc)
      enableVibration(true)
    }
    manager.createNotificationChannel(channel)
  }

  fun show(context: Context, event: InboxEvent) {
    post(
      context,
      event.id.hashCode(),
      event.title.ifBlank { context.getString(R.string.app_name) },
      event.message,
      event.href,
    )
  }

  fun showOverflow(context: Context, count: Int) {
    post(
      context,
      "overflow".hashCode(),
      context.getString(R.string.app_name),
      context.getString(R.string.notify_overflow, count),
      null,
    )
  }

  private fun post(context: Context, id: Int, title: String, text: String, path: String?) {
    ensureChannel(context)
    val open = Intent(context, MainActivity::class.java).apply {
      action = ACTION_OPEN
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      if (!path.isNullOrBlank()) putExtra(EXTRA_PATH, path)
    }
    val pending = PendingIntent.getActivity(
      context,
      id,
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_proxora)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setContentIntent(pending)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
      /* POST_NOTIFICATIONS denied */
    }
  }
}
