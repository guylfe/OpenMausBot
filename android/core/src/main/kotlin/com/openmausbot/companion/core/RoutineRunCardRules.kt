package com.openmausbot.companion.core

/**
 * How a routine card decides its label, its detail, and whether "Open run"
 * has a live execution task to open. Pure so both the transcript and the
 * roster can share it, and so a JVM test can pin it without a device.
 *
 * Task lists are the caller's. Pass every task, including ones tagged
 * `routineRunId` — those are hidden from pickers and still openable.
 */
object RoutineRunCardRules {
    const val DETAIL_LIMIT = 280

    /** One bot and the thread ids of its tasks, hidden executions included. */
    data class BotTasks(val id: String, val taskThreadIds: List<String>)

    /** Every task thread, including `routineRunId` executions pickers hide. */
    fun taskLists(bots: List<Bot>): List<BotTasks> = bots.map { bot ->
        BotTasks(bot.id, bot.tasks.orEmpty().map { it.threadId })
    }

    fun statusLabel(status: String, goalStatus: String?, deferredAt: Double?): String {
        val goal = goalStatus?.takeIf { it.isNotEmpty() }?.let(::goalLabel)
        if (goal != null) return goal
        return when {
            status == "queued" && deferredAt != null -> "Deferred: target busy"
            status == "queued" -> "Queued"
            status == "running" -> "Running"
            status == "waiting" -> "Waiting"
            status == "completed" -> "Completed"
            status == "failed" -> "Failed"
            status == "cancelled" -> "Cancelled"
            status == "missed" -> "Missed"
            else -> status
        }
    }

    fun detail(run: RoutineRunCard): String? = detail(run.status, run.summary, run.error)

    /**
     * Failed and missed runs prefer a non-empty error. Everything else prefers
     * the summary, then the error. Empty strings are absent.
     */
    fun detail(status: String, summary: String?, error: String?): String? {
        val errorText = error?.takeIf { it.isNotEmpty() }
        val summaryText = summary?.takeIf { it.isNotEmpty() }
        if ((status == "failed" || status == "missed") && errorText != null) return errorText
        return summaryText ?: errorText
    }

    fun detailOverflows(text: String): Boolean = text.length > DETAIL_LIMIT

    /** Collapsed form of a detail past [DETAIL_LIMIT]. The full string is not rewritten. */
    fun detailPreview(text: String): String {
        if (text.length <= DETAIL_LIMIT) return text
        return text.take(DETAIL_LIMIT - 1).trimEnd() + "…"
    }

    fun actionLabel(goalStatus: String?): String =
        if (goalStatus == "needs-input") "Review" else "Open run"

    fun rosterLine(run: RoutineRunCard): String =
        "${run.routineName}: ${statusLabel(run.status, run.goalStatus, run.deferredAt)}"

    /** Roster text for this kind: the card line when the payload is present, otherwise the message text. */
    fun previewLine(message: Message): String {
        val run = message.routineRun ?: return message.text.orEmpty()
        return rosterLine(run)
    }

    /**
     * The thread to open, or null when the button should not exist.
     *
     * The execution id has to be non-empty, different from the thread already
     * on screen, and present on some bot's task list. The bot id prefers the
     * message sender when that bot owns the task, then the chat's bot, then
     * whichever bot actually has the task — a room has no chat bot.
     */
    fun openTarget(
        executionThreadId: String?,
        routineName: String,
        currentThreadId: String,
        fromBotId: String?,
        chatBotId: String?,
        bots: List<BotTasks>,
    ): ThreadRef? {
        val threadId = executionThreadId?.takeIf { it.isNotEmpty() } ?: return null
        if (threadId == currentThreadId) return null
        fun owns(botId: String): Boolean = bots.any { it.id == botId && threadId in it.taskThreadIds }
        val botId = when {
            fromBotId != null && owns(fromBotId) -> fromBotId
            chatBotId != null && owns(chatBotId) -> chatBotId
            else -> bots.firstOrNull { threadId in it.taskThreadIds }?.id
        } ?: return null
        return ThreadRef(botId, threadId, routineName)
    }

    private fun goalLabel(goalStatus: String): String? = when (goalStatus) {
        "completed" -> "Completed"
        "needs-input" -> "Needs your input"
        "blocked" -> "Blocked"
        "limit-reached" -> "Turn limit reached"
        "paused" -> "Paused"
        "stopped" -> "Stopped"
        "failed" -> "Failed"
        else -> null
    }
}
