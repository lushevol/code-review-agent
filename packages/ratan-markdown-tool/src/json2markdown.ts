type TableRow = Record<string, string> | string[];

export type DataObject =
  | { p: string }
  | { h1: string }
  | { h2: string }
  | { h3: string }
  | { h4: string }
  | { h5: string }
  | { h6: string }
  | { img: { title: string; source: string } }
  | { code: { content: string; language?: string } }
  | { blockquote: string }
  | { ul: string[] }
  | { ol: string[] }
  | { table: { headers: string[]; rows: TableRow[] } };

export const p = (content: string): DataObject => ({ p: content });
export const h1 = (content: string): DataObject => ({ h1: content });
export const h2 = (content: string): DataObject => ({ h2: content });
export const h3 = (content: string): DataObject => ({ h3: content });
export const h4 = (content: string): DataObject => ({ h4: content });
export const h5 = (content: string): DataObject => ({ h5: content });
export const h6 = (content: string): DataObject => ({ h6: content });

export const image = (title: string, source: string): DataObject => ({
  img: { title, source },
});

export const code = (content: string, language?: string): DataObject => ({
  code: { content, language },
});

export const blockquote = (content: string): DataObject => ({ blockquote: content });
export const list = (items: string[]): DataObject => ({ ul: items });
export const orderedList = (items: string[]): DataObject => ({ ol: items });

export const table = (headers: string[], rows: TableRow[]): DataObject => ({
  table: { headers, rows },
});

export const line = (): DataObject => p("---");

export function jsonToMarkdown(
  data: DataObject | DataObject[] | string | string[],
  prefix = "",
): string {
  const blocks = Array.isArray(data) ? data : [data];
  return prefix + blocks.map(renderBlock).join("\n\n");
}

function renderBlock(block: DataObject | string): string {
  if (typeof block === "string") return block;
  if ("p" in block) return block.p;
  if ("h1" in block) return `# ${block.h1}`;
  if ("h2" in block) return `## ${block.h2}`;
  if ("h3" in block) return `### ${block.h3}`;
  if ("h4" in block) return `#### ${block.h4}`;
  if ("h5" in block) return `##### ${block.h5}`;
  if ("h6" in block) return `###### ${block.h6}`;
  if ("img" in block) return `![${block.img.title}](${block.img.source})`;
  if ("code" in block) {
    return `\`\`\`${block.code.language ?? ""}\n${block.code.content}\n\`\`\``;
  }
  if ("blockquote" in block) {
    return block.blockquote.split("\n").map((line) => `> ${line}`).join("\n");
  }
  if ("ul" in block) return block.ul.map((item) => `- ${item}`).join("\n");
  if ("ol" in block) return block.ol.map((item, index) => `${index + 1}. ${item}`).join("\n");
  if ("table" in block) return renderTable(block.table.headers, block.table.rows);
  return "";
}

function renderTable(headers: string[], rows: TableRow[]): string {
  const header = `| ${headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : headers.map((heading) => row[heading] ?? "");
    return `| ${cells.map(escapeCell).join(" | ")} |`;
  });
  return [header, separator, ...body].join("\n");
}

function escapeCell(value: string): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
