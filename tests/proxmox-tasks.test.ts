import { describe, expect, it } from "vitest";
import {
  filterTasks,
  taskGuestLabel,
  taskKindGroup,
  taskRunState,
  taskTypeLabel,
} from "@/lib/proxmox-tasks";
import { guestTaskLabel } from "@/lib/backup-tasks";

describe("task labels and status", () => {
  it("uses readable labels instead of UPIDs", () => {
    expect(taskTypeLabel("qmcreate", "de")).toBe("VM erstellen");
    expect(taskTypeLabel("vzdump", "en")).toBe("Backup");
    expect(taskTypeLabel("aptupdate", "de")).toBe("APT-Update");
    expect(guestTaskLabel("qmstart")).toBe("VM starten");
  });

  it("groups task types", () => {
    expect(taskKindGroup("qmcreate")).toBe("vm");
    expect(taskKindGroup("vzstart")).toBe("lxc");
    expect(taskKindGroup("vzdump")).toBe("backup");
    expect(taskKindGroup("download")).toBe("storage");
    expect(taskKindGroup("aptupdate")).toBe("system");
  });

  it("treats missing status as running and OK/exitstatus correctly", () => {
    expect(taskRunState({})).toBe("running");
    expect(taskRunState({ status: "running" })).toBe("running");
    expect(taskRunState({ status: "stopped", exitstatus: "OK" })).toBe("ok");
    expect(taskRunState({ status: "stopped", exitstatus: "interrupted" })).toBe("failed");
    expect(taskRunState({ status: "OK" })).toBe("ok");
  });

  it("shows guest name next to the id", () => {
    expect(taskGuestLabel({ id: "100", guestName: "web" })).toBe("100 (web)");
    expect(taskGuestLabel({ id: "100" })).toBe("100");
  });

  it("filters by host, kind, status and query", () => {
    const rows = [
      { hostId: "a", type: "qmstart", status: "running", id: "100", guestName: "web" },
      { hostId: "b", type: "vzdump", status: "stopped", exitstatus: "OK", id: "204" },
    ];
    expect(filterTasks(rows, { kind: "vm", status: "all", type: "all", query: "" })).toHaveLength(1);
    expect(filterTasks(rows, { hostId: "b", kind: "all", status: "ok", type: "all", query: "" }).map((r) => r.type)).toEqual([
      "vzdump",
    ]);
    expect(filterTasks(rows, { kind: "all", status: "all", type: "all", query: "web" })).toHaveLength(1);
  });
});
