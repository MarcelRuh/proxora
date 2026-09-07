import { describe, expect, it } from "vitest";
import { unreadInboxCount } from "@/server/services/inbox-service";

describe("inbox per user", () => {
  it("counts unread against that user's read set", () => {
    const events = ["a", "b", "c"];
    expect(unreadInboxCount(events, [])).toBe(3);
    expect(unreadInboxCount(events, ["b"])).toBe(2);
    expect(unreadInboxCount(events, ["a", "b", "c"])).toBe(0);
  });
});
