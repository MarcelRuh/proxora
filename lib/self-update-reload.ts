export type UpdateReloadStatus = {
  updating: boolean;
  progress?: { step?: string } | null;
};

export function updateShouldReload(input: {
  held: boolean;
  sawUpdating: boolean;
  resumed: boolean;
  status: UpdateReloadStatus | undefined;
}): "reload" | "clear" | "wait" {
  const { held, sawUpdating, resumed, status } = input;
  if (!status || status.updating) return "wait";
  if (status.progress?.step === "error") return held || sawUpdating ? "clear" : "wait";
  if (!held && !sawUpdating) return "wait";
  if (sawUpdating || (resumed && status.progress?.step === "done")) return "reload";
  return "wait";
}
