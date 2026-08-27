"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Button } from "@/components/ui/button";
import { Maximize2, Minus, Plus, RefreshCw } from "lucide-react";

type Props = {
  hostId: string;
  node: string;
  kind: "vm" | "lxc" | "node";
  vmid?: number;
  cmd?: "upgrade";
};

export function WebConsole({ hostId, node, kind, vmid, cmd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [fontSize, setFontSize] = useState(14);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize,
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

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.startsWith("{")) {
        try {
          const parsed = JSON.parse(event.data) as { type?: string; status?: string };
          if (parsed.type === "status" && parsed.status) {
            setStatus(parsed.status === "connected" ? "connected" : "error");
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
      disposable.dispose();
      resizeDisp.dispose();
      clearInterval(ping);
      window.removeEventListener("resize", onResize);
      ws.close();
      term.dispose();
    };
  }, [hostId, node, kind, vmid, cmd, fontSize, nonce]);

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-[#020617]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-300">
        <span
          className={
            status === "connected" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-amber-400"
          }
        >
          ● {status}
        </span>
          <span className="text-slate-500">
            {cmd === "upgrade" ? "UPGRADE" : kind.toUpperCase()} {vmid ?? node} @ {node}
          </span>
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
