import turndown from "./turndown";

export const html2markdown = (html: string) => turndown.turndown(html);
