import { describe, it, expect } from "vitest";
import { extractAdoWorkItemIds } from "./commit-parser";

describe("extractAdoWorkItemIds", () => {
  it("extracts AB# prefixed IDs", () => {
    expect(extractAdoWorkItemIds(["Fix login bug AB#12345"])).toEqual([12345]);
  });

  it("extracts multiple AB# IDs", () => {
    expect(extractAdoWorkItemIds(["AB#12345, AB#67890"])).toEqual([
      12345, 67890,
    ]);
  });

  it("extracts hash-prefixed IDs with 5+ digits", () => {
    expect(extractAdoWorkItemIds(["Fixes #12345"])).toEqual([12345]);
  });

  it("does not extract short hash-prefixed numbers", () => {
    expect(extractAdoWorkItemIds(["Issue #123"])).toEqual([]);
  });

  it("extracts IDs from fix keywords", () => {
    expect(
      extractAdoWorkItemIds(["fixes 12345", "resolves 67890"]),
    ).toEqual([12345, 67890]);
  });

  it("deduplicates IDs", () => {
    expect(extractAdoWorkItemIds(["AB#12345", "fixes 12345"])).toEqual([
      12345,
    ]);
  });

  it("returns empty array for no matches", () => {
    expect(extractAdoWorkItemIds(["Refactor button component"])).toEqual([]);
  });

  it("handles empty input", () => {
    expect(extractAdoWorkItemIds([])).toEqual([]);
  });
});
