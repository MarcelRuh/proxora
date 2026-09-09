import { describe, expect, it } from "vitest";
import { isHostTransportFailure, ProxmoxApiError, ValidationError } from "@/lib/errors";

describe("host transport errors", () => {
  it("does not treat validation errors as a dead host", () => {
    expect(isHostTransportFailure(new ValidationError("bad input"))).toBe(false);
    expect(isHostTransportFailure(new ProxmoxApiError("Connection failed", 503))).toBe(true);
  });
});
