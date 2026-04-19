import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X, Plus, Database } from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import {
  getObjectTypeMeta,
  groupEntitiesByType,
} from "../../lib/objectTypeMeta";
import { addEntity, parseYamlSafe } from "../../lib/yamlRoundTrip";

/**
 * Luna-style Object List: a grouped, expandable tree of all objects in the
 * active model, organized by DataLex kind (Tables, Views, Enums, ...). Single
 * click selects + centers on canvas; the tree drives selection state shared
 * with the Inspector and right-click menus.
 */
export default function ObjectListPanel() {
  const {
    model,
    edges,
    selectedEntityId,
    selectEntity,
    setCenterEntityId,
  } = useDiagramStore();
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [requestedName, setRequestedName] = useState("NewEntity");

  const entities = model?.entities || [];

  const relCounts = useMemo(() => {
    const counts = {};
    (edges || []).forEach((e) => {
      counts[e.source] = (counts[e.source] || 0) + 1;
      counts[e.target] = (counts[e.target] || 0) + 1;
    });
    return counts;
  }, [edges]);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? entities.filter((entity) => {
          const name = String(entity?.name || "").toLowerCase();
          if (name.includes(query)) return true;
          const description = String(entity?.description || "").toLowerCase();
          if (description.includes(query)) return true;
          return (entity?.fields || []).some((field) =>
            String(field?.name || "").toLowerCase().includes(query)
          );
        })
      : entities;
    return groupEntitiesByType(filtered);
  }, [entities, search]);

  const toggleGroup = (kind) =>
    setCollapsedGroups((prev) => ({ ...prev, [kind]: !prev[kind] }));

  const handleSelect = (name) => {
    selectEntity(name);
    setCenterEntityId(name);
  };

  const handleAddTable = () => {
    if (!activeFileContent) {
      addToast?.({ type: "error", message: "Open a model file first." });
      return;
    }
    setRequestedName("NewEntity");
    setCreateDialogOpen(true);
  };

  const handleCreateEntity = () => {
    const before = new Set((model?.entities || []).map((e) => e.name));
    const result = addEntity(activeFileContent, String(requestedName || "").trim());
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    const parsed = parseYamlSafe(result.yaml);
    const after = (parsed.doc?.entities || []).map((e) => e.name);
    const added = after.find((name) => !before.has(name));
    if (added) {
      selectEntity(added);
      setCenterEntityId(added);
      addToast?.({ type: "success", message: `Added table ${added}.` });
    } else {
      addToast?.({ type: "success", message: "Added table." });
    }
    setCreateDialogOpen(false);
  };

  if (entities.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center text-center px-6 py-10">
          <Database size={28} className="text-text-muted mb-3" />
          <p className="t-label text-text-secondary">No objects yet</p>
          <p className="t-caption text-text-muted mt-1">
            Open a model file to populate the tree.
          </p>
          {canEdit && (
            <button
              onClick={handleAddTable}
              className="dl-toolbar-btn dl-toolbar-btn--primary mt-4"
            >
              <Plus size={14} strokeWidth={2} />
              New Table
            </button>
          )}
        </div>
        {createDialogOpen && (
          <NameModal
            title="New Table"
            value={requestedName}
            onChange={setRequestedName}
            onClose={() => setCreateDialogOpen(false)}
            onSubmit={handleCreateEntity}
          />
        )}
      </>
    );
  }

  const totalVisible = filteredGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <div className="flex flex-col min-h-0">
        {/* Search row */}
        <div className="px-2 pt-1 pb-2">
          <div className="flex items-center gap-1.5 h-7 px-2 rounded-md bg-bg-tertiary border border-border-subtle focus-within:border-accent-blue focus-within:ring-1 focus-within:ring-accent-blue/20 transition-colors">
            <Search size={12} className="text-text-muted shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter objects"
              className="flex-1 bg-transparent outline-none text-xs text-text-primary placeholder:text-text-muted"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="p-0.5 rounded hover:bg-bg-hover text-text-muted"
                title="Clear filter"
              >
                <X size={11} />
              </button>
            )}
            {canEdit && (
              <button
                onClick={handleAddTable}
                className="p-1 rounded hover:bg-bg-hover text-text-muted"
                title="Add a new table"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          <div className="px-1 pt-1.5 t-caption text-text-muted">
            {search
              ? `${totalVisible} of ${entities.length} objects`
              : `${entities.length} objects`}
          </div>
        </div>

        {/* Grouped tree */}
        <div className="flex-1 overflow-y-auto px-1 pb-2">
          {filteredGroups.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="t-caption text-text-muted">
                No objects match your filter.
              </p>
            </div>
          )}
          {filteredGroups.map(({ meta, items }) => {
            const collapsed = collapsedGroups[meta.kind];
            return (
              <ObjectGroup
                key={meta.kind}
                meta={meta}
                items={items}
                relCounts={relCounts}
                collapsed={collapsed}
                onToggle={() => toggleGroup(meta.kind)}
                selectedId={selectedEntityId}
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      </div>

      {createDialogOpen && (
        <NameModal
          title="New Table"
          value={requestedName}
          onChange={setRequestedName}
          onClose={() => setCreateDialogOpen(false)}
          onSubmit={handleCreateEntity}
        />
      )}
    </>
  );
}

function ObjectGroup({ meta, items, relCounts, collapsed, onToggle, selectedId, onSelect }) {
  const Icon = meta.icon;
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="dl-tree-section w-full text-left"
        title={meta.plural}
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-text-muted shrink-0" />
        ) : (
          <ChevronDown size={12} className="text-text-muted shrink-0" />
        )}
        <Icon
          size={13}
          strokeWidth={1.75}
          style={{ color: meta.color }}
          className="shrink-0"
        />
        <span className="truncate">{meta.plural}</span>
        <span className="ml-auto t-caption text-text-muted normal-case tracking-normal font-normal">
          {items.length}
        </span>
      </button>
      {!collapsed && (
        <div className="mt-0.5 space-y-px">
          {items.map((entity) => (
            <ObjectRow
              key={entity.name}
              entity={entity}
              meta={meta}
              relCount={relCounts[entity.name] || 0}
              selected={selectedId === entity.name}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectRow({ entity, meta, relCount, selected, onSelect }) {
  const Icon = meta.icon;
  const fieldCount = (entity.fields || []).length;
  return (
    <div
      onClick={() => onSelect(entity.name)}
      onDoubleClick={() => onSelect(entity.name)}
      className={`dl-tree-row pl-5 ${selected ? "dl-tree-row--active" : ""}`}
      title={entity.description || entity.name}
    >
      <Icon
        size={13}
        strokeWidth={1.75}
        style={{ color: meta.color }}
        className="shrink-0"
      />
      <span className="truncate flex-1">{entity.name}</span>
      <span className="t-caption text-text-muted shrink-0">
        {fieldCount}
        {relCount > 0 ? ` · ${relCount}` : ""}
      </span>
    </div>
  );
}

function NameModal({ title, value, onChange, onClose, onSubmit, confirmLabel = "Create" }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[360px] max-w-[92vw] rounded-xl border border-border-primary bg-bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-primary">
          <h3 className="t-subtitle text-text-primary">{title}</h3>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="p-4 space-y-3"
        >
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon px-3"
            >
              Cancel
            </button>
            <button type="submit" className="dl-toolbar-btn dl-toolbar-btn--primary">
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
