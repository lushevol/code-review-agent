export const transformPlainTextToHtml = (text: string) => {
  return text.replace(/(?:\r\n|\r|\n)/g, "<br>");
};

export const transformHtmlToPlainText = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
};
