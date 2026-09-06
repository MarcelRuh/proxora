package app.proxora

data class InboxEvent(
  val id: String,
  val title: String,
  val message: String,
  val href: String?,
  val read: Boolean,
)

data class InboxNotifyPlan(
  val lastSeenId: String?,
  val items: List<InboxEvent>,
  val overflow: Int,
)

object InboxDiff {
  private const val MAX_INDIVIDUAL = 5

  fun plan(eventsNewestFirst: List<InboxEvent>, lastSeenId: String?): InboxNotifyPlan {
    if (eventsNewestFirst.isEmpty()) return InboxNotifyPlan(lastSeenId, emptyList(), 0)
    val newestId = eventsNewestFirst.first().id
    if (lastSeenId.isNullOrBlank()) return InboxNotifyPlan(newestId, emptyList(), 0)
    val fresh = ArrayList<InboxEvent>()
    var found = false
    for (row in eventsNewestFirst) {
      if (row.id == lastSeenId) {
        found = true
        break
      }
      if (!row.read) fresh.add(row)
    }
    if (!found) return InboxNotifyPlan(newestId, emptyList(), fresh.size)
    if (fresh.isEmpty()) return InboxNotifyPlan(newestId, emptyList(), 0)
    return InboxNotifyPlan(
      newestId,
      fresh.take(MAX_INDIVIDUAL),
      (fresh.size - MAX_INDIVIDUAL).coerceAtLeast(0),
    )
  }
}
