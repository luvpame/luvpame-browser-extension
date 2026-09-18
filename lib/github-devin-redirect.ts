import { browser } from "wxt/browser";

export const DEVIN_REDIRECT_CONTAINER_ID = "github-enhancer-devin-redirect";
export const DEVIN_REDIRECT_ICON_PATH = "devin-redirect-icon.png";
export const DEVIN_REDIRECT_STYLE_ID = "github-enhancer-devin-redirect-style";

const ACTIONS_CLASS = "github-enhancer-devin-redirect-actions";
const TOGGLE_ROLE = "toggle";
const TOGGLE_SELECTOR = `button[data-role="${TOGGLE_ROLE}"]`;

export interface RepoRedirectContext {
  owner: string;
  repo: string;
  isPrivate: boolean;
  isPullRequest: boolean;
  pullNumber?: string;
}

interface RepoUrlInput {
  owner: string;
  repo: string;
}

interface PullRequestUrlInput extends RepoUrlInput {
  pullNumber?: string;
}

interface RedirectButtonSpec {
  id: string;
  label: string;
  getUrl: (context: RepoRedirectContext) => string;
  isVisible?: (context: RepoRedirectContext) => boolean;
}

const buttonSelector = (id: string): string => `button[data-target="${id}"]`;

export const buildDeepwikiUrl = ({ owner, repo }: RepoUrlInput): string =>
  `https://deepwiki.com/${owner}/${repo}`;

export const buildDevinWikiUrl = ({ owner, repo }: RepoUrlInput): string =>
  `https://app.devin.ai/wiki/${owner}/${repo}`;

export const buildDevinReviewUrl = ({ owner, repo, pullNumber }: PullRequestUrlInput): string =>
  `https://app.devin.ai/review/${owner}/${repo}/pull/${pullNumber}`;

const isPrivateRepo = (doc: Document): boolean => {
  const meta = doc.querySelector<HTMLMetaElement>(
    'meta[name="octolytics-dimension-repository_public"]',
  );
  if (meta?.content) {
    return meta.content.toLowerCase() === "false";
  }

  const badge = doc.querySelector<HTMLElement>("#repository-container-header .Label--secondary");
  return badge?.textContent?.trim().toLowerCase() === "private";
};

export const getRepoRedirectContext = (
  url: URL,
  doc: Document = document,
): RepoRedirectContext | null => {
  if (url.hostname !== "github.com") {
    return null;
  }

  const [owner, repo, section, pullNumber] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo || owner === "settings") {
    return null;
  }

  const isPullRequest = section === "pull" && Boolean(pullNumber);
  return {
    owner,
    repo,
    isPrivate: isPrivateRepo(doc),
    isPullRequest,
    pullNumber: isPullRequest ? pullNumber : undefined,
  };
};

const redirectButtonSpecs: RedirectButtonSpec[] = [
  {
    id: "deepwiki",
    label: "DeepWiki",
    getUrl: (context) =>
      context.isPrivate ? buildDevinWikiUrl(context) : buildDeepwikiUrl(context),
  },
  {
    id: "devin-review",
    label: "Devin Review",
    getUrl: buildDevinReviewUrl,
    isVisible: ({ isPullRequest }) => isPullRequest,
  },
];

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

    #${DEVIN_REDIRECT_CONTAINER_ID}.${DEVIN_REDIRECT_CONTAINER_ID}-collapsed {
      gap: 0;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .${ACTIONS_CLASS} {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      margin-bottom: 8px;
      transform-origin: bottom right;
      animation: github-enhancer-devin-menu-in 180ms ease-out;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID}.${DEVIN_REDIRECT_CONTAINER_ID}-collapsed .${ACTIONS_CLASS} {
      display: none;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} button {
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

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-action {
      min-width: 132px;
      padding: 10px 12px;
      text-align: left;
      animation: github-enhancer-devin-action-in 180ms ease-out both;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-action:nth-child(2) {
      animation-delay: 35ms;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-toggle {
      width: 44px;
      height: 44px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transform-origin: center;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-toggle img {
      width: 32px;
      height: 32px;
      display: block;
      transition: transform 180ms ease;
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} button:hover {
      background: var(--bgColor-muted, #f6f8fa);
      border-color: var(--borderColor-emphasis, #818b98);
      box-shadow: 0 12px 24px rgba(31, 35, 40, 0.2);
      transform: translateY(-2px);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} button:active {
      box-shadow: 0 4px 12px rgba(31, 35, 40, 0.18);
      transform: translateY(0) scale(0.96);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} .github-enhancer-devin-redirect-toggle:hover img {
      transform: rotate(-6deg) scale(1.06);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID}.${DEVIN_REDIRECT_CONTAINER_ID}-expanded .github-enhancer-devin-redirect-toggle {
      transform: rotate(4deg);
    }

    #${DEVIN_REDIRECT_CONTAINER_ID} button:focus-visible {
      outline: 2px solid var(--focus-outlineColor, #0969da);
      outline-offset: 2px;
    }

    @keyframes github-enhancer-devin-menu-in {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes github-enhancer-devin-action-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
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

const ensureContainer = (doc: Document): HTMLElement => {
  let container = doc.getElementById(DEVIN_REDIRECT_CONTAINER_ID);
  if (!container) {
    container = doc.createElement("div");
    container.id = DEVIN_REDIRECT_CONTAINER_ID;
    doc.body.appendChild(container);
  }

  return container;
};

const ensureActionsContainer = (doc: Document, container: HTMLElement): HTMLDivElement => {
  let actions = container.querySelector<HTMLDivElement>(`.${ACTIONS_CLASS}`);
  if (!actions) {
    actions = doc.createElement("div");
    actions.className = ACTIONS_CLASS;
    container.appendChild(actions);
  }

  return actions;
};

const setExpanded = (container: HTMLElement, expanded: boolean): void => {
  container.classList.toggle(`${DEVIN_REDIRECT_CONTAINER_ID}-expanded`, expanded);
  container.classList.toggle(`${DEVIN_REDIRECT_CONTAINER_ID}-collapsed`, !expanded);
  container.dataset.expanded = String(expanded);
  container
    .querySelector<HTMLButtonElement>(TOGGLE_SELECTOR)
    ?.setAttribute("aria-expanded", String(expanded));
};

const getDevinIconUrl = (): string =>
  browser.runtime?.getURL?.("/devin-redirect-icon.png") ?? DEVIN_REDIRECT_ICON_PATH;

const createToggleIcon = (doc: Document): HTMLImageElement => {
  const icon = doc.createElement("img");
  icon.src = getDevinIconUrl();
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");

  return icon;
};

const ensureToggleButton = (doc: Document, container: HTMLElement): void => {
  if (container.querySelector(TOGGLE_SELECTOR)) {
    return;
  }

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "github-enhancer-devin-redirect-toggle";
  button.dataset.role = TOGGLE_ROLE;
  button.appendChild(createToggleIcon(doc));
  button.setAttribute("aria-label", "Toggle Devin shortcuts");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => {
    setExpanded(container, container.dataset.expanded !== "true");
  });
  container.appendChild(button);
};

const ensureButton = (
  doc: Document,
  container: HTMLElement,
  spec: RedirectButtonSpec,
): HTMLButtonElement => {
  let button = container.querySelector<HTMLButtonElement>(buttonSelector(spec.id));
  if (!button) {
    button = doc.createElement("button");
    button.type = "button";
    button.className = "github-enhancer-devin-redirect-action";
    button.dataset.target = spec.id;
    button.textContent = spec.label;
    button.addEventListener("click", () => {
      const url = button?.dataset.url;
      if (url) {
        window.open(url, "_blank", "noopener");
      }
    });
    container.appendChild(button);
  }

  return button;
};

const removeHiddenButtons = (actions: HTMLElement, context: RepoRedirectContext): void => {
  for (const spec of redirectButtonSpecs) {
    if (spec.isVisible?.(context) === false) {
      actions.querySelector(buttonSelector(spec.id))?.remove();
    }
  }
};

export const ensureDevinRedirectButtons = (
  doc: Document = document,
  url: URL = new URL(window.location.href),
): boolean => {
  const context = getRepoRedirectContext(url, doc);
  if (!context) {
    removeDevinRedirectButtons(doc);
    return false;
  }

  ensureStyle(doc);
  const container = ensureContainer(doc);
  const wasCurrent =
    container.dataset.owner === context.owner && container.dataset.repo === context.repo;
  container.dataset.owner = context.owner;
  container.dataset.repo = context.repo;

  const actions = ensureActionsContainer(doc, container);
  removeHiddenButtons(actions, context);

  for (const spec of redirectButtonSpecs) {
    if (spec.isVisible?.(context) === false) {
      continue;
    }

    ensureButton(doc, actions, spec).dataset.url = spec.getUrl(context);
  }

  ensureToggleButton(doc, container);
  if (!container.dataset.expanded) {
    setExpanded(container, false);
  }

  return !wasCurrent;
};

export const removeDevinRedirectButtons = (doc: Document = document): void => {
  doc.getElementById(DEVIN_REDIRECT_CONTAINER_ID)?.remove();
};
