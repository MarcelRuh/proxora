"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isUpid } from "@/lib/guest-task";
import { useProxmoxTask } from "@/components/tasks/use-proxmox-task";

export type CreateTaskPhase = "create" | "start";

export function useCreateTaskFollow({
  kind,
  hostId,
  node,
  vmid,
  createUpid,
  startAfter,
  open,
  failedFallback,
  onAllDone,
  onFailed,
}: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number;
  createUpid: string | null;
  startAfter: boolean;
  open: boolean;
  failedFallback: string;
  onAllDone: () => void;
  onFailed: (message: string) => void;
}) {
  const [phase, setPhase] = useState<CreateTaskPhase>("create");
  const [upid, setUpid] = useState<string | null>(null);
  const startedRef = useRef(false);
  const doneRef = useRef(false);
  const onAllDoneRef = useRef(onAllDone);
  const onFailedRef = useRef(onFailed);
  onAllDoneRef.current = onAllDone;
  onFailedRef.current = onFailed;

  useEffect(() => {
    setPhase("create");
    setUpid(createUpid);
    startedRef.current = false;
    doneRef.current = false;
  }, [createUpid]);

  const task = useProxmoxTask({
    hostId,
    node,
    upid,
    open,
    failedFallback,
  });

  useEffect(() => {
    if (task.errorMsg) onFailedRef.current(task.errorMsg);
  }, [task.errorMsg]);

  useEffect(() => {
    if (!task.finished || doneRef.current) return;
    if (phase === "create" && startAfter) {
      if (startedRef.current) return;
      startedRef.current = true;
      const path = `/api/hosts/${hostId}/${kind === "lxc" ? "lxc" : "vms"}/${encodeURIComponent(node)}/${vmid}`;
      void api<{ upid?: unknown }>(path, {
        method: "POST",
        body: JSON.stringify({ action: "start", wait: false }),
      })
        .then((res) => {
          const next = isUpid(res.upid) ? res.upid : null;
          if (!next) {
            doneRef.current = true;
            onAllDoneRef.current();
            return;
          }
          setPhase("start");
          setUpid(next);
        })
        .catch((err: unknown) => {
          onFailedRef.current(err instanceof Error ? err.message : failedFallback);
        });
      return;
    }
    doneRef.current = true;
    onAllDoneRef.current();
  }, [task.finished, phase, startAfter, hostId, kind, node, vmid, failedFallback]);

  return { logLines: task.logLines, phase };
}
