package com.openmausbot.companion.core

import kotlinx.serialization.decodeFromString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoutineRunCardRulesTest {
    private fun run(
        status: String,
        summary: String? = null,
        error: String? = null,
        goalStatus: String? = null,
        deferredAt: Double? = null,
        executionThreadId: String? = "exec-1",
        name: String = "Morning brief",
    ) = RoutineRunCard(
        runId = "run-1",
        routineId = "routine-1",
        routineName = name,
        status = status,
        summary = summary,
        error = error,
        goalStatus = goalStatus,
        deferredAt = deferredAt,
        executionThreadId = executionThreadId,
    )

    private fun message(card: RoutineRunCard? = null, text: String? = "ran") = Message(
        id = "m",
        role = Message.Role.BOT,
        kind = Message.Kind.ROUTINE_RUN,
        at = 1.0,
        text = text,
        routineRun = card,
    )

    @Test
    fun statusLabelsMatchTheDesktopCard() {
        assertEquals("Queued", RoutineRunCardRules.statusLabel("queued", null, null))
        assertEquals("Running", RoutineRunCardRules.statusLabel("running", null, null))
        assertEquals("Waiting", RoutineRunCardRules.statusLabel("waiting", null, null))
        assertEquals("Completed", RoutineRunCardRules.statusLabel("completed", null, null))
        assertEquals("Failed", RoutineRunCardRules.statusLabel("failed", null, null))
        assertEquals("Cancelled", RoutineRunCardRules.statusLabel("cancelled", null, null))
        assertEquals("Missed", RoutineRunCardRules.statusLabel("missed", null, null))
        assertEquals("Deferred: target busy", RoutineRunCardRules.statusLabel("queued", null, 1.0))
        assertEquals("Queued", RoutineRunCardRules.statusLabel("queued", null, null))
        assertEquals("Deferred: target busy", RoutineRunCardRules.statusLabel("queued", "", 0.0))
    }

    @Test
    fun goalStatusOverridesTheSchedulerStatus() {
        assertEquals("Completed", RoutineRunCardRules.statusLabel("running", "completed", 1.0))
        assertEquals("Needs your input", RoutineRunCardRules.statusLabel("queued", "needs-input", 1.0))
        assertEquals("Blocked", RoutineRunCardRules.statusLabel("completed", "blocked", null))
        assertEquals("Turn limit reached", RoutineRunCardRules.statusLabel("waiting", "limit-reached", null))
        assertEquals("Paused", RoutineRunCardRules.statusLabel("running", "paused", null))
        assertEquals("Stopped", RoutineRunCardRules.statusLabel("running", "stopped", null))
        assertEquals("Failed", RoutineRunCardRules.statusLabel("completed", "failed", null))
        assertEquals("Running", RoutineRunCardRules.statusLabel("running", "surprise", null))
    }

    @Test
    fun anUnknownStatusIsShownRaw() {
        assertEquals("not-a-status", RoutineRunCardRules.statusLabel("not-a-status", null, null))
        assertEquals("not-a-status", RoutineRunCardRules.statusLabel("not-a-status", null, 4.0))
    }

    @Test
    fun detailPrefersTheErrorOnlyForAFailedOrMissedRun() {
        assertEquals("Provider failed", RoutineRunCardRules.detail("failed", "summary", "Provider failed"))
        assertEquals("Computer was offline.", RoutineRunCardRules.detail("missed", "summary", "Computer was offline."))
        assertEquals("summary", RoutineRunCardRules.detail("failed", "summary", ""))
        assertEquals("summary", RoutineRunCardRules.detail("missed", "summary", null))
        assertEquals("only error", RoutineRunCardRules.detail("failed", null, "only error"))
        assertEquals("The brief is ready.", RoutineRunCardRules.detail("completed", "The brief is ready.", "ignored"))
        assertEquals("fallback error", RoutineRunCardRules.detail("waiting", null, "fallback error"))
        assertEquals("fallback error", RoutineRunCardRules.detail("completed", "", "fallback error"))
        assertNull(RoutineRunCardRules.detail("completed", null, null))
        assertNull(RoutineRunCardRules.detail("failed", "", ""))
    }

    @Test
    fun aLongDetailTruncatesThePreviewAndKeepsTheWholeString() {
        val body = "A".repeat(279) + "\n" + "B".repeat(20)
        assertEquals(300, body.length)
        assertFalse(RoutineRunCardRules.detailOverflows("A".repeat(280)))
        assertEquals("A".repeat(280), RoutineRunCardRules.detailPreview("A".repeat(280)))
        assertTrue(RoutineRunCardRules.detailOverflows(body))
        val preview = RoutineRunCardRules.detailPreview(body)
        assertEquals("A".repeat(279) + "…", preview)
        assertFalse(preview.contains("\n"))
        assertEquals(body, RoutineRunCardRules.detail("completed", body, null))
    }

    @Test
    fun theActionIsReviewOnlyWhenTheGoalNeedsInput() {
        assertEquals("Review", RoutineRunCardRules.actionLabel("needs-input"))
        assertEquals("Open run", RoutineRunCardRules.actionLabel("blocked"))
        assertEquals("Open run", RoutineRunCardRules.actionLabel(null))
        assertEquals("Open run", RoutineRunCardRules.actionLabel(""))
    }

    @Test
    fun theButtonRequiresALiveTaskThatIsNotAlreadyOnScreen() {
        val hidden = RoutineRunCardRules.BotTasks("scout", listOf("source", "exec-1"))
        val other = RoutineRunCardRules.BotTasks("quill", listOf("exec-2"))
        val bots = listOf(hidden, other)

        assertNull(target(executionThreadId = null, bots = bots))
        assertNull(target(executionThreadId = "", bots = bots))
        assertNull(target(currentThreadId = "exec-1", bots = bots))
        assertNull(target(executionThreadId = "gone", bots = bots))

        val onHidden = target(fromBotId = "scout", chatBotId = "quill", bots = bots)
        assertEquals(ThreadRef("scout", "exec-1", "Morning brief"), onHidden)

        val chatOwnsIt = target(executionThreadId = "exec-2", fromBotId = "scout", chatBotId = "quill", bots = bots)
        assertEquals("quill", chatOwnsIt?.botId)

        val roomFindsTheOwner = target(executionThreadId = "exec-2", fromBotId = "nobody", chatBotId = null, bots = bots)
        assertEquals("quill", roomFindsTheOwner?.botId)

        val senderWinsWhenBothOwnIt = target(
            executionThreadId = "exec-1",
            fromBotId = "scout",
            chatBotId = "scout",
            bots = bots,
        )
        assertEquals("scout", senderWinsWhenBothOwnIt?.botId)
    }

    @Test
    fun aHiddenRoutineExecutionStillOpens() {
        val scout = CompanionJson.decodeFromString<Bot>(
            """{"id":"scout","threadId":"main","name":"Scout","title":"","description":"",
               "notifications":true,"color":"green","unread":false,
               "modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,
               "tasks":[{"threadId":"exec-1","title":"Hidden","createdAt":2,"routineRunId":"run-1"}]}""",
        )
        val opened = RoutineRunCardRules.openTarget(
            executionThreadId = "exec-1",
            routineName = "Morning brief",
            currentThreadId = "main",
            fromBotId = null,
            chatBotId = "scout",
            bots = RoutineRunCardRules.taskLists(listOf(scout)),
        )
        assertEquals(ThreadRef("scout", "exec-1", "Morning brief"), opened)
        assertNull(
            RoutineRunCardRules.openTarget(
                executionThreadId = "exec-1",
                routineName = "Morning brief",
                currentThreadId = "elsewhere",
                fromBotId = null,
                chatBotId = "scout",
                bots = RoutineRunCardRules.taskLists(listOf(scout.copy(tasks = emptyList()))),
            ),
        )
    }

    @Test
    fun rosterPreviewUsesTheStatusLabelAndIsNotAnActivityReceipt() {
        val failed = message(run("failed", summary = "nope", error = "Provider failed"))
        assertFalse(isActivityReceipt(failed))
        assertEquals("Morning brief: Failed", previewText(failed))
        assertEquals("Morning brief: Failed", rosterPreview(listOf(failed), ActivityDetail.HIDDEN))
        assertEquals(listOf("m"), transcriptRows(listOf(failed), ActivityDetail.HIDDEN).map { it.head.id })

        val deferred = message(run("queued", deferredAt = 5.0))
        assertEquals("Morning brief: Deferred: target busy", previewText(deferred))

        val needsInput = message(run("waiting", goalStatus = "needs-input"))
        assertEquals("Morning brief: Needs your input", previewText(needsInput))

        val bare = message(card = null, text = "ran")
        assertEquals("ran", previewText(bare))
    }

    private fun target(
        executionThreadId: String? = "exec-1",
        currentThreadId: String = "chat-thread",
        fromBotId: String? = null,
        chatBotId: String? = "scout",
        bots: List<RoutineRunCardRules.BotTasks>,
    ) = RoutineRunCardRules.openTarget(
        executionThreadId = executionThreadId,
        routineName = "Morning brief",
        currentThreadId = currentThreadId,
        fromBotId = fromBotId,
        chatBotId = chatBotId,
        bots = bots,
    )
}
