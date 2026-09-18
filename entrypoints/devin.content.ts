import { watchFeatures } from "../lib/features";
import { setMergeGuard } from "../lib/merge-guard";
export default defineContentScript({
  matches: ["https://app.devin.ai/*"],
  main(ctx) {
    let enabled = false;
    const apply = () => setMergeGuard(enabled && location.pathname.startsWith("/review/"));
    const stop = watchFeatures((settings) => {
      enabled = settings.mergeGuardEnabled;
      apply();
    });
    ctx.addEventListener(window, "wxt:locationchange", apply);
    ctx.onInvalidated(() => {
      stop();
      setMergeGuard(false);
    });
  },
});
