const MARKDOWN_TITLE_ESCAPE_PATTERN = /[\\[\]]/g;

export function escapeMarkdownTitle(title: string): string {
  return title.replace(MARKDOWN_TITLE_ESCAPE_PATTERN, escapeMarkdownCharacter);
}

export function buildMarkdownLink(title: string, url: string): string {
  const normalizedTitle = normalizeTitle(title, url);
  return `[${escapeMarkdownTitle(normalizedTitle)}](${url})`;
}

function normalizeTitle(title: string, fallbackUrl: string): string {
  return title.trim() || fallbackUrl;
}

function escapeMarkdownCharacter(character: string): string {
  switch (character) {
    case "\\":
      return "\\\\";
    case "[":
      return "【";
    case "]":
      return "】";
    default:
      return character;
  }
}
