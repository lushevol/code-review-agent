import turndownService, { type TagName } from "turndown";
import { gfm, strikethrough, tables } from "turndown-plugin-gfm";

const turndownClient = new turndownService({
  codeBlockStyle: "fenced",
});

turndownClient.use(gfm);
turndownClient.use([tables, strikethrough]);

addCustomRules(turndownClient);

function addCustomRules(turndownClient: turndownService) {
  turndownClient.addRule("strikethrough", {
    filter: ["del", "s", "strike"] as TagName[],
    replacement: (content) => `~~${content}~~`,
  });

  turndownClient.addRule("pre", {
    filter: ["pre"],
    replacement: (content, node: any) => {
      const code = node.querySelector("code");
      let language = "";

      if (node.getAttribute("lang")) {
        language = node.getAttribute("lang");
      } else if (code?.className) {
        const langMatch = code.className.match(/language-(\S+)/);
        language = langMatch?.[1] || "";
      } else if (node.className) {
        const mdFencesMatch = node.className.match(/md-fences|language-(\S+)/);
        language = mdFencesMatch?.[1] || "";
      }

      let codeContent = code ? code.textContent.trim() : content.trim();
      codeContent = codeContent.replace(/\\([^\\])/g, "$1");
      language = language.toLowerCase().replace(/[^a-z0-9+#]+/g, "");

      return `\`\`\`${language}\n${codeContent}\n\`\`\`\n`;
    },
  });

  turndownClient.addRule("inlineCode", {
    filter: (node) =>
      node.nodeName === "CODE" && node.parentNode?.nodeName !== "PRE",
    replacement: (content) => `\`${content}\``,
  });

  turndownClient.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const table = node as HTMLTableElement;
      const rows = Array.from(table.rows);

      const headers = Array.from(rows[0]?.cells || [])
        .map((cell) => cell.textContent?.trim() || "")
        .join(" | ");

      const separator = Array.from(rows[0]?.cells || [])
        .map(() => "---")
        .join(" | ");

      const data = rows
        .slice(1)
        .map((row) =>
          Array.from(row.cells)
            .map((cell) => cell.textContent?.trim() || "")
            .join(" | "),
        )
        .join("\n");

      return `\n| ${headers} |\n| ${separator} |\n${data ? `| ${data} |` : ""}\n\n`;
    },
  });
}

export default turndownClient;
