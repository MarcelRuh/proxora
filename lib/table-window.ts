export const GUEST_ROW_ESTIMATE_PX = 56;
export const GUEST_TABLE_VIRTUALIZE_AFTER = 48;
export const GUEST_TABLE_OVERSCAN = 8;

export type TableWindow<T> = {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  slice: T[];
};

export function windowRows<T>(
  items: T[],
  scrollTop: number,
  viewHeight: number,
  rowHeight = GUEST_ROW_ESTIMATE_PX,
  overscan = GUEST_TABLE_OVERSCAN,
): TableWindow<T> {
  if (items.length === 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0, slice: [] };
  }
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const visible = Math.ceil(Math.max(rowHeight, viewHeight) / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visible);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (items.length - end) * rowHeight,
    slice: items.slice(start, end),
  };
}
