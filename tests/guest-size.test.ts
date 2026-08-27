import { describe, expect, it } from "vitest";
import { guestSizeDetail, percentage } from "@/lib/utils";

describe("guestSizeDetail", () => {
  it("formats used and total memory", () => {
    expect(guestSizeDetail(512 * 1024 * 1024, 2 * 1024 * 1024 * 1024)).toBe("512,0 MB / 2,0 GB");
  });

  it("shows zero used against allocated size", () => {
    expect(guestSizeDetail(0, 4 * 1024 * 1024 * 1024)).toBe("0 B / 4,0 GB");
  });

  it("returns a dash when size is missing", () => {
    expect(guestSizeDetail(0, 0)).toBe("—");
    expect(guestSizeDetail(128, undefined)).toBe("—");
  });
});

describe("percentage", () => {
  it("keeps 0% when nothing is used but a total exists", () => {
    expect(percentage(0, 4 * 1024 * 1024 * 1024)).toBe(0);
    expect(percentage(512, 1024)).toBe(50);
  });
});
