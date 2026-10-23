import { lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { splitTranscriptAttachments, isPrivateAttachmentPath } from "../src/lib/composer-attachments.ts";
import { ATTACHMENTS_DIR, FILE_MAX_BYTES, IMAGE_MAX_BYTES, extensionForFileMime, saveFile, saveImage } from "./attachments.ts";
import { decodeGeneratedImage } from "./generated-image.ts";
import { messageFileTargets, mimeFor, openMessageFile } from "./message-file.ts";
import { extractTurnImages } from "./turn-images.ts";
import type { Message } from "./store.ts";

export function codexUserInput(text: string): unknown[] {
  const extracted = extractTurnImages(text);
  const attachments = splitTranscriptAttachments(text, false);
  if (attachments.images.some((image) => !extracted.images.some((admitted) => admitted.path === image.path))) throw Object.assign(new Error("An attached image is unavailable. Upload it again before sending."), { status: 422 });
  for (const file of attachments.files) {
    try {
      const path = resolve(file.path);
      const stat = lstatSync(path);
      if (!isPrivateAttachmentPath(path) || dirname(path) !== resolve(ATTACHMENTS_DIR) || dirname(realpathSync(path)) !== realpathSync(ATTACHMENTS_DIR) || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > FILE_MAX_BYTES || !extensionForFileMime(mimeFor(path))) throw new Error("Unavailable attachment");
    } catch { throw Object.assign(new Error("An attached file is unavailable or unsupported. Upload it again before sending."), { status: 422 }); }
  }
  return [
    ...(extracted.text ? [{ type: "text", text: extracted.text, text_elements: [] }] : []),
    ...extracted.images.map(({ path }) => ({ type: "localImage", path })),
  ];
}

export async function codexItemAttachments(item: any, cwd: string): Promise<{ attachments: NonNullable<Message["attachments"]>; unavailable: boolean }> {
  const attachments: NonNullable<Message["attachments"]> = [];
  let unavailable = false;
  if (item.type === "imageGeneration" && typeof item.result === "string" && item.result && item.result !== "[redacted]") {
    try {
      const decoded = decodeGeneratedImage(item.result);
      const saved = saveImage(decoded.bytes, decoded.mime);
      attachments.push({ kind: "image", path: saved.path, mime: saved.mime });
      return { attachments, unavailable };
    } catch { unavailable = true; }
  }
  const paths: string[] = item.type === "imageView" && typeof item.path === "string" ? [item.path]
    : item.type === "imageGeneration" && typeof item.savedPath === "string" ? [item.savedPath]
      : item.type === "agentMessage" && typeof item.text === "string" ? messageFileTargets(item.text.replace(/sandbox:(\/)/g, "$1")) : [];
  for (const path of paths.slice(0, 20)) {
    let opened: Awaited<ReturnType<typeof openMessageFile>> | undefined;
    try {
      opened = await openMessageFile(path, [cwd, ATTACHMENTS_DIR]);
      const bytes = await opened.handle.readFile();
      if (opened.mime.startsWith("image/")) {
        if (bytes.length > IMAGE_MAX_BYTES) throw new Error("Image too large");
        const decoded = decodeGeneratedImage(bytes.toString("base64"));
        const saved = saveImage(decoded.bytes, decoded.mime);
        attachments.push({ kind: "image", path: saved.path, mime: saved.mime, name: opened.name });
      } else {
        const saved = await saveFile((async function* () { yield bytes; })(), opened.name, opened.mime, { expectedBytes: bytes.length });
        attachments.push({ kind: "file", path: saved.path, mime: saved.mime, name: saved.name });
      }
    } catch { unavailable = true; }
    finally { await opened?.handle.close(); }
  }
  return { attachments, unavailable: unavailable || paths.length > 20 };
}
