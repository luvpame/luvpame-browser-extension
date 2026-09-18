export const convertHtml = async (html: string, url: string): Promise<string> => {
  const { default: Defuddle } = await import("defuddle/full");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const markdown = new Defuddle(doc, { markdown: true, url }).parse().content.trim();
  if (!markdown) throw new Error("読み取れる本文がありません。");
  return markdown;
};
export const writeClipboard = (text: string, doc: Document = document): void => {
  const input = doc.createElement("textarea");
  input.value = text;
  input.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
  doc.body.append(input);
  input.focus();
  input.select();
  try {
    if (!doc.execCommand("copy")) throw new Error("クリップボードへの書き込みが拒否されました。");
  } finally {
    input.remove();
  }
};
