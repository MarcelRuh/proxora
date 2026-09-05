import { describe, expect, it } from "vitest";
import { windowRows } from "@/lib/table-window";

describe("windowRows", () => {
  it("returns an empty window for no rows", () => {
    expect(windowRows([], 0, 400)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0, slice: [] });
  });

  it("keeps a short list fully visible", () => {
    const items = [1, 2, 3];
    const win = windowRows(items, 0, 400, 56, 8);
    expect(win.slice).toEqual(items);
    expect(win.padTop).toBe(0);
    expect(win.padBottom).toBe(0);
  });

  it("windows a long list around the scroll offset", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const win = windowRows(items, 56 * 50, 280, 56, 2);
    expect(win.start).toBe(48);
    expect(win.slice[0]).toBe(48);
    expect(win.padTop).toBe(48 * 56);
    expect(win.padBottom).toBe((200 - win.end) * 56);
    expect(win.slice.length).toBeLessThan(30);
  });
});
