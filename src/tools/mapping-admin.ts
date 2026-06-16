import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { loadMapping, resolveMapping, defaultMapPath } from "../blitzit/mapping.js";
import { groupByTarget, makeEntry, upsertMapping, removeMapping, writeMapping } from "../blitzit/mapping-write.js";
import { getCurrentUser } from "../accelo/identity.js";
import { currentWeekRangeInTz } from "../accelo/dates.js";
import { dayRangeEpoch } from "../accelo/tz.js";
import { getBlitzitAuth } from "../blitzit/auth.js";
import { createBlitzitClient } from "../blitzit/client.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";

/** View current Blitzit→Accelo mappings, grouped by Accelo target (many-to-one). Read-only. */
export function buildListMappingsTool(): ToolDescriptor {
  return {
    name: "accelo_list_mappings",
    description:
      "List the current Blitzit→Accelo time mappings, grouped by Accelo target so you can see when several Blitzit project labels feed the same Accelo task (many-to-one). Read-only.",
    inputSchema: {},
    handler: async () => {
      const path = defaultMapPath();
      const map = loadMapping(path);
      const targets = groupByTarget(map);
      return text({
        path,
        labelCount: Object.keys(map).length,
        targetCount: targets.length,
        targets,
      });
    },
  };
}

/**
 * List Blitzit tasks (assigned to you, completed in the range) whose project
 * label does NOT resolve to any mapping — the "orphans" that the sync skips.
 * Use this as the first conversational step before mapping. Read-only.
 */
export function buildListOrphansTool(client: AcceloClient, config: AcceloConfig): ToolDescriptor {
  return {
    name: "accelo_list_orphan_tasks",
    description:
      "List your completed Blitzit tasks whose project is not yet mapped to an Accelo target (the entries the sync skips as 'unmapped'). Defaults to the current week. Read-only. Use this to find what needs mapping, then accelo_search_tasks to pick an Accelo target, then accelo_update_mapping to link them.",
    inputSchema: {
      from: z.string().optional().describe("Start date YYYY-MM-DD (default Monday of current week)."),
      to: z.string().optional().describe("End date YYYY-MM-DD inclusive (default Sunday of current week)."),
      listId: z.string().optional().describe("Optional Blitzit list id to filter tasks."),
    },
    handler: async (args) => {
      const user = await getCurrentUser(client);
      const tz = config.workdayTz ?? user.timezone ?? "UTC";
      const defaults = currentWeekRangeInTz(tz);
      const from = args.from ?? defaults.from;
      const to = args.to ?? defaults.to;
      const fromMs = dayRangeEpoch(from, tz).start * 1000;
      const toMs = dayRangeEpoch(to, tz).endExclusive * 1000;

      const { idToken, uid } = await getBlitzitAuth();
      const tasks = await fetchWeekDoneTasks(createBlitzitClient(idToken), uid, fromMs, toMs, args.listId);
      const map = loadMapping();

      // Group unmapped tasks by their leading Blitzit label (the part the mapping keys on).
      const byLabel = new Map<string, { label: string; count: number; samples: string[] }>();
      for (const t of tasks) {
        if (resolveMapping(map, t.project)) continue;
        const label = t.project.split("::")[0].trim();
        let g = byLabel.get(label);
        if (!g) { g = { label, count: 0, samples: [] }; byLabel.set(label, g); }
        g.count++;
        if (g.samples.length < 3 && t.project) g.samples.push(t.project);
      }
      const orphans = [...byLabel.values()].sort((a, b) => b.count - a.count);
      return text({
        from, to, tz,
        taskCount: tasks.length,
        orphanLabelCount: orphans.length,
        orphans,
        nextStep:
          orphans.length === 0
            ? "No orphan tasks in this range."
            : "For each label, run accelo_search_tasks to find the Accelo task to map to, then accelo_update_mapping { labels, objectId }.",
      });
    },
  };
}

/**
 * Add or update a mapping: point one or more Blitzit labels at a single Accelo
 * target. Preview by default; confirm:true persists. Many labels → one target
 * is supported so multiple internal projects can share one Accelo task.
 */
export function buildUpdateMappingTool(): ToolDescriptor {
  return {
    name: "accelo_update_mapping",
    description:
      "Add or update Blitzit→Accelo mappings: point one or more Blitzit project labels at a single Accelo target (objectId). Supports many-to-one (pass several labels to fold them onto one Accelo task). Preview by default; pass confirm:true to write the mapping file.",
    inputSchema: {
      labels: z.array(z.string()).min(1).describe("Blitzit project label(s) to map (e.g. ['CAIAConnect', 'Houston Eye']). Match the part before the first '::' in the task title."),
      objectId: z.number().int().positive().describe("Accelo object id to map these labels to (usually a task id from accelo_search_tasks)."),
      objectType: z.string().optional().describe("Accelo object type (default 'task')."),
      billable: z.boolean().optional().describe("Whether time for these labels is billable (e.g. false for internal/overhead)."),
      workTypeId: z.number().int().positive().optional().describe("Optional Accelo work type / class id."),
      confirm: z.boolean().optional().describe("Set true to write; otherwise returns a preview of the change."),
    },
    handler: async (args) => {
      const path = defaultMapPath();
      const map = loadMapping(path);
      const entry = makeEntry({ objectType: args.objectType, objectId: args.objectId, billable: args.billable, workTypeId: args.workTypeId });
      const { next, added, updated } = upsertMapping(map, args.labels, entry);

      if (!args.confirm) {
        return text({
          mode: "preview", path, target: entry,
          willAdd: added,
          willRetarget: updated.map((u) => ({ label: u.label, from: u.from, to: u.to })),
          hint: "Set confirm:true to write these mappings.",
        });
      }
      writeMapping(next, path);
      return text({ mode: "written", path, target: entry, added, retargeted: updated.map((u) => u.label) });
    },
  };
}

/** Remove one or more Blitzit labels from the mapping. Preview by default; confirm:true persists. */
export function buildRemoveMappingTool(): ToolDescriptor {
  return {
    name: "accelo_remove_mapping",
    description:
      "Remove one or more Blitzit project labels from the Blitzit→Accelo mapping. Preview by default; pass confirm:true to write the mapping file.",
    inputSchema: {
      labels: z.array(z.string()).min(1).describe("Blitzit project label(s) to unmap."),
      confirm: z.boolean().optional().describe("Set true to write; otherwise returns a preview."),
    },
    handler: async (args) => {
      const path = defaultMapPath();
      const map = loadMapping(path);
      const { next, removed, missing } = removeMapping(map, args.labels);

      if (!args.confirm) {
        return text({
          mode: "preview", path,
          willRemove: removed.map((r) => ({ label: r.label, target: r.entry })),
          notFound: missing,
          hint: "Set confirm:true to write this change.",
        });
      }
      writeMapping(next, path);
      return text({ mode: "written", path, removed: removed.map((r) => r.label), notFound: missing });
    },
  };
}
