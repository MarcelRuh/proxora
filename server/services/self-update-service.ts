import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";
import {
  hasDockerSocket,
  isSignalDirReady,
  isUpdateBusyFromSignal,
  resolveUpdateSignalDir,
  writeUpdateRequest,
} from "@/lib/self-update-signal";
import {
  APP_VERSION,
  DEFAULT_GITHUB_BRANCH,
  DEFAULT_GITHUB_REPO,
  isSelfUpdateAvailable,
  selfUpdateTargetVersion,
} from "@/lib/version";
import {
  fetchGithubChangelog,
  fetchGithubCommitSha,
  fetchGithubPackageVersion,
} from "@/server/services/github-revision";
import {
  mergeProgress,
  parseUpdaterLogs,
  readComposeLogsFromDir,
  readProgressFromDir,
  REVISION_FILE,
  type SelfUpdateProgress,
} from "@/server/services/self-update-progress";

const execFileAsync = promisify(execFile);
const UPDATER_NAME = "proxora-self-updater";
const APPLY_TIMEOUT_MS = 20 * 60 * 1000;

export type SelfUpdateMode = "compose" | "none";

export interface SelfUpdateStatus {
  enabled: boolean;
  mode: SelfUpdateMode;
  currentVersion: string;
  sourceVersion: string | null;
  remoteVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  updating: boolean;
  progress: SelfUpdateProgress | null;
  changelog: string | null;
  targetVersion: string | null;
}

let applyInFlight = false;

function options() {
  return {
    installDirHost: process.env.PROXORA_INSTALL_DIR ?? process.env.DOCKORA_INSTALL_DIR ?? null,
    installDirMount: process.env.PROXORA_INSTALL_MOUNT ?? process.env.PROXORA_INSTALL_DIR ?? process.cwd(),
    repo: process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO,
    branch: process.env.PROXORA_BRANCH ?? DEFAULT_GITHUB_BRANCH,
  };
}

function readSourceVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function readLocalRevision(dir: string): string | null {
  const file = path.join(dir, REVISION_FILE);
  if (existsSync(file)) {
    try {
      return readFileSync(file, "utf8").trim() || null;
    } catch {
      /* ignore */
    }
  }
  try {
    const head = path.join(dir, ".git", "HEAD");
    if (existsSync(head)) {
      const ref = readFileSync(head, "utf8").trim();
      if (ref.startsWith("ref:")) {
        const refPath = path.join(dir, ".git", ref.slice(4).trim());
        if (existsSync(refPath)) return readFileSync(refPath, "utf8").trim();
      } else if (/^[a-f0-9]{40}$/.test(ref)) {
        return ref;
      }
    }
  } catch {
    /* ignore */
  }
  return process.env.GIT_SHA ?? null;
}

async function isDockerUpdaterRunning(): Promise<boolean> {
  if (!hasDockerSocket()) return false;
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--filter", `name=^${UPDATER_NAME}$`, "--filter", "status=running", "--format", "{{.Names}}"],
      { timeout: 5_000 },
    );
    return stdout.split("\n").some((n) => n.trim() === UPDATER_NAME);
  } catch {
    return false;
  }
}

async function isUpdaterRunning(): Promise<boolean> {
  const signalDir = resolveUpdateSignalDir();
  if (isSignalDirReady(signalDir) && isUpdateBusyFromSignal(signalDir)) return true;
  return isDockerUpdaterRunning();
}

async function updaterLogs(mount: string | null): Promise<string | null> {
  const fromFile = readComposeLogsFromDir(mount);
  if (fromFile) return fromFile;
  if (!hasDockerSocket()) return null;
  try {
    const { stdout } = await execFileAsync("docker", ["logs", "--tail", "200", UPDATER_NAME], { timeout: 5_000 });
    return stdout;
  } catch {
    return null;
  }
}

export async function getSelfUpdateStatus(): Promise<SelfUpdateStatus> {
  const opts = options();
  const updating = applyInFlight || (await isUpdaterRunning());
  const mount = opts.installDirMount;
  const sourceVersion = mount ? readSourceVersion(mount) : null;
  const composeFile = mount ? path.join(mount, "docker-compose.yml") : "";
  const enabled = Boolean(mount && existsSync(composeFile));

  const base: SelfUpdateStatus = {
    enabled,
    mode: enabled ? "compose" : "none",
    currentVersion: APP_VERSION,
    sourceVersion,
    remoteVersion: null,
    localRevision: mount ? readLocalRevision(mount) : null,
    remoteRevision: null,
    updateAvailable: false,
    message: enabled
      ? "Checking GitHub…"
      : "Self-update unavailable. Set PROXORA_INSTALL_DIR to the Compose install path.",
    installDir: opts.installDirHost ?? mount,
    repo: opts.repo,
    branch: opts.branch,
    updating,
    progress: null,
    changelog: null,
    targetVersion: null,
  };

  if (!enabled) return withProgress(base, mount);

  let remoteRevision: string | null = null;
  let shaError: string | null = null;
  try {
    remoteRevision = await fetchGithubCommitSha(opts.repo, opts.branch);
  } catch (error) {
    shaError = error instanceof Error ? error.message : String(error);
  }

  let remoteVersion: string | null = null;
  try {
    remoteVersion = await fetchGithubPackageVersion(opts.repo, remoteRevision ?? opts.branch);
  } catch {
    remoteVersion = null;
  }

  const targetVersion = selfUpdateTargetVersion(APP_VERSION, remoteVersion, sourceVersion);
  const updateAvailable = isSelfUpdateAvailable({
    runningVersion: APP_VERSION,
    sourceVersion,
    remoteVersion,
  });

  let changelog: string | null = null;
  if (updateAvailable) {
    try {
      changelog = await fetchGithubChangelog(opts.repo, remoteRevision ?? opts.branch, APP_VERSION);
    } catch {
      changelog = null;
    }
  }

  return withProgress(
    {
      ...base,
      remoteVersion,
      remoteRevision,
      updateAvailable,
      targetVersion,
      changelog,
      message: updating
        ? "Update running…"
        : shaError && !updateAvailable
          ? `GitHub check failed: ${shaError}`
          : updateAvailable
            ? targetVersion
              ? `Update available — ${APP_VERSION} → ${targetVersion}`
              : "Update available from GitHub"
            : "Up to date",
    },
    mount,
  );
}

async function withProgress(status: SelfUpdateStatus, mount: string | null): Promise<SelfUpdateStatus> {
  const file = readProgressFromDir(mount);
  const logs = status.updating ? parseUpdaterLogs((await updaterLogs(mount)) ?? "") : null;
  const progress = mergeProgress(file, logs);
  if (progress && status.updating && progress.step === "done") {
    return { ...status, progress };
  }
  return { ...status, progress: status.updating || progress?.step === "error" ? progress : progress };
}

export async function applySelfUpdate(): Promise<{ ok: boolean; message: string; mode: SelfUpdateMode }> {
  if (applyInFlight || (await isUpdaterRunning())) {
    return { ok: false, message: "Update already running", mode: "compose" };
  }
  const status = await getSelfUpdateStatus();
  if (!status.enabled) return { ok: false, message: status.message, mode: status.mode };

  const opts = options();
  const hostDir = opts.installDirHost ?? opts.installDirMount;
  const mount = opts.installDirMount;
  if (!hostDir || !mount) {
    return { ok: false, message: "PROXORA_INSTALL_DIR is not set", mode: "compose" };
  }

  applyInFlight = true;
  try {
    if (!existsSync("/.dockerenv")) {
      return await applyOnHost(mount, opts.repo, opts.branch);
    }
    return await applyViaDocker(hostDir, opts.repo, opts.branch);
  } finally {
    applyInFlight = false;
  }
}

async function applyOnHost(installMount: string, repo: string, branch: string) {
  const scriptPath = path.join(installMount, "scripts", "self-update-apply.sh");
  if (!existsSync(scriptPath)) {
    return { ok: false, message: "self-update-apply.sh missing", mode: "compose" as const };
  }
  try {
    const { stdout, stderr } = await execFileAsync("sh", [scriptPath], {
      env: {
        ...process.env,
        PROXORA_INSTALL_DIR: installMount,
        PROXORA_REPO: repo,
        PROXORA_BRANCH: branch,
        PROXORA_SKIP_COMPOSE: existsSync("/.dockerenv") ? "0" : "1",
      },
      timeout: APPLY_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-8).join("\n");
    return { ok: true, mode: "compose" as const, message: `Files synced.\n${tail}` };
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return {
      ok: false,
      mode: "compose" as const,
      message: [err.message, err.stderr, err.stdout].filter(Boolean).join("\n") || String(error),
    };
  }
}

async function applyViaDocker(hostDir: string, repo: string, branch: string) {
  const signalDir = resolveUpdateSignalDir();
  if (isSignalDirReady(signalDir)) {
    if (isUpdateBusyFromSignal(signalDir)) {
      return { ok: false, mode: "compose" as const, message: "Update already running" };
    }
    try {
      writeUpdateRequest(signalDir);
      logger.info({ hostDir, repo, signalDir }, "Proxora update requested via sidecar");
      return {
        ok: true,
        mode: "compose" as const,
        message: "Updater started. Proxora will rebuild and come back shortly.",
      };
    } catch (error) {
      return {
        ok: false,
        mode: "compose" as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (hasDockerSocket()) {
    return applyViaLegacyDocker(hostDir, repo, branch);
  }

  return {
    ok: false,
    mode: "compose" as const,
    message:
      "Self-update sidecar is missing. Recreate the stack with docker compose up -d so proxora-updater can own docker.sock.",
  };
}

/** 1.0.58 and older mounted docker.sock into the app. Keep this path so the first jump to the sidecar works. */
async function applyViaLegacyDocker(hostDir: string, repo: string, branch: string) {
  try {
    if (await isDockerUpdaterRunning()) {
      return { ok: false, mode: "compose" as const, message: "Update already running" };
    }
    await execFileAsync("docker", ["rm", "-f", UPDATER_NAME], { timeout: 10_000 }).catch(() => undefined);
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/scripts/self-update-apply.sh`;
    await execFileAsync(
      "docker",
      [
        "run",
        "-d",
        "--init",
        "--name",
        UPDATER_NAME,
        "-v",
        `${hostDir}:${hostDir}`,
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "-e",
        `PROXORA_INSTALL_DIR=${hostDir}`,
        "-e",
        `PROXORA_REPO=${repo}`,
        "-e",
        `PROXORA_BRANCH=${branch}`,
        "-e",
        "PROXORA_SKIP_COMPOSE=0",
        "-w",
        hostDir,
        "--label",
        "proxora.update=self",
        "docker:27-cli",
        "sh",
        "-c",
        `wget -qO /tmp/proxora-apply.sh ${JSON.stringify(rawUrl)} && exec sh /tmp/proxora-apply.sh`,
      ],
      { timeout: 60_000 },
    );
    logger.info({ hostDir, repo }, "Proxora self-updater started (legacy docker.sock)");
    return {
      ok: true,
      mode: "compose" as const,
      message: "Updater started. Proxora will rebuild and come back shortly.",
    };
  } catch (error) {
    return {
      ok: false,
      mode: "compose" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
