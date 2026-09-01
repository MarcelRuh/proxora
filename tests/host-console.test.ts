import { describe, expect, it } from "vitest";
import { consoleProxyErrorDetail, isHostConsolePermissionError, pickHostConsoleNode } from "@/lib/host-console";

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

describe("host console errors", () => {
  it("detects missing Sys.Console", () => {
    expect(isHostConsolePermissionError("Permission check failed (Sys.Console)")).toBe(true);
    expect(isHostConsolePermissionError("403 Forbidden")).toBe(true);
    expect(isHostConsolePermissionError("node is offline")).toBe(false);
  });

  it("maps proxy errors to i18n keys or the raw message", () => {
    expect(consoleProxyErrorDetail("lxc", { code: "no-serial" })).toEqual({ key: "guest.consoleSerialMissing" });
    expect(consoleProxyErrorDetail("node", { message: "Permission denied (Sys.Console)" })).toEqual({
      key: "hosts.terminalPermission",
    });
    expect(consoleProxyErrorDetail("vm", { message: "Permission denied" })).toEqual({
      message: "Permission denied",
    });
    expect(consoleProxyErrorDetail("node", { message: "termproxy failed" })).toEqual({
      message: "termproxy failed",
    });
  });
});
