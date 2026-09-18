import { initializeTextareaVim } from "../features/vim/src/content";
export default defineContentScript({ matches: ["<all_urls>"], main: initializeTextareaVim });
