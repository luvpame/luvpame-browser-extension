import { browser } from "wxt/browser";

export const DEVIN_REDIRECT_CONTAINER_ID = "github-enhancer-devin-redirect";
export const DEVIN_REDIRECT_ICON_PATH = "devin-redirect-icon.png";
export const DEVIN_REDIRECT_STYLE_ID = "github-enhancer-devin-redirect-style";

interface PullRequestUrlInput {
  owner: string;
  repo: string;
  pullNumber: string;
}

export const buildDevinReviewUrl = ({ owner, repo, pullNumber }: PullRequestUrlInput): string =>
  `https://app.devin.ai/review/${owner}/${repo}/pull/${pullNumber}`;

export const getRepoRedirectContext = (url: URL): PullRequestUrlInput | null => {
  if (url.hostname !== "github.com") return null;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/|$)/);
  if (!match || match[1] === "settings") return null;
  return { owner: match[1]!, repo: match[2]!, pullNumber: match[3]! };
};

const ensureStyle = (doc: Document): void => {
  if (doc.getElementById(DEVIN_REDIRECT_STYLE_ID)) {
    return;
  }

  const styleElement = doc.createElement("style");
  styleElement.id = DEVIN_REDIRECT_STYLE_ID;
  styleElement.textContent = `
    #${DEVIN_REDIRECT_CONTAINER_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transform-origin: bottom right;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} a {
      appearance: none;
      border: 1px solid var(--borderColor-default, #d0d7de);
      border-radius: 8px;
      background: var(--bgColor-default, #ffffff);
      color: var(--fgColor-default, #24292f);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      box-shadow: 0 8px 20px rgba(31, 35, 40, 0.16);
      transition:
        background 140ms ease,
        border-color 140ms ease,
        box-shadow 140ms ease,
        transform 140ms ease;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-link {
      width: 44px;
      height: 44px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transform-origin: center;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-link img {
      width: 32px;
      height: 32px;
      display: block;
      transition: transform 180ms ease;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} a:hover {
      background: var(--bgColor-muted, #f6f8fa);
      border-color: var(--borderColor-emphasis, #818b98);
      box-shadow: 0 12px 24px rgba(31, 35, 40, 0.2);
      transform: translateY(-2px);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} a:active {
      box-shadow: 0 4px 12px rgba(31, 35, 40, 0.18);
      transform: translateY(0) scale(0.96);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-link:hover img {
      transform: rotate(-6deg) scale(1.06);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} a:focus-visible {
      outline: 2px solid var(--focus-outlineColor, #0969da);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      #${DEVIN_REDIRECT_CONTAINER_ID},
      #${DEVIN_REDIRECT_CONTAINER_ID} *,
      #${DEVIN_REDIRECT_CONTAINER_ID} *::before,
      #${DEVIN_REDIRECT_CONTAINER_ID} *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  `;

  (doc.head ?? doc.body).appendChild(styleElement);
};

export const ensureDevinRedirectButtons = (
  doc: Document = document,
  url: URL = new URL(window.location.href),
): boolean => {
  const context = getRepoRedirectContext(url);
  if (!context) {
    removeDevinRedirectButtons(doc);
    return false;
  }

  ensureStyle(doc);
  let container = doc.getElementById(DEVIN_REDIRECT_CONTAINER_ID);
  if (!container) {
    container = doc.createElement("div");
    container.id = DEVIN_REDIRECT_CONTAINER_ID;
    const link = doc.createElement("a");
    link.className = "github-enhancer-devin-redirect-link";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Devin Review（別タブで開く）");
    link.title = "Devin Review（別タブで開く）";
    const icon = doc.createElement("img");
    icon.src = browser.runtime?.getURL?.("/devin-redirect-icon.png") ?? DEVIN_REDIRECT_ICON_PATH;
    icon.alt = "";
    link.appendChild(icon);
    container.appendChild(link);
    doc.body.appendChild(container);
  }

  const link = container.querySelector("a")!;
  const href = buildDevinReviewUrl(context);
  if (link.href === href) return false;
  link.href = href;
  return true;
};

export const removeDevinRedirectButtons = (doc: Document = document): void => {
  doc.getElementById(DEVIN_REDIRECT_CONTAINER_ID)?.remove();
};
