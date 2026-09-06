"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { useI18n } from "@/components/i18n/locale-provider";
import { api, ApiRequestError } from "@/lib/api";
import { bytesToSize } from "@/lib/utils";
import { isAbortError, putBlobWithProgress } from "@/lib/guest-file-transfer";
import {
  AGENT_FILE_MAX_BYTES,
  GUEST_FILE_EDITOR_WARN_BYTES,
  GUEST_FILE_SHORTCUTS,
  guestPathCrumbs,
  guestPathParent,
  isProbablyTextFile,
  resolveGuestPath,
  type GuestFileEntry,
  type GuestFileResult,
  type GuestTransferMode,
} from "@/lib/guest-files";

type Session = {
  target: string;
  port: number;
  username: string;
  password: string;
};

type Transfer = {
  name: string;
  sent: number;
  total: number;
};

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadBytes(name: string, bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function formatMtime(value: number | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

export function GuestFilesPanel({
  hostId,
  node,
  vmid,
  kind,
  ips,
  running,
  agentEnabled,
}: {
  hostId: string;
  node: string;
  vmid: number;
  kind: "vm" | "lxc";
  ips: string[];
  running: boolean;
  agentEnabled?: boolean;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(ips[0] ?? "");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [via, setVia] = useState<"agent" | "sftp" | null>(null);
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<GuestFileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [editor, setEditor] = useState<{ path: string; name: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSsh, setShowSsh] = useState(kind === "lxc");
  const [agentError, setAgentError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const opened = useRef(false);

  const apiPath = `/api/hosts/${hostId}/${kind === "vm" ? "vms" : "lxc"}/${encodeURIComponent(node)}/${vmid}/files`;
  const ipOptions = useMemo(() => Array.from(new Set(ips.filter(Boolean))), [ips]);
  const crumbs = guestPathCrumbs(path);
  const parent = guestPathParent(path);
  const connected = via !== null;
  const maxBytes = via === "agent" ? AGENT_FILE_MAX_BYTES : null;
  const transferring = Boolean(transfer);

  async function request(op: "list" | "read" | "write" | "mkdir" | "delete" | "transfer-ticket", extra: Record<string, unknown> = {}) {
    const mode = extra.via === "sftp" || session ? "sftp" : "agent";
    const creds = session;
    if (mode === "sftp" && !creds && extra.via !== "sftp") {
      throw new Error(t("files.needConnect"));
    }
    return api<GuestFileResult>(apiPath, {
      method: "POST",
      body: JSON.stringify({
        op,
        via: mode,
        ...(mode === "sftp"
          ? {
              target: creds?.target ?? target.trim(),
              port: creds?.port ?? (Number(port) || 22),
              username: creds?.username ?? username.trim(),
              password: creds?.password ?? password,
            }
          : {}),
        ...extra,
      }),
    });
  }

  async function loadDir(nextPath: string, mode: "agent" | "sftp", creds?: Session | null) {
    setBusy(true);
    try {
      const result = await api<GuestFileResult>(apiPath, {
        method: "POST",
        body: JSON.stringify({
          op: "list",
          path: nextPath,
          via: mode,
          ...(mode === "sftp" && creds
            ? {
                target: creds.target,
                port: creds.port,
                username: creds.username,
                password: creds.password,
              }
            : {}),
        }),
      });
      setVia(mode);
      setPath(result.path || nextPath);
      setEntries(result.entries ?? []);
      setAgentError("");
      if (mode === "agent") setShowSsh(false);
      return true;
    } catch (error) {
      const message = error instanceof ApiRequestError || error instanceof Error ? error.message : t("common.failed");
      if (mode === "agent") {
        setAgentError(message);
        setShowSsh(true);
        setVia(null);
      } else {
        toast.error(message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (opened.current) return;
    if (kind !== "vm" || !running || !agentEnabled) {
      setShowSsh(true);
      return;
    }
    opened.current = true;
    void loadDir("/", "agent");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per guest
  }, [kind, running, hostId, node, vmid]);

  async function connect() {
    const next: Session = {
      target: target.trim(),
      port: Number(port) || 22,
      username: username.trim() || "root",
      password,
    };
    if (!next.target || !next.password) {
      toast.error(t("files.needAuth"));
      return;
    }
    const ok = await loadDir("/", "sftp", next);
    if (ok) setSession(next);
  }

  async function openDir(next: string) {
    if (!via) return;
    await loadDir(resolveGuestPath(next), via, session);
  }

  async function call(op: "read" | "write" | "mkdir" | "delete", extra: Record<string, unknown> = {}) {
    return request(op, extra);
  }

  async function transferTicket(mode: GuestTransferMode, filePath: string) {
    const creds = session;
    if (!creds) throw new Error(t("files.needConnect"));
    const result = await api<GuestFileResult>(apiPath, {
      method: "POST",
      body: JSON.stringify({
        op: "transfer-ticket",
        mode,
        via: "sftp",
        path: filePath,
        target: creds.target,
        port: creds.port,
        username: creds.username,
        password: creds.password,
      }),
    });
    if (!result.ticket) throw new Error(t("common.failed"));
    return result.ticket;
  }

  async function sftpPut(filePath: string, body: Blob, name: string) {
    const ticket = await transferTicket("upload", filePath);
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setTransfer({ name, sent: 0, total: body.size });
    try {
      await putBlobWithProgress(`${apiPath}/upload?ticket=${encodeURIComponent(ticket)}`, body, {
        signal: abort.signal,
        onProgress: (sent, total) => setTransfer({ name, sent, total }),
      });
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setTransfer(null);
    }
  }

  async function sftpGetBytes(filePath: string) {
    const ticket = await transferTicket("download", filePath);
    const response = await fetch(`${apiPath}/download?ticket=${encodeURIComponent(ticket)}`, { credentials: "include" });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || t("common.failed"));
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function download(entry: GuestFileEntry) {
    if (via === "sftp") {
      try {
        const ticket = await transferTicket("download", entry.path);
        const a = document.createElement("a");
        a.href = `${apiPath}/download?ticket=${encodeURIComponent(ticket)}`;
        a.download = entry.name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success(t("files.downloadStarted"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.failed"));
      }
      return;
    }
    setBusy(true);
    try {
      const result = await call("read", { path: entry.path });
      downloadBytes(entry.name, decodeBase64(result.contentBase64 ?? ""));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function edit(entry: GuestFileEntry) {
    if (via === "sftp") {
      if (entry.size > GUEST_FILE_EDITOR_WARN_BYTES) {
        toast.message(t("files.editorHuge", { size: bytesToSize(entry.size) }));
      }
      setBusy(true);
      try {
        const bytes = await sftpGetBytes(entry.path);
        if (!isProbablyTextFile(entry.name, bytes)) {
          downloadBytes(entry.name, bytes);
          toast.message(t("files.binary"));
          return;
        }
        setEditor({ path: entry.path, name: entry.name, text: new TextDecoder().decode(bytes) });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.failed"));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const result = await call("read", { path: entry.path });
      const bytes = decodeBase64(result.contentBase64 ?? "");
      if (!isProbablyTextFile(entry.name, bytes)) {
        downloadBytes(entry.name, bytes);
        toast.message(t("files.binary"));
        return;
      }
      setEditor({ path: entry.path, name: entry.name, text: new TextDecoder().decode(bytes) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor() {
    if (!editor) return;
    setSaving(true);
    try {
      const bytes = new TextEncoder().encode(editor.text);
      if (via === "sftp") {
        await sftpPut(editor.path, new Blob([bytes]), editor.name);
      } else {
        await call("write", { path: editor.path, contentBase64: bytesToBase64(bytes) });
      }
      toast.success(t("files.saved"));
      setEditor(null);
      if (via) await loadDir(path, via, session);
    } catch (error) {
      if (isAbortError(error)) toast.message(t("files.transferCancelled"));
      else toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (via === "agent") {
      const file = files[0];
      if (!file) return;
      if (maxBytes && file.size > maxBytes) {
        toast.error(t("files.tooLarge", { size: bytesToSize(maxBytes) }));
        return;
      }
      setBusy(true);
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        await call("write", { path: resolveGuestPath(path, file.name), contentBase64: bytesToBase64(buf) });
        toast.success(t("files.uploaded"));
        await loadDir(path, "agent", session);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.failed"));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      for (const file of files) {
        await sftpPut(resolveGuestPath(path, file.name), file, file.name);
      }
      toast.success(files.length > 1 ? t("files.uploadedMany", { count: files.length }) : t("files.uploaded"));
      if (via) await loadDir(path, via, session);
    } catch (error) {
      if (isAbortError(error)) toast.message(t("files.transferCancelled"));
      else toast.error(error instanceof Error ? error.message : t("common.failed"));
    }
  }

  async function makeDir() {
    const name = mkdirName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await call("mkdir", { path: resolveGuestPath(path, name) });
      setMkdirName("");
      toast.success(t("files.mkdirOk"));
      if (via) await loadDir(path, via, session);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function makeFile() {
    const name = newFileName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const dest = resolveGuestPath(path, name);
      if (via === "sftp") {
        await sftpPut(dest, new Blob([]), name);
      } else {
        await call("write", { path: dest, contentBase64: "" });
      }
      setNewFileName("");
      toast.success(t("files.saved"));
      if (via) await loadDir(path, via, session);
      setEditor({ path: dest, name, text: "" });
    } catch (error) {
      if (isAbortError(error)) toast.message(t("files.transferCancelled"));
      else toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: GuestFileEntry) {
    setBusy(true);
    try {
      await call("delete", { path: entry.path });
      toast.success(t("files.deleted"));
      if (via) await loadDir(path, via, session);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{t("files.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {via === "agent"
              ? t("files.viaAgent")
              : via === "sftp"
                ? t("files.viaSftp")
                : kind === "vm"
                  ? t("files.bodyAgent")
                  : t("files.bodyLxc")}
          </p>
        </div>
        {connected ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy || transferring} onClick={() => via && void loadDir(path, via, session)}>
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </Button>
            {via === "sftp" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  abortRef.current?.abort();
                  setSession(null);
                  setVia(null);
                  setEntries([]);
                  setPath("/");
                  setShowSsh(true);
                  setTransfer(null);
                }}
              >
                {t("files.disconnect")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <CardContent className="p-0">
        {!running ? <p className="px-4 py-3 text-sm text-muted-foreground">{t("files.stopped")}</p> : null}
        {kind === "vm" && running && !agentEnabled && !connected ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t("files.agentOff")}</p>
        ) : null}
        {agentError && !connected ? <p className="px-4 py-3 text-sm text-destructive">{agentError}</p> : null}

        {!connected && showSsh ? (
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {kind === "lxc" ? t("files.lxcNeedsSsh") : t("files.sshFallback")}
            </p>
            <label className="text-sm">
              {t("files.host")}
              {ipOptions.length ? (
                <select className={selectClass} value={ipOptions.includes(target) ? target : ""} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">{t("files.chooseIp")}</option>
                  {ipOptions.map((ip) => (
                    <option key={ip} value={ip}>
                      {ip}
                    </option>
                  ))}
                </select>
              ) : null}
              <Input className="mt-1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="192.168.178.50" />
            </label>
            <label className="text-sm">
              {t("files.port")}
              <Input className="mt-1" value={port} onChange={(e) => setPort(e.target.value)} />
            </label>
            <label className="text-sm">
              {t("files.user")}
              <Input className="mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label className="text-sm">
              {t("files.password")}
              <Input
                className="mt-1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void connect();
                }}
              />
            </label>
            <div className="sm:col-span-2">
              <Button disabled={busy} onClick={() => void connect()}>
                {busy ? t("common.loading") : t("files.connect")}
              </Button>
            </div>
          </div>
        ) : null}

        {kind === "vm" && !connected && !showSsh && busy ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("files.opening")}</p>
        ) : null}

        {kind === "vm" && !connected && agentError && !showSsh ? (
          <div className="px-4 py-3">
            <Button size="sm" variant="outline" onClick={() => setShowSsh(true)}>
              {t("files.useSsh")}
            </Button>
          </div>
        ) : null}

        {connected ? (
          <div className="flex min-h-[28rem] flex-col md:flex-row">
            <nav className="w-full shrink-0 border-b border-border p-2 md:w-44 md:border-b-0 md:border-r">
              {GUEST_FILE_SHORTCUTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={busy}
                  onClick={() => void openDir(item)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-primary/10 ${
                    path === item ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="truncate font-mono">{item === "/" ? t("files.root") : item}</span>
                </button>
              ))}
            </nav>
            <div
              className={`min-w-0 flex-1 ${dragging ? "bg-primary/5" : ""}`}
              onDragEnter={(e) => {
                e.preventDefault();
                if (via === "sftp") setDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (via !== "sftp" || transferring) return;
                const files = Array.from(e.dataTransfer.files);
                if (files.length) void uploadFiles(files);
              }}
            >
              <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy || parent === null}
                  onClick={() => parent && void openDir(parent)}
                  aria-label={t("files.parent")}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                {crumbs.map((crumb, index) => (
                  <span key={crumb.path} className="flex items-center text-sm">
                    {index > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 font-mono hover:bg-primary/10"
                      disabled={busy}
                      onClick={() => void openDir(crumb.path)}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
                <input
                  ref={fileRef}
                  type="file"
                  multiple={via === "sftp"}
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) void uploadFiles(files);
                  }}
                />
                <Button size="sm" disabled={busy || transferring} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  {t("files.upload")}
                </Button>
                <div className="flex gap-1">
                  <Input
                    className="h-8 w-32"
                    placeholder={t("files.folderName")}
                    value={mkdirName}
                    onChange={(e) => setMkdirName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void makeDir();
                    }}
                  />
                  <Button size="sm" variant="outline" disabled={busy || transferring || !mkdirName.trim()} onClick={() => void makeDir()}>
                    <FolderPlus className="h-4 w-4" />
                    {t("files.mkdir")}
                  </Button>
                </div>
                <div className="flex gap-1">
                  <Input
                    className="h-8 w-32"
                    placeholder={t("files.fileName")}
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void makeFile();
                    }}
                  />
                  <Button size="sm" variant="outline" disabled={busy || transferring || !newFileName.trim()} onClick={() => void makeFile()}>
                    <FilePlus className="h-4 w-4" />
                    {t("files.newFile")}
                  </Button>
                </div>
              </div>
              {transfer ? (
                <div className="flex items-center gap-3 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">
                      {t("files.transferring", {
                        name: transfer.name,
                        done: bytesToSize(transfer.sent, 0),
                        total: bytesToSize(transfer.total, 0),
                      })}
                    </p>
                    <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-primary transition-[width]"
                        style={{
                          width: `${transfer.total ? Math.min(100, Math.round((transfer.sent / transfer.total) * 100)) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                  >
                    {t("files.cancelTransfer")}
                  </Button>
                </div>
              ) : via === "sftp" ? (
                <p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">{t("files.dropHint")}</p>
              ) : null}
              <div className="max-h-[28rem] overflow-auto">
                <div className="sticky top-0 grid grid-cols-[1fr_7rem_10rem_auto] gap-2 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                  <span>{t("files.colName")}</span>
                  <span>{t("files.colSize")}</span>
                  <span>{t("files.colMtime")}</span>
                  <span />
                </div>
                {entries.length === 0 ? (
                  <p className="px-3 py-8 text-sm text-muted-foreground">{busy ? t("common.loading") : t("files.empty")}</p>
                ) : (
                  entries.map((entry) => (
                    <div
                      key={entry.path}
                      className="grid grid-cols-[1fr_7rem_10rem_auto] items-center gap-2 border-b border-border/60 px-3 py-1.5 text-sm hover:bg-primary/5"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        disabled={busy}
                        onClick={() => {
                          if (entry.type === "dir") void openDir(entry.path);
                          else void edit(entry);
                        }}
                      >
                        {entry.type === "dir" ? (
                          <Folder className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{entry.type === "dir" ? `${entry.name}/` : entry.name}</span>
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {entry.type === "dir" ? t("files.dir") : bytesToSize(entry.size, 0)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{formatMtime(entry.mtime)}</span>
                      <div className="flex justify-end gap-1">
                        {entry.type === "file" ? (
                          <Button size="icon" variant="ghost" disabled={busy} onClick={() => void download(entry)} aria-label={t("files.download")}>
                            <Download className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <ConfirmAction
                          title={t("files.deleteTitle", { name: entry.name })}
                          description={entry.path}
                          actionLabel={t("files.delete")}
                          destructive
                          onConfirm={() => remove(entry)}
                        >
                          <Button size="icon" variant="ghost" disabled={busy} aria-label={t("files.delete")}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </ConfirmAction>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editor?.name}</DialogTitle>
            <DialogDescription className="font-mono">{editor?.path}</DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-[50vh] font-mono text-xs"
            value={editor?.text ?? ""}
            onChange={(e) => setEditor((cur) => (cur ? { ...cur, text: e.target.value } : cur))}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            {saving && transfer ? (
              <span className="mr-auto truncate text-xs text-muted-foreground">
                {bytesToSize(transfer.sent, 0)} / {bytesToSize(transfer.total, 0)}
              </span>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                if (saving) abortRef.current?.abort();
                else setEditor(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={saving} onClick={() => void saveEditor()}>
              {t("files.saveFile")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
