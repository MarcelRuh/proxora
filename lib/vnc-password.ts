/** QEMU VNC only uses the first 8 characters of the password. */
export function rfbPasswordFromVncProxy(term: { ticket: string; password?: string | null }): string {
  const generated = term.password?.trim();
  if (generated) return generated.slice(0, 8);
  return term.ticket.slice(0, 8);
}
