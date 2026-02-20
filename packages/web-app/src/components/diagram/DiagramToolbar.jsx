import React, { useState } from "react";
import {
  Search,
  X,
  Filter,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Layers,
  LayoutGrid,
  ChevronDown,
  Tag,
  Eye,
  EyeOff,
  ArrowRightLeft,
  Boxes,
  RefreshCw,
  Download,
  Image,
  StickyNote,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import { SCHEMA_COLORS } from "../../lib/schemaColors";

const CARDINALITY_LEGEND = [
  { key: "one_to_one", label: "1:1", color: "#16a34a" },
  { key: "one_to_many", label: "1:N", color: "#2563eb" },
  { key: "many_to_one", label: "N:1", color: "#9333ea" },
  { key: "many_to_many", label: "N:N", color: "#ea580c" },
];

const REL_SEMANTIC_LEGEND = [
  { label: "PK->FK", color: "#0ea5e9", dash: false },
  { label: "FK->PK", color: "#8b5cf6", dash: false },
  { label: "Self relationship", color: "#f59e0b", dash: true },
  { label: "Shared PK target", color: "#0f766e", dash: false },
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
    getSchemaOptions,
    nodes,
    viewMode,
    setViewMode,
    visibleLimit,
    setVisibleLimit,
    activeSchemaFilter,
    setActiveSchemaFilter,
    requestLayoutRefresh,
  } = useDiagramStore();

  const { diagramFullscreen, toggleDiagramFullscreen } = useUiStore();
  const [showLegend, setShowLegend] = useState(false);
  const [showSchemaLegend, setShowSchemaLegend] = useState(false);

  const tagOptions = getTagOptions();
  const entityNames = getEntityNames();
  const schemaOptions = getSchemaOptions();
  const totalEntities = entityNames.length;
  const currentVisible = totalEntities === 0 ? 0 : (visibleLimit === 0 ? totalEntities : visibleLimit);

  const handleFocusSearch = () => {
    const query = entitySearch.trim().toLowerCase();
    if (!query) return;
    const match = entityNames.find((n) => n.toLowerCase().includes(query));
    if (match) selectEntity(match);
  };

  const handleLimitChange = (delta) => {
    if (totalEntities <= 0) return;
    if (delta === 0) {
      setVisibleLimit(0);
      return;
    }
    const current = visibleLimit || totalEntities;
    const next = Math.max(1, Math.min(totalEntities, current + delta));
    setVisibleLimit(next === totalEntities ? 0 : next);
  };

  const handleLimitInputChange = (rawValue) => {
    if (totalEntities <= 0) {
      setVisibleLimit(0);
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(1, Math.min(totalEntities, Math.floor(parsed)));
    setVisibleLimit(clamped >= totalEntities ? 0 : clamped);
  };

  return (
    <div className="relative">
      {/* Row 1: Search + View Mode + Schema + Entity Count */}
      <div className="flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm border-b border-slate-200">

        {/* Search */}
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md px-2 py-0.5 w-[160px] focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
          <Search size={11} className="text-slate-400 shrink-0" />
          <input
            value={entitySearch}
            onChange={(e) => setEntitySearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFocusSearch()}
            placeholder="Search..."
            className="bg-transparent text-[11px] text-slate-700 placeholder:text-slate-400 outline-none w-full"
            list="entity-search-list"
          />
          <datalist id="entity-search-list">
            {entityNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {entitySearch && (
            <button onClick={() => { setEntitySearch(""); clearSelection(); }} className="p-0.5 rounded hover:bg-slate-200 text-slate-400">
              <X size={9} />
            </button>
          )}
        </div>

        <ToolbarDivider />

        {/* View Mode */}
        <ToolbarButton active={viewMode === "overview"} onClick={() => { setViewMode("overview"); setActiveSchemaFilter(null); }} title="Schema overview">
          <LayoutGrid size={11} /> Overview
        </ToolbarButton>
        <ToolbarButton active={viewMode === "all"} onClick={() => setViewMode("all")} title="Show all entities">
          <Layers size={11} /> All
        </ToolbarButton>

        {/* Schema filter */}
        {activeSchemaFilter && (
          <button onClick={() => setActiveSchemaFilter(null)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
            title="Clear schema filter">
            <X size={9} /> {activeSchemaFilter}
          </button>
        )}
        {schemaOptions.length > 1 && viewMode !== "overview" && (
          <select value={activeSchemaFilter || ""} onChange={(e) => setActiveSchemaFilter(e.target.value || null)}
            className="bg-white border border-slate-200 rounded-md px-1 py-0.5 text-[10px] text-slate-600 outline-none hover:border-slate-300 cursor-pointer max-w-[110px]"
            title="Filter by schema">
            <option value="">All Schemas</option>
            {schemaOptions.map((s) => (<option key={s.name} value={s.name}>{s.name} ({s.entityCount})</option>))}
          </select>
        )}

        <ToolbarDivider />

        {/* Entity count control */}
        <span className="text-[9px] text-slate-400 font-medium uppercase">Show</span>
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-md overflow-hidden">
          <button onClick={() => handleLimitChange(-5)} className="px-1 py-0.5 text-slate-500 hover:bg-slate-100 border-r border-slate-200" title="Fewer"><Minus size={10} /></button>
          <input
            type="number"
            min={totalEntities > 0 ? 1 : 0}
            max={totalEntities}
            value={currentVisible}
            onChange={(e) => handleLimitInputChange(e.target.value)}
            className="w-[44px] px-1 py-0.5 text-[10px] font-semibold text-slate-700 text-center tabular-nums bg-white outline-none"
            title="Enter how many entities to display"
            disabled={totalEntities <= 0}
          />
          <button onClick={() => handleLimitChange(5)} className="px-1 py-0.5 text-slate-500 hover:bg-slate-100 border-l border-slate-200" title="More"><Plus size={10} /></button>
        </div>
        <button onClick={() => handleLimitChange(0)} className="text-[9px] text-blue-600 hover:text-blue-700 font-medium" title="Show all">All</button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Entity count badge */}
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-[9px] text-slate-500 font-medium tabular-nums shrink-0">
          <Boxes size={9} />
          {visibleLimit > 0 ? `${visibleLimit}/${totalEntities}` : totalEntities}
        </span>
      </div>

      {/* Row 2: Filters + Layout + Toggles + Export */}
      <div className="flex items-center gap-1 px-2 py-0.5 bg-white/80 border-b border-slate-100">
        {/* Filters */}
        <Filter size={10} className="text-slate-400 shrink-0" />
        <ToolbarSelect value={vizSettings.entityTypeFilter} onChange={(v) => updateVizSetting("entityTypeFilter", v)} label="Entity type"
          options={[{ value: "all", label: "All Models" }, { value: "table", label: "Relational" }, { value: "view", label: "Views" }, { value: "dimension_table", label: "Dimensional" }]} />
        {tagOptions.length > 0 && (
          <ToolbarSelect value={vizSettings.tagFilter} onChange={(v) => updateVizSetting("tagFilter", v)} label="Tag filter"
            options={[{ value: "all", label: "All Tags" }, ...tagOptions.map((t) => ({ value: t, label: t }))]} />
        )}

        <ToolbarDivider />

        {/* Layout */}
        <ToolbarSelect value={vizSettings.layoutMode} onChange={(v) => updateVizSetting("layoutMode", v)} label="Layout"
          options={[{ value: "elk", label: "Auto (ELK)" }, { value: "grid", label: "Grid" }, { value: "star_schema", label: "Star Schema" }]} />
        <ToolbarSelect value={vizSettings.layoutDensity} onChange={(v) => updateVizSetting("layoutDensity", v)} label="Density"
          options={[{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "wide", label: "Wide" }]} />
        <ToolbarSelect value={vizSettings.fieldView} onChange={(v) => updateVizSetting("fieldView", v)} label="Fields"
          options={[{ value: "all", label: "All Fields" }, { value: "keys", label: "Keys Only" }, { value: "minimal", label: "Top 8" }]} />
        <ToolbarButton onClick={() => requestLayoutRefresh()} title="Auto arrange and fit">
          <RefreshCw size={10} /> Auto Layout
        </ToolbarButton>

        <ToolbarDivider />

        {/* Toggles */}
        <ToolbarButton active={vizSettings.showEdgeLabels} onClick={() => updateVizSetting("showEdgeLabels", !vizSettings.showEdgeLabels)} title="Edge labels">
          <Tag size={10} />
        </ToolbarButton>
        <ToolbarButton active={vizSettings.dimUnrelated} onClick={() => updateVizSetting("dimUnrelated", !vizSettings.dimUnrelated)} title="Dim unrelated">
          {vizSettings.dimUnrelated ? <EyeOff size={10} /> : <Eye size={10} />}
        </ToolbarButton>
        <ToolbarButton active={showSchemaLegend} onClick={() => setShowSchemaLegend(!showSchemaLegend)} title="Schema color legend">
          <Boxes size={10} />
        </ToolbarButton>
        <ToolbarButton active={showLegend} onClick={() => setShowLegend(!showLegend)} title="Relationship legend">
          <ArrowRightLeft size={10} />
        </ToolbarButton>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Note */}
        <ToolbarButton onClick={() => { if (window.__dlAddAnnotation) window.__dlAddAnnotation({ x: Math.random() * 400 + 50, y: Math.random() * 200 + 50 }); }} title="Add note">
          <StickyNote size={10} />
        </ToolbarButton>

        {/* Export */}
        <ToolbarButton
          onClick={() => {
            const el = document.querySelector(".react-flow");
            if (!el) return;
            import("html-to-image").then(({ toPng }) => {
              toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 }).then((dataUrl) => {
                const a = document.createElement("a"); a.href = dataUrl; a.download = "duckcodemodeling-diagram.png"; a.click();
              });
            });
          }}
          title="Export PNG"
        >
          <Image size={10} /> PNG
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            const el = document.querySelector(".react-flow");
            if (!el) return;
            import("html-to-image").then(({ toSvg }) => {
              toSvg(el, { backgroundColor: "#ffffff" }).then((dataUrl) => {
                const a = document.createElement("a"); a.href = dataUrl; a.download = "duckcodemodeling-diagram.svg"; a.click();
              });
            });
          }}
          title="Export SVG"
        >
          <Download size={10} /> SVG
        </ToolbarButton>

        {/* Fullscreen */}
        <button onClick={toggleDiagramFullscreen}
          className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title={diagramFullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {diagramFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      {/* Schema color legend */}
      {showSchemaLegend && schemaOptions.length > 0 && (
        <div className="absolute top-full left-2 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[180px] max-w-[260px]">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">
            Schema / Domain Colors
          </div>
          <div className="space-y-1.5">
            {schemaOptions.map((s, i) => {
              const sc = SCHEMA_COLORS[i % SCHEMA_COLORS.length];
              return (
                <button
                  key={s.name}
                  onClick={() => { setActiveSchemaFilter(s.name === activeSchemaFilter ? null : s.name); }}
                  className={`flex items-center gap-2 w-full rounded-md px-1.5 py-1 transition-colors ${
                    activeSchemaFilter === s.name ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: sc.hex }} />
                  <span className="text-[11px] font-medium text-slate-700 truncate flex-1 text-left">{s.name}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{s.entityCount}</span>
                </button>
              );
            })}
          </div>
          {activeSchemaFilter && (
            <button
              onClick={() => setActiveSchemaFilter(null)}
              className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-blue-600 hover:text-blue-700 font-medium w-full text-left"
            >
              Show all schemas
            </button>
          )}
        </div>
      )}

      {/* Relationship legend dropdown */}
      {showLegend && (
        <div className="absolute top-full right-2 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[220px]">
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
          <div className="mt-2 pt-2 border-t border-slate-100">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1.5">
              Semantic Edges
            </div>
            <div className="space-y-1">
              {REL_SEMANTIC_LEGEND.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div
                    className="w-5 h-0.5 rounded-full"
                    style={{
                      backgroundColor: item.color,
                      borderTop: item.dash ? `1px dashed ${item.color}` : undefined,
                    }}
                  />
                  <span className="text-[10px] text-slate-600">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-5 h-0.5 bg-blue-500 rounded-full" />
              <span>Animated = many:many / focused edge</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 bg-blue-500 rounded-full relative">
                <div className="absolute right-0 -top-[3px] w-0 h-0 border-l-[5px] border-l-blue-500 border-y-[3px] border-y-transparent" />
              </div>
              <span>Arrows indicate edge direction</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
