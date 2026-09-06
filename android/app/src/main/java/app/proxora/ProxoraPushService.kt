package app.proxora

import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

class ProxoraPushService : PushService() {
  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    PushRegistrar.onNewEndpoint(this, endpoint)
  }

  override fun onMessage(message: PushMessage, instance: String) {
    val event = PushClient.parse(String(message.content, Charsets.UTF_8)) ?: return
    if (AppForeground.resumed) return
    InboxNotifier.show(this, event)
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    PushRegistrar.onLost(this)
  }

  override fun onUnregistered(instance: String) {
    PushRegistrar.onLost(this)
  }
}
