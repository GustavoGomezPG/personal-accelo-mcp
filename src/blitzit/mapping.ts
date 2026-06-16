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
    if (val === null || typeof val !== "object" || Array.isArray(val)) throw new Error(`Map entry "${name}" must be an object.`);
    const e = val as Record<string, unknown>;
    if (typeof e.objectType !== "string" || !e.objectType.trim()) throw new Error(`Map entry "${name}" needs a string objectType.`);
    if (typeof e.objectId !== "number" || !Number.isInteger(e.objectId) || e.objectId <= 0) throw new Error(`Map entry "${name}" needs a positive integer objectId.`);
    const entry: MappingEntry = { objectType: e.objectType, objectId: e.objectId };
    if (typeof e.billable === "boolean") entry.billable = e.billable;
    if (typeof e.workTypeId === "number" && Number.isInteger(e.workTypeId) && e.workTypeId > 0) entry.workTypeId = e.workTypeId;
    out[name] = entry;
  }
  return out;
}

/**
 * Resolve a Blitzit task title to a mapping entry. Blitzit titles encode
 * `Client::SubProject::Description` in the title field, so we match the longest
 * mapping key that the title's leading `::` segments equal (segment boundaries
 * only — never a substring). Falls back to an exact match for keys without `::`.
 */
export function resolveMapping(map: Mapping, project: string): MappingEntry | undefined {
  const exact = map[project];
  if (exact) return exact;
  const segments = project.split("::").map((s) => s.trim());
  // Longest prefix first so a more specific "A::B" key wins over "A".
  for (let n = segments.length; n >= 1; n--) {
    const key = segments.slice(0, n).join("::");
    if (map[key]) return map[key];
  }
  return undefined;
}

export function defaultMapPath(): string {
  const env = (process.env.BLITZIT_ACCELO_MAP ?? "").trim();
  return env || fileURLToPath(new URL("../../config/blitzit-accelo-map.json", import.meta.url));
}

export function loadMapping(path: string = defaultMapPath()): Mapping {
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    throw new Error(`Blitzit→Accelo map not found at ${path}. Copy config/blitzit-accelo-map.example.json to that location and fill in Accelo object ids, or set BLITZIT_ACCELO_MAP.`, { cause: e });
  }
  try {
    return parseMapping(json);
  } catch (e) {
    throw new Error(`Invalid Blitzit→Accelo map at ${path}: ${(e as Error).message}`, { cause: e });
  }
}
