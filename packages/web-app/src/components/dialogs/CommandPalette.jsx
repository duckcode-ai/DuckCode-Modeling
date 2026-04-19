import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import { buildCommands, fuzzyMatch } from "../../lib/commandRegistry";

export default function CommandPalette() {
  const { closeModal } = useUiStore();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const commands = useMemo(() => buildCommands(), []);

  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((c) => {
        const m = fuzzyMatch(query, c.title);
        return m ? { cmd: c, score: m.score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.cmd);
  }, [commands, query]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const run = (cmd) => {
    try {
      cmd.run?.();
    } finally {
      closeModal();
    }
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[activeIdx];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      closeModal();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/50 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="w-[640px] max-w-[94vw] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border-primary">
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command…"
            className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted"
          />
          <kbd className="text-[10px] text-text-muted font-mono">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-text-muted">
              No commands match "{query}"
            </div>
          )}
          {results.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => run(cmd)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors ${
                i === activeIdx
                  ? "bg-bg-active text-text-accent"
                  : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-text-muted w-[64px] shrink-0">
                  {cmd.section}
                </span>
                <span className="truncate">{cmd.title}</span>
              </div>
              {cmd.shortcut && (
                <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-subtle text-text-muted">
                  {cmd.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
