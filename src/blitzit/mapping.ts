import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface MappingEntry {
  objectType: string;
  objectId: number;
  billable?: boolean;
  workTypeId?: number;
}
export type Mapping = Record<string, MappingEntry>;

export function parseMapping(json: string): Mapping {
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Blitzit→Accelo map must be a JSON object of { projectName: { objectType, objectId } }.");
  }
  const out: Mapping = {};
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val === null || typeof val !== "object") throw new Error(`Map entry "${name}" must be an object.`);
    const e = val as Record<string, unknown>;
    if (typeof e.objectType !== "string" || !e.objectType) throw new Error(`Map entry "${name}" needs a string objectType.`);
    if (typeof e.objectId !== "number" || !Number.isInteger(e.objectId)) throw new Error(`Map entry "${name}" needs an integer objectId.`);
    const entry: MappingEntry = { objectType: e.objectType, objectId: e.objectId };
    if (typeof e.billable === "boolean") entry.billable = e.billable;
    if (typeof e.workTypeId === "number" && Number.isInteger(e.workTypeId)) entry.workTypeId = e.workTypeId;
    out[name] = entry;
  }
  return out;
}

export function resolveMapping(map: Mapping, project: string): MappingEntry | undefined {
  return map[project];
}

export function defaultMapPath(): string {
  return process.env.BLITZIT_ACCELO_MAP ?? fileURLToPath(new URL("../../config/blitzit-accelo-map.json", import.meta.url));
}

export function loadMapping(path: string = defaultMapPath()): Mapping {
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Blitzit→Accelo map not found at ${path}. Copy config/blitzit-accelo-map.example.json to that location and fill in Accelo object ids, or set BLITZIT_ACCELO_MAP.`);
  }
  return parseMapping(json);
}
