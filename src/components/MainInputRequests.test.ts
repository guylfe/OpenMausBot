// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotInputRequest } from "../../shared/input-requests";
import type { InputRequestView } from "@/state/input-requests";

const fixture = vi.hoisted(() => ({ view: { requests: [], loading: false, failed: false, loaded: true } as InputRequestView, showThreads: false, refresh: vi.fn() }));
vi.mock("@/state/input-requests", () => ({ useInputRequests: () => fixture.view, refreshInputRequests: fixture.refresh }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));

import { initialState, StoreContext, type Bot } from "@/state/store";
import { BotInputRequestBadge, MainInputRequests } from "./MainInputRequests";
import { PendingApprovalActions, pendingApprovals } from "./PendingApproval";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const question = (threadId: string, requestId: string): BotInputRequest => ({ botId: "atlas", threadId, title: `Work in ${threadId}`,
  message: { id: requestId, at: 1, role: "bot", kind: "options", card: { title: "Your bot has a question", subtitle: "Which page?", requestType: "question", requestId, options: ["Home", "Pricing"] } } });
const approval = (): BotInputRequest => ({ ...question("review", "approval"), message: { ...question("review", "approval").message,
  card: { title: "Permission needed", subtitle: "echo fixture", requestId: "approval", requestType: "permission", tool: "Bash", options: ["Allow", "Deny"] } } });
const bot: Bot = { id: "atlas", name: "Atlas", threadId: "main", mainThreadId: "main", title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fixture", model: "fixture" }, messages: [],
  tasks: ["main", "site", "report", "review"].map((threadId) => ({ threadId, title: threadId, createdAt: 1 })) };
let root: Root;
let host: HTMLDivElement;
const dispatch = vi.fn();
const mount = (connected = true) => act(async () => {
  root.render(createElement(StoreContext.Provider, { value: { state: { ...initialState, bots: [bot], connected }, dispatch,
    flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } },
  createElement("div", null, createElement(BotInputRequestBadge, { botId: bot.id }), createElement(MainInputRequests, { bot, threadId: "main" }))));
});
const click = (selector: string) => act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fixture.view = { requests: [question("site", "page"), approval()], loading: false, failed: false, loaded: true };
  fixture.showThreads = false; fixture.refresh.mockClear(); dispatch.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("answering hidden subthreads from the main chat", () => {
  it("shows actual questions and approvals together with their origin and a bot-wide input count", async () => {
    await mount();
    expect(host.querySelector("[data-bot-input-count]")?.textContent).toBe("2");
    expect(host.textContent).toContain("Which page?");
    expect(host.textContent).toContain("echo fixture");
    click('[data-input-origin="site"] [role="radio"]');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "site", requestId: "page", behavior: "answer", message: "Home" }));
    expect(dispatch.mock.calls.some(([action]) => action.type === "switchTask" || action.type === "send")).toBe(false);
  });

  it("prevents duplicate approval taps, exposes failures and allows a retry on the same original request", async () => {
    await mount();
    const allow = () => host.querySelector<HTMLButtonElement>('[data-input-origin="review"] button[data-input-request-action="allow"]')!;
    act(() => { allow().click(); allow().click(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "decideRequest", threadId: "review", requestId: "approval", behavior: "allow", always: undefined, alwaysAllow: undefined });
    expect(allow().disabled).toBe(true);
    act(() => dispatch.mock.calls[0][0].onError("Connection failed"));
    expect(host.querySelector('[data-input-origin="review"] [role="alert"]')?.textContent).toBe("Connection failed");
    expect(allow().disabled).toBe(false);
    click('[data-input-origin="review"] [data-input-request-action="deny"]');
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1][0]).toMatchObject({ threadId: "review", requestId: "approval", behavior: "deny" });
  });

  it("allows the next approval in a reused action surface and ignores a previous request's late failure", async () => {
    const draw = async (id: string) => {
      const message = { ...approval().message, card: { ...approval().message.card!, requestId: id } };
      await act(async () => root.render(createElement(StoreContext.Provider, { value: { state: initialState, dispatch,
        flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } },
      createElement(PendingApprovalActions, { pending: pendingApprovals([message])[0], threadId: "review", bot,
        tag: "rotating", onCancelTurn() {} }))));
    };
    await draw("first");
    click('[data-rotating-action="allow"]');
    const oldError = dispatch.mock.calls[0][0].onError;
    await draw("second");
    expect(host.querySelector<HTMLButtonElement>('[data-rotating-action="allow"]')!.disabled).toBe(false);
    click('[data-rotating-action="deny"]');
    act(() => oldError("Old failure"));
    expect(dispatch.mock.calls[1][0]).toMatchObject({ requestId: "second", behavior: "deny" });
    expect(host.querySelector<HTMLButtonElement>('[data-rotating-action="allow"]')!.disabled).toBe(true);
    expect(host.textContent).not.toContain("Old failure");
  });

  it("offers context separately, keeps other bots isolated and avoids drawing the current thread's card twice", async () => {
    fixture.view.requests.push(question("main", "main-card"), { ...question("private", "other-card"), botId: "other" });
    await mount();
    expect(host.querySelectorAll("[data-input-origin]")).toHaveLength(2);
    expect(host.querySelector('[data-input-origin="main"]')).toBeNull();
    click('[data-input-origin="site"] button');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "switchTask", botId: "atlas", threadId: "site" }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "focusMessage", threadId: "site", messageId: "page" }));
  });

  it("updates after another view settles a card and keeps Advanced's thread view uncluttered", async () => {
    await mount();
    fixture.view = { ...fixture.view, requests: [approval()] };
    await mount();
    expect(host.querySelector('[data-input-origin="site"]')).toBeNull();
    expect(host.querySelector("[data-bot-input-count]")?.textContent).toBe("1");
    fixture.showThreads = true;
    await mount();
    expect(host.querySelector("[data-main-input-requests]")).toBeNull();
    expect(host.querySelector("[data-bot-input-count]")).toBeNull();
  });

  it("disables stale/offline actions, offers read retry, and does not flash loading for empty background refreshes", async () => {
    fixture.view = { ...fixture.view, failed: true };
    await mount();
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry")!;
    act(() => retry.click());
    expect(fixture.refresh).toHaveBeenCalledOnce();
    fixture.view = { requests: [], failed: false, loading: true, loaded: true };
    await mount();
    expect(host.querySelector("[data-main-input-requests]")).toBeNull();
    fixture.view = { ...fixture.view, requests: [approval()], loading: false };
    await mount(false);
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
  });
});
