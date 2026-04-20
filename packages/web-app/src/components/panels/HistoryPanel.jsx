/* HistoryPanel — captures in-memory snapshots of the active file and
   lets the user restore a prior version. Adopts PanelFrame so the
   header, action cluster, and empty state follow the Luna theme. */
import React, { useState, useCallback } from "react";
import {
  Clock,
  RotateCcw,
  Trash2,
  FileCode2,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { PanelFrame, PanelCard, PanelEmpty } from "./PanelFrame";

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

  const restoreSnapshot = useCallback(
    (entry) => {
      if (entry?.content) updateContent(entry.content);
    },
    [updateContent]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    setSelectedId(null);
  }, []);

  const takeSnapshot = useCallback(() => {
    if (activeFileContent) addSnapshot("Manual snapshot", activeFileContent);
  }, [activeFileContent, addSnapshot]);

  const selected = history.find((h) => h.id === selectedId);

  const headerBtn = (icon, label, onClick, disabled, color = "var(--text-secondary)") => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "4px 8px", borderRadius: 6,
        background: "transparent", border: "1px solid var(--border-default)",
        color, fontSize: 10.5, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );

  const actions = (
    <div style={{ display: "flex", gap: 4 }}>
      {headerBtn(<FileCode2 size={10} />, "Snapshot", takeSnapshot, !activeFileContent, "var(--accent)")}
      {headerBtn(<RotateCcw size={10} />, "Restore", () => selected && restoreSnapshot(selected), !selected, "var(--cat-billing)")}
      {headerBtn(<Trash2 size={10} />, "Clear", clearHistory, history.length === 0, "#ef4444")}
    </div>
  );

  return (
    <PanelFrame
      icon={<Clock size={14} />}
      eyebrow="Timeline"
      title="History"
      subtitle={`${history.length} ${history.length === 1 ? "snapshot" : "snapshots"}`}
      actions={actions}
      bodyPadding={history.length === 0 ? 14 : 10}
    >
      {history.length === 0 ? (
        <PanelEmpty
          icon={Clock}
          title="No history yet"
          description="Take snapshots to track changes to the active file over time."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {history.map((entry) => {
            const isSelected = selectedId === entry.id;
            return (
              <PanelCard
                key={entry.id}
                tone={isSelected ? "accent" : "neutral"}
                dense
                onClick={() => setSelectedId(entry.id)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: 4,
                      background: isSelected ? "var(--accent)" : "var(--cat-users)",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.label}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                      {timeLabel(entry.timestamp)}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
                    {entry.contentLength.toLocaleString()} chars
                  </span>
                </div>
              </PanelCard>
            );
          })}
        </div>
      )}
    </PanelFrame>
  );
}
