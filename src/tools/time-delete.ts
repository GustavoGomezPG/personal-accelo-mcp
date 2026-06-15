import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";

const DELETE_MUTATION = `mutation Delete($input: deleteWorkLogArgs!) { deleteWorkLog(input: $input) }`;

export function buildDeleteTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_delete_time",
    description: "Delete a time entry by its note id. DESTRUCTIVE: requires confirm:true; otherwise only reports what would be deleted.",
    inputSchema: {
      noteId: z.number().int().describe("Note id of the entry to delete (used as workLogId)."),
      confirm: z.boolean().optional().describe("Must be true to actually delete."),
    },
    handler: async (args) => {
      if (args.confirm !== true) return text({ deleted: false, noteId: args.noteId, note: "Destructive action. Re-call with confirm:true to delete this entry." });
      await client.mutate<{ deleteWorkLog: boolean }>(DELETE_MUTATION, { input: { workLogId: args.noteId } });
      return text({ deleted: true, noteId: args.noteId });
    },
  };
}
