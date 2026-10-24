import { fromMarkdown } from "mdast-util-from-markdown";

type Node = {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

type Segment = { node: Node; text: string; start: number; end: number };
const MARKER = ":codex-file-citation{";
const CITATION = /:codex-file-citation\{((?:\s*[\w-]+\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'))+\s*)\}/g;
const ATTRIBUTE = /([\w-]+)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/g;
const SKIP = new Set(["link", "linkReference", "image", "imageReference", "definition", "html", "inlineCode", "code"]);

function outputLink(attributes: string): Node | null {
  const values = new Map<string, string>();
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    if (values.has(match[1]!)) return null;
    values.set(match[1]!, match[2] ?? match[3]!);
  }
  if (values.size !== 2 || values.get("purpose") !== "output") return null;
  const path = values.get("path")?.trim();
  if (!path) return null;
  let url = path;
  let label = path;
  if (path.startsWith("[")) {
    const tree = fromMarkdown(path);
    const paragraph = tree.children.length === 1 ? tree.children[0] : undefined;
    const link = paragraph?.type === "paragraph" && paragraph.children.length === 1 ? paragraph.children[0] : undefined;
    if (link?.type !== "link" || !link.children.every((child) => child.type === "text")) return null;
    url = link.url;
    label = link.children.map((child) => child.type === "text" ? child.value : "").join("");
  }
  if (!/^https?:\/\//i.test(url) || /\p{Cc}/u.test(url)) return null;
  try { new URL(url); } catch { return null; }
  return { type: "link", url, children: [{ type: "text", value: label }] };
}

function escapedMarker(segment: Segment, offset: number, source: string): boolean {
  const start = segment.node.position?.start.offset;
  const end = segment.node.position?.end.offset;
  if (start === undefined || end === undefined) return true;
  const ordinal = segment.text.slice(0, offset - segment.start).split(MARKER).length - 1;
  const raw = source.slice(start, end);
  const index = [...raw.matchAll(/:codex-file-citation\{/g)][ordinal]?.index;
  if (index === undefined) return true;
  let cursor = index;
  while (cursor > 0 && raw[cursor - 1] === "\\") cursor--;
  return (index - cursor) % 2 === 1;
}

function replaceCitations(nodes: Node[], source: string): Node[] {
  const segments: Segment[] = [];
  let text = "";
  for (const node of nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const value = node.type === "text" ? node.value ?? ""
      : start !== undefined && end !== undefined ? source.slice(start, end) : "";
    segments.push({ node, text: value, start: text.length, end: text.length + value.length });
    text += value;
  }
  if (!text.includes(MARKER)) return nodes;
  const result: Node[] = [];
  const append = (start: number, end: number) => {
    for (const segment of segments) {
      const from = Math.max(start, segment.start);
      const to = Math.min(end, segment.end);
      if (from >= to) continue;
      result.push(from === segment.start && to === segment.end ? segment.node
        : { type: "text", value: segment.text.slice(from - segment.start, to - segment.start) });
    }
  };
  let cursor = 0;
  for (const match of text.matchAll(CITATION)) {
    const start = match.index;
    const end = start + match[0].length;
    const first = segments.find((segment) => segment.start <= start && segment.end > start);
    const last = segments.find((segment) => segment.start < end && segment.end >= end);
    const endsInBareUrl = last?.node.type === "link" && /^https?:\/\//i.test(last.text);
    if (first?.node.type !== "text" || (!endsInBareUrl && last?.node.type !== "text") || escapedMarker(first, start, source)) continue;
    const link = outputLink(match[1]!);
    if (!link) continue;
    append(cursor, start);
    result.push(link);
    cursor = end;
  }
  if (cursor === 0) return nodes;
  append(cursor, text.length);
  return result;
}

export function remarkCodexFileCitations() {
  return (tree: Node, file: { value: unknown }) => {
    if (typeof file.value !== "string" || !file.value.includes(MARKER)) return;
    const source = file.value;
    const visit = (node: Node) => {
      if (!node.children || SKIP.has(node.type)) return;
      const children: Node[] = [];
      let run: Node[] = [];
      const flush = () => { children.push(...replaceCitations(run, source)); run = []; };
      for (const child of node.children) {
        if (child.type === "text" || child.type === "link") run.push(child);
        else { flush(); visit(child); children.push(child); }
      }
      flush();
      node.children = children;
    };
    visit(tree);
  };
}
