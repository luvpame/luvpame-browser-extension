export const setMergeGuard = (enabled: boolean, doc: Document = document): void => {
  const id = "luvpame-merge-guard";
  if (!enabled) {
    doc.getElementById(id)?.remove();
    return;
  }
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = 'button[data-testid="merge-button"] { display: none !important; }';
  (doc.head ?? doc.documentElement).append(style);
};
