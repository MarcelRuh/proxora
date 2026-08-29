import { describe, expect, it } from "vitest";
import { consumeProxmoxVncHandshake } from "@/lib/vnc-handshake";

describe("Proxmox VNC handshake", () => {
  it("strips OK and keeps leftover RFB in the same buffer", () => {
    const rfb = Buffer.from("RFB 003.008\n");
    const result = consumeProxmoxVncHandshake(Buffer.alloc(0), Buffer.concat([Buffer.from("OK\n"), rfb]));
    expect(result.done).toBe(true);
    expect("error" in result && result.error).toBeFalsy();
    expect(result.rest.equals(rfb)).toBe(true);
  });

  it("accepts OK without a newline and RFB arriving later", () => {
    const first = consumeProxmoxVncHandshake(Buffer.alloc(0), Buffer.from("OK"));
    expect(first.done).toBe(true);
    expect(first.rest.length).toBe(0);
    const second = consumeProxmoxVncHandshake(Buffer.alloc(0), Buffer.from("RFB 003.008\n"));
    expect(second.done).toBe(true);
    expect(second.rest.toString("latin1").startsWith("RFB ")).toBe(true);
  });

  it("treats a raw RFB banner as already authenticated", () => {
    const result = consumeProxmoxVncHandshake(Buffer.alloc(0), Buffer.from("RFB 003.008\n"));
    expect(result.done).toBe(true);
    expect(result.rest.toString("latin1")).toContain("RFB ");
  });

  it("buffers incomplete prefixes", () => {
    const result = consumeProxmoxVncHandshake(Buffer.alloc(0), Buffer.from("O"));
    expect(result.done).toBe(false);
    expect(result.rest.toString()).toBe("O");
  });
});
