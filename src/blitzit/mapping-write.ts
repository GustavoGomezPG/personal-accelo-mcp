import { writeFileSync, renameSync } from "node:fs";
import { parseMapping, defaultMapPath, type Mapping, type MappingEntry } from "./mapping.js";

/** A single Accelo target plus every Blitzit label that routes to it (many-to-one view). */
export interface TargetGroup {
  objectType: string;
  objectId: number;
  billable?: boolean;
  workTypeId?: number;
  labels: string[];
}

function targetKey(e: MappingEntry): string {
  return `${e.objectType}#${e.objectId}#${e.billable ?? ""}#${e.workTypeId ?? ""}`;
}

/**
 * Group a flat mapping by Accelo target so the many-to-one relationships are
 * visible (e.g. one Internal task fed by several Blitzit labels). The on-disk
 * format stays flat; this is purely a presentation transform.
 */
export function groupByTarget(map: Mapping): TargetGroup[] {
  const groups = new Map<string, TargetGroup>();
  for (const [label, e] of Object.entries(map)) {
    const key = targetKey(e);
    let g = groups.get(key);
    if (!g) {
      g = { objectType: e.objectType, objectId: e.objectId, billable: e.billable, workTypeId: e.workTypeId, labels: [] };
      groups.set(key, g);
    }
    g.labels.push(label);
  }
  for (const g of groups.values()) g.labels.sort((a, b) => a.localeCompare(b));
  return [...groups.values()].sort((a, b) => a.objectId - b.objectId);
}

/** Build and validate a MappingEntry from raw tool input. Throws on bad input. */
export function makeEntry(input: { objectType?: string; objectId: number; billable?: boolean; workTypeId?: number }): MappingEntry {
  const objectType = (input.objectType ?? "task").trim();
  if (!objectType) throw new Error("objectType must be a non-empty string.");
  if (!Number.isInteger(input.objectId) || input.objectId <= 0) throw new Error("objectId must be a positive integer.");
  const entry: MappingEntry = { objectType, objectId: input.objectId };
  if (typeof input.billable === "boolean") entry.billable = input.billable;
  if (typeof input.workTypeId === "number" && Number.isInteger(input.workTypeId) && input.workTypeId > 0) entry.workTypeId = input.workTypeId;
  return entry;
}

export interface UpsertResult {
  next: Mapping;
  added: string[];
  updated: Array<{ label: string; from: MappingEntry; to: MappingEntry }>;
}

/**
 * Point one or more Blitzit labels at a single Accelo target. Many labels →
 * one target is the whole point: pass several labels to fold multiple internal
 * tasks onto the same Accelo task. Returns a new map; does not touch disk.
 */
export function upsertMapping(map: Mapping, labels: string[], entry: MappingEntry): UpsertResult {
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) throw new Error("Provide at least one Blitzit label to map.");
  const next: Mapping = { ...map };
  const added: string[] = [];
  const updated: UpsertResult["updated"] = [];
  for (const label of clean) {
    const prev = next[label];
    if (prev) {
      if (targetKey(prev) !== targetKey(entry)) updated.push({ label, from: prev, to: entry });
    } else {
      added.push(label);
    }
    next[label] = entry;
  }
  return { next, added, updated };
}

export interface RemoveResult {
  next: Mapping;
  removed: Array<{ label: string; entry: MappingEntry }>;
  missing: string[];
}

/** Drop one or more Blitzit labels from the mapping. Returns a new map; does not touch disk. */
export function removeMapping(map: Mapping, labels: string[]): RemoveResult {
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) throw new Error("Provide at least one Blitzit label to remove.");
  const next: Mapping = { ...map };
  const removed: RemoveResult["removed"] = [];
  const missing: string[] = [];
  for (const label of clean) {
    if (label in next) {
      removed.push({ label, entry: next[label] });
      delete next[label];
    } else {
      missing.push(label);
    }
  }
  return { next, removed, missing };
}

/** Validate, then atomically write a mapping to disk (temp file + rename). */
export function writeMapping(map: Mapping, path: string = defaultMapPath()): void {
  const json = JSON.stringify(map, null, 2) + "\n";
  parseMapping(json); // round-trip validation: never persist a file we cannot reload
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, path);
}
