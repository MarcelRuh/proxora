"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getAndroidDownloadBridge } from "@/lib/guest-file-transfer";

export function AndroidSessionTtl() {
  const { data } = useQuery({
    queryKey: ["account-sessions"],
    queryFn: () => api<{ cookieMaxAge: number }>("/api/account/sessions"),
    staleTime: 60_000,
  });
  useEffect(() => {
    const seconds = data?.cookieMaxAge;
    if (!seconds || seconds < 60) return;
    getAndroidDownloadBridge()?.setCookieMaxAge?.(seconds);
  }, [data?.cookieMaxAge]);
  return null;
}
