import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const url = new URL(process.argv[2]);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__pinned-sidebar.html");
const captureOnly = process.argv.includes("--capture-only");
const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({
  executablePath: process.env.OMB_VERIFY_BROWSER_CHROME || undefined,
  headless: true,
  args: JSON.parse(process.env.OMB_VERIFY_BROWSER_ARGS || "[]"),
});
const output = process.env.OMB_PINNED_EVIDENCE || ".omb-scratch/verify-evidence/pinned-sidebar";
await mkdir(output, { recursive: true });
const results = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  for (const layout of ["circles", "rows"]) for (const density of ["comfortable", "compact"]) for (const skin of ["midnight", "atelier"]) for (const height of [480, 800]) {
    await page.setViewportSize({ width: 1000, height });
    url.search = new URLSearchParams({ layout, density, skin }).toString();
    await page.goto(url.href);
    const pins = page.locator("[data-sidebar-universal-pins]");
    await page.getByRole("button", { name: "Expand Atlas threads", exact: true }).click();
    await pins.locator("[data-sidebar-thread-row]").first().waitFor();
    await page.waitForFunction(() => {
      const bar = document.querySelector('[data-glass-bar="top"]');
      return Math.ceil(bar.getBoundingClientRect().height) === parseFloat(getComputedStyle(bar.parentElement).getPropertyValue("--glass-top"));
    });
    await page.mouse.move(900, 10);
    const bounds = await pins.boundingBox();
    assert.ok(bounds.height <= Math.min(height * 0.4, 280) + 1);
    const clip = { x: bounds.x + 8, y: Math.floor(bounds.y + bounds.height - 25), width: Math.floor(bounds.width - 32), height: 20 };
    const resting = await page.screenshot({ clip, animations: "disabled" });
    await page.evaluate(() => new Promise((resolve) => {
      const scroller = document.querySelector(".glass-scroller");
      scroller.addEventListener("scroll", () => requestAnimationFrame(resolve), { once: true });
      scroller.scrollTop = 18;
    }));
    const scrolled = await page.screenshot({ clip, animations: "disabled" });
    const paintStable = resting.equals(scrolled);
    const name = `${layout}-${density}-${skin}-${height}`;
    await page.locator("[data-sidebar]").screenshot({ path: join(output, `${name}.png`) });
    results.push({ name, paintStable });
    if (!captureOnly) assert.ok(paintStable, `${name}: the regular bot list must not paint through the pinned thread boundary`);
    const mainScroll = () => page.locator(".glass-scroller").evaluate((element) => element.scrollTop);
    assert.equal(await mainScroll(), 18);
    await pins.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.ok(await pins.evaluate((element) => element.scrollTop > 0), "expanded pinned threads scroll within their own region");
    assert.equal(await mainScroll(), 18, "scrolling pinned threads leaves regular bots in place");
    await pins.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: "Collapse Atlas threads", exact: true }).click();
    await page.getByRole("button", { name: "Expand Atlas threads", exact: true }).waitFor();
    await page.locator(".glass-scroller").evaluate((element) => { element.scrollTop = 0; });
    await page.locator('[data-sidebar-bot-row="bot-0"]').click();
    assert.equal(await page.locator("[data-selected-bot]").textContent(), "bot-0");
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, "results.json"), JSON.stringify({ browser: await browser.version(), captureOnly, results, errors }, null, 2));
  console.log(JSON.stringify({ ok: !captureOnly, captureOnly, cases: results.length, paintStable: results.filter((result) => result.paintStable).length, errors }));
} finally {
  await browser.close();
}
