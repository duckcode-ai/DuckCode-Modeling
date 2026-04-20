/* PanelDialog — thin wrapper that mounts an existing panel component inside
   a centered modal so the new shell can expose Import / Search / Connectors
   flows without dedicating screen real estate to them. */
import React from "react";
import { X } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import ImportPanel from "../panels/ImportPanel";
import GlobalSearchPanel from "../panels/GlobalSearchPanel";
import ConnectorsPanel from "../panels/ConnectorsPanel";

const REGISTRY = {
  import:     { title: "Import Schema",     Panel: ImportPanel,       w: "860px", h: "80vh" },
  search:     { title: "Global Search",     Panel: GlobalSearchPanel, w: "820px", h: "75vh" },
  connectors: { title: "Database Connectors", Panel: ConnectorsPanel, w: "900px", h: "80vh" },
};

export default function PanelDialog({ kind }) {
  const { closeModal } = useUiStore();
  const entry = REGISTRY[kind];
  if (!entry) return null;
  const { title, Panel, w, h } = entry;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div
        className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl flex flex-col"
        style={{ width: w, maxWidth: "94vw", height: h, maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary shrink-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <Panel />
        </div>
      </div>
    </div>
  );
}
