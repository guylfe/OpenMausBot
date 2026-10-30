import { describe, expect, it } from "vitest";
import { inputRequestOpen, type BotInputRequest } from "./input-requests";

type Row = BotInputRequest["message"];
const question: Row = { id: "q", at: 1, role: "bot", kind: "options", card: { requestId: "q", title: "Question", subtitle: "Which page?", options: ["Home"], requestType: "question" } };

describe("open input card lifecycle", () => {
  it.each(["answered", "dismissed", "expired", "stopped", "autoApplied"] as const)("keeps %s question cards out of the active queue", (field) => {
    expect(inputRequestOpen(question)).toBe(true);
    expect(inputRequestOpen({ ...question, card: { ...question.card!, [field]: field === "answered" ? "answer" : true } })).toBe(false);
  });

  it("keeps provided credentials private while retaining a failed resume's retry", () => {
    const secret: Row = { id: "secret", at: 1, role: "bot", kind: "secret", secret: { target: "customSecret", label: "Token", description: "An app token", placeholder: "Token", helpUrl: "", requestKey: "secret-key" } };
    expect(inputRequestOpen(secret)).toBe(true);
    expect(inputRequestOpen({ ...secret, secret: { ...secret.secret!, provided: true } })).toBe(false);
    expect(inputRequestOpen({ ...secret, secret: { ...secret.secret!, provided: true, error: "Resume failed" } })).toBe(true);
    expect(inputRequestOpen({ ...secret, secret: { ...secret.secret!, stopped: true, error: "Resume failed" } })).toBe(false);
    expect(inputRequestOpen({ ...secret, secret: { ...secret.secret!, superseded: true } })).toBe(false);
  });

  it("follows sign-in and connector cancellation, supersession and retry state", () => {
    const signIn: Row = { id: "login", at: 1, role: "bot", kind: "signin", signIn: { url: "https://example.test", site: "example.test", place: "browser" } };
    const connector: Row = { id: "app", at: 1, role: "bot", kind: "connector", connector: { slug: "fixture", label: "Fixture", description: "Connect", status: "required", resumeKey: "resume" } };
    expect(inputRequestOpen(signIn)).toBe(true);
    expect(inputRequestOpen({ ...signIn, signIn: { ...signIn.signIn!, done: true } })).toBe(false);
    expect(inputRequestOpen({ ...signIn, signIn: { ...signIn.signIn!, cancelled: true } })).toBe(false);
    expect(inputRequestOpen({ ...signIn, signIn: { ...signIn.signIn!, answeredInChat: true } })).toBe(false);
    expect(inputRequestOpen(connector)).toBe(true);
    expect(inputRequestOpen({ ...connector, connector: { ...connector.connector!, status: "connected" } })).toBe(false);
    expect(inputRequestOpen({ ...connector, connector: { ...connector.connector!, dismissed: true } })).toBe(false);
  });
});
