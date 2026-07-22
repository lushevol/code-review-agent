# ratan-markdown-tool

Small Markdown utilities used by the workspace.

- `jsonToMarkdown(blocks, prefix?)` builds Markdown from paragraphs, headings,
  images, fenced code, blockquotes, ordered/unordered lists, and tables.
- `html2markdown(html)` converts HTML using Turndown with GFM support.

The JSON builder is implemented locally and has no `json2md` dependency.
HTML-to-text and Markdown-to-HTML conversions are not part of the public API.

```bash
pnpm --filter ratan-markdown-tool test
pnpm --filter ratan-markdown-tool build
```
