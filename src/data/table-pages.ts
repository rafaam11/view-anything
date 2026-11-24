import { iconButton } from "../ui/icons";

/**
 * Row and column paging for the table viewers (CSV, spreadsheet sheets): previous/next page,
 * then previous/next column block, each with an `n / m` label. Hidden when everything fits.
 */
export type TablePager = {
  element: HTMLElement;
  /** Zero-based page and column block. */
  row: number;
  column: number;
  /** Clamps the position to the new size and refreshes the labels; does not call `change`. */
  update(rows: number, columns: number): void;
};

export function tablePager(label: string, size: { rows: number; columns: number }, change: () => void): TablePager {
  const element = document.createElement("nav"); element.className = "data-pages"; element.setAttribute("aria-label", label);
  const previous = iconButton("이전 페이지", "previous");
  const next = iconButton("다음 페이지", "next");
  const pageLabel = document.createElement("span");
  const previousColumns = iconButton("이전 열", "previous");
  const nextColumns = iconButton("다음 열", "next");
  const columnLabel = document.createElement("span");
  const separator = document.createElement("span"); separator.className = "data-pages-sep"; separator.textContent = "·"; separator.setAttribute("aria-hidden", "true");
  const columnsName = document.createElement("span"); columnsName.textContent = "열";
  element.append(previous, pageLabel, next, separator, columnsName, previousColumns, columnLabel, nextColumns);
  let rowPages = 1, columnPages = 1;
  const pager: TablePager = {
    element, row: 0, column: 0,
    update(rows, columns) {
      rowPages = Math.max(1, Math.ceil(rows / size.rows));
      columnPages = Math.max(1, Math.ceil(columns / size.columns));
      pager.row = Math.min(pager.row, rowPages - 1); pager.column = Math.min(pager.column, columnPages - 1);
      pageLabel.textContent = `${pager.row + 1} / ${rowPages}`;
      previous.disabled = pager.row === 0; next.disabled = pager.row + 1 >= rowPages;
      columnLabel.textContent = `${pager.column + 1} / ${columnPages}`;
      previousColumns.disabled = pager.column === 0; nextColumns.disabled = pager.column + 1 >= columnPages;
      element.hidden = rowPages === 1 && columnPages === 1;
    },
  };
  const step = (move: () => boolean) => () => { if (move()) change(); };
  previous.onclick = step(() => pager.row > 0 && (pager.row--, true));
  next.onclick = step(() => pager.row + 1 < rowPages && (pager.row++, true));
  previousColumns.onclick = step(() => pager.column > 0 && (pager.column--, true));
  nextColumns.onclick = step(() => pager.column + 1 < columnPages && (pager.column++, true));
  return pager;
}
