import type { TableDimensions } from "./markdown-table";

export interface GridSelection extends TableDimensions {
  isSelecting: boolean;
}

export interface GridCellPosition {
  column: number;
  row: number;
}

export const defaultGridSize = 6;
const minimumGridIndex = 1;
const zeroSelection = 0;

export const createIdleGridSelection = (): GridSelection => ({
  columns: zeroSelection,
  rows: zeroSelection,
  isSelecting: false,
});

export const createDraggingGridSelection = (position: GridCellPosition): GridSelection => ({
  columns: position.column,
  rows: position.row,
  isSelecting: true,
});

export const updateGridSelection = (
  selection: GridSelection,
  position: GridCellPosition,
): GridSelection => {
  if (!selection.isSelecting) {
    return selection;
  }

  return {
    columns: position.column,
    rows: position.row,
    isSelecting: true,
  };
};

export const finishGridSelection = (selection: GridSelection): GridSelection => ({
  ...selection,
  isSelecting: false,
});

export const hasSelectedDimensions = (selection: GridSelection): boolean =>
  selection.columns >= minimumGridIndex && selection.rows >= minimumGridIndex;

export const formatGridSelectionLabel = (selection: GridSelection): string => {
  if (!hasSelectedDimensions(selection)) {
    return "Select table size";
  }

  return `${selection.columns} x ${selection.rows}`;
};

export const isCellSelected = (selection: GridSelection, position: GridCellPosition): boolean =>
  hasSelectedDimensions(selection) &&
  position.column <= selection.columns &&
  position.row <= selection.rows;
