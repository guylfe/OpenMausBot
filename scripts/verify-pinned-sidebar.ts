import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
let preview: MountedPreview | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/pinned-sidebar-preview.tsx",
    route: "/__pinned-sidebar.html",
    title: "Isolated pinned sidebar verification",
    logLevel: "error",
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally {
  await preview?.close();
  await fixture.close();
}
