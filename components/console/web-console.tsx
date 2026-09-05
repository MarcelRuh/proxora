"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Button } from "@/components/ui/button";
import { Maximize2, Minus, Plus, RefreshCw } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { consoleProxyErrorDetail } from "@/lib/host-console";
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
        void event.data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
        return;
      }
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

    return () => {
      closedByCleanup = true;
      disposable.dispose();
      resizeDisp.dispose();
      clearInterval(ping);
      window.removeEventListener("resize", onResize);
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [hostId, node, kind, vmid, cmd, nonce]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
  }, [fontSize]);

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
        "flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-[#020617]",
        fill && "h-[min(calc(100dvh-11rem),880px)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-300">
        <span
          className={
            status === "connected" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-amber-400"
          }
        >
          ● {statusLabel}
        </span>
        <span className="text-slate-500">
          {cmd === "upgrade"
            ? `UPGRADE ${node}`
            : kind === "node"
              ? `SHELL ${node}`
              : `${kind.toUpperCase()} ${vmid ?? node} @ ${node}`}
        </span>
        {detail && status === "error" ? <span className="text-red-400">{detail}</span> : null}
        <div className="ml-auto flex items-center gap-1">
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
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
