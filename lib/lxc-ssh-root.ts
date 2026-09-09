export function isLxcRootSshEnabled(permitRootLogin: string | null | undefined): boolean {
  const v = String(permitRootLogin ?? "")
    .trim()
    .toLowerCase();
  return v === "yes" || v === "without-password" || v === "prohibit-password";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLxcExecPayload(raw: string, begin: string, end: string): { stdout: string; exitCode: number } | null {
  const text = stripTermNoise(raw);
  const re = new RegExp(`(?:^|\\n)${escapeRegExp(begin)}\\n([\\s\\S]*?)\\n${escapeRegExp(end)}:(\\d+)`);
  const match = re.exec(text);
  if (!match) return null;
  return { stdout: match[1].trim(), exitCode: Number(match[2]) };
}

export function stripTermNoise(raw: string): string {
  return raw
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "");
}

export function chunkBase64(b64: string, size = 48): string[] {
  if (!b64) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += size) chunks.push(b64.slice(i, i + size));
  return chunks;
}

/** Short lines so a 80-col PTY does not wrap and corrupt the payload. */
export function wrapLxcTermScript(b64: string, begin: string, end: string): string {
  const chunks = chunkBase64(b64);
  const assigns = chunks.map((chunk, i) => (i === 0 ? `B64='${chunk}'` : `B64="$B64${chunk}"`));
  return [
    "stty -echo cols 512 2>/dev/null || true",
    ...assigns,
    `echo ${begin}`,
    "printf '%s' \"$B64\" | base64 -d | sh",
    `echo ${end}:$?`,
    "",
  ].join("\n");
}

export function parseLxcSshRootStatus(stdout: string): { running: boolean; permitRootLogin: string; enabled: boolean } {
  const jsonMatch = /\{[\s\S]*\}/.exec(stdout);
  let running = false;
  let permitRootLogin = "unknown";
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { running?: unknown; permitRootLogin?: unknown };
      running = parsed.running === true || parsed.running === 1 || parsed.running === "1";
      permitRootLogin = String(parsed.permitRootLogin ?? "unknown").trim().toLowerCase() || "unknown";
    } catch {
      /* fall through */
    }
  }
  return { running, permitRootLogin, enabled: isLxcRootSshEnabled(permitRootLogin) };
}

const PATH_PREFIX = 'export PATH="/usr/sbin:/sbin:/usr/bin:/bin${PATH:+:$PATH}"';

export function lxcSshRootStatusScript(): string {
  return [
    PATH_PREFIX,
    "running=0",
    "if pgrep -x sshd >/dev/null 2>&1; then running=1; fi",
    "permit=unknown",
    "if [ -f /etc/ssh/sshd_config.d/99-proxora-root.conf ]; then",
    "  permit=$(awk 'tolower($1)==\"permitrootlogin\"{v=tolower($2)} END{print v}' /etc/ssh/sshd_config.d/99-proxora-root.conf)",
    "elif [ -f /etc/ssh/sshd_config ]; then",
    "  permit=$(awk 'BEGIN{v=\"unknown\"} $1 ~ /^#/{next} tolower($1)==\"permitrootlogin\"{v=tolower($2)} END{print v}' /etc/ssh/sshd_config)",
    "fi",
    '[ -n "$permit" ] || permit=unknown',
    'printf \'{"running":%s,"permitRootLogin":"%s"}\\n\' "$running" "$permit"',
  ].join("\n");
}

const RESTART_SSHD = [
  "if command -v systemctl >/dev/null 2>&1; then",
  "  systemctl enable ssh >/dev/null 2>&1 || systemctl enable sshd >/dev/null 2>&1 || true",
  "  systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true",
  "elif command -v rc-service >/dev/null 2>&1; then",
  "  rc-update add sshd default >/dev/null 2>&1 || rc-update add ssh default >/dev/null 2>&1 || true",
  "  rc-service sshd restart >/dev/null 2>&1 || rc-service ssh restart >/dev/null 2>&1 || true",
  "elif command -v service >/dev/null 2>&1; then",
  "  service ssh restart >/dev/null 2>&1 || service sshd restart >/dev/null 2>&1 || true",
  "else",
  "  pkill -HUP -x sshd >/dev/null 2>&1 || true",
  "  pgrep -x sshd >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || sshd >/dev/null 2>&1 || true",
  "fi",
];

export function lxcSshRootSetScript(enabled: boolean): string {
  const value = enabled ? "yes" : "no";
  return [
    PATH_PREFIX,
    "if ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ]; then",
    "  echo NO_SSHD",
    "  exit 2",
    "fi",
    "if [ -d /etc/ssh/sshd_config.d ]; then",
    `  printf 'PermitRootLogin ${value}\\n' > /etc/ssh/sshd_config.d/99-proxora-root.conf`,
    "  chmod 644 /etc/ssh/sshd_config.d/99-proxora-root.conf",
    "elif [ -f /etc/ssh/sshd_config ]; then",
    "  if grep -qE '^[[:space:]]*#?[[:space:]]*PermitRootLogin[[:space:]]' /etc/ssh/sshd_config; then",
    `    sed -i 's/^[[:space:]]*#*[[:space:]]*PermitRootLogin[[:space:]].*/PermitRootLogin ${value}/' /etc/ssh/sshd_config`,
    "  else",
    `    printf '\\nPermitRootLogin ${value}\\n' >> /etc/ssh/sshd_config`,
    "  fi",
    "else",
    "  echo NO_SSHD_CONFIG",
    "  exit 2",
    "fi",
    ...RESTART_SSHD,
    lxcSshRootStatusScript(),
  ].join("\n");
}
