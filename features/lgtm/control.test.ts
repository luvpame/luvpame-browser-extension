import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mountLgtm } from "./control";

vi.mock("./shared/storage", () => ({
  reviewTemplate: { getValue: vi.fn(async () => "LGTM") },
}));

describe("mountLgtm", () => {
  let controls: ReturnType<typeof mountLgtm> | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.body.innerHTML = `
      <header style="overflow: hidden">
        <button type="button" aria-haspopup="dialog">Submit review</button>
      </header>
    `;
  });

  afterEach(async () => {
    await act(async () => controls?.dispose());
    controls = undefined;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      controls = mountLgtm();
      controls.syncUrl(new URL("https://github.com/acme/widgets/pull/123"));
    });
  }

  async function prepareUnavailableApproval(): Promise<void> {
    await mount();
    document.querySelector("header > button")?.addEventListener("click", () => {
      const panel = document.createElement("div");
      panel.setAttribute("role", "dialog");
      panel.innerHTML = '<textarea name="pull_request_review[body]"></textarea>';
      document.body.append(panel);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".fast-lgtm-button")?.click();
    });
  }

  it("places LGTM immediately after the header review opener", async () => {
    await mount();

    const opener = document.querySelector("header > button");
    expect(opener?.nextElementSibling?.hasAttribute("data-fast-lgtm-root")).toBe(true);
    expect(opener?.nextElementSibling?.textContent).toBe("LGTM");
  });

  it("keeps LGTM disabled and shows a dismissible body alert when approval is unavailable", async () => {
    await prepareUnavailableApproval();

    const button = document.querySelector<HTMLButtonElement>(".fast-lgtm-button");
    expect(button?.textContent).toBe("LGTM");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.parentElement).toBe(document.body);
    expect(alert?.textContent).toContain("Approve is not available for this pull request.");

    await act(async () => {
      alert?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss error"]')?.click();
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(button?.isConnected).toBe(true);
  });

  it("removes the body alert when the controls are disposed", async () => {
    await prepareUnavailableApproval();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();

    await act(async () => controls?.dispose());

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector("[data-fast-lgtm-root]")).toBeNull();
  });
});
