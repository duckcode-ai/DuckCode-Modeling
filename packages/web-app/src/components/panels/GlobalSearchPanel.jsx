import React, { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  Search,
  Sparkles,
  Database,
  Columns3,
  Tag,
  FileText,
  BookOpen,
  ArrowUpRight,
  Link2,
  Filter,
  X,
  Copy,
  Command,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import {
  buildSearchIndex,
  rankSearchResults,
  buildSearchRecommendations,
} from "../../lib/searchEngine";

const CATEGORY_META = {
  entity: { label: "Entity", icon: Database, chip: "bg-blue-50 text-blue-700 border-blue-200" },
  field: { label: "Field", icon: Columns3, chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  tag: { label: "Tag", icon: Tag, chip: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200" },
  description: { label: "Description", icon: FileText, chip: "bg-amber-50 text-amber-700 border-amber-200" },
  glossary: { label: "Glossary", icon: BookOpen, chip: "bg-cyan-50 text-cyan-700 border-cyan-200" },
};

const QUICK_HINTS = [
  "entity:orders",
  "schema:finance -tag:deprecated",
  "\"customer lifetime value\"",
  "type:field status",
];

function highlight(text, query) {
  const source = String(text || "");
  const q = String(query || "").trim();
  if (!q) return source;
  const idx = source.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return source;
  return (
    <>
      {source.slice(0, idx)}
      <mark className="bg-amber-100 text-amber-900 rounded px-0.5">{source.slice(idx, idx + q.length)}</mark>
      {source.slice(idx + q.length)}
    </>
  );
}

export default function GlobalSearchPanel() {
  const {
    model,
    edges,
    selectEntity,
    setCenterEntityId,
  } = useDiagramStore();
  const {
    setActiveActivity,
    setBottomPanelTab,
    addToast,
  } = useUiStore();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);

  const relCounts = useMemo(() => {
    const map = {};
    (edges || []).forEach((edge) => {
      map[edge.source] = (map[edge.source] || 0) + 1;
      map[edge.target] = (map[edge.target] || 0) + 1;
    });
    return map;
  }, [edges]);

  const searchIndex = useMemo(
    () => buildSearchIndex(model, relCounts),
    [model, relCounts]
  );

  const ranked = useMemo(
    () => rankSearchResults(searchIndex, deferredQuery),
    [searchIndex, deferredQuery]
  );

  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const result of ranked.results) {
      counts[result.category] = (counts[result.category] || 0) + 1;
    }
    return counts;
  }, [ranked.results]);

  const filteredResults = useMemo(() => {
    if (categoryFilter === "all") return ranked.results;
    return ranked.results.filter((result) => result.category === categoryFilter);
  }, [ranked.results, categoryFilter]);

  const recommendations = useMemo(
    () => buildSearchRecommendations(model, filteredResults, deferredQuery),
    [model, filteredResults, deferredQuery]
  );

  const resultCount = filteredResults.length;
  const hasQuery = deferredQuery.trim().length > 0;

  const openInModel = useCallback((item) => {
    if (item.entityName) {
      setActiveActivity("model");
      setBottomPanelTab("properties");
      selectEntity(item.entityName);
      setCenterEntityId(item.entityName);
      return;
    }
    if (item.category === "glossary") {
      setActiveActivity("model");
      setBottomPanelTab("dictionary");
    }
  }, [setActiveActivity, setBottomPanelTab, selectEntity, setCenterEntityId]);

  const copyModelLink = useCallback(async (item) => {
    if (!item?.modelLink) return;
    try {
      await navigator.clipboard.writeText(item.modelLink);
      addToast?.({ type: "success", message: `Copied ${item.modelLink}` });
    } catch (_err) {
      addToast?.({ type: "error", message: "Unable to copy model link." });
    }
  }, [addToast]);

  const totalCount = Object.values(categoryCounts).reduce((sum, value) => sum + value, 0);

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.10),_transparent_50%),linear-gradient(180deg,#f8fbff_0%,#ffffff_52%)]">
      <div className="max-w-[1320px] mx-auto px-6 pb-8">
        <div className={`${hasQuery ? "pt-5" : "pt-16"} transition-all duration-300`}>
          <div className={`${hasQuery ? "text-left" : "text-center"} transition-all duration-300`}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 text-[11px] font-semibold text-slate-600 shadow-sm">
              <Sparkles size={12} className="text-blue-600" />
              DuckCodeModeling Search
            </div>
            <div className="mt-2 text-[12px] text-slate-500">
              Powered by{" "}
              <a
                href="https://duckcode.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-700 hover:text-blue-800 hover:underline"
              >
                DuckCode AI Labs
              </a>
              .
            </div>
            {!hasQuery && (
              <h1 className="mt-4 text-[44px] leading-[1.1] tracking-tight font-semibold text-slate-900">
                Search your data model
              </h1>
            )}
          </div>

          <div className={`${hasQuery ? "mt-4" : "mt-7"} max-w-[840px] ${hasQuery ? "" : "mx-auto"}`}>
            <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
              <Search size={18} className="text-slate-400 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search entities, columns, tags, descriptions, glossary..."
                className="flex-1 bg-transparent text-[15px] text-slate-800 placeholder:text-slate-400 outline-none"
                autoFocus
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  title="Clear"
                >
                  <X size={14} />
                </button>
              )}
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-[10px] text-slate-500 font-medium">
                <Command size={10} />
                K
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Google-style operators: <code>entity:</code> <code>schema:</code> <code>tag:</code> <code>type:</code> and exclusion with <code>-term</code>.
            </div>
          </div>

          <div className={`${hasQuery ? "mt-4" : "mt-6"} flex flex-wrap gap-2 ${hasQuery ? "" : "justify-center"}`}>
            {QUICK_HINTS.map((hint) => (
              <button
                key={hint}
                onClick={() => setQuery(hint)}
                className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-[11px] text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              >
                {hint}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {hasQuery && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <Filter size={12} />
                  Filter
                </span>
                <button
                  onClick={() => setCategoryFilter("all")}
                  className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                    categoryFilter === "all"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  All ({totalCount})
                </button>
                {Object.entries(categoryCounts).map(([cat, count]) => {
                  const meta = CATEGORY_META[cat] || CATEGORY_META.description;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                        categoryFilter === cat
                          ? meta.chip
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <Icon size={11} />
                      {meta.label} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {!hasQuery ? (
              <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-sm px-6 py-10 text-center">
                <Search size={24} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-700 font-medium">Start typing to search your model like Google.</p>
                <p className="text-xs text-slate-500 mt-1">Search names, tags, descriptions, glossary, and use operators for precision.</p>
              </div>
            ) : resultCount === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-10 text-center">
                <p className="text-sm text-slate-700 font-medium">No results for "{deferredQuery}"</p>
                <p className="text-xs text-slate-500 mt-1">Try broader keywords, quoted phrases, or remove exclusions.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {filteredResults.map((item) => {
                  const meta = CATEGORY_META[item.category] || CATEGORY_META.description;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={item.id}
                      className="px-5 py-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 p-1.5 rounded-lg border ${meta.chip}`}>
                          <Icon size={12} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-emerald-700 truncate font-mono">
                            {item.modelLink}
                          </div>
                          <button
                            onClick={() => openInModel(item)}
                            className="mt-0.5 text-left text-[16px] leading-snug text-blue-700 hover:text-blue-800 hover:underline"
                          >
                            {highlight(item.text, deferredQuery)}
                          </button>
                          <div className="mt-0.5 text-[12px] text-slate-600 line-clamp-2">
                            {highlight(item.detail || "", deferredQuery)}
                          </div>
                          {item.subDetail && (
                            <div className="mt-1 text-[11px] text-slate-500 line-clamp-1">{item.subDetail}</div>
                          )}
                          <div className="mt-2 flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${meta.chip}`}>
                              <Icon size={10} />
                              {meta.label}
                            </span>
                            {item.schema && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] border border-slate-200 bg-slate-50 text-slate-600">
                                {item.schema}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => copyModelLink(item)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            title="Copy model link"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            onClick={() => openInModel(item)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            title="Open in model"
                          >
                            <ArrowUpRight size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <h3 className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold">
                Follow-up Recommendations
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {recommendations.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setQuery(suggestion)}
                    className="px-2.5 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <h3 className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold">
                Model Links
              </h3>
              <div className="mt-3 space-y-2">
                {recommendations.entityLinks.map((entry) => (
                  <button
                    key={entry.modelLink}
                    onClick={() => openInModel(entry)}
                    className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Link2 size={11} className="text-emerald-700 shrink-0" />
                      <span className="text-[11px] font-mono text-emerald-700 truncate">{entry.modelLink}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-slate-700 truncate">{entry.label}</div>
                    {entry.schema && (
                      <div className="text-[10px] text-slate-500">{entry.schema}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
