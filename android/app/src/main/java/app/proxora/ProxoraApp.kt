package app.proxora

import android.app.Application

class ProxoraApp : Application() {
  override fun onCreate() {
    super.onCreate()
    instance = this
    PushClient.start(this)
  }

  companion object {
    lateinit var instance: ProxoraApp
      private set
  }
}
