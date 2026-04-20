/* Cardinality / notation helpers + theme registry. Ported from DataLex design prototype. */

export const NOTATION = {
  cardinalityLabel: (min, max) => {
    if (min === "0" && max === "1") return "0..1";
    if (min === "1" && max === "1") return "1";
    if (min === "0" && max === "N") return "0..N";
    if (min === "1" && max === "N") return "1..N";
    return `${min}..${max}`;
  },
  kind: (from, to) => {
    const fMany = from.max === "N";
    const tMany = to.max === "N";
    if (fMany && tMany) return "N:M";
    if (fMany && !tMany) return "N:1";
    if (!fMany && tMany) return "1:N";
    return "1:1";
  },
  onDeleteActions: [
    { k: "CASCADE",     desc: "Delete dependent rows",            color: "#ef4444" },
    { k: "RESTRICT",    desc: "Block delete if dependents exist", color: "#f59e0b" },
    { k: "SET NULL",    desc: "Set FK columns to NULL",           color: "#64748b" },
    { k: "SET DEFAULT", desc: "Set FK columns to default",        color: "#8b5cf6" },
    { k: "NO ACTION",   desc: "Defer check; error at commit",     color: "#6b7385" },
  ],
};

export const THEMES = [
  { id: "midnight", name: "Midnight", mode: "dark",  colors: ["#0a0c11", "#5b8cff", "#7c5cff", "#10b981"], sub: "Deep navy enterprise dark" },
  { id: "obsidian", name: "Obsidian", mode: "dark",  colors: ["#08090b", "#e6e7ea", "#a29bff", "#4ade80"], sub: "Neutral monochrome dark" },
  { id: "paper",    name: "Paper",    mode: "light", colors: ["#faf8f3", "#3558d6", "#5b4ac4", "#0d8b5e"], sub: "Warm off-white, print-like" },
  { id: "arctic",   name: "Arctic",   mode: "light", colors: ["#f1f4f9", "#0f62fe", "#6929c4", "#0e7c58"], sub: "Cool crisp enterprise light" },
];

export const FK_COLOR_MAP = {
  CASCADE: "#ef4444",
  RESTRICT: "#f59e0b",
  "SET NULL": "#64748b",
  "SET DEFAULT": "#8b5cf6",
  "NO ACTION": "#6b7385",
};
