const state = document.querySelector("#state");
const output = document.querySelector("#results");
let pending;
window.bench = {
  state: "waiting",
  results: [],
  failures: [],
  run() {
    if (this.state === "waiting")
      throw new Error(
        "Extension is not ready. Reload this page and wait for ready before running.",
      );
    if (pending) throw new Error("A benchmark is already running");
    this.state = "warming";
    state.textContent = "Preparing model (outside measurement)…";
    output.textContent = "";
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      document.dispatchEvent(new CustomEvent("translation-bench:command", { detail: "run" }));
    });
  },
  release() {
    document.dispatchEvent(new CustomEvent("translation-bench:command", { detail: "release" }));
  },
};
document.addEventListener("translation-bench:event", (event) => {
  const value = JSON.parse(event.detail);
  window.bench.state = value.kind;
  state.textContent = value.kind;
  if (value.kind === "done") {
    window.bench.results.push(value.result);
    output.textContent = JSON.stringify(value.result, null, 2);
    pending?.resolve(value.result);
    pending = undefined;
  } else if (value.kind === "failed") {
    window.bench.failures.push(value.error);
    output.textContent = value.error;
    pending?.reject(new Error(value.error));
    pending = undefined;
  }
});
document.querySelector("#run").onclick = () => window.bench.run().catch(console.error);
document.querySelector("#release").onclick = () => window.bench.release();
