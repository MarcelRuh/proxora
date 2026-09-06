import { guestFileUploadRoute } from "@/server/http/guest-file-download-route";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export const PUT = guestFileUploadRoute("vm");
