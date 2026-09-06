import { ProxmoxApiError, ValidationError } from "@/lib/errors";
import {
  AGENT_FILE_MAX_BYTES,
  decodeGuestFileContent,
  guestFileName,
  parseGuestListOutput,
  resolveGuestPath,
  type GuestFileEntry,
} from "@/lib/guest-files";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestFileRequest } from "@/lib/guest-files";
import type { GuestFileResult } from "@/lib/guest-files";

function unwrapAgent(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && "result" in data) {
    const result = (data as { result: unknown }).result;
    if (result && typeof result === "object") return result as Record<string, unknown>;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return {};
}

function b64Text(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return raw;
  }
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function agentExec(client: ProxmoxClient, node: string, vmid: number, command: string[]) {
  const started = unwrapAgent(await client.vms.agentExec(node, vmid, command));
  const pid = Number(started.pid);
  if (!Number.isInteger(pid) || pid < 1) {
    throw new ValidationError("QEMU Agent hat keinen Prozess gestartet (guest-exec aktiv?)");
  }
  for (let i = 0; i < 40; i++) {
    const status = unwrapAgent(await client.vms.agentExecStatus(node, vmid, pid));
    if (status.exited) {
      return {
        exitcode: Number(status.exitcode ?? 1),
        stdout: b64Text(status["out-data"]),
        stderr: b64Text(status["err-data"]),
      };
    }
    await wait(150);
  }
  throw new ValidationError("QEMU Agent Timeout");
}

async function agentExecOk(client: ProxmoxClient, node: string, vmid: number, command: string[]) {
  const result = await agentExec(client, node, vmid, command);
  if (result.exitcode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 200);
    throw new ValidationError(detail || `Befehl fehlgeschlagen (${result.exitcode})`);
  }
  return result;
}

async function listDir(client: ProxmoxClient, node: string, vmid: number, path: string): Promise<GuestFileEntry[]> {
  try {
    const listed = await agentExec(client, node, vmid, [
      "find",
      path,
      "-maxdepth",
      "1",
      "-mindepth",
      "1",
      "-printf",
      "%y\t%s\t%T@\t%f\n",
    ]);
    if (listed.exitcode === 0) return parseGuestListOutput(listed.stdout, path);
  } catch {
    /* busybox / Windows */
  }
  const listed = await agentExecOk(client, node, vmid, ["ls", "-1Ap", "--", path]);
  return parseGuestListOutput(listed.stdout, path);
}

async function readFile(client: ProxmoxClient, node: string, vmid: number, path: string): Promise<Buffer> {
  const raw = unwrapAgent(await client.vms.agentFileRead(node, vmid, path));
  const content = String(raw.content ?? "");
  if (raw.truncated) {
    throw new ValidationError(`Datei größer als ${Math.round(AGENT_FILE_MAX_BYTES / 1024)} KB für den QEMU Agent`);
  }
  const buf = decodeGuestFileContent(content, AGENT_FILE_MAX_BYTES);
  return buf;
}

async function writeFile(client: ProxmoxClient, node: string, vmid: number, path: string, body: Buffer) {
  if (body.length > AGENT_FILE_MAX_BYTES) {
    throw new ValidationError(`Datei größer als ${Math.round(AGENT_FILE_MAX_BYTES / 1024)} KB für den QEMU Agent`);
  }
  await client.vms.agentFileWrite(node, vmid, path, body.toString("base64"));
}

function agentError(error: unknown): Error {
  if (error instanceof ValidationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("not running") || lower.includes("guest agent") || lower.includes("no qemu-guest-agent")) {
    return new ValidationError("QEMU Guest Agent antwortet nicht (in der VM installiert und gestartet?)");
  }
  if (lower.includes("guest-exec") || lower.includes("disabled")) {
    return new ValidationError("guest-exec ist im Guest Agent deaktiviert");
  }
  if (error instanceof ProxmoxApiError) {
    return new ValidationError(error.message.slice(0, 240));
  }
  return new ValidationError(message.trim().slice(0, 240) || "QEMU Agent fehlgeschlagen");
}

export async function guestAgentFiles(client: ProxmoxClient, input: GuestFileRequest): Promise<GuestFileResult> {
  let path: string;
  try {
    path = resolveGuestPath(input.path || "/");
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
  }
  const node = input.node?.trim() ?? "";
  if (!node) throw new ValidationError("Node fehlt");
  const vmid = input.vmid;
  try {
    switch (input.op) {
      case "list":
        return { path, via: "agent", entries: await listDir(client, node, vmid, path) };
      case "read": {
        const buf = await readFile(client, node, vmid, path);
        return {
          path,
          via: "agent",
          name: guestFileName(path),
          size: buf.length,
          contentBase64: buf.toString("base64"),
        };
      }
      case "write": {
        const buf = decodeGuestFileContent(input.contentBase64 ?? "", AGENT_FILE_MAX_BYTES);
        await writeFile(client, node, vmid, path, buf);
        return { path, via: "agent", name: guestFileName(path), size: buf.length };
      }
      case "mkdir":
        await agentExecOk(client, node, vmid, ["mkdir", "--", path]);
        return { path, via: "agent" };
      case "delete":
        try {
          await agentExecOk(client, node, vmid, ["rmdir", "--", path]);
        } catch {
          await agentExecOk(client, node, vmid, ["rm", "-f", "--", path]);
        }
        return { path, via: "agent" };
      default:
        throw new ValidationError("Unknown file operation");
    }
  } catch (error) {
    throw agentError(error);
  }
}
