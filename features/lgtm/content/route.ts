const PULL_REQUEST_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/;

export function isPullRequestPage(url: URL): boolean {
  return url.hostname === "github.com" && PULL_REQUEST_PATH.test(url.pathname);
}
