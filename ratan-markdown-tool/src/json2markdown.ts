import json2md from "json2md";

export const p = (content: string) => {
  return { p: content };
};

export const h1 = (content: string) => {
  return { h1: content };
};
export const h2 = (content: string) => {
  return { h2: content };
};

export const h3 = (content: string) => {
  return { h3: content };
};

export const h4 = (content: string) => {
  return { h4: content };
};

export const h5 = (content: string) => {
  return { h5: content };
};
export const h6 = (content: string) => {
  return { h6: content };
};

export const image = (title: string, source: string) => {
  return {
    img: {
      title,
      source,
    },
  };
};

export const code = (content: string, language?: string) => {
  return {
    code: {
      content,
      language,
    },
  };
};
export const blockquote = (content: string) => {
  return {
    blockquote: content,
  };
};
export const list = (items: string[]) => {
  return {
    ul: items,
  };
};
export const orderedList = (items: string[]) => {
  return {
    ol: items,
  };
};
export const table = (
  headers: string[],
  rows: Array<{ [column: string]: string }> | string[][],
) => {
  return {
    table: {
      headers,
      rows,
    },
  };
};

export const line = () => {
  return {
    p: "---",
  };
};

export const jsonToMarkdown = (
  data: json2md.DataObject | json2md.DataObject[] | string | string[],
  prefix?: string,
) => {
  return json2md(data, prefix);
};
