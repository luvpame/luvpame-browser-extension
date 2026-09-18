export const CURSOR_MARKER = "{{cursor}}";

export const DEFAULT_TEMPLATE = `LGTM!!

{{cursor}}

![LGTM](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeHA2cDZmZ2J3NXBoOWprd3pnb3BvMjF6d3BkNWk1MjQ0cmJydW90YyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ABC2bhcjgwZ1ZyvpvI/giphy.gif)`;

export type TemplateResult =
  | {
      ok: true;
      text: string;
      cursorOffset: number;
    }
  | {
      ok: false;
      error: "required" | "multiple-cursors";
    };

export function prepareTemplate(source: string): TemplateResult {
  const markerCount = source.split(CURSOR_MARKER).length - 1;

  if (markerCount > 1) {
    return { ok: false, error: "multiple-cursors" };
  }

  const text = source.replace(CURSOR_MARKER, "");
  if (text.trim().length === 0) {
    return { ok: false, error: "required" };
  }

  const markerOffset = source.indexOf(CURSOR_MARKER);
  return {
    ok: true,
    text,
    cursorOffset: markerOffset === -1 ? text.length : markerOffset,
  };
}
