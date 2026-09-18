import {
  enhanceMarkdownEditors,
  replaceTextareaSelection,
  type MarkdownEditorTarget,
} from "../lib/github-markdown-editor";
import { buildMarkdownTable } from "../lib/markdown-table";
import {
  createDraggingGridSelection,
  createIdleGridSelection,
  defaultGridSize,
  finishGridSelection,
  formatGridSelectionLabel,
  hasSelectedDimensions,
  isCellSelected,
  updateGridSelection,
  type GridCellPosition,
  type GridSelection,
} from "../lib/table-grid";

const styleElementId = "gmti-style";
const popoverSelector = "[data-gmti-popover='true']";
const firstGridIndex = 1;
const firstCellIndex = 0;
const selectedState = "true";
const unselectedState = "false";

interface PopoverFields {
  cancelButton: HTMLButtonElement;
  cells: HTMLButtonElement[];
  insertButton: HTMLButtonElement;
  popover: HTMLElement;
  selectionLabel: HTMLElement;
}

interface ControlBindingContext {
  documentRef: Document;
  fields: PopoverFields;
  selection: GridSelection;
  target: MarkdownEditorTarget;
}

const contentStyles = `
  .gmti-control {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
  }

  .gmti-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--borderColor-default, #d0d7de);
    border-radius: 6px;
    color: var(--fgColor-default, #1f2328);
    background: var(--bgColor-default, #ffffff);
    font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }

  .gmti-button:hover {
    background: var(--bgColor-muted, #f6f8fa);
  }

  .gmti-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 1000;
    display: grid;
    gap: 10px;
    width: 248px;
    padding: 12px;
    border: 1px solid var(--borderColor-default, #d0d7de);
    border-radius: 10px;
    background: var(--bgColor-default, #ffffff);
    box-shadow: 0 12px 32px rgba(31, 35, 40, 0.16);
  }

  .gmti-popover[hidden] {
    display: none;
  }

  .gmti-selection-label {
    color: var(--fgColor-muted, #59636e);
    font: 600 12px/1.2 ui-sans-serif, system-ui, sans-serif;
  }

  .gmti-grid {
    display: grid;
    grid-template-columns: repeat(${defaultGridSize}, minmax(0, 1fr));
    gap: 4px;
  }

  .gmti-grid-cell {
    aspect-ratio: 1 / 1;
    min-height: 22px;
    padding: 0;
    border: 1px solid var(--borderColor-default, #d0d7de);
    border-radius: 4px;
    background: var(--bgColor-muted, #f6f8fa);
    cursor: pointer;
    user-select: none;
  }

  .gmti-grid-cell:hover {
    border-color: var(--borderColor-accent-emphasis, #0969da);
  }

  .gmti-grid-cell[data-selected='true'] {
    border-color: var(--borderColor-accent-emphasis, #0969da);
    background: color-mix(in srgb, var(--button-primary-bgColor-rest, #1f883d) 18%, white);
  }

  .gmti-popover-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .gmti-secondary-button,
  .gmti-primary-button {
    min-height: 30px;
    padding: 0 10px;
    border-radius: 6px;
    font: 600 12px/1.2 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }

  .gmti-secondary-button {
    border: 1px solid var(--borderColor-default, #d0d7de);
    color: var(--fgColor-default, #1f2328);
    background: var(--bgColor-default, #ffffff);
  }

  .gmti-primary-button {
    border: 1px solid transparent;
    color: #ffffff;
    background: var(--button-primary-bgColor-rest, #1f883d);
  }

  .gmti-primary-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
`;

const ensureContentStyles = (documentRef: Document): void => {
  if (documentRef.getElementById(styleElementId) !== null) {
    return;
  }

  const styleElement = documentRef.createElement("style");
  styleElement.id = styleElementId;
  styleElement.textContent = contentStyles;
  (documentRef.head ?? documentRef.documentElement).append(styleElement);
};

const closeAllPopovers = (documentRef: Document): void => {
  for (const popover of documentRef.querySelectorAll<HTMLElement>(popoverSelector)) {
    popover.hidden = true;
  }
};

const updateGridCellState = (selection: GridSelection, cell: HTMLButtonElement): void => {
  const column = Number.parseInt(cell.dataset.gmtiColumn ?? "0", 10);
  const row = Number.parseInt(cell.dataset.gmtiRow ?? "0", 10);
  const selected = isCellSelected(selection, { column, row });
  let nextState = unselectedState;
  if (selected) {
    nextState = selectedState;
  }
  cell.dataset.selected = nextState;
  cell.setAttribute("aria-pressed", nextState);
};

const updateGridUi = (context: ControlBindingContext): void => {
  context.fields.selectionLabel.textContent = formatGridSelectionLabel(context.selection);
  context.fields.insertButton.disabled = !hasSelectedDimensions(context.selection);

  for (const cell of context.fields.cells) {
    updateGridCellState(context.selection, cell);
  }
};

const createActionButton = (
  documentRef: Document,
  className: string,
  label: string,
): HTMLButtonElement => {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
};

const createGridCell = (documentRef: Document, position: GridCellPosition): HTMLButtonElement => {
  const cell = documentRef.createElement("button");
  cell.type = "button";
  cell.className = "gmti-grid-cell";
  cell.dataset.gmtiColumn = String(position.column);
  cell.dataset.gmtiRow = String(position.row);
  cell.dataset.selected = "false";
  cell.setAttribute("aria-label", `${position.column} by ${position.row}`);
  cell.setAttribute("aria-pressed", "false");
  return cell;
};

const createPopoverContainer = (documentRef: Document): HTMLDivElement => {
  const popover = documentRef.createElement("div");
  popover.className = "gmti-popover";
  popover.dataset.gmtiPopover = "true";
  popover.hidden = true;

  return popover;
};

const createPopoverActions = (
  documentRef: Document,
): {
  actions: HTMLDivElement;
  cancelButton: HTMLButtonElement;
  insertButton: HTMLButtonElement;
} => {
  const actions = documentRef.createElement("div");
  actions.className = "gmti-popover-actions";

  const cancelButton = createActionButton(documentRef, "gmti-secondary-button", "Cancel");
  const insertButton = createActionButton(documentRef, "gmti-primary-button", "Insert");
  actions.append(cancelButton, insertButton);

  return { actions, cancelButton, insertButton };
};

const createPopoverFields = (documentRef: Document): PopoverFields => {
  const popover = createPopoverContainer(documentRef);
  const selectionLabel = documentRef.createElement("p");
  selectionLabel.className = "gmti-selection-label";

  const grid = documentRef.createElement("div");
  grid.className = "gmti-grid";
  const cells = Array.from({ length: defaultGridSize * defaultGridSize }, (_value, index) => {
    const column = (index % defaultGridSize) + firstGridIndex;
    const row = Math.floor(index / defaultGridSize) + firstGridIndex;
    const cell = createGridCell(documentRef, { column, row });
    grid.append(cell);
    return cell;
  });

  const { actions, cancelButton, insertButton } = createPopoverActions(documentRef);
  insertButton.disabled = true;

  popover.append(selectionLabel, grid, actions);

  return {
    cancelButton,
    cells,
    insertButton,
    popover,
    selectionLabel,
  };
};

const openPopover = ({ documentRef, fields }: ControlBindingContext): void => {
  closeAllPopovers(documentRef);
  fields.popover.hidden = false;
  fields.cells[firstCellIndex]?.focus();
};

const resetSelection = (context: ControlBindingContext): void => {
  context.selection = createIdleGridSelection();
  updateGridUi(context);
};

const hidePopover = (context: ControlBindingContext): void => {
  context.fields.popover.hidden = true;
  context.selection = finishGridSelection(context.selection);
};

const readCellPosition = (cell: HTMLButtonElement): GridCellPosition | undefined => {
  const column = Number.parseInt(cell.dataset.gmtiColumn ?? "", 10);
  const row = Number.parseInt(cell.dataset.gmtiRow ?? "", 10);
  if (Number.isNaN(column) || Number.isNaN(row)) {
    return undefined;
  }

  return { column, row };
};

const handleInsert = (context: ControlBindingContext): void => {
  if (!hasSelectedDimensions(context.selection)) {
    return;
  }

  replaceTextareaSelection(context.target.textarea, buildMarkdownTable(context.selection));
  hidePopover(context);
};

const bindGridCellEvents = (cell: HTMLButtonElement, context: ControlBindingContext): void => {
  const position = readCellPosition(cell);
  if (position === undefined) {
    return;
  }

  cell.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    context.selection = createDraggingGridSelection(position);
    updateGridUi(context);
  });

  cell.addEventListener("pointerenter", () => {
    context.selection = updateGridSelection(context.selection, position);
    updateGridUi(context);
  });

  cell.addEventListener("click", () => {
    if (!context.selection.isSelecting) {
      context.selection = finishGridSelection(createDraggingGridSelection(position));
      updateGridUi(context);
    }
  });
};

const bindControlEvents = (
  wrapper: HTMLElement,
  button: HTMLButtonElement,
  context: ControlBindingContext,
): void => {
  wrapper.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  wrapper.addEventListener("gmti:pointerup", () => {
    context.selection = finishGridSelection(context.selection);
    updateGridUi(context);
  });

  button.addEventListener("click", () => {
    if (context.fields.popover.hidden) {
      resetSelection(context);
      openPopover(context);
      return;
    }

    hidePopover(context);
  });

  context.fields.cancelButton.addEventListener("click", () => {
    hidePopover(context);
  });
  context.fields.insertButton.addEventListener("click", () => {
    handleInsert(context);
  });

  for (const cell of context.fields.cells) {
    bindGridCellEvents(cell, context);
  }
};

const createTableControl = (target: MarkdownEditorTarget, documentRef: Document): HTMLElement => {
  const wrapper = documentRef.createElement("span");
  wrapper.className = "gmti-control";

  const button = createActionButton(documentRef, "gmti-button", "Table");
  const fields = createPopoverFields(documentRef);
  const context: ControlBindingContext = {
    documentRef,
    fields,
    selection: createIdleGridSelection(),
    target,
  };
  updateGridUi(context);
  wrapper.append(button, fields.popover);
  bindControlEvents(wrapper, button, context);

  return wrapper;
};

export const mountGithubTableInserter = (documentRef: Document): (() => void) => {
  const lifetime = new AbortController();
  ensureContentStyles(documentRef);

  const attachControl = (target: MarkdownEditorTarget): void => {
    if ("append" in target.toolbar && typeof target.toolbar.append === "function") {
      target.toolbar.append(createTableControl(target, documentRef));
    }
  };

  enhanceMarkdownEditors(documentRef, attachControl);

  documentRef.addEventListener(
    "click",
    () => {
      closeAllPopovers(documentRef);
    },
    { signal: lifetime.signal },
  );

  documentRef.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeAllPopovers(documentRef);
      }
    },
    { signal: lifetime.signal },
  );

  documentRef.addEventListener(
    "pointerup",
    () => {
      for (const popover of documentRef.querySelectorAll<HTMLElement>(popoverSelector)) {
        if (!popover.hidden) {
          const control = popover.parentElement;
          if (control !== null) {
            control.dispatchEvent(new CustomEvent("gmti:pointerup", { bubbles: false }));
          }
        }
      }
    },
    { signal: lifetime.signal },
  );

  const observer = new MutationObserver(() => {
    enhanceMarkdownEditors(documentRef, attachControl);
  });

  observer.observe(documentRef.body ?? documentRef.documentElement, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    lifetime.abort();
    documentRef.querySelectorAll(".gmti-control").forEach((node) => node.remove());
    documentRef.querySelectorAll<HTMLElement>("[data-gmti-enhanced]").forEach((node) => {
      delete node.dataset.gmtiEnhanced;
    });
    documentRef.getElementById(styleElementId)?.remove();
  };
};
