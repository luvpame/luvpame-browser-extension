import { describe, expect, it } from "vite-plus/test";

import {
  createDraggingGridSelection,
  createIdleGridSelection,
  finishGridSelection,
  formatGridSelectionLabel,
  hasSelectedDimensions,
  isCellSelected,
  updateGridSelection,
} from "../lib/table-grid";

describe("grid selection", () => {
  it("starts with no selected dimensions", () => {
    const selection = createIdleGridSelection();

    expect(hasSelectedDimensions(selection)).toBe(false);
    expect(formatGridSelectionLabel(selection)).toBe("Select table size");
  });

  it("tracks drag updates and preserves the selected rectangle", () => {
    const startedSelection = createDraggingGridSelection({ column: 2, row: 2 });
    const updatedSelection = updateGridSelection(startedSelection, { column: 4, row: 3 });
    const finishedSelection = finishGridSelection(updatedSelection);

    expect(finishedSelection).toEqual({
      columns: 4,
      rows: 3,
      isSelecting: false,
    });
    expect(formatGridSelectionLabel(finishedSelection)).toBe("4 x 3");
    expect(isCellSelected(finishedSelection, { column: 4, row: 3 })).toBe(true);
    expect(isCellSelected(finishedSelection, { column: 5, row: 3 })).toBe(false);
  });

  it("ignores hover updates after dragging has finished", () => {
    const selection = finishGridSelection(createDraggingGridSelection({ column: 1, row: 1 }));

    expect(updateGridSelection(selection, { column: 6, row: 6 })).toEqual(selection);
  });
});
