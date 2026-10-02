import XCTest
@testable import CompanionCore

final class RoutineRunCardRulesTests: XCTestCase {
    private func run(
        status: String,
        summary: String? = nil,
        error: String? = nil,
        goalStatus: String? = nil,
        deferredAt: Double? = nil,
        executionThreadId: String? = "exec-1",
        name: String = "Morning brief"
    ) -> RoutineRunCard {
        RoutineRunCard(
            runId: "run-1",
            routineId: "routine-1",
            routineName: name,
            status: status,
            deferredAt: deferredAt,
            goalStatus: goalStatus,
            executionThreadId: executionThreadId,
            summary: summary,
            error: error
        )
    }

    private func message(card: RoutineRunCard? = nil, text: String? = "ran") -> Message {
        var message = Message(id: "m", role: .bot, kind: .routineRun, at: 1, text: text)
        message.routineRun = card
        return message
    }

    func testStatusLabelsMatchTheDesktopCard() {
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "queued", goalStatus: nil, deferredAt: nil), "Queued")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "running", goalStatus: nil, deferredAt: nil), "Running")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "waiting", goalStatus: nil, deferredAt: nil), "Waiting")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "completed", goalStatus: nil, deferredAt: nil), "Completed")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "failed", goalStatus: nil, deferredAt: nil), "Failed")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "cancelled", goalStatus: nil, deferredAt: nil), "Cancelled")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "missed", goalStatus: nil, deferredAt: nil), "Missed")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "queued", goalStatus: nil, deferredAt: 1), "Deferred: target busy")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "queued", goalStatus: "", deferredAt: 0), "Deferred: target busy")
    }

    func testGoalStatusOverridesTheSchedulerStatus() {
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "running", goalStatus: "completed", deferredAt: 1), "Completed")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "queued", goalStatus: "needs-input", deferredAt: 1), "Needs your input")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "completed", goalStatus: "blocked", deferredAt: nil), "Blocked")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "waiting", goalStatus: "limit-reached", deferredAt: nil), "Turn limit reached")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "running", goalStatus: "paused", deferredAt: nil), "Paused")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "running", goalStatus: "stopped", deferredAt: nil), "Stopped")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "completed", goalStatus: "failed", deferredAt: nil), "Failed")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "running", goalStatus: "surprise", deferredAt: nil), "Running")
    }

    func testAnUnknownStatusIsShownRaw() {
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "not-a-status", goalStatus: nil, deferredAt: nil), "not-a-status")
        XCTAssertEqual(RoutineRunCardRules.statusLabel(status: "not-a-status", goalStatus: nil, deferredAt: 4), "not-a-status")
    }

    func testDetailPrefersTheErrorOnlyForAFailedOrMissedRun() {
        XCTAssertEqual(RoutineRunCardRules.detail(status: "failed", summary: "summary", error: "Provider failed"), "Provider failed")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "missed", summary: "summary", error: "Computer was offline."), "Computer was offline.")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "failed", summary: "summary", error: ""), "summary")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "missed", summary: "summary", error: nil), "summary")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "failed", summary: nil, error: "only error"), "only error")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "completed", summary: "The brief is ready.", error: "ignored"), "The brief is ready.")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "waiting", summary: nil, error: "fallback error"), "fallback error")
        XCTAssertEqual(RoutineRunCardRules.detail(status: "completed", summary: "", error: "fallback error"), "fallback error")
        XCTAssertNil(RoutineRunCardRules.detail(status: "completed", summary: nil, error: nil))
        XCTAssertNil(RoutineRunCardRules.detail(status: "failed", summary: "", error: ""))
    }

    func testALongDetailTruncatesThePreviewAndKeepsTheWholeString() {
        let body = String(repeating: "A", count: 279) + "\n" + String(repeating: "B", count: 20)
        XCTAssertEqual(body.count, 300)
        XCTAssertFalse(RoutineRunCardRules.detailOverflows(String(repeating: "A", count: 280)))
        XCTAssertEqual(RoutineRunCardRules.detailPreview(String(repeating: "A", count: 280)), String(repeating: "A", count: 280))
        XCTAssertTrue(RoutineRunCardRules.detailOverflows(body))
        let preview = RoutineRunCardRules.detailPreview(body)
        XCTAssertEqual(preview, String(repeating: "A", count: 279) + "…")
        XCTAssertFalse(preview.contains("\n"))
        XCTAssertEqual(RoutineRunCardRules.detail(status: "completed", summary: body, error: nil), body)
    }

    func testTheActionIsReviewOnlyWhenTheGoalNeedsInput() {
        XCTAssertEqual(RoutineRunCardRules.actionLabel(goalStatus: "needs-input"), "Review")
        XCTAssertEqual(RoutineRunCardRules.actionLabel(goalStatus: "blocked"), "Open run")
        XCTAssertEqual(RoutineRunCardRules.actionLabel(goalStatus: nil), "Open run")
        XCTAssertEqual(RoutineRunCardRules.actionLabel(goalStatus: ""), "Open run")
    }

    func testTheButtonRequiresALiveTaskThatIsNotAlreadyOnScreen() {
        let hidden = RoutineRunCardRules.BotTasks(id: "scout", taskThreadIds: ["source", "exec-1"])
        let other = RoutineRunCardRules.BotTasks(id: "quill", taskThreadIds: ["exec-2"])
        let bots = [hidden, other]

        XCTAssertNil(target(executionThreadId: nil, bots: bots))
        XCTAssertNil(target(executionThreadId: "", bots: bots))
        XCTAssertNil(target(currentThreadId: "exec-1", bots: bots))
        XCTAssertNil(target(executionThreadId: "gone", bots: bots))

        let onHidden = target(fromBotId: "scout", chatBotId: "quill", bots: bots)
        XCTAssertEqual(onHidden, ThreadRef(botId: "scout", threadId: "exec-1", title: "Morning brief"))

        let chatOwnsIt = target(executionThreadId: "exec-2", fromBotId: "scout", chatBotId: "quill", bots: bots)
        XCTAssertEqual(chatOwnsIt?.botId, "quill")

        let roomFindsTheOwner = target(executionThreadId: "exec-2", fromBotId: "nobody", chatBotId: nil, bots: bots)
        XCTAssertEqual(roomFindsTheOwner?.botId, "quill")

        let senderWins = target(executionThreadId: "exec-1", fromBotId: "scout", chatBotId: "scout", bots: bots)
        XCTAssertEqual(senderWins?.botId, "scout")
    }

    func testAHiddenRoutineExecutionStillOpens() throws {
        let scout = try JSONDecoder().decode(Bot.self, from: Data("""
        {"id":"scout","threadId":"main","name":"Scout","title":"","description":"",
         "notifications":true,"color":"green","unread":false,
         "modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,
         "tasks":[{"threadId":"exec-1","title":"Hidden","createdAt":2,"routineRunId":"run-1"}]}
        """.utf8))
        let opened = RoutineRunCardRules.openTarget(
            executionThreadId: "exec-1",
            routineName: "Morning brief",
            currentThreadId: "main",
            fromBotId: nil,
            chatBotId: "scout",
            bots: RoutineRunCardRules.taskLists([scout])
        )
        XCTAssertEqual(opened, ThreadRef(botId: "scout", threadId: "exec-1", title: "Morning brief"))
        var gone = scout
        gone.tasks = []
        XCTAssertNil(RoutineRunCardRules.openTarget(
            executionThreadId: "exec-1",
            routineName: "Morning brief",
            currentThreadId: "elsewhere",
            fromBotId: nil,
            chatBotId: "scout",
            bots: RoutineRunCardRules.taskLists([gone])
        ))
    }

    func testRosterPreviewUsesTheStatusLabelAndIsNotAnActivityReceipt() {
        let failed = message(card: run(status: "failed", summary: "nope", error: "Provider failed"))
        XCTAssertFalse(isActivityReceipt(failed))
        XCTAssertEqual(previewText(of: failed), "Morning brief: Failed")
        XCTAssertEqual(rosterPreview([failed], detail: .hidden), "Morning brief: Failed")
        XCTAssertEqual(transcriptRows([failed], detail: .hidden).map(\.id), ["m"])

        let deferred = message(card: run(status: "queued", deferredAt: 5))
        XCTAssertEqual(previewText(of: deferred), "Morning brief: Deferred: target busy")

        let needsInput = message(card: run(status: "waiting", goalStatus: "needs-input"))
        XCTAssertEqual(previewText(of: needsInput), "Morning brief: Needs your input")

        XCTAssertEqual(previewText(of: message(card: nil, text: "ran")), "ran")
    }

    private func target(
        executionThreadId: String? = "exec-1",
        currentThreadId: String = "chat-thread",
        fromBotId: String? = nil,
        chatBotId: String? = "scout",
        bots: [RoutineRunCardRules.BotTasks]
    ) -> ThreadRef? {
        RoutineRunCardRules.openTarget(
            executionThreadId: executionThreadId,
            routineName: "Morning brief",
            currentThreadId: currentThreadId,
            fromBotId: fromBotId,
            chatBotId: chatBotId,
            bots: bots
        )
    }
}
