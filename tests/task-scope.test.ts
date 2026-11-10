import { describe, expect, it } from "vitest";
import { assertTaskAccess, canAccessTask, filterTasksForUser, parseUpid } from "@/lib/task-scope";
import type { AccessScope } from "@/lib/guest-scope";

const unscoped: AccessScope = { allowedHostIds: null, allowedGuests: null };
const scoped: AccessScope = {
  allowedHostIds: ["h1"],
  allowedGuests: [
    { hostId: "h1", kind: "vm", vmid: 100 },
    { hostId: "h1", kind: "lxc", vmid: 200 },
  ],
};

const upid = (type: string, id: string, node = "pve1") => `UPID:${node}:0000ABCD:00112233:65A1B2C3:${type}:${id}:root@pam:`;

describe("task scope", () => {
  it("parses a UPID", () => {
    expect(parseUpid(upid("qmstart", "100"))).toEqual({
      node: "pve1",
      type: "qmstart",
      id: "100",
      user: "root@pam",
      vmid: 100,
      kind: "vm",
    });
    expect(parseUpid(upid("vzstart", "200"))?.kind).toBe("lxc");
    expect(parseUpid(upid("vzdump", "200"))?.kind).toBe("unknown");
    expect(parseUpid(upid("aptupdate", ""))?.vmid).toBeNull();
    expect(parseUpid("not-a-upid")).toBeNull();
  });

  it("lets scoped users see only their guests' tasks", () => {
    expect(canAccessTask(scoped, "h1", { upid: upid("qmstart", "100") })).toBe(true);
    expect(canAccessTask(scoped, "h1", { upid: upid("vzstart", "100") })).toBe(false);
    expect(canAccessTask(scoped, "h1", { upid: upid("vzdump", "200") })).toBe(true);
    expect(canAccessTask(scoped, "h1", { upid: upid("qmstart", "101") })).toBe(false);
    expect(canAccessTask(scoped, "h1", { upid: upid("aptupdate", "") })).toBe(false);
    expect(canAccessTask(scoped, "h2", { upid: upid("qmstart", "100") })).toBe(false);
    expect(canAccessTask(unscoped, "h1", { upid: upid("aptupdate", "") })).toBe(true);
  });

  it("filters task lists", () => {
    const tasks = [
      { upid: upid("qmstart", "100") },
      { upid: upid("qmstart", "101") },
      { upid: upid("aptupdate", "") },
    ];
    expect(filterTasksForUser(scoped, "h1", tasks)).toEqual([tasks[0]]);
    expect(filterTasksForUser(unscoped, "h1", tasks)).toBe(tasks);
  });

  it("denies status, log and cancel of foreign tasks", () => {
    expect(() => assertTaskAccess(scoped, "h1", "pve1", upid("qmstart", "100"))).not.toThrow();
    expect(() => assertTaskAccess(scoped, "h1", "pve1", upid("qmstart", "101"))).toThrow();
    expect(() => assertTaskAccess(scoped, "h1", "pve2", upid("qmstart", "100"))).toThrow();
    expect(() => assertTaskAccess(scoped, "h1", "pve1", "garbage")).toThrow();
    expect(() => assertTaskAccess(unscoped, "h1", "pve1", "garbage")).not.toThrow();
  });
});
