import type { BlitzitClient } from "./client.js";

export interface BlitzitTask {
  id: string;
  project: string;
  topic: string;
  detail: string;
  seconds: number;
  endTimeMs: number;
  listId: string | null;
  board: string;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Blitzit description is "<strong>topic</strong><br>detail". */
export function parseDescription(html: string): { topic: string; detail: string } {
  const input = html ?? "";
  const strong = input.match(/<strong>([\s\S]*?)<\/strong>/i);
  const topic = strong ? stripTags(strong[1]) : "";
  const rest = strong ? input.slice(input.indexOf(strong[0]) + strong[0].length) : input;
  const detail = stripTags(rest);
  return { topic, detail };
}

type FsFields = Record<string, { stringValue?: string; integerValue?: string }>;

const DONE_BOARD = "done";

function str(f: FsFields, key: string): string { return f[key]?.stringValue ?? ""; }
function int(f: FsFields, key: string): number { const n = Number(f[key]?.integerValue); return Number.isFinite(n) ? n : 0; }

export function normalizeTask(id: string, fields: FsFields): BlitzitTask {
  const { topic, detail } = parseDescription(str(fields, "description"));
  return {
    id,
    project: str(fields, "title"),
    topic,
    detail,
    seconds: Math.round(int(fields, "timeTaken") / 1000),
    endTimeMs: int(fields, "endTime"),
    listId: fields.listId?.stringValue ?? null,
    board: str(fields, "board"),
  };
}

/** Owner's done tasks whose endTime is in [fromMs, toMs), optionally filtered by Blitzit listId. */
export async function fetchWeekDoneTasks(
  client: BlitzitClient, uid: string, fromMs: number, toMs: number, listId?: string,
): Promise<BlitzitTask[]> {
  const docs = await client.queryTasksByOwner(uid);
  return docs
    .map((d) => normalizeTask(d.id, d.fields))
    .filter((t) => t.board === DONE_BOARD && t.endTimeMs >= fromMs && t.endTimeMs < toMs && (!listId || t.listId === listId))
    .sort((a, b) => a.endTimeMs - b.endTimeMs);
}
