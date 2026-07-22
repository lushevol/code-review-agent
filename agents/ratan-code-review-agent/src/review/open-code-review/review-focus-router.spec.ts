import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../workspace/types";
import { selectReviewFocuses } from "./review-focus-router";

describe("selectReviewFocuses", () => {
  it("always selects the general focus", () => {
    expect(selectReviewFocuses([])).toEqual([
      {
        focus: "general",
        reasons: ["General review applies to every pull request."],
      },
    ]);
  });

  it("selects test coverage for production changes without test changes", () => {
    expect(selectReviewFocuses([change("src/payment.ts", ["export function charge() {}"])]))
      .toContainEqual(
        expect.objectContaining({ focus: "tests" }),
      );
  });

  it("does not select test coverage when the change includes tests", () => {
    expect(
      selectReviewFocuses([
        change("src/payment.ts", ["export function charge() {}"]),
        change("src/payment.spec.ts", ["it('charges', () => {})"]),
      ]).map((selection) => selection.focus),
    ).not.toContain("tests");
  });

  it("recognizes conventional test directories", () => {
    expect(
      selectReviewFocuses([
        change("src/payment.ts", ["export function charge() {}"]),
        change("src/__tests__/payment.ts", ["test('charges', () => {})"]),
      ]).map((selection) => selection.focus),
    ).not.toContain("tests");
  });

  it("recognizes test helper directories", () => {
    expect(
      selectReviewFocuses([
        change("src/payment.ts", ["export function charge() {}"]),
        change("src/payment.test/helpers.ts", ["export const helper = () => {}"]),
      ]).map((selection) => selection.focus),
    ).not.toContain("tests");
  });

  it("selects error handling for catch and retry changes", () => {
    expect(
      selectReviewFocuses([
        change("src/client.ts", ["try {", "} catch (error) {", "await retry()"]),
      ]).map((selection) => selection.focus),
    ).toContain("error-handling");
  });

  it("selects error handling for callback error changes", () => {
    expect(
      selectReviewFocuses([
        change("src/client.ts", ["callback(error)", "(err) => handle(err)"]),
      ]).map((selection) => selection.focus),
    ).toContain("error-handling");
  });

  it("does not treat a default export as fallback behavior", () => {
    expect(
      selectReviewFocuses([
        change("src/client.ts", ["export default createClient;"]),
      ]).map((selection) => selection.focus),
    ).not.toContain("error-handling");
  });

  it("selects type design for exported TypeScript declarations", () => {
    expect(
      selectReviewFocuses([
        change("src/user.ts", ["export interface User { id: string }"]),
      ]).map((selection) => selection.focus),
    ).toContain("type-design");
  });

  it("selects comment accuracy for changed comments and documentation", () => {
    expect(
      selectReviewFocuses([
        change("src/user.ts", ["// The ID is always present"]),
        change("README.md", ["## Setup"]),
      ]).map((selection) => selection.focus),
    ).toContain("comments");
  });

  it("selects comment accuracy for inline comments", () => {
    expect(
      selectReviewFocuses([
        change("src/user.ts", ["return id; // The ID is always present"]),
      ]).map((selection) => selection.focus),
    ).toContain("comments");
  });

  it("does not infer focuses from deleted or renamed files without added lines", () => {
    expect(
      selectReviewFocuses([
        { path: "src/types/user.ts", status: "deleted", addedLines: [] },
        {
          path: "README.md",
          previousPath: "docs/README.md",
          status: "renamed",
          addedLines: [],
        },
      ]).map((selection) => selection.focus),
    ).toEqual(["general"]);
  });

  it("keeps focus order stable for mixed changes", () => {
    expect(
      selectReviewFocuses([
        change("src/user.ts", [
          "export interface User { id: string }",
          "try {",
          "} catch (error) {",
          "// Explain recovery",
        ]),
      ]).map((selection) => selection.focus),
    ).toEqual(["general", "tests", "error-handling", "type-design", "comments"]);
  });
});

function change(path: string, lines: string[]): ChangedFile {
  return {
    path,
    status: "modified",
    addedLines: lines.map((text, index) => ({ line: index + 1, text })),
  };
}
