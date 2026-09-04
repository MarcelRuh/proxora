import { describe, expect, it } from "vitest";
import { bulkActionFits, guestRowKey } from "@/lib/guest-bulk";

describe("bulk guest actions", () => {
  it("starts only stopped guests and shuts down running ones", () => {
    expect(bulkActionFits({ status: "stopped" }, "start")).toBe(true);
    expect(bulkActionFits({ status: "running" }, "start")).toBe(false);
    expect(bulkActionFits({ status: "running" }, "shutdown")).toBe(true);
    expect(bulkActionFits({ status: "paused" }, "stop")).toBe(true);
    expect(bulkActionFits({ status: "stopped" }, "stop")).toBe(false);
  });

  it("keys rows by kind, host, node and vmid", () => {
    expect(guestRowKey({ vmid: 100, node: "pve1", hostId: "h1" }, "vm")).toBe("vm:h1:pve1:100");
  });
});
