import { readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { openSse } from "../../server/testing/sse.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./preview-fixture.ts";

function answerDump(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const dump = JSON.parse(readFileSync(path, "utf8"));
        if (!dump.decision) return;
        watcher.close(); clearTimeout(timer); resolve(dump.decision);
      } catch { }
    };
    const watcher = watch(join(path, ".."), check);
    const timer = setTimeout(() => { watcher.close(); reject(new Error("No answer reached the isolated Codex provider")); }, 20_000);
    check();
  });
}

export async function mainInputFixture() {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const api = fixtureApi(fixture.info.url);
  const events = await openSse(`${fixture.info.url}/api/events`, { origin: fixture.info.url });
  let preview: MountedPreview | undefined;
  const close = async () => { events.close(); await preview?.close(); await fixture.close(); };
  try {
    await api("PATCH", "/api/config", { language: "en", threads: { maxConcurrentPerBot: 3 } });
    const { bot } = await runControlOmb(["new-bot", "--name", "Atlas", "--url", fixture.info.url]) as { bot: { id: string; threadId: string } };
    const { bots } = await api("GET", "/api/bots");
    for (const candidate of bots.filter((candidate: { defaultBot?: unknown }) => candidate.defaultBot)) await api("PATCH", `/api/bots/${candidate.id}`, { welcomed: true });
    const main = bots.find((candidate: { id: string }) => candidate.id === bot.id).mainThreadId ?? bot.threadId;
    const question = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Review the landing page" })).task.threadId as string;
    const approval = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Prepare the weekly report" })).task.threadId as string;
    const dumps = new Map<string, string>();
    const launch = join(fixture.info.dataDir, "codex-mode.json");
    const cli = join(fixture.info.dataDir, "fixture-codex.mjs");
    writeFileSync(launch, JSON.stringify({ mode: "question", dump: join(fixture.info.dataDir, "question-answer.json") }));
    writeFileSync(cli, `#!/usr/bin/env node\nimport{readFileSync}from"node:fs";const fixture=JSON.parse(readFileSync(${JSON.stringify(launch)},"utf8"));\nconst write=process.stdout.write.bind(process.stdout);process.stdout.write=(chunk,...args)=>{const result=write(chunk,...args);if(String(chunk).includes('"method":"turn/completed"'))write("",()=>process.exit(0));return result;};\nprocess.env.FAKE_CODEX_MODE=fixture.mode;process.env.FAKE_CODEX_DUMP=fixture.dump;process.env.FAKE_CODEX_DUMP_TURNS_ONLY="1";process.env.FAKE_CODEX_APPROVAL_REQUEST=JSON.stringify({method:"item/fileChange/requestApproval",params:{reason:"Create a synthetic report",fileChanges:{"fixture-report.txt":{type:"add",content:"synthetic"}}}});\nawait import(${JSON.stringify(new URL("../../server/testing/fake-codex-app-server.ts", import.meta.url).href)});\n`, { mode: 0o755 });
    await api("PATCH", "/api/instances/codex", { cli });
    for (const [threadId, mode] of [[question, "question"], [approval, "approval"]]) {
      const dump = join(fixture.info.dataDir, `${mode}-answer.json`);
      dumps.set(threadId, dump);
      writeFileSync(launch, JSON.stringify({ mode, dump }));
      await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: { instanceId: "codex", model: "gpt-5.5" }, approvalMode: "ask" });
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text: "Run this synthetic fixture turn" });
      await events.until((frame) => frame.kind === "message" && frame.threadId === threadId && Boolean(frame.message?.card?.requestId), 30_000);
    }
    writeFileSync(launch, JSON.stringify({ mode: "happy", dump: join(fixture.info.dataDir, "main-answer.json") }));
    await api("PATCH", `/api/bots/${bot.id}/tasks/${main}`, { modelSelection: { instanceId: "codex", model: "gpt-5.5" }, approvalMode: "ask" });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: main, text: "This is the main conversation" });
    await events.until((frame) => frame.kind === "message" && frame.threadId === main && frame.message?.text === "done from fake codex", 20_000);
    await api("POST", `/api/bots/${bot.id}/tasks/${main}`, {});
    preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__main-input.html", title: "Isolated main-chat input verification", logLevel: "error" });
    const answered = (threadId: string) => answerDump(dumps.get(threadId)!);
    const hasAnswer = (threadId: string) => { try { return Boolean(JSON.parse(readFileSync(dumps.get(threadId)!, "utf8")).decision); } catch { return false; } };
    return { ...fixture.info, previewUrl: preview.previewUrl, botId: bot.id, main, question, approval, hasAnswer, answered, api, close };
  } catch (error) { console.info(JSON.stringify({ logPath: fixture.info.logPath })); await close(); throw error; }
}
