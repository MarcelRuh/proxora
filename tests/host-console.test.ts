import { describe, expect, it } from "vitest";
import { pickHostConsoleNode } from "@/lib/host-console";

describe("pickHostConsoleNode", () => {
  it("prefers the requested node when it exists", () => {
    expect(
      pickHostConsoleNode(
        [
          { node: "pve1", online: "online" },
          { node: "pve2", online: "offline" },
        ],
        "pve2",
      ),
    ).toBe("pve2");
  });

  it("falls back to an online node, then the first listed", () => {
    expect(
      pickHostConsoleNode([
        { node: "pve1", online: "offline" },
        { node: "pve2", online: "online" },
      ]),
    ).toBe("pve2");
    expect(pickHostConsoleNode([{ node: "only" }])).toBe("only");
    expect(pickHostConsoleNode([])).toBeNull();
  });
});
