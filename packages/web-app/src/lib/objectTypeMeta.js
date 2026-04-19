import {
  Table,
  Table2,
  Eye,
  Layers,
  ListChecks,
  FunctionSquare,
  Workflow,
  KeyRound,
  Binary,
  ShieldAlert,
  Timer,
  AlertTriangle,
  Boxes,
  Link2,
  Network,
  Gauge,
  Component,
  Globe,
  Archive,
  Landmark,
  Sigma,
} from "lucide-react";

/**
 * Metadata registry for DataLex object types.
 *
 * Each entry describes how a kind of object should be rendered in the left
 * Object List tree, on the canvas as a node header, and wherever else the app
 * needs a consistent label + icon + color. CSS variables are used for colors
 * so themes swap cleanly without prop drilling.
 *
 * The `kind` field is the canonical DataLex kind (what the YAML uses).
 * `plural` is the header label in the tree ("Tables (12)").
 */
export const OBJECT_TYPE_META = {
  // Relational entities
  table: {
    kind: "table",
    label: "Table",
    plural: "Tables",
    icon: Table,
    color: "var(--color-ot-table)",
    softColor: "var(--color-accent-blue-soft)",
  },
  external_table: {
    kind: "external_table",
    label: "External table",
    plural: "External tables",
    icon: Globe,
    color: "var(--color-ot-table)",
    softColor: "var(--color-accent-blue-soft)",
  },
  snapshot: {
    kind: "snapshot",
    label: "Snapshot",
    plural: "Snapshots",
    icon: Archive,
    color: "var(--color-ot-satellite)",
    softColor: "var(--color-accent-cyan-soft)",
  },
  view: {
    kind: "view",
    label: "View",
    plural: "Views",
    icon: Eye,
    color: "var(--color-ot-view)",
    softColor: "var(--color-accent-purple-soft)",
  },
  materialized_view: {
    kind: "materialized_view",
    label: "Materialized view",
    plural: "Materialized views",
    icon: Layers,
    color: "var(--color-ot-view)",
    softColor: "var(--color-accent-purple-soft)",
  },

  // Dimensional modeling
  fact_table: {
    kind: "fact_table",
    label: "Fact table",
    plural: "Fact tables",
    icon: Sigma,
    color: "var(--color-ot-fact)",
    softColor: "var(--color-accent-blue-soft)",
  },
  dimension_table: {
    kind: "dimension_table",
    label: "Dimension",
    plural: "Dimensions",
    icon: Component,
    color: "var(--color-ot-dimension)",
    softColor: "var(--color-accent-purple-soft)",
  },
  bridge_table: {
    kind: "bridge_table",
    label: "Bridge",
    plural: "Bridges",
    icon: Network,
    color: "var(--color-ot-bridge)",
    softColor: "var(--color-accent-pink-soft)",
  },

  // Data vault
  hub: {
    kind: "hub",
    label: "Hub",
    plural: "Hubs",
    icon: Landmark,
    color: "var(--color-ot-hub)",
    softColor: "var(--color-accent-teal-soft)",
  },
  link: {
    kind: "link",
    label: "Link",
    plural: "Links",
    icon: Link2,
    color: "var(--color-ot-link)",
    softColor: "var(--color-accent-orange-soft)",
  },
  satellite: {
    kind: "satellite",
    label: "Satellite",
    plural: "Satellites",
    icon: Boxes,
    color: "var(--color-ot-satellite)",
    softColor: "var(--color-accent-cyan-soft)",
  },

  // Programmability / governance
  enum: {
    kind: "enum",
    label: "Enum",
    plural: "Enums",
    icon: ListChecks,
    color: "var(--color-ot-enum)",
    softColor: "var(--color-accent-pink-soft)",
  },
  domain: {
    kind: "domain",
    label: "Domain",
    plural: "Domains",
    icon: Binary,
    color: "var(--color-ot-domain)",
    softColor: "var(--color-accent-purple-soft)",
  },
  function: {
    kind: "function",
    label: "Function",
    plural: "Functions",
    icon: FunctionSquare,
    color: "var(--color-ot-function)",
    softColor: "var(--color-accent-teal-soft)",
  },
  procedure: {
    kind: "procedure",
    label: "Procedure",
    plural: "Procedures",
    icon: Workflow,
    color: "var(--color-ot-procedure)",
    softColor: "var(--color-accent-cyan-soft)",
  },
  sequence: {
    kind: "sequence",
    label: "Sequence",
    plural: "Sequences",
    icon: KeyRound,
    color: "var(--color-ot-sequence)",
    softColor: "var(--color-accent-yellow-soft)",
  },
  trigger: {
    kind: "trigger",
    label: "Trigger",
    plural: "Triggers",
    icon: AlertTriangle,
    color: "var(--color-ot-trigger)",
    softColor: "var(--color-accent-red-soft)",
  },
  policy: {
    kind: "policy",
    label: "Policy",
    plural: "Policies",
    icon: ShieldAlert,
    color: "var(--color-ot-policy)",
    softColor: "var(--color-accent-blue-soft)",
  },
  rule: {
    kind: "rule",
    label: "Rule",
    plural: "Rules",
    icon: Gauge,
    color: "var(--color-ot-rule)",
    softColor: "var(--color-accent-blue-soft)",
  },

  // Fallback
  unknown: {
    kind: "unknown",
    label: "Object",
    plural: "Objects",
    icon: Table2,
    color: "var(--color-text-muted)",
    softColor: "var(--color-bg-tertiary)",
  },
};

/** Return the metadata entry for an arbitrary object kind, or the fallback. */
export function getObjectTypeMeta(kind) {
  if (!kind) return OBJECT_TYPE_META.unknown;
  const key = String(kind).toLowerCase();
  return OBJECT_TYPE_META[key] || OBJECT_TYPE_META.unknown;
}

/**
 * Canonical display order when grouping objects by type in the tree. Relational
 * tables first, then views, then enums/domains, then programmability, then the
 * dimensional/vault specializations, then catch-alls.
 */
export const OBJECT_TYPE_DISPLAY_ORDER = [
  "table",
  "external_table",
  "view",
  "materialized_view",
  "snapshot",
  "fact_table",
  "dimension_table",
  "bridge_table",
  "hub",
  "link",
  "satellite",
  "enum",
  "domain",
  "function",
  "procedure",
  "sequence",
  "trigger",
  "policy",
  "rule",
];

/**
 * Group a list of entities by their `type` field, returning `[{ meta, items }]`
 * in display order. Unknown types fall back to the "table" bucket since that is
 * the most common DataLex default.
 */
export function groupEntitiesByType(entities) {
  const buckets = new Map();
  for (const entity of entities || []) {
    const rawKind = String(entity?.type || entity?.data?.type || "table").toLowerCase();
    const kind = OBJECT_TYPE_META[rawKind] ? rawKind : "table";
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(entity);
  }

  const ordered = [];
  const seen = new Set();
  for (const kind of OBJECT_TYPE_DISPLAY_ORDER) {
    if (buckets.has(kind)) {
      ordered.push({ meta: getObjectTypeMeta(kind), items: buckets.get(kind) });
      seen.add(kind);
    }
  }
  for (const [kind, items] of buckets.entries()) {
    if (!seen.has(kind)) ordered.push({ meta: getObjectTypeMeta(kind), items });
  }
  return ordered;
}
