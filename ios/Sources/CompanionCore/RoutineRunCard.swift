import Foundation

/// How a routine card decides its label, its detail, and whether "Open run"
/// has a live execution task to open. Kept in Core so the package tests cover
/// it without a simulator.
///
/// Task lists are the caller's. Pass every task, including ones tagged
/// `routineRunId` — those are hidden from pickers and still openable.
public enum RoutineRunCardRules {
    public static let detailLimit = 280

    /// One bot and the thread ids of its tasks, hidden executions included.
    public struct BotTasks: Hashable, Sendable {
        public var id: String
        public var taskThreadIds: [String]

        public init(id: String, taskThreadIds: [String]) {
            self.id = id
            self.taskThreadIds = taskThreadIds
        }
    }

    /// Every task thread, including `routineRunId` executions pickers hide.
    public static func taskLists(_ bots: [Bot]) -> [BotTasks] {
        bots.map { BotTasks(id: $0.id, taskThreadIds: ($0.tasks ?? []).map(\.threadId)) }
    }

    public static func statusLabel(status: String, goalStatus: String?, deferredAt: Double?) -> String {
        if let goalStatus, !goalStatus.isEmpty, let goal = goalLabel(goalStatus) {
            return goal
        }
        switch status {
        case "queued" where deferredAt != nil: return "Deferred: target busy"
        case "queued": return "Queued"
        case "running": return "Running"
        case "waiting": return "Waiting"
        case "completed": return "Completed"
        case "failed": return "Failed"
        case "cancelled": return "Cancelled"
        case "missed": return "Missed"
        default: return status
        }
    }

    public static func detail(_ run: RoutineRunCard) -> String? {
        detail(status: run.status, summary: run.summary, error: run.error)
    }

    /// Failed and missed runs prefer a non-empty error. Everything else prefers
    /// the summary, then the error. Empty strings are absent.
    public static func detail(status: String, summary: String?, error: String?) -> String? {
        let errorText = error?.isEmpty == false ? error : nil
        let summaryText = summary?.isEmpty == false ? summary : nil
        if (status == "failed" || status == "missed"), let errorText { return errorText }
        return summaryText ?? errorText
    }

    public static func detailOverflows(_ text: String) -> Bool {
        text.count > detailLimit
    }

    /// Collapsed form of a detail past `detailLimit`. The full string is not rewritten.
    public static func detailPreview(_ text: String) -> String {
        guard text.count > detailLimit else { return text }
        var sliced = String(text.prefix(detailLimit - 1))
        while let last = sliced.last, last.isWhitespace { sliced.removeLast() }
        return sliced + "…"
    }

    public static func actionLabel(goalStatus: String?) -> String {
        goalStatus == "needs-input" ? "Review" : "Open run"
    }

    public static func rosterLine(_ run: RoutineRunCard) -> String {
        "\(run.routineName): \(statusLabel(status: run.status, goalStatus: run.goalStatus, deferredAt: run.deferredAt))"
    }

    /// Roster text for this kind: the card line when the payload is present, otherwise the message text.
    public static func previewLine(_ message: Message) -> String {
        guard let run = message.routineRun else { return message.text ?? "" }
        return rosterLine(run)
    }

    /// The thread to open, or nil when the button should not exist.
    ///
    /// The execution id has to be non-empty, different from the thread already
    /// on screen, and present on some bot's task list. The bot id prefers the
    /// message sender when that bot owns the task, then the chat's bot, then
    /// whichever bot actually has the task — a room has no chat bot.
    public static func openTarget(
        executionThreadId: String?,
        routineName: String,
        currentThreadId: String,
        fromBotId: String?,
        chatBotId: String?,
        bots: [BotTasks]
    ) -> ThreadRef? {
        guard let threadId = executionThreadId, !threadId.isEmpty, threadId != currentThreadId else {
            return nil
        }
        func owns(_ botId: String) -> Bool {
            bots.contains { $0.id == botId && $0.taskThreadIds.contains(threadId) }
        }
        let botId: String?
        if let fromBotId, owns(fromBotId) {
            botId = fromBotId
        } else if let chatBotId, owns(chatBotId) {
            botId = chatBotId
        } else {
            botId = bots.first { $0.taskThreadIds.contains(threadId) }?.id
        }
        guard let botId else { return nil }
        return ThreadRef(botId: botId, threadId: threadId, title: routineName)
    }

    private static func goalLabel(_ goalStatus: String) -> String? {
        switch goalStatus {
        case "completed": return "Completed"
        case "needs-input": return "Needs your input"
        case "blocked": return "Blocked"
        case "limit-reached": return "Turn limit reached"
        case "paused": return "Paused"
        case "stopped": return "Stopped"
        case "failed": return "Failed"
        default: return nil
        }
    }
}
