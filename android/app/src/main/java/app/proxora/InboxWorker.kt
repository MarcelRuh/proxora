package app.proxora

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class InboxWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    InboxPoller.poll(applicationContext, notify = !AppForeground.resumed)
    return Result.success()
  }

  companion object {
    private const val NAME = "proxora-inbox"

    fun schedule(context: Context) {
      val request = PeriodicWorkRequestBuilder<InboxWorker>(15, TimeUnit.MINUTES)
        .setConstraints(
          Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
        )
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        NAME,
        ExistingPeriodicWorkPolicy.KEEP,
        request,
      )
    }
  }
}
