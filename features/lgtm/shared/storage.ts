import { storage } from "#imports";

import { DEFAULT_TEMPLATE } from "./template";

export const reviewTemplate = storage.defineItem<string>("sync:reviewTemplate", {
  fallback: DEFAULT_TEMPLATE,
});
