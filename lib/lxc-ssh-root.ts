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

export function lxcSshRootStatusScript(): string {
  return [
    "running=0",
    "if pgrep -x sshd >/dev/null 2>&1; then running=1; fi",
    "permit=unknown",
    "if command -v sshd >/dev/null 2>&1; then",
    "  permit=$(sshd -T 2>/dev/null | awk 'tolower($1)==\"permitrootlogin\"{print tolower($2); exit}')",
    '  [ -n "$permit" ] || permit=unknown',
    "fi",
    'printf \'{"running":%s,"permitRootLogin":"%s"}\\n\' "$running" "$permit"',
  ].join("\n");
}

export function lxcSshRootSetScript(enabled: boolean): string {
  const value = enabled ? "yes" : "no";
  const restart = enabled
    ? [
        "systemctl enable ssh >/dev/null 2>&1 || systemctl enable sshd >/dev/null 2>&1 || true",
        "systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true",
      ]
    : [
        "systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true",
      ];
  return [
    "if ! command -v sshd >/dev/null 2>&1; then",
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
    "if command -v systemctl >/dev/null 2>&1; then",
    ...restart.map((line) => `  ${line}`),
    "elif command -v rc-service >/dev/null 2>&1; then",
    "  rc-service sshd restart >/dev/null 2>&1 || rc-service ssh restart >/dev/null 2>&1 || true",
    "elif command -v service >/dev/null 2>&1; then",
    "  service ssh restart >/dev/null 2>&1 || service sshd restart >/dev/null 2>&1 || true",
    "fi",
    lxcSshRootStatusScript(),
  ].join("\n");
}
