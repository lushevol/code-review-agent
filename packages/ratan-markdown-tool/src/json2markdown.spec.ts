import { describe, expect, it } from "vitest";
import {
  blockquote,
  code,
  h3,
  image,
  jsonToMarkdown,
  line,
  list,
  orderedList,
  p,
  table,
} from "./json2markdown";

describe("jsonToMarkdown", () => {
  it("builds the blocks used by ADO comments", () => {
    expect(
      jsonToMarkdown([
        h3("Review"),
        p("No blocking issues."),
        list(["Coverage: 90%", "Bugs: 0"]),
        line(),
      ]),
    ).toBe(
      "### Review\n\nNo blocking issues.\n\n- Coverage: 90%\n- Bugs: 0\n\n---",
    );
  });

  it("builds rich Markdown without external rendering dependencies", () => {
    expect(
      jsonToMarkdown([
        image("diagram", "https://example.invalid/diagram.png"),
        code("const ok = true;", "ts"),
        blockquote("Review carefully\nSecond line"),
        orderedList(["first", "second"]),
        table(["Name", "Value"], [["A|B", "one\ntwo"]]),
      ]),
    ).toBe(
      [
        "![diagram](https://example.invalid/diagram.png)",
        "```ts\nconst ok = true;\n```",
        "> Review carefully\n> Second line",
        "1. first\n2. second",
        "| Name | Value |\n| --- | --- |\n| A\\|B | one<br>two |",
      ].join("\n\n"),
    );
  });
});
