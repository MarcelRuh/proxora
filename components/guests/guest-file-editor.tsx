"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/i18n/locale-provider";

const LINE = "font-mono text-xs leading-5";

function matchStarts(haystack: string, query: string): number[] {
  if (!query) return [];
  const hay = haystack.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    out.push(at);
    from = at + Math.max(needle.length, 1);
  }
  return out;
}

export function GuestFileEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const lineCount = Math.max(1, value.split("\n").length);
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => String(i + 1)).join("\n"),
    [lineCount],
  );
  const matches = useMemo(() => matchStarts(value, query), [value, query]);

  function syncScroll() {
    const textarea = textareaRef.current;
    const gutterEl = gutterRef.current;
    if (textarea && gutterEl) gutterEl.scrollTop = textarea.scrollTop;
  }

  function selectMatch(index: number, opts?: { focus?: boolean }) {
    const textarea = textareaRef.current;
    if (!textarea || !matches.length) return;
    const next = ((index % matches.length) + matches.length) % matches.length;
    const start = matches[next];
    if (start == null) return;
    setActive(next);
    if (opts?.focus !== false) textarea.focus();
    const end = start + query.length;
    textarea.setSelectionRange(start, end);
    const line = value.slice(0, start).split("\n").length;
    textarea.scrollTop = Math.max(0, (line - 4) * 20);
    syncScroll();
  }

  useEffect(() => {
    if (!findOpen) return;
    findRef.current?.focus();
    findRef.current?.select();
  }, [findOpen]);

  useEffect(() => {
    if (!query) {
      setActive(0);
      return;
    }
    if (matches.length) selectMatch(0, { focus: false });
    else setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump to first match when query changes
  }, [query]);

  function openFind() {
    setFindOpen(true);
    const textarea = textareaRef.current;
    if (textarea) {
      const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (selected && !selected.includes("\n")) setQuery(selected);
    }
  }

  function onEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
    }
    if (e.key === "Escape" && findOpen) {
      e.preventDefault();
      setFindOpen(false);
    }
  }

  function onFindKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!matches.length) return;
      selectMatch(active + (e.shiftKey ? -1 : 1), { focus: false });
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setFindOpen(false);
      textareaRef.current?.focus();
    }
  }

  const digits = String(lineCount).length;

  return (
    <div className="overflow-hidden rounded-[var(--ui-radius)] border border-input">
      {findOpen ? (
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <Input
            ref={findRef}
            className="h-8"
            value={query}
            placeholder={t("files.findPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFindKey}
            aria-label={t("files.find")}
          />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {query
              ? matches.length
                ? t("files.findCount", { current: active + 1, total: matches.length })
                : t("files.findNone")
              : ""}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={!matches.length}
            onClick={() => selectMatch(active - 1, { focus: false })}
            aria-label={t("files.findPrev")}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={!matches.length}
            onClick={() => selectMatch(active + 1, { focus: false })}
            aria-label={t("files.findNext")}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-[50vh]">
        <div
          ref={gutterRef}
          aria-hidden
          className={`shrink-0 overflow-hidden border-r border-border bg-white/[0.03] px-2 py-2 text-right text-muted-foreground select-none ${LINE}`}
          style={{ width: `${Math.max(2, digits) + 1.5}ch` }}
        >
          <pre className={`m-0 ${LINE}`}>{gutter}</pre>
        </div>
        <textarea
          ref={textareaRef}
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onEditorKey}
          className={`min-h-[50vh] w-0 min-w-0 flex-1 resize-none overflow-auto bg-transparent px-2 py-2 [tab-size:2] outline-none disabled:opacity-50 ${LINE}`}
        />
      </div>
    </div>
  );
}
