import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchVerificationServer } from "../control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, type MountedPreview } from "./preview-fixture.ts";

const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, ["codex"]);
let preview: MountedPreview | undefined;
try {
  const api = fixtureApi(fixture.info.url);
  const wrapper = join(fixture.info.dataDir, "native-codex-ui-fixture.mjs");
  writeFileSync(wrapper, [
    `#!${process.execPath}`,
    `process.env.FAKE_CODEX_NATIVE_DIR = ${JSON.stringify(fixture.info.dataDir)};`,
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../../server/testing/fake-codex-native.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/codex", { cli: wrapper });
  await api("PATCH", "/api/config", { language: "en" });
  const bot = (await api("POST", "/api/bots", { name: "Codex connection fixture" })).bot;
  preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__codex-binding.html", title: "Existing Codex connection fixture", logLevel: "warn" });
  console.log(JSON.stringify({ previewUrl: preview.previewUrl, url: fixture.info.url, botId: bot.id, threadId: bot.threadId, conversationId: "fixture-native-existing", logPath: fixture.info.logPath }));
  await parkUntilSignal();
} finally {
  await preview?.close();
  await fixture.close();
}
