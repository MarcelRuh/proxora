"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { useI18n } from "@/components/i18n/locale-provider";
import { api, ApiRequestError } from "@/lib/api";
import { bytesToSize } from "@/lib/utils";
import {
  GUEST_FILE_MAX_BYTES,
  guestPathParent,
  isProbablyTextFile,
  resolveGuestPath,
  type GuestFileEntry,
} from "@/lib/guest-files";

type Session = {
  target: string;
  port: number;
  username: string;
  password: string;
};

type FileResult = {
  path: string;
  entries?: GuestFileEntry[];
  name?: string;
  size?: number;
  contentBase64?: string;
  fingerprint?: string;
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

export function GuestFilesPanel({
  hostId,
  node,
  vmid,
  kind,
  ips,
  running,
}: {
  hostId: string;
  node: string;
  vmid: number;
  kind: "vm" | "lxc";
  ips: string[];
  running: boolean;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(ips[0] ?? "");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<GuestFileEntry[]>([]);
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [editor, setEditor] = useState<{ path: string; name: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const apiPath = `/api/hosts/${hostId}/${kind === "vm" ? "vms" : "lxc"}/${encodeURIComponent(node)}/${vmid}/files`;
  const ipOptions = useMemo(() => Array.from(new Set(ips.filter(Boolean))), [ips]);

  async function call(op: "list" | "read" | "write" | "mkdir" | "delete", extra: Record<string, unknown> = {}) {
    const creds = session;
    if (!creds && op !== "list") throw new Error(t("files.needConnect"));
    const auth = creds ?? {
      target: target.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      password,
    };
    return api<FileResult>(apiPath, {
      method: "POST",
      body: JSON.stringify({
        op,
        target: auth.target,
        port: auth.port,
        username: auth.username,
        password: auth.password,
        ...extra,
      }),
    });
  }

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
    setBusy(true);
    try {
      const result = await api<FileResult>(apiPath, {
        method: "POST",
        body: JSON.stringify({
          op: "list",
          path: "/",
          target: next.target,
          port: next.port,
          username: next.username,
          password: next.password,
        }),
      });
      setSession(next);
      setPath(result.path || "/");
      setEntries(result.entries ?? []);
      setFingerprint(result.fingerprint ?? "");
    } catch (error) {
      toast.error(error instanceof ApiRequestError || error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(nextPath = path, creds = session) {
    if (!creds) return;
    setBusy(true);
    try {
      const result = await api<FileResult>(apiPath, {
        method: "POST",
        body: JSON.stringify({
          op: "list",
          path: nextPath,
          target: creds.target,
          port: creds.port,
          username: creds.username,
          password: creds.password,
        }),
      });
      setPath(result.path || nextPath);
      setEntries(result.entries ?? []);
      if (result.fingerprint) setFingerprint(result.fingerprint);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function openDir(next: string) {
    await refresh(resolveGuestPath(next));
  }

  async function download(entry: GuestFileEntry) {
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
      const encoded = bytesToBase64(new TextEncoder().encode(editor.text));
      await call("write", { path: editor.path, contentBase64: encoded });
      toast.success(t("files.saved"));
      setEditor(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    if (file.size > GUEST_FILE_MAX_BYTES) {
      toast.error(t("files.tooLarge", { size: bytesToSize(GUEST_FILE_MAX_BYTES) }));
      return;
    }
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const dest = resolveGuestPath(path, file.name);
      await call("write", { path: dest, contentBase64: bytesToBase64(buf) });
      toast.success(t("files.uploaded"));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
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
      await refresh();
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
      await call("write", { path: dest, contentBase64: "" });
      setNewFileName("");
      toast.success(t("files.saved"));
      await refresh();
      setEditor({ path: dest, name, text: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: GuestFileEntry) {
    setBusy(true);
    try {
      await call("delete", { path: entry.path });
      toast.success(t("files.deleted"));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const parent = guestPathParent(path);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("files.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("files.body")}</p>
        {!running ? <p className="text-sm text-muted-foreground">{t("files.stopped")}</p> : null}

        {session ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-mono">
                {t("files.connected", { user: session.username, host: session.target })}
                {fingerprint ? ` · ${fingerprint}` : ""}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
                  {t("common.refresh")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSession(null);
                    setEntries([]);
                    setPath("/");
                    setFingerprint("");
                  }}
                >
                  {t("files.disconnect")}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
              {parent !== null ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void openDir(parent)}>
                  {t("files.parent")}
                </Button>
              ) : null}
              <span className="break-all">{path}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
              <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                {t("files.upload")}
              </Button>
              <div className="flex gap-1">
                <Input
                  className="h-8 w-36"
                  placeholder={t("files.folderName")}
                  value={mkdirName}
                  onChange={(e) => setMkdirName(e.target.value)}
                />
                <Button size="sm" variant="outline" disabled={busy || !mkdirName.trim()} onClick={() => void makeDir()}>
                  {t("files.mkdir")}
                </Button>
              </div>
              <div className="flex gap-1">
                <Input
                  className="h-8 w-36"
                  placeholder={t("files.fileName")}
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                />
                <Button size="sm" variant="outline" disabled={busy || !newFileName.trim()} onClick={() => void makeFile()}>
                  {t("files.newFile")}
                </Button>
              </div>
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {entries.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{t("files.empty")}</p>
              ) : (
                entries.map((entry) => (
                  <div key={entry.path} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      disabled={busy}
                      onClick={() => {
                        if (entry.type === "dir") void openDir(entry.path);
                        else void edit(entry);
                      }}
                    >
                      {entry.type === "dir" ? `${entry.name}/` : entry.name}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.type === "dir" ? t("files.dir") : bytesToSize(entry.size, 0)}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      {entry.type === "file" ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void download(entry)}>
                          {t("files.download")}
                        </Button>
                      ) : null}
                      <ConfirmAction
                        title={t("files.deleteTitle", { name: entry.name })}
                        description={entry.path}
                        actionLabel={t("files.delete")}
                        destructive
                        onConfirm={() => remove(entry)}
                      >
                        <Button size="sm" variant="ghost" disabled={busy}>
                          {t("files.delete")}
                        </Button>
                      </ConfirmAction>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
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
        )}
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
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>
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
