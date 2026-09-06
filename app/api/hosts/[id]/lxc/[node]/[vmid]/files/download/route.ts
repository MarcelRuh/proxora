import { guestFileDownloadRoute } from "@/server/http/guest-file-download-route";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export const GET = guestFileDownloadRoute("lxc");
