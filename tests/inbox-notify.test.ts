import { describe, expect, it } from "vitest";
import { inboxNotifyPlan } from "@/lib/inbox-notify";

describe("inboxNotifyPlan", () => {
  it("seeds on first poll without notifying", () => {
    expect(inboxNotifyPlan([{ id: "c" }, { id: "b" }, { id: "a" }], null)).toEqual({
      lastSeenId: "c",
      items: [],
      overflow: 0,
    });
  });

  it("returns unread events newer than the cursor", () => {
    const plan = inboxNotifyPlan(
      [
        { id: "d", read: false },
        { id: "c", read: false },
        { id: "b", read: true },
        { id: "a", read: false },
      ],
      "b",
    );
    expect(plan.lastSeenId).toBe("d");
    expect(plan.items.map((row) => row.id)).toEqual(["d", "c"]);
    expect(plan.overflow).toBe(0);
  });

  it("skips already-read rows between cursor and head", () => {
    const plan = inboxNotifyPlan(
      [
        { id: "c", read: true },
        { id: "b", read: false },
        { id: "a" },
      ],
      "a",
    );
    expect(plan.items.map((row) => row.id)).toEqual(["b"]);
  });

  it("summarises when the cursor has fallen out of the window", () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ id: `e${10 - i}`, read: false }));
    expect(inboxNotifyPlan(events, "missing")).toEqual({
      lastSeenId: "e10",
      items: [],
      overflow: 10,
    });
  });

  it("caps individual alerts at five", () => {
    const events = [
      { id: "n6" },
      { id: "n5" },
      { id: "n4" },
      { id: "n3" },
      { id: "n2" },
      { id: "n1" },
      { id: "old" },
    ];
    const plan = inboxNotifyPlan(events, "old");
    expect(plan.items.map((row) => row.id)).toEqual(["n6", "n5", "n4", "n3", "n2"]);
    expect(plan.overflow).toBe(1);
  });
});
