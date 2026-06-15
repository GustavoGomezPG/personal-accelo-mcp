export const FIRESTORE_PROJECT = "blitzitapp1";
const BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

export interface FirestoreDoc { id: string; fields: Record<string, any> }

export interface BlitzitClient {
  /** Run a structuredQuery against the `tasks` collection, returning documents. */
  queryTasksByOwner(uid: string): Promise<FirestoreDoc[]>;
}

export function createBlitzitClient(idToken: string): BlitzitClient {
  return {
    async queryTasksByOwner(uid: string): Promise<FirestoreDoc[]> {
      const body = {
        structuredQuery: {
          from: [{ collectionId: "tasks" }],
          where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: { stringValue: uid } } },
        },
      };
      const res = await fetch(`${BASE}:runQuery`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Blitzit Firestore query failed (HTTP ${res.status}).`);
      const rows = (await res.json()) as Array<{ document?: { name: string; fields: Record<string, any> } }>;
      return rows
        .filter((r) => r.document)
        .map((r) => ({ id: r.document!.name.split("/documents/")[1].split("/").pop()!, fields: r.document!.fields }));
    },
  };
}
