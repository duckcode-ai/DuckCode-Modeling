import React, { useState } from "react";
import {
  Search,
  X,
  Filter,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  GitBranch,
  Layers,
  LayoutGrid,
  ChevronDown,
  Tag,
  Eye,
  EyeOff,
  ArrowRightLeft,
  Boxes,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";

const CARDINALITY_LEGEND = [
  { key: "one_to_one", label: "1:1", color: "#16a34a" },
  { key: "one_to_many", label: "1:N", color: "#2563eb" },
  { key: "many_to_one", label: "N:1", color: "#9333ea" },
  { key: "many_to_many", label: "N:N", color: "#ea580c" },
];

function ToolbarSection({ children, className = "" }) {
  return <div className={`flex items-center gap-1.5 ${className}`}>{children}</div>;
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-slate-200 mx-0.5" />;
}

function ToolbarButton({ active, onClick, title, children, className = "" }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
        active
          ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-sm"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-transparent"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function ToolbarSelect({ value, onChange, options, label, width = "w-auto" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-white border border-slate-200 rounded-md px-1.5 py-1 text-[11px] text-slate-600 outline-none hover:border-slate-300 focus:border-blue-300 focus:ring-1 focus:ring-blue-100 cursor-pointer ${width}`}
      title={label}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

export default function DiagramToolbar() {
  const {
    entitySearch,
    setEntitySearch,
    vizSettings,
    updateVizSetting,
    selectEntity,
    clearSelection,
    getTagOptions,
    getEntityNames,
    nodes,
    viewMode,
    setViewMode,
    visibleLimit,
    setVisibleLimit,
    lineageDepth,
    setLineageDepth,
    selectedEntityId,
  } = useDiagramStore();

  const { diagramFullscreen, toggleDiagramFullscreen } = useUiStore();
  const [showLegend, setShowLegend] = useState(false);

  const tagOptions = getTagOptions();
  const entityNames = getEntityNames();
  const totalEntities = entityNames.length;

  const handleFocusSearch = () => {
    const query = entitySearch.trim().toLowerCase();
    if (!query) return;
    const match = entityNames.find((n) => n.toLowerCase().includes(query));
    if (match) selectEntity(match);
  };

  const handleLimitChange = (delta) => {
    if (delta === 0) {
      setVisibleLimit(0);
      return;
    }
    const current = visibleLimit || totalEntities;
    const next = Math.max(1, Math.min(totalEntities, current + delta));
    setVisibleLimit(next === totalEntities ? 0 : next);
  };

  return (
    <div className="relative">
      {/* Main toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-white/90 backdrop-blur-sm border-b border-slate-200 overflow-x-auto">

        {/* Search */}
        <ToolbarSection>
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 min-w-[150px] focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFocusSearch()}
              placeholder="Search entities..."
              className="bg-transparent text-[11px] text-slate-700 placeholder:text-slate-400 outline-none w-full"
              list="entity-search-list"
            />
            <datalist id="entity-search-list">
              {entityNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {entitySearch && (
              <button
                onClick={() => { setEntitySearch(""); clearSelection(); }}
                className="p-0.5 rounded hover:bg-slate-200 text-slate-400"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </ToolbarSection>

        <ToolbarDivider />

        {/* View Mode: All vs Lineage */}
        <ToolbarSection>
          <ToolbarButton
            active={viewMode === "all"}
            onClick={() => setViewMode("all")}
            title="Show all entities"
          >
            <Layers size={12} />
            All
          </ToolbarButton>
          <ToolbarButton
            active={viewMode === "lineage"}
            onClick={() => {
              setViewMode("lineage");
              if (!selectedEntityId && entityNames.length > 0) {
                selectEntity(entityNames[0]);
              }
            }}
            title="Lineage view from selected entity"
          >
            <GitBranch size={12} />
            Lineage
          </ToolbarButton>
        </ToolbarSection>

        <ToolbarDivider />

        {/* Entity count +/- control */}
        <ToolbarSection>
          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Show</span>
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-md overflow-hidden">
            <button
              onClick={() => handleLimitChange(-5)}
              className="px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors border-r border-slate-200"
              title="Show fewer entities"
            >
              <Minus size={11} />
            </button>
            <span className="px-2 py-1 text-[11px] font-semibold text-slate-700 min-w-[40px] text-center tabular-nums">
              {visibleLimit === 0 ? totalEntities : visibleLimit}
            </span>
            <button
              onClick={() => handleLimitChange(5)}
              className="px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors border-l border-slate-200"
              title="Show more entities"
            >
              <Plus size={11} />
            </button>
          </div>
          <button
            onClick={() => handleLimitChange(0)}
            className="text-[10px] text-blue-600 hover:text-blue-700 font-medium"
            title="Show all entities"
          >
            All
          </button>
        </ToolbarSection>

        {/* Lineage depth (only in lineage mode) */}
        {viewMode === "lineage" && (
          <>
            <ToolbarDivider />
            <ToolbarSection>
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Depth</span>
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-md overflow-hidden">
                <button
                  onClick={() => setLineageDepth(Math.max(1, lineageDepth - 1))}
                  className="px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors border-r border-slate-200"
                >
                  <Minus size={11} />
                </button>
                <span className="px-2 py-1 text-[11px] font-semibold text-slate-700 min-w-[24px] text-center tabular-nums">
                  {lineageDepth}
                </span>
                <button
                  onClick={() => setLineageDepth(Math.min(10, lineageDepth + 1))}
                  className="px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors border-l border-slate-200"
                >
                  <Plus size={11} />
                </button>
              </div>
              <span className="text-[10px] text-slate-400">hops</span>
            </ToolbarSection>
          </>
        )}

        <ToolbarDivider />

        {/* Filters */}
        <ToolbarSection>
          <Filter size={11} className="text-slate-400" />
          <ToolbarSelect
            value={vizSettings.entityTypeFilter}
            onChange={(v) => updateVizSetting("entityTypeFilter", v)}
            label="Entity type"
            options={[
              { value: "all", label: "All Types" },
              { value: "table", label: "Tables" },
              { value: "view", label: "Views" },
            ]}
          />
          {tagOptions.length > 0 && (
            <ToolbarSelect
              value={vizSettings.tagFilter}
              onChange={(v) => updateVizSetting("tagFilter", v)}
              label="Tag filter"
              options={[
                { value: "all", label: "All Tags" },
                ...tagOptions.map((t) => ({ value: t, label: t })),
              ]}
            />
          )}
        </ToolbarSection>

        <ToolbarDivider />

        {/* Layout & Edge */}
        <ToolbarSection>
          <ToolbarSelect
            value={vizSettings.layoutMode}
            onChange={(v) => updateVizSetting("layoutMode", v)}
            label="Layout algorithm"
            options={[
              { value: "elk", label: "Auto (ELK)" },
              { value: "grid", label: "Grid" },
            ]}
          />
          <ToolbarSelect
            value={vizSettings.layoutDensity}
            onChange={(v) => updateVizSetting("layoutDensity", v)}
            label="Density"
            options={[
              { value: "compact", label: "Compact" },
              { value: "normal", label: "Normal" },
              { value: "wide", label: "Wide" },
            ]}
          />
          <ToolbarSelect
            value={vizSettings.fieldView}
            onChange={(v) => updateVizSetting("fieldView", v)}
            label="Field visibility"
            options={[
              { value: "all", label: "All Fields" },
              { value: "keys", label: "Keys Only" },
              { value: "minimal", label: "Top 8" },
            ]}
          />
        </ToolbarSection>

        <ToolbarDivider />

        {/* Toggles */}
        <ToolbarSection>
          <ToolbarButton
            active={vizSettings.showEdgeLabels}
            onClick={() => updateVizSetting("showEdgeLabels", !vizSettings.showEdgeLabels)}
            title="Toggle edge labels"
          >
            <Tag size={11} />
          </ToolbarButton>
          <ToolbarButton
            active={vizSettings.dimUnrelated}
            onClick={() => updateVizSetting("dimUnrelated", !vizSettings.dimUnrelated)}
            title="Dim unrelated entities on select"
          >
            {vizSettings.dimUnrelated ? <EyeOff size={11} /> : <Eye size={11} />}
          </ToolbarButton>
          <ToolbarButton
            active={showLegend}
            onClick={() => setShowLegend(!showLegend)}
            title="Relationship color legend"
          >
            <ArrowRightLeft size={11} />
          </ToolbarButton>
        </ToolbarSection>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Entity count badge */}
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] text-slate-500 font-medium tabular-nums">
          <Boxes size={10} />
          {visibleLimit > 0 ? `${visibleLimit} / ${totalEntities}` : totalEntities} entities
        </span>

        {/* Fullscreen */}
        <button
          onClick={toggleDiagramFullscreen}
          className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title={diagramFullscreen ? "Exit fullscreen" : "Fullscreen diagram"}
        >
          {diagramFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Legend dropdown */}
      {showLegend && (
        <div className="absolute top-full right-2 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[180px]">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">
            Relationship Colors
          </div>
          <div className="space-y-1.5">
            {CARDINALITY_LEGEND.map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-2">
                <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{key.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-5 h-0.5 bg-blue-500 rounded-full" />
              <span>Animated = many:many</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-1 bg-blue-500 rounded-full" />
              <span>Thick = selected entity</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
