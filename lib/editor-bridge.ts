export const suspendVimEvent = "luvpame:vim-suspend";
export const resumeVimEvent = "luvpame:vim-resume";

// Content scripts share the isolated DOM event channel, not module instances.
export const suspendVim = (doc: Document = document): ((target?: HTMLTextAreaElement) => void) => {
  doc.dispatchEvent(new CustomEvent(suspendVimEvent));
  let finished = false;
  return (target) => {
    if (finished) return;
    finished = true;
    doc.dispatchEvent(new CustomEvent(resumeVimEvent, { detail: target }));
  };
};
