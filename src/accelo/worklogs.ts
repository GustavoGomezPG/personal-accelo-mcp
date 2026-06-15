import type { AcceloClient } from "./client.js";

export interface WorkLogEntry {
  id: string;
  startEpoch: number;
  subject: string;
  billable: number;
  nonbillable: number;
  against: { type: string; id: string | null; title: string | null } | null;
}

export function entryEnd(e: WorkLogEntry): number {
  return e.startEpoch + e.billable + e.nonbillable;
}

const QUERY = `query MyWork($f:[notesFilterAndBlockInput!]!, $s:[notesSortFieldInput!], $first:Int) {
  notes(first:$first, filters:$f, sort:$s) {
    edges { node {
      id subject date
      creator { __typename ... on Staff { id } }
      loggedWork { billableTime nonbillableTime }
      againstObject { __typename ... on Task { id title } ... on Ticket { id title } ... on Project { id title } }
    } }
  }
}`;

interface RawNote {
  id: string; subject: string | null; date: number;
  creator: { __typename: string; id?: string };
  loggedWork: { billableTime: number; nonbillableTime: number } | null;
  againstObject: { __typename: string; id?: string; title?: string } | null;
}

/** The current user's work-log notes with start in [fromEpoch, toEpochExclusive). */
export async function fetchMyWorkLogs(client: AcceloClient, fromEpoch: number, toEpochExclusive: number, staffId: string, first = 100): Promise<WorkLogEntry[]> {
  const f = [{ epochs: [
    { key: "NoteDate", type: "greaterThanOrEqual", value: fromEpoch },
    { key: "NoteDate", type: "lessThan", value: toEpochExclusive },
  ] }];
  const s = [{ key: "NoteDate", order: "ASC" }];
  const data = await client.query<{ notes: { edges: Array<{ node: RawNote }> } }>(QUERY, { f, s, first: Math.min(Math.max(first, 1), 100) });
  return data.notes.edges
    .map((e) => e.node)
    .filter((n) => n.creator.__typename === "Staff" && n.creator.id === staffId)
    .map((n) => ({
      id: n.id,
      startEpoch: n.date,
      subject: n.subject ?? "",
      billable: n.loggedWork?.billableTime ?? 0,
      nonbillable: n.loggedWork?.nonbillableTime ?? 0,
      against: n.againstObject ? { type: n.againstObject.__typename, id: n.againstObject.id ?? null, title: n.againstObject.title ?? null } : null,
    }));
}
