"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isFailedTaskExit } from "@/lib/backup-tasks";

export type ProxmoxTaskPayload = {
  status: { status?: string; exitstatus?: string };
  log: Array<{ n: number; t: string }>;
};

export function useProxmoxTask({
  hostId,
  node,
  upid,
  open,
  failedFallback,
}: {
  hostId: string;
  node: string;
  upid: string | null;
  open: boolean;
  failedFallback: string;
}) {
  const [settled, setSettled] = useState<{
    upid: string | null;
    finished: boolean;
    error: string | null;
  }>({ upid: null, finished: false, error: null });

  const finished = Boolean(upid) && settled.upid === upid && settled.finished;
  const errorMsg = upid && settled.upid === upid ? settled.error : null;
  const tracking = Boolean(upid) && !finished && !errorMsg;

  const { data: task } = useQuery({
    queryKey: ["proxmox-task", hostId, node, upid],
    enabled: Boolean(open && upid),
    queryFn: () =>
      api<ProxmoxTaskPayload>(
        `/api/hosts/${hostId}/task?node=${encodeURIComponent(node)}&upid=${encodeURIComponent(upid!)}&limit=2000`,
      ),
    refetchInterval: tracking ? 1200 : false,
  });

  useEffect(() => {
    if (!upid || !task?.status) return;
    if (settled.upid === upid && (settled.finished || settled.error)) return;
    const st = task.status;
    if (!st.status || st.status === "running") return;
    if (isFailedTaskExit(st)) {
      setSettled({ upid, finished: false, error: st.exitstatus || failedFallback });
      return;
    }
    setSettled({ upid, finished: true, error: null });
  }, [task, upid, failedFallback, settled]);

  return {
    logLines: (task?.log ?? []).map((l) => l.t).filter(Boolean),
    finished,
    errorMsg,
    tracking,
  };
}
