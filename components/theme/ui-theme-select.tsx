"use client";

import { UiThemePicker } from "@/components/theme/ui-theme-picker";

export function UiThemeSelect({ className }: { className?: string }) {
  return (
    <div className={className}>
      <UiThemePicker compact />
    </div>
  );
}
