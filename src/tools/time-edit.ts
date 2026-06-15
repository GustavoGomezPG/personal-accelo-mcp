import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration, formatDuration } from "../accelo/time.js";
import { buildSubject } from "../accelo/nomenclature.js";

const TIME_MUTATION = `mutation EditTime($input: updateNoteLoggedTimeArgs!) { updateNoteLoggedTime(input: $input) { id subject } }`;
const SUBJECT_MUTATION = `mutation EditSubject($input: updateNoteSubjectArgs!) { updateNoteSubject(input: $input) { id subject } }`;

export function buildEditTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_edit_time",
    description:
      "Edit a time entry's logged time and/or subject. Pass `time` to change duration; pass projectLabel+topic+description (or a verbatim `subject`) to change the title. Preview by default; confirm:true applies.",
    inputSchema: {
      noteId: z.number().int().describe("Note id of the entry."),
      time: z.string().optional().describe("New duration: '2h', '45m', '1:30'."),
      projectLabel: z.string().optional().describe("New nomenclature segment 1."),
      topic: z.string().optional().describe("New nomenclature segment 2."),
      description: z.string().optional().describe("New nomenclature segment 3."),
      subject: z.string().optional().describe("Verbatim new subject (alternative to the three parts)."),
      confirm: z.boolean().optional().describe("Set true to apply."),
    },
    handler: async (args) => {
      const changes: { loggedTime?: string; seconds?: number; subject?: string } = {};
      let newSeconds: number | undefined;
      let newSubject: string | undefined;

      if (args.time !== undefined) {
        newSeconds = parseDuration(args.time);
        changes.loggedTime = formatDuration(newSeconds);
        changes.seconds = newSeconds;
      }
      if (args.subject !== undefined) {
        newSubject = args.subject.trim();
      } else if (args.projectLabel !== undefined || args.topic !== undefined || args.description !== undefined) {
        newSubject = buildSubject(args.projectLabel ?? "", args.topic ?? "", args.description ?? "");
      }
      if (newSubject !== undefined) changes.subject = newSubject;

      if (newSeconds === undefined && newSubject === undefined) {
        throw new Error("No change specified: provide `time` and/or a new subject.");
      }
      if (!args.confirm) {
        return text({ preview: true, noteId: args.noteId, changes, willApply: "Set confirm:true to apply." });
      }

      if (newSeconds !== undefined) {
        await client.mutate(TIME_MUTATION, { input: { noteId: args.noteId, noteLoggedTime: newSeconds } });
      }
      if (newSubject !== undefined) {
        await client.mutate(SUBJECT_MUTATION, { input: { noteId: args.noteId, noteSubject: newSubject } });
      }
      return text({ updated: true, noteId: args.noteId, changes });
    },
  };
}
