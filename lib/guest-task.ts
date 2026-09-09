export function isUpid(value: unknown): value is string {
  return typeof value === "string" && value.includes("UPID:");
}
