export interface TableDimensions {
  columns: number;
  rows: number;
}

const dimensionPattern = /^\d+$/;
const minimumTableSize = 1;
const firstColumnNumber = 1;

export const parsePositiveInteger = (value: string): number | undefined => {
  const normalizedValue = value.trim();
  if (!dimensionPattern.test(normalizedValue)) {
    return undefined;
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimumTableSize) {
    return undefined;
  }

  return parsedValue;
};

export const isValidTableDimensions = (dimensions: TableDimensions): boolean =>
  Number.isSafeInteger(dimensions.columns) &&
  dimensions.columns >= minimumTableSize &&
  Number.isSafeInteger(dimensions.rows) &&
  dimensions.rows >= minimumTableSize;

const buildEmptyRow = (columns: number): string => `| ${Array(columns).fill("").join(" | ")} |`;

export const buildMarkdownTable = (dimensions: TableDimensions): string => {
  if (!isValidTableDimensions(dimensions)) {
    throw new Error("Table dimensions must be positive integers.");
  }

  const headerRow = `| ${Array.from(
    { length: dimensions.columns },
    (_value, index) => `Column ${index + firstColumnNumber}`,
  ).join(" | ")} |`;
  const dividerRow = `| ${Array(dimensions.columns).fill("---").join(" | ")} |`;
  const bodyRows = Array.from({ length: dimensions.rows }, () => buildEmptyRow(dimensions.columns));

  return [headerRow, dividerRow, ...bodyRows].join("\n");
};
