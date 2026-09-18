import { describe, expect, it } from "vite-plus/test";

import { isPullRequestPage } from "./route";

describe("isPullRequestPage", () => {
  it.each(["files", "changes"])("recognizes the %s pull request route", (view) => {
    expect(isPullRequestPage(new URL(`https://github.com/acme/widgets/pull/123/${view}`))).toBe(
      true,
    );
  });

  it("recognizes the base Conversation pull request route", () => {
    expect(isPullRequestPage(new URL("https://github.com/acme/widgets/pull/123"))).toBe(true);
  });

  it("recognizes other pull request subpaths", () => {
    expect(isPullRequestPage(new URL("https://github.com/acme/widgets/pull/123/commits"))).toBe(
      true,
    );
  });

  it("does not recognize a non-pull-request page", () => {
    expect(isPullRequestPage(new URL("https://github.com/acme/widgets/issues/123"))).toBe(false);
  });

  it("does not mount on another host", () => {
    expect(isPullRequestPage(new URL("https://example.com/acme/widgets/pull/123/changes"))).toBe(
      false,
    );
  });
});
