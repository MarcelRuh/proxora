import { describe, expect, it } from "vitest";
import { channelAllowsTopic, parseNotificationEvents } from "@/lib/notification-topics";

describe("notification topic filters", () => {
  it("treats a missing list as all events", () => {
    expect(channelAllowsTopic(null, "vm.created")).toBe(true);
    expect(channelAllowsTopic(undefined, "host.offline")).toBe(true);
  });

  it("honours an explicit selection", () => {
    expect(channelAllowsTopic(["host.updates", "vm.created"], "vm.created")).toBe(true);
    expect(channelAllowsTopic(["host.updates"], "lxc.created")).toBe(false);
    expect(channelAllowsTopic([], "host.online")).toBe(false);
  });

  it("drops unknown event ids", () => {
    expect(parseNotificationEvents(["vm.created", "nope", 1])).toEqual(["vm.created"]);
  });
});
