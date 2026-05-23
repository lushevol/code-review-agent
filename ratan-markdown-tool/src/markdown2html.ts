export const markdown2html = async (markdown: string) => {
  const { marked } = await import("marked");
  return marked.parse(markdown);
};
