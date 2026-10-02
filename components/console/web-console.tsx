"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { Maximize2, Minus, Plus, RefreshCw } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { consoleProxyErrorDetail } from "@/lib/host-console";
import { LXC_APT_UPGRADE_INPUT } from "@/lib/lxc-apt";
import { lxcShellPrompt, lxcSshInput, lxcSshProbeInput, lxcSshStateFromOutput } from "@/lib/lxc-ssh";
import { cn } from "@/lib/utils";

type Props = {
  hostId: string;
  node: string;
  kind: "vm" | "lxc" | "node";
  vmid?: number;
  cmd?: "upgrade";
  fill?: boolean;
  onDisconnected?: () => void;
};

export function WebConsole({ hostId, node, kind, vmid, cmd, fill, onDisconnected }: Props) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fontSizeRef = useRef(14);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [nonce, setNonce] = useState(0);
  const [sshOn, setSshOn] = useState<boolean | null>(null);
  const [commandOut, setCommandOut] = useState<string | null>(null);
  const sshBufRef = useRef("");
  const captureRef = useRef(false);
  fontSizeRef.current = fontSize;

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: fontSizeRef.current,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#2dd4bf",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    sshBufRef.current = "";
    setSshOn(null);

    const noteSsh = (chunk: string) => {
      if (kind !== "lxc") return;
      sshBufRef.current = (sshBufRef.current + chunk).slice(-800);
      const next = lxcSshStateFromOutput(sshBufRef.current);
      if (next != null) setSshOn(next);
      if (captureRef.current) {
        const plain = chunk.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
        if (plain) setCommandOut((prev) => ((prev ?? "") + plain).slice(-8000));
      }
    };

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${proto}://${window.location.host}`;
    const params = new URLSearchParams({
      hostId,
      node,
      kind,
      cols: String(term.cols),
      rows: String(term.rows),
    });
    if (vmid) params.set("vmid", String(vmid));
    if (cmd) params.set("cmd", cmd);
    const ws = new WebSocket(`${wsBase}/ws/console?${params.toString()}`);
    wsRef.current = ws;
    setStatus("connecting");
    setDetail(null);
    let sawConnected = false;
    let closedByCleanup = false;

    ws.onopen = () => setStatus("connecting");
    ws.onclose = () => {
      const hadSession = sawConnected;
      setStatus((s) => (s === "error" ? s : "disconnected"));
      if (!closedByCleanup && hadSession) onDisconnectedRef.current?.();
    };
    ws.onerror = () => setStatus("error");
    ws.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.startsWith("{")) {
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            status?: string;
            message?: string;
            code?: string;
          };
          if (parsed.type === "status" && parsed.status) {
            if (parsed.status === "connected") {
              sawConnected = true;
              setStatus("connected");
              setDetail(null);
            } else {
              setStatus("error");
              const mapped = consoleProxyErrorDetail(kind, parsed);
              setDetail("key" in mapped ? tRef.current(mapped.key) : mapped.message || tRef.current("guest.consoleError"));
            }
            return;
          }
        } catch {
          /* raw */
        }
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          noteSsh(new TextDecoder().decode(bytes));
          term.write(bytes);
        });
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        noteSsh(new TextDecoder().decode(bytes));
        term.write(bytes);
        return;
      }
      noteSsh(event.data as string);
      term.write(event.data as string);
    };

    const disposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });
    const resizeDisp = term.onResize((size) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    });
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 30_000);
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    const probeTimer = setInterval(() => {
      if (kind !== "lxc" || ws.readyState !== WebSocket.OPEN || captureRef.current) return;
      const buffer = term.buffer.active;
      const row = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? "";
      if (!lxcShellPrompt(row)) return;
      ws.send(JSON.stringify({ type: "input", data: lxcSshProbeInput() }));
      clearInterval(probeTimer);
    }, 1000);

    return () => {
      closedByCleanup = true;
      disposable.dispose();
      resizeDisp.dispose();
      clearInterval(ping);
      clearInterval(probeTimer);
      window.removeEventListener("resize", onResize);
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      captureRef.current = false;
    };
  }, [hostId, node, kind, vmid, cmd, nonce]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
  }, [fontSize]);

  function shellReady() {
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return false;
    const buffer = term.buffer.active;
    const row = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? "";
    return lxcShellPrompt(row);
  }

  function sendShell(data: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (!shellReady()) return false;
    captureRef.current = true;
    setCommandOut((current) => current ?? "");
    ws.send(JSON.stringify({ type: "input", data }));
    return true;
  }

  const statusLabel =
    status === "connected"
      ? t("guest.consoleConnected")
      : status === "error"
        ? t("guest.consoleError")
        : status === "connecting"
          ? t("guest.consoleConnecting")
          : t("guest.consoleDisconnected");

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--ui-radius)] border border-border bg-[#020617]",
        fill ? "h-full min-h-0" : "min-h-[420px]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span
          className={
            status === "connected" ? "text-success" : status === "error" ? "text-danger" : "text-warning"
          }
        >
          ● {statusLabel}
        </span>
        <span>
          {cmd === "upgrade"
            ? `UPGRADE ${node}`
            : kind === "node"
              ? `SHELL ${node}`
              : `${kind.toUpperCase()} ${vmid ?? node} @ ${node}`}
        </span>
        {detail && status === "error" ? <span className="text-danger">{detail}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {kind === "lxc" ? (
            <ConfirmAction
              title={t("guest.consoleAptTitle")}
              description={t("guest.consoleAptBody")}
              actionLabel={t("guest.consoleAptRun")}
              disabled={status !== "connected"}
              onConfirm={async () => {
                if (!sendShell(LXC_APT_UPGRADE_INPUT)) throw new Error(t("guest.consoleNeedShell"));
              }}
            >
              <Button size="sm" variant="outline" disabled={status !== "connected"} className="h-7 px-2 text-xs">
                {t("guest.consoleApt")}
              </Button>
            </ConfirmAction>
          ) : null}
          {kind === "lxc" ? (
            <ConfirmAction
              title={t(sshOn ? "guest.consoleSshOffTitle" : "guest.consoleSshOnTitle")}
              description={t(sshOn ? "guest.consoleSshOffBody" : "guest.consoleSshOnBody")}
              actionLabel={t(sshOn ? "guest.consoleSshOff" : "guest.consoleSshOn")}
              disabled={status !== "connected" || sshOn == null}
              onConfirm={async () => {
                if (sshOn == null) return;
                const turnOn = !sshOn;
                if (!sendShell(lxcSshInput(turnOn))) throw new Error(t("guest.consoleNeedShell"));
                setSshOn(turnOn);
              }}
            >
              <Button size="sm" variant="outline" disabled={status !== "connected" || sshOn == null} className="h-7 px-2 text-xs">
                {t(sshOn == null ? "guest.consoleSshUnknown" : sshOn ? "guest.consoleSshOff" : "guest.consoleSshOn")}
              </Button>
            </ConfirmAction>
          ) : null}
          <Button size="icon" variant="ghost" onClick={() => setFontSize((s) => Math.max(10, s - 1))}>
            <Minus className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setFontSize((s) => Math.min(22, s + 1))}>
            <Plus className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => containerRef.current?.parentElement?.requestFullscreen()}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {commandOut != null ? (
        <div className="border-b border-border bg-card px-3 py-2 text-xs text-foreground">
          <div className="mb-1 flex items-center justify-between">
            <span>{t("guest.consoleOutput")}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                captureRef.current = false;
                setCommandOut(null);
              }}
            >
              {t("common.close")}
            </button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{commandOut || "…"}</pre>
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
