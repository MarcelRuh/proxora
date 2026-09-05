"use client";

import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/components/i18n/locale-provider";
import { formatMemoryMib, isMemoryPreset, MEMORY_PRESETS_MIB } from "@/lib/guest-memory";

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export function MemoryField({
  value,
  onChange,
}: {
  value: number;
  onChange: (mib: number) => void;
}) {
  const { t } = useI18n();
  const preset = isMemoryPreset(value) ? String(value) : "custom";

  return (
    <div className="space-y-1">
      <Label>{t("create.memory")}</Label>
      <select
        className={selectClass}
        value={preset}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next > 0) onChange(next);
        }}
      >
        {preset === "custom" ? (
          <option value="custom">
            {t("create.memoryCustom")}
            {value > 0 ? ` (${formatMemoryMib(value)})` : ""}
          </option>
        ) : null}
        {MEMORY_PRESETS_MIB.map((mib) => (
          <option key={mib} value={mib}>
            {formatMemoryMib(mib)}
          </option>
        ))}
      </select>
      <Input
        className="mt-1"
        inputMode="numeric"
        value={value ? String(value) : ""}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}
