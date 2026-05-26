import { describe, expect, it } from "vitest";
import { buildUnifiedDiffRows } from "./unified-diff-view";

function guttersFor(patch: string): (number | null)[] {
  return buildUnifiedDiffRows(patch).map((row) => row.gutter);
}

describe("buildUnifiedDiffRows", () => {
  it("numbers new-file writes from the + side of the hunk header", () => {
    const patch = [
      "--- /dev/null",
      "+++ b/new.md",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");

    expect(guttersFor(patch)).toEqual([null, null, null, 1, 2]);
  });

  it("uses hunk offsets for edits far into a file", () => {
    const patch = [
      "--- a/UJIMA-ROADMAP.md",
      "+++ b/UJIMA-ROADMAP.md",
      "@@ -165,1 +165,3 @@",
      "-old tail",
      "+new tail",
      "+extra",
    ].join("\n");

    expect(guttersFor(patch)).toEqual([null, null, null, 165, 165, 166]);
  });

  it("advances context, deletion, and addition counters within a hunk", () => {
    const patch = [
      "@@ -10,3 +10,4 @@",
      " unchanged",
      "-removed",
      "+added",
      " trailing",
    ].join("\n");

    expect(guttersFor(patch)).toEqual([null, 10, 11, 11, 12]);
  });

  it("falls back to sequential numbers when the hunk header is malformed", () => {
    const patch = ["@@", "+one", "+two"].join("\n");

    expect(guttersFor(patch)).toEqual([null, 1, 2]);
  });
});
