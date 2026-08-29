/** Strip Proxmox `{user}:{ticket}` acknowledgement so the browser only sees RFB. */
export function consumeProxmoxVncHandshake(
  previous: Buffer,
  chunk: Buffer,
): { done: false; rest: Buffer } | { done: true; rest: Buffer; error?: string } {
  const buf = Buffer.concat([previous, chunk]);
  if (buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "RFB ") {
    return { done: true, rest: buf };
  }
  if (buf.length < 2) return { done: false, rest: buf };
  if (buf[0] === 0x4f && buf[1] === 0x4b) {
    let skip = 2;
    if (buf.length > skip && buf[skip] === 0x0d) skip += 1;
    if (buf.length > skip && buf[skip] === 0x0a) skip += 1;
    return { done: true, rest: buf.subarray(skip) };
  }
  if (buf.length >= 16) {
    return { done: true, rest: buf, error: "Unexpected VNC handshake" };
  }
  return { done: false, rest: buf };
}

export function wsPayloadToBuffer(data: Buffer | ArrayBuffer | Buffer[] | string): Buffer {
  if (typeof data === "string") return Buffer.from(data);
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
