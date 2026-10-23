# Connect an existing Codex conversation

A local OpenMausBot thread can forward the person's text and images to an exact
existing local Codex conversation and display Codex's actual responses. The
OpenMausBot bot does not answer, add its instructions, or replay its transcript.

## Requirements and limitations

- Owner/admin-controlled local workspace. Cloud homes, shared hosted workspaces,
  service loopback, and client-only sessions cannot discover/control conversations.
- Native Codex instance using the conversation's ChatGPT sign-in and `CODEX_HOME`.
  Company, token-sharing ChatGPT variants, and API-key accounts are excluded.
- Codex **0.163.x**. Official 0.163.0 source and generated schemas were inspected.
  Other minor versions fail before app-server launch. In particular, 0.159.2 has
  a different legacy permission restoration path and is deliberately refused.
- The conversation must be visible to that local app-server. A UUID/title from
  cloud-only ChatGPT/Codex Work does not make it accessible locally. Missing IDs
  fail; no replacement, fork, unarchive, or reconstructed conversation is created.
- A thread-owned saved permission snapshot must be readable in the local Codex
  store. Unsupported/remote-only history and old histories without that snapshot
  fail before resume. The reader is version-pinned and never edits Codex files.
- Finish/stop work in the original Codex client before connecting. Use one writer
  while connected. Separate clients/processes can race the same local history;
  this feature cannot remotely attach to an arbitrary running application process.
- Outgoing structured input supports text and admitted images. Supported documents
  in the attachment store are forwarded as their original file-reference text;
  Codex reads them through its own tools and permissions. Inaccessible or
  unsupported attachments are rejected before dispatch. Audio is not transcribed.
- Only command/file-change approvals and structured native questions have a user
  interface. Other approval, permission-amendment, elicitation, and dynamic-tool
  requests fail closed with a visible notice. Continue in Codex or cancel.

## Setup, inspect, and disconnect

Configure the native Codex engine through existing engine settings. Use its CLI
without profile, model, sandbox, approval, or `-c` overrides and the original
account/store. In the intended OpenMausBot thread, expand **Codex conversation**.
Choose the instance, find the title, inspect its exact ID, and select **Connect
this conversation**. An exact ID can also be entered directly.

The server persists a reservation, connects, reads the exact thread, resumes with
only `threadId` and `excludeTurns`, and reconciles history. Only then does it show
**Ready**. The panel shows Codex's effective model, effort, working folder,
sandbox, and approval policy. Normal model/place/approval controls are hidden;
the saved native settings govern the conversation. A failed/disconnected binding
stays reserved, so messages never fall back to an OpenMausBot model.

Native text/image replies have expandable provenance identifying conversation,
turn, and item. Existing native assistant messages/images are imported on connect.
The original history remains in Codex. No `thread/start` or `thread/fork` is used.

The private `codex-bindings.json` in the workspace data directory persists
reservations, settings, and delivery receipts with mode 0600. Account/store
identity is hashed; credentials are not copied or logged. After restart the
reservation is **Disconnected** until explicitly reconnected. Reconnection checks
the original account/store and settings. Deliberate settings changes require
review in Codex, then disconnect/reselection to accept the new native settings.

Finish/stop active work, cancel queued messages, and review uncertain deliveries.
Select **Disconnect Codex** and confirm. The thread returns to its normal bot;
both transcripts and the original Codex conversation are retained. Old send IDs
cannot be replayed by disconnecting/rebinding and retrying the same send.

## Delivery and recovery

Browser sends use the existing stable `sendId`. The durable outbox records text
before acknowledgement; retries return the original receipt, and different words
with the same ID are rejected. Messages run in order, one native turn at a time,
with up to 20 waiting messages. The panel can cancel queued work or interrupt the
native turn. Cancelled receipts remain cancelled.

Dispatch is committed before `turn/start`. Codex's `clientUserMessageId` becomes
its user item's `clientId`; this identifies history, **not** a native exactly-once
submission guarantee. On reconnect, native turn/item history reconciles accepted
IDs and imports missed replies once. Reply deduplication uses conversation, turn,
and item ID in the durable message store, including a crash between message and
outbox commits.

A dispatch whose outcome cannot be established is **Delivery uncertain**, never
automatically replayed. Following queued work stays held. Review the original
conversation in Codex, then select **Mark reviewed**. This closes that receipt and
permits following queued work; it never resends the uncertain message. Send a new
message with a new ID only if review establishes that it is needed.

Only the owner/admin can answer a native approval card. Approve grants the
displayed request once. No session grants, remembered command rules, or permission
amendments are synthesized. Stale cards expire on disconnect/turn completion.
Codex's sandbox and approval policy remain authoritative; OpenMausBot Full access
does not grant native approvals.

## Attachments

Generated raster bytes and accessible image-view/file references are copied into
the existing private attachment store. PNG, JPEG, GIF, and WebP display in the
normal inline gallery. Document links use the existing file MIME allowlist and
limits. References must be in the native working folder or OpenMausBot attachment
store; existing canonical-path/file-handle checks apply. Remote-only/inaccessible
files, remote URLs, unsupported formats, and oversized files are not fetched using
another permission/credential context. A visible notice asks for a manual upload.

## HTTP interface

All routes are authenticated and admin scoped. Use personal IDs locally; the
placeholders below are intentionally not real account/conversation identifiers.

| Method | Path | Body/query |
| --- | --- | --- |
| GET | `/api/codex/conversations` | Supported native instances |
| GET | `/api/codex/conversations?instanceId=codex&search=title` | Optional `cursor`, pages of 30 |
| GET | `/api/bots/BOT_ID/threads/THREAD_ID/codex` | Status, settings, delivery states |
| PUT | Same path | `{"instanceId":"codex","conversationId":"CONVERSATION_ID"}` |
| POST | Same path + `/reconnect` | `{}` |
| POST | Same path + `/cancel` | `{}` or `{"sendId":"..."}` |
| POST | Same path + `/acknowledge` | `{"sendId":"..."}` after review |
| DELETE | Same path | Disconnect idle/reviewed binding |

Send through ordinary `POST /api/bots/BOT_ID/messages` with explicit `threadId`,
`text`, and stable 16–80 character `sendId`. Answer through existing
`/api/threads/THREAD_ID/respond`. Guarded relays, app/widget messages, quoted
replies, data-context injection, edits, compaction, and autonomous bot turns are
excluded from the native path.

## Manual end-to-end smoke test

This test changes a local binding and a harmless Codex text exchange may consume
normal Codex usage. Run only when separately authorized. Implementation fixtures
do not access the user's running app, target thread, conversation, or account.

1. In Codex, record the exact existing conversation ID/title, latest message,
   model, effort, cwd, sandbox, and approval policy. Locate an **existing** image
   item with accessible bytes/path. Do not generate a new image for this test.
2. In a disposable OpenMausBot workspace, choose a dedicated thread and the native
   instance for that conversation store. Connect by exact ID. Verify Connecting
   becomes Ready and settings match. Verify the existing image displays inline
   with original native conversation/turn/item provenance.
3. Send “Reply with the word connected. Do not use tools or change files.” Verify
   the exact message appears in the original Codex conversation and its actual
   reply appears once in OpenMausBot. Check Codex has no replacement/fork.
4. Retry the same HTTP send ID. Check the receipt ID is unchanged and neither side
   has a duplicate. Reconnect and check text/image items still appear once.
5. If explicitly permitted, exercise a harmless native approval. Deny first and
   verify denial remains denial. Approve only a second displayed request and
   inspect Codex's actual outcome. Another thread must not answer that card.
6. Disconnect once settled. Check Codex retains original history/settings. Remove
   only the disposable OpenMausBot workspace.

If the intended conversation is cloud-only and absent from the local Codex list,
stop at step 2. The service owner must expose a supported exact-conversation
transport; this local bridge cannot manufacture one.

## Verification and protocol evidence

```sh
pnpm exec vitest run server/codex-bindings.test.ts server/drivers/codex-native-client.test.ts server/drivers/codex-saved-permissions.test.ts server/routes/codex-bindings.test.ts server/codex-binding.e2e.test.ts
pnpm typecheck
pnpm lint
pnpm i18n:check
```

Unit tests use an in-memory native peer and real durable message store. Stdio
tests use a dependency-free fake CLI. The end-to-end test launches a real isolated
OpenMausBot server and fake engines, covering selection/resume, exact text, SSE
provenance, an existing inline image, retry, approval, blocked compaction, and
disconnect. These do not prove live model output or remote Work availability.

Installed verification inspected generated schemas from bundled 0.159.2 and a
separately installed disposable 0.163.0. A no-inference probe initialized 0.163.0;
creating a disposable native fixture thread timed out here. No model `turn/start`
was sent to either real binary. Real-account native resumption and the manual
smoke above remain unverified. The PR records actual checks and baseline failures.

Official references:

- [Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [0.163.0 resume implementation](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/thread_processor.rs)
- [0.163.0 persisted settings](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/persisted_resume_settings.rs)
- [0.159.2 resume implementation](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/app-server/src/request_processors/thread_processor.rs)

To inspect the real UI against fake engines without an account, run
`node --experimental-strip-types scripts/testing/verify-codex-binding-ui.ts`,
open its printed preview URL, select the fixture bot, find its fixture native
conversation, connect, and send harmless text. The existing fixture image appears
inline. Ctrl-C removes only the disposable fixture. Screenshots in
`docs/verification/images/codex-binding/` use synthetic data, not a live account.
