import React, { useState, useCallback } from "react";
import {
  Clock,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileCode2,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch (_err) {
    return iso;
  }
}

export default function HistoryPanel() {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const addSnapshot = useCallback((label, content) => {
    const entry = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      timestamp: new Date().toISOString(),
      content,
      contentLength: content.length,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 50));
    setSelectedId(entry.id);
  }, []);

  const restoreSnapshot = useCallback((entry) => {
    if (entry?.content) {
      updateContent(entry.content);
    }
  }, [updateContent]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setSelectedId(null);
  }, []);

  // Take snapshot of current state
  const takeSnapshot = useCallback(() => {
    if (activeFileContent) {
      addSnapshot("Manual snapshot", activeFileContent);
    }
  }, [activeFileContent, addSnapshot]);

  const selected = history.find((h) => h.id === selectedId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
          <Clock size={12} />
          History
        </span>
        <span className="text-[10px] text-text-muted">{history.length} snapshots</span>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={takeSnapshot}
            disabled={!activeFileContent}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-accent-blue hover:bg-accent-blue/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FileCode2 size={10} />
            Snapshot
          </button>
          <button
            onClick={() => selected && restoreSnapshot(selected)}
            disabled={!selected}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-accent-green hover:bg-accent-green/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw size={10} />
            Restore
          </button>
          <button
            onClick={clearHistory}
            disabled={history.length === 0}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-status-error hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 size={10} />
            Clear
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs p-4">
            <Clock size={28} className="mb-2 text-text-muted/50" />
            <p className="text-sm mb-1">No history yet</p>
            <p className="text-xs text-center">
              Take snapshots to track changes over time
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-primary/50">
            {history.map((entry) => (
              <div
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                  selectedId === entry.id
                    ? "bg-bg-active"
                    : "hover:bg-bg-hover"
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-primary truncate">{entry.label}</div>
                  <div className="text-[10px] text-text-muted">{timeLabel(entry.timestamp)}</div>
                </div>
                <span className="text-[10px] text-text-muted shrink-0">
                  {entry.contentLength} chars
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
