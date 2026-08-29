"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Maximize2, RefreshCw, Keyboard } from "lucide-react";

type Props = {
  hostId: string;
  node: string;
  vmid: number;
};

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  focus: () => void;
  disconnect: () => void;
  sendCtrlAltDel: () => void;
  addEventListener: (type: string, listener: () => void) => void;
};

export function VncConsole({ hostId, node, vmid }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    let cancelled = false;
    setStatus("connecting");

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${proto}://${window.location.host}`;
    const params = new URLSearchParams({
      hostId,
      node,
      kind: "vm",
      vmid: String(vmid),
    });
    const url = `${wsBase}/ws/vnc?${params.toString()}`;

    void import("@novnc/novnc/lib/rfb.js").then(({ default: RFB }) => {
      if (cancelled || !containerRef.current) return;
      const rfb = new RFB(target, url) as RfbInstance;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.addEventListener("connect", () => setStatus("connected"));
      rfb.addEventListener("disconnect", () => {
        if (!cancelled) setStatus("disconnected");
      });
      rfb.addEventListener("securityfailure", () => setStatus("error"));
      rfbRef.current = rfb;
    });

    return () => {
      cancelled = true;
      try {
        rfbRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
      target.replaceChildren();
    };
  }, [hostId, node, vmid, nonce]);

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
        <span className="text-slate-500">VGA {vmid} @ {node}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" title="Ctrl+Alt+Del" onClick={() => rfbRef.current?.sendCtrlAltDel()}>
            <Keyboard className="h-3 w-3" />
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
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden [&_canvas]:h-full [&_canvas]:w-full" />
    </div>
  );
}
