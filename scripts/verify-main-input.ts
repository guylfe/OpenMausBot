import { mainInputFixture } from "./testing/main-input-fixture.ts";
import { parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await mainInputFixture();
try {
  console.log(JSON.stringify({ previewUrl: fixture.previewUrl, logPath: fixture.logPath }));
  await parkUntilSignal();
} finally { await fixture.close(); }
