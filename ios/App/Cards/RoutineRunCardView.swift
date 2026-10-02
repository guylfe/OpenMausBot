import CompanionCore
import SwiftUI

/// A background routine's result, in the same settled-card surface as a
/// question or approval that is no longer waiting. The open action is the
/// isolated execution thread, and only while that task still exists.
struct RoutineRunCardView: View {
    let chat: Chat
    let message: Message
    let run: RoutineRunCard
    var openThread: ((ThreadRef) -> Void)? = nil
    @EnvironmentObject private var session: Session
    @State private var expanded = false

    private var label: String {
        RoutineRunCardRules.statusLabel(
            status: run.status,
            goalStatus: run.goalStatus,
            deferredAt: run.deferredAt
        )
    }

    private var detail: String? { RoutineRunCardRules.detail(run) }

    private var target: ThreadRef? {
        guard openThread != nil else { return nil }
        let chatBotId: String?
        if case let .bot(bot) = chat {
            chatBotId = bot.id
        } else {
            chatBotId = nil
        }
        // `tasks`, not `visibleTasks`: a routineRunId execution is hidden from
        // pickers and is still the thread "Open run" goes to.
        return RoutineRunCardRules.openTarget(
            executionThreadId: run.executionThreadId,
            routineName: run.routineName,
            currentThreadId: chat.threadId,
            fromBotId: message.from?.botId,
            chatBotId: chatBotId,
            bots: RoutineRunCardRules.taskLists(session.state.bots)
        )
    }

    var body: some View {
        let overflows = detail.map(RoutineRunCardRules.detailOverflows) ?? false
        let shown: String? = {
            guard let detail else { return nil }
            if expanded || !overflows { return detail }
            return RoutineRunCardRules.detailPreview(detail)
        }()
        let running = run.status == "running" && (run.goalStatus ?? "").isEmpty
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(run.routineName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.primary)
                    HStack(spacing: 6) {
                        if running {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(label)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(run.routineName) routine run: \(label)")
                Spacer(minLength: 8)
                if let target, let openThread {
                    Button(RoutineRunCardRules.actionLabel(goalStatus: run.goalStatus)) {
                        Haptics.selection()
                        openThread(target)
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityLabel("\(RoutineRunCardRules.actionLabel(goalStatus: run.goalStatus)) for \(run.routineName)")
                }
            }
            if let shown {
                // Expanded text wraps in full. No line limit and no height cap.
                Text(shown)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.secondary)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if overflows {
                    Button(expanded ? "Show less" : "Show full") {
                        Haptics.selection()
                        expanded.toggle()
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .buttonStyle(.borderless)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.secondary.opacity(0.13))
        )
    }
}
