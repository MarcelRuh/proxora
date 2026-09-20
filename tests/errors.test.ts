import { describe, expect, it } from "vitest";
import { isHostTransportFailure, ProxmoxApiError, ValidationError } from "@/lib/errors";
import { ApiRequestError, isNetworkFetchError } from "@/lib/api";

describe("host transport errors", () => {
  it("does not treat validation errors as a dead host", () => {
    expect(isHostTransportFailure(new ValidationError("bad input"))).toBe(false);
    expect(isHostTransportFailure(new ProxmoxApiError("Connection failed", 503))).toBe(true);
  });
});

describe("browser fetch errors", () => {
  it("detects Failed to fetch and network ApiRequestError", () => {
    expect(isNetworkFetchError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFetchError(new ApiRequestError("Failed to fetch", 0, "network"))).toBe(true);
    expect(isNetworkFetchError(new ApiRequestError("Ungültiges Backup", 400))).toBe(false);
  });
});
