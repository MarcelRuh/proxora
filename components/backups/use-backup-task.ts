"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isFailedTaskExit } from "@/lib/backup-tasks";

export type BackupTaskPayload = {
  status: { status?: string; exitstatus?: string };
  log: Array<{ n: number; t: string }>;
};

export function useBackupTask({
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
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
  }, [upid]);

  const tracking = Boolean(upid) && !finished && !errorMsg;
  const { data: task } = useQuery({
    queryKey: ["backup-task", hostId, node, upid],
    enabled: Boolean(open && upid),
    queryFn: () =>
      api<BackupTaskPayload>(
        `/api/hosts/${hostId}/backups/task?node=${encodeURIComponent(node)}&upid=${encodeURIComponent(upid!)}`,
      ),
    refetchInterval: tracking ? 1200 : false,
  });

  useEffect(() => {
    if (!task?.status || finished || errorMsg || settledRef.current) return;
    const st = task.status;
    if (!st.status || st.status === "running") return;
    settledRef.current = true;
    if (isFailedTaskExit(st)) {
      setErrorMsg(st.exitstatus || failedFallback);
      return;
    }
    setFinished(true);
  }, [task, finished, errorMsg, failedFallback]);

  return {
    logLines: (task?.log ?? []).map((l) => l.t).filter(Boolean),
    finished,
    errorMsg,
    tracking,
  };
}
