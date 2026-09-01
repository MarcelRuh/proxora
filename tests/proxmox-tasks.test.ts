import { describe, expect, it } from "vitest";
import {
  filterTasks,
  taskGuestHref,
  taskGuestLabel,
  taskKindGroup,
  taskRunState,
  tasksPollIntervalMs,
  TASKS_POLL_ACTIVE_MS,
  TASKS_POLL_IDLE_MS,
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

  it("polls faster while a task is running", () => {
    expect(tasksPollIntervalMs(undefined)).toBe(TASKS_POLL_IDLE_MS);
    expect(tasksPollIntervalMs([])).toBe(TASKS_POLL_IDLE_MS);
    expect(tasksPollIntervalMs([{ status: "stopped", exitstatus: "OK" }])).toBe(TASKS_POLL_IDLE_MS);
    expect(tasksPollIntervalMs([{ status: "running" }, { status: "stopped", exitstatus: "OK" }])).toBe(
      TASKS_POLL_ACTIVE_MS,
    );
  });

  it("shows guest name next to the id", () => {
    expect(taskGuestLabel({ id: "100", guestName: "web" })).toBe("100 (web)");
    expect(taskGuestLabel({ id: "100" })).toBe("100");
  });

  it("links guest tasks to the detail page", () => {
    expect(taskGuestHref({ hostId: "h1", node: "pve", id: "100", guestKind: "vm", type: "qmstart" })).toBe(
      "/vms/h1/pve/100",
    );
    expect(taskGuestHref({ hostId: "h1", node: "pve", id: "204", type: "vzstart" })).toBe(
      "/containers/h1/pve/204",
    );
    expect(taskGuestHref({ hostId: "h1", node: "pve", id: "100", type: "vzdump" })).toBeNull();
    expect(taskGuestHref({ hostId: "h1", node: "pve", id: "100", guestKind: "vm", type: "vzdump" })).toBe(
      "/vms/h1/pve/100",
    );
    expect(taskGuestHref({ hostId: "h1", node: "pve", id: "iso/foo.iso", type: "download" })).toBeNull();
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
