import { describe, it, expect } from "vitest";
import { parseDescription, normalizeTask, decodeEntities } from "./tasks.js";

describe("decodeEntities", () => {
  it("decodes common HTML entities", () => {
    expect(decodeEntities("A &amp; B &lt;x&gt; &quot;q&quot; &#39;y&#39;")).toBe('A & B <x> "q" \'y\'');
  });
});

describe("parseDescription", () => {
  it("splits <strong>topic</strong><br>detail", () => {
    expect(parseDescription("<strong>Website</strong><br>Fixed the header")).toEqual({ topic: "Website", detail: "Fixed the header" });
  });
  it("strips nested tags and decodes entities in detail", () => {
    expect(parseDescription('<strong>Website</strong><br>Updated <a href="x">link</a> &amp; more')).toEqual({ topic: "Website", detail: "Updated link & more" });
  });
  it("handles missing <strong> by leaving topic empty", () => {
    expect(parseDescription("just some text")).toEqual({ topic: "", detail: "just some text" });
  });
  it("handles empty input", () => {
    expect(parseDescription("")).toEqual({ topic: "", detail: "" });
  });
});

describe("normalizeTask", () => {
  it("maps Firestore fields to a BlitzitTask", () => {
    const fields = {
      title: { stringValue: "Datamax" },
      description: { stringValue: "<strong>Website</strong><br>DNS work" },
      timeTaken: { integerValue: "28800000" },
      endTime: { integerValue: "1780934026000" },
      listId: { stringValue: "VJ46SaipqK2ikg3aoi1i" },
      board: { stringValue: "done" },
    };
    expect(normalizeTask("abc", fields)).toEqual({
      id: "abc", project: "Datamax", topic: "Website", detail: "DNS work",
      seconds: 28800, endTimeMs: 1780934026000, listId: "VJ46SaipqK2ikg3aoi1i", board: "done",
    });
  });
  it("defaults missing numbers/strings safely", () => {
    expect(normalizeTask("x", { title: { stringValue: "Internal" } })).toEqual({
      id: "x", project: "Internal", topic: "", detail: "", seconds: 0, endTimeMs: 0, listId: null, board: "",
    });
  });
});
