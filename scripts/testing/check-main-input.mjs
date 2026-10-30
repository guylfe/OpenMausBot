import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mainInputFixture } from "./main-input-fixture.ts";

const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const { chromium } = playwright.default ?? playwright;
const output = process.env.OMB_INPUT_EVIDENCE || ".omb-scratch/verify-evidence/main-input";
await mkdir(output, { recursive: true });
const fixture = await mainInputFixture();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.OMB_VERIFY_BROWSER_CHROME || undefined, headless: true,
    args: JSON.parse(process.env.OMB_VERIFY_BROWSER_ARGS || "[]") });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  const resourceErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource:")) resourceErrors.push({ url: message.location().url, message: message.text() });
    else errors.push(message.text());
  });
  await page.addInitScript(() => { localStorage.setItem("omb-advanced-mode", "0"); localStorage.setItem("omb-show-threads", "0"); localStorage.setItem("omb-skin", "midnight"); });
  await page.goto(fixture.previewUrl);
  await page.locator(`[data-sidebar-bot-row="${fixture.botId}"]`).click();
  const requests = page.locator(`[data-main-input-requests="${fixture.botId}"]`);
  const question = requests.locator(`[data-input-origin="${fixture.question}"]`);
  const approval = requests.locator(`[data-input-origin="${fixture.approval}"]`);
  await question.getByRole("textbox").waitFor();
  await approval.locator('[data-input-request-action="allow"]').waitFor();
  assert.equal(await page.locator(`[data-bot-input-count="${fixture.botId}"]`).first().textContent(), "2");
  assert.equal(await page.locator("[data-sidebar-thread-row]").count(), 0);
  await requests.scrollIntoViewIfNeeded();
  await requests.screenshot({ path: join(output, "main-chat-dark.png") });
  await question.getByRole("button", { name: "View context" }).click();
  await page.locator("[data-chathead-back]").click();
  await approval.locator('[data-input-request-action="allow"]').waitFor();
  await page.evaluate(async () => { const { applySkinChoice } = await import("/src/lib/skins.ts"); applySkinChoice("daylight"); });
  await requests.screenshot({ path: join(output, "main-chat-light.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const height of [800, 1000]) {
    await page.setViewportSize({ width: 390, height });
    await approval.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 5000 });
  }
  await page.screenshot({ path: join(output, "main-chat-phone.png") });
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.reload();
  await question.getByRole("textbox").waitFor();
  assert.equal(await question.count(), 1);
  await question.getByRole("textbox").focus();
  await page.keyboard.type("Home");
  await page.keyboard.press("Enter");
  assert.deepEqual(await fixture.answered(fixture.question), { answers: { "q-ship": { answers: ["Home"] } } });
  await question.waitFor({ state: "detached" });
  assert.equal(await page.locator(`[data-bot-input-count="${fixture.botId}"]`).first().textContent(), "1");

  const route = `**/api/threads/${fixture.approval}/respond`;
  let refused = false;
  await page.route(route, async (request) => {
    if (!refused) { refused = true; await request.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Synthetic connection failure"}' }); }
    else await request.continue();
  });
  await approval.locator('[data-input-request-action="allow"]').click();
  await approval.getByRole("alert").filter({ hasText: "Synthetic connection failure" }).waitFor();
  assert.equal(fixture.hasAnswer(fixture.approval), false);
  await approval.locator('[data-input-request-action="deny"]').click();
  const denied = await fixture.answered(fixture.approval);
  assert.deepEqual(denied, { decision: "decline" });
  await approval.waitFor({ state: "detached" });
  assert.equal((await fixture.api("GET", "/api/input-requests")).requests.length, 0);
  const main = (await fixture.api("GET", `/api/threads/${fixture.main}/messages`)).messages;
  assert.equal(main.some((message) => message.card?.requestId || message.text === "Home"), false);
  for (const height of [800, 1000]) {
    await page.setViewportSize({ width: 390, height });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 5000 });
  }
  assert.deepEqual(errors, []);
  assert.ok(resourceErrors.every((error) => error.url.startsWith("https://www.google.com/s2/favicons?") ||
    (error.url.endsWith(`/api/threads/${fixture.approval}/respond`) && error.message.includes("503"))), JSON.stringify(resourceErrors));
  const runtimeWarnings = await page.getByText("codex did not shut down after termination was requested", { exact: true }).count();
  const result = { runtimeWarnings, browser: await browser.version(), checks: ["Simple main chat shows both original subthread requests", "bot count aggregates both requests", "optional source context returns to main chat", "light and dark skins, narrow layout and reduced motion", "reload has no duplicate cards", "keyboard answer reaches exact originating provider", "failed approval stays actionable", "denial reaches only its originating provider once", "main transcript is not copied or steered", "390px layout fits", "no JavaScript console errors or page exceptions"], resourceErrors, logPath: fixture.logPath };
  await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser?.close(); await fixture.close(); }
