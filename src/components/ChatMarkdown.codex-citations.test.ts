// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";
import * as AttachmentPreview from "./AttachmentPreview";

const SHEET = "https://docs.google.com/spreadsheets/d/fixture-sheet/edit#gid=102617001";
const citation = (path = SHEET) => `:codex-file-citation{path="${path}" purpose="output"}`;
const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));
const documentOf = (html: string) => { const element = document.createElement("div"); element.innerHTML = html; return element; };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Codex output file citations", () => {
  it.each([SHEET, `[${SHEET}](${SHEET})`, `[Open spreadsheet](${SHEET})`])("renders a real link for %s", (path) => {
    const element = documentOf(render(citation(path)));
    expect(element.querySelectorAll("a")).toHaveLength(1);
    expect(element.querySelector("a")?.getAttribute("href")).toBe(SHEET);
    expect(element.textContent).not.toContain("codex-file-citation");
    expect(element.textContent).not.toContain('purpose="output"');
    expect(element.querySelector("a")?.textContent).toBe(path.startsWith("[Open") ? "Open spreadsheet" : SHEET);
  });

  it("preserves surrounding prose, ordinary links, lists, tables, and emphasis", () => {
    const text = `Before [existing](https://example.test). **${citation()}** After.\n\n- ${citation(`[Report](${SHEET})`)}\n\n| Output |\n| --- |\n| ${citation()} |`;
    const element = documentOf(render(text));
    expect(element.querySelectorAll(`a[href="${SHEET}"]`)).toHaveLength(3);
    expect(element.querySelector('a[href="https://example.test"]')?.textContent).toBe("existing");
    expect(element.querySelector("strong a")?.getAttribute("href")).toBe(SHEET);
    expect(element.querySelector("li a")?.getAttribute("href")).toBe(SHEET);
    expect(element.querySelector("td a")?.getAttribute("href")).toBe(SHEET);
    expect(element.textContent).toContain("Before existing.");
    expect(element.textContent).toContain("After.");
  });

  it.each([`\`${citation()}\``, `\`\`\`text\n${citation()}\n\`\`\``, `    ${citation()}`, `[${citation()}](https://example.test)`])("keeps citation examples literal: %s", (text) => {
    const element = documentOf(render(text));
    expect(element.textContent).toContain(":codex-file-citation{");
    expect(element.querySelector(`a[href="${SHEET}"]`)).toBeNull();
  });

  it("leaves escaped wrappers literal while preserving ordinary GFM autolinks", () => {
    const element = documentOf(render(`\\${citation()}`));
    expect(element.textContent).toBe(citation());
    expect(element.querySelector("a")?.getAttribute("href")).toBe(SHEET);
  });

  it.each([
    `:codex-file-citation{path="${SHEET}"`,
    `:codex-file-citation{path="${SHEET}" purpose="unknown"}`,
    `:codex-file-citation{path="${SHEET}" path="https://example.test" purpose="output"}`,
    `:codex-file-citation{path="[broken](" purpose="output"}`,
    citation("/workspace/report.pdf"),
  ])("leaves incomplete, unsupported, or local citations untouched: %s", (text) => {
    expect(documentOf(render(text)).textContent).toContain(":codex-file-citation{");
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "[unsafe](javascript:alert%281%29)"])("keeps unsafe destinations out of executable links: %s", (path) => {
    const element = documentOf(render(citation(path)));
    expect(element.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(element.querySelector('a[href^="data:"]')).toBeNull();
    expect(element.querySelector('a[href^="file:"]')).toBeNull();
    expect(element.querySelector("script,iframe,img")).toBeNull();
  });

  it("accepts reordered attributes and single quotes without changing URL query or fragment", () => {
    const url = "https://example.test/report?a=1&b=%22quoted%22#part-2";
    const element = documentOf(render(`:codex-file-citation{purpose='output' path='${url}'}`));
    expect(element.querySelector("a")?.getAttribute("href")).toBe(url);
  });

  it("converts adjacent citations and preserves text consumed by a GFM autolink", () => {
    const element = documentOf(render(`${citation()} :codex-file-citation{purpose='output' path='${SHEET}'}after`));
    expect(element.querySelectorAll(`a[href="${SHEET}"]`)).toHaveLength(2);
    expect(element.textContent).toBe(`${SHEET} ${SHEET}after`);
  });

  it("preserves message-scoped image authorization offsets after a citation", () => {
    const text = `Done: ${citation(`[Sheet](${SHEET})`)}\n\n![chart](/workspace/chart.png)`;
    const preview = vi.spyOn(AttachmentPreview, "MarkdownImagePreview");
    try {
      renderToStaticMarkup(createElement(ChatMarkdown, { text, message: { threadId: "fixture-thread", messageId: "fixture-message" } }));
      expect(preview.mock.calls[0]?.[0].sourceOffset).toBe(text.indexOf("!["));
    } finally { preview.mockRestore(); }
  });

  it("turns a streaming citation into a link once its closing metadata arrives", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => { root.render(createElement(ChatMarkdown, { text: citation().slice(0, -1) })); });
      expect(container.textContent).toContain(":codex-file-citation{");
      await act(async () => { root.render(createElement(ChatMarkdown, { text: citation() })); });
      expect(container.querySelectorAll("a")).toHaveLength(1);
      expect(container.querySelector("a")?.getAttribute("href")).toBe(SHEET);
      expect(container.textContent).not.toContain(":codex-file-citation{");
    } finally { await act(async () => { root.unmount(); }); }
  });
});
