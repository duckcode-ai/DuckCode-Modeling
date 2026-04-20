import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { linter, lintGutter } from "@codemirror/lint";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Eye, Copy, Check } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { runModelChecks } from "../../modelQuality";

/* ── Theme-aware CodeMirror chrome ─────────────────────────────────────
   The editor used to hard-code a light theme, which meant the YAML pane
   glowed white on midnight/obsidian and the default navy property-key
   highlight was almost invisible against the surrounding dark shell.

   We now pick between two complementary palettes — one tuned for the two
   light Luna themes (paper, arctic) and one for the two dark Luna themes
   (midnight, obsidian) — and swap automatically when the user changes
   theme. Colors are chosen to read well on the corresponding Luna bg
   tokens and to stay legible against dim/accent-dim selection halos. */

const DARK_THEMES = new Set(["midnight", "obsidian", "dark"]);
const FONT_STACK = "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace";

// Light mode — high-contrast for paper/arctic.
const LIGHT_PALETTE = {
  bg:           "#ffffff",
  fg:           "#1a1f2c",
  caret:        "#2563eb",
  selectionBg:  "rgba(37, 99, 235, 0.18)",
  activeLineBg: "rgba(37, 99, 235, 0.06)",
  gutterBg:     "#f7f8fa",
  gutterFg:     "#8b94a3",
  gutterBorder: "#e4e7ec",
  activeLineGutterBg: "rgba(37, 99, 235, 0.10)",
  activeLineGutterFg: "#334155",
  matchBg:      "rgba(37, 99, 235, 0.18)",
  matchOutline: "rgba(37, 99, 235, 0.35)",
  // Syntax
  key:          "#2c5ba8",   // YAML property name — deep readable blue
  string:       "#0b7a3e",   // green
  number:       "#a04b1a",   // orange-brown
  bool:         "#7a3aa6",   // purple
  comment:      "#7a828c",   // muted slate
  punctuation:  "#5b6472",
  keyword:      "#b02a5a",
  operator:     "#5b6472",
  heading:      "#1a1f2c",
};

// Dark mode — muted-bright for midnight/obsidian.
const DARK_PALETTE = {
  bg:           "#151922",   // matches --bg-1 on midnight
  fg:           "#e4e7ec",
  caret:        "#7aa9ff",
  selectionBg:  "rgba(122, 169, 255, 0.22)",
  activeLineBg: "rgba(122, 169, 255, 0.06)",
  gutterBg:     "#0f131b",
  gutterFg:     "#6b7280",
  gutterBorder: "#242a36",
  activeLineGutterBg: "rgba(122, 169, 255, 0.10)",
  activeLineGutterFg: "#b5bcc7",
  matchBg:      "rgba(122, 169, 255, 0.22)",
  matchOutline: "rgba(122, 169, 255, 0.45)",
  // Syntax — chosen to clear WCAG AA against bg #151922
  key:          "#7db7ff",   // bright sky-blue for YAML keys (the fix)
  string:       "#8ee1a7",   // soft green
  number:       "#ffb87a",   // warm amber
  bool:         "#d4a8ff",   // lavender
  comment:      "#7a828c",
  punctuation:  "#9aa3b4",
  keyword:      "#ff9ab8",
  operator:     "#9aa3b4",
  heading:      "#e4e7ec",
};

function buildEditorTheme(p, dark) {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: p.bg,
        color: p.fg,
        fontSize: "13px",
        fontFamily: FONT_STACK,
      },
      ".cm-content": {
        caretColor: p.caret,
        padding: "8px 0",
        color: p.fg,
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: `${p.selectionBg} !important`,
      },
      ".cm-activeLine": { backgroundColor: p.activeLineBg },
      ".cm-gutters": {
        backgroundColor: p.gutterBg,
        color: p.gutterFg,
        border: "none",
        borderRight: `1px solid ${p.gutterBorder}`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: p.activeLineGutterBg,
        color: p.activeLineGutterFg,
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 12px",
        minWidth: "40px",
      },
      ".cm-foldGutter": { width: "12px" },
      ".cm-matchingBracket": {
        backgroundColor: p.matchBg,
        outline: `1px solid ${p.matchOutline}`,
      },
      // Tooltips / autocomplete popover — these otherwise inherit
      // browser defaults (white bg) and vanish on dark.
      ".cm-tooltip, .cm-tooltip-autocomplete, .cm-tooltip-hover": {
        backgroundColor: dark ? "#1c2130" : "#ffffff",
        color: p.fg,
        border: `1px solid ${p.gutterBorder}`,
        borderRadius: "6px",
        boxShadow: dark
          ? "0 10px 28px rgba(0,0,0,0.5)"
          : "0 10px 28px rgba(15,23,42,0.14)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: p.activeLineGutterBg,
        color: p.fg,
      },
      // Lint diagnostic underlines/panels get muted tones, not neon red.
      ".cm-diagnostic": {
        backgroundColor: dark ? "#1c2130" : "#ffffff",
        color: p.fg,
        borderLeft: "3px solid var(--status-error, #ef4444)",
      },
      ".cm-diagnostic-warning": { borderLeftColor: "var(--status-warning, #f59e0b)" },
      ".cm-diagnostic-error":   { borderLeftColor: "var(--status-error, #ef4444)" },
    },
    { dark },
  );
}

function buildHighlightStyle(p) {
  return HighlightStyle.define([
    // YAML mapping keys — the "blue not readable" target.
    { tag: [t.propertyName, t.definition(t.propertyName)], color: p.key, fontWeight: "500" },
    { tag: [t.atom, t.bool, t.null],   color: p.bool },
    { tag: [t.number],                 color: p.number },
    { tag: [t.string, t.special(t.string)], color: p.string },
    { tag: [t.comment, t.lineComment, t.blockComment], color: p.comment, fontStyle: "italic" },
    { tag: [t.keyword],                color: p.keyword },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: p.punctuation },
    { tag: [t.heading],                color: p.heading, fontWeight: "600" },
    { tag: [t.meta, t.processingInstruction], color: p.comment },
    { tag: [t.escape],                 color: p.keyword },
    { tag: [t.variableName],           color: p.fg },
  ]);
}

const LIGHT_EDITOR_THEME = buildEditorTheme(LIGHT_PALETTE, false);
const DARK_EDITOR_THEME  = buildEditorTheme(DARK_PALETTE, true);
const LIGHT_HIGHLIGHT    = syntaxHighlighting(buildHighlightStyle(LIGHT_PALETTE));
const DARK_HIGHLIGHT     = syntaxHighlighting(buildHighlightStyle(DARK_PALETTE));

// Schema-aware YAML completions
const SCHEMA_KEYWORDS = {
  root: ["model:", "entities:", "relationships:", "indexes:", "metrics:", "rules:", "governance:", "glossary:", "domains:", "enums:", "templates:", "naming_rules:", "subject_areas:", "display:"],
  model: ["name:", "kind:", "spec_version:", "version:", "domain:", "owners:", "state:", "layer:", "description:", "imports:"],
  entity: ["name:", "type:", "description:", "derived_from:", "mapped_from:", "fields:", "grain:", "candidate_keys:", "business_keys:", "hash_key:", "tags:", "template:", "templates:", "schema:", "database:", "physical_name:", "subject_area:", "owner:", "sla:", "natural_key:", "surrogate_key:", "scd_type:", "conformed:", "subtype_of:", "subtypes:", "dimension_refs:", "link_refs:", "parent_entity:", "hash_diff_fields:", "load_timestamp_field:", "record_source_field:", "partition_by:", "cluster_by:", "distribution:", "storage:"],
  field: ["name:", "type:", "domain:", "enum:", "mapped_from:", "nullable:", "primary_key:", "unique:", "foreign_key:", "identity:", "sequence:", "default:", "check:", "computed:", "computed_expression:", "sensitivity:", "description:", "deprecated:", "deprecated_message:", "examples:"],
  relationship: ["name:", "from:", "to:", "cardinality:", "on_update:", "description:"],
  index: ["name:", "entity:", "fields:", "unique:"],
  metric: ["name:", "entity:", "description:", "expression:", "aggregation:", "grain:", "dimensions:", "time_dimension:", "owner:", "tags:", "deprecated:", "deprecated_message:"],
  rule: ["name:", "target:", "expression:", "severity:"],
  governance: ["classification:", "stewards:", "retention:"],
  glossary: ["term:", "abbreviation:", "definition:", "related_fields:", "tags:"],
  types: ["string", "integer", "bigint", "float", "decimal", "boolean", "date", "timestamp", "datetime", "uuid", "json", "text", "varchar"],
  cardinalities: ["one_to_one", "one_to_many", "many_to_one", "many_to_many"],
  kinds: ["conceptual", "logical", "physical"],
  states: ["draft", "approved", "deprecated"],
  layers: ["source", "transform", "report"],
  entityTypes: ["concept", "logical_entity", "table", "view", "materialized_view", "external_table", "snapshot", "fact_table", "dimension_table", "bridge_table", "hub", "link", "satellite"],
  aggregations: ["sum", "count", "count_distinct", "avg", "min", "max", "custom"],
  severity: ["info", "warn", "error"],
  sensitivity: ["public", "internal", "confidential", "restricted"],
};

function findCurrentSection(doc, lineNumber) {
  for (let i = lineNumber; i >= 1; i--) {
    const text = doc.line(i).text;
    const match = text.match(/^([a-z_]+):\s*$/);
    if (match) return match[1];
  }
  return "";
}

function yamlCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const indent = textBefore.match(/^\s*/)?.[0]?.length ?? 0;
  const trimmed = textBefore.trim();
  const section = findCurrentSection(context.state.doc, line.number);

  // After "type: " suggest types
  if (/type:\s*$/.test(textBefore)) {
    if (section === "entities" && indent <= 6) return { from: context.pos, options: SCHEMA_KEYWORDS.entityTypes.map((t) => ({ label: t, type: "enum" })) };
    return { from: context.pos, options: SCHEMA_KEYWORDS.types.map((t) => ({ label: t, type: "type" })) };
  }
  if (/kind:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.kinds.map((t) => ({ label: t, type: "enum" })) };
  if (/cardinality:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.cardinalities.map((t) => ({ label: t, type: "enum" })) };
  if (/state:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.states.map((t) => ({ label: t, type: "enum" })) };
  if (/layer:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.layers.map((t) => ({ label: t, type: "enum" })) };
  if (/aggregation:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.aggregations.map((t) => ({ label: t, type: "enum" })) };
  if (/severity:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.severity.map((t) => ({ label: t, type: "enum" })) };
  if (/sensitivity:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.sensitivity.map((t) => ({ label: t, type: "enum" })) };
  if (
    /nullable:\s*$/.test(textBefore) ||
    /primary_key:\s*$/.test(textBefore) ||
    /unique:\s*$/.test(textBefore) ||
    /foreign_key:\s*$/.test(textBefore) ||
    /deprecated:\s*$/.test(textBefore) ||
    /computed:\s*$/.test(textBefore)
  ) {
    return { from: context.pos, options: [{ label: "true", type: "keyword" }, { label: "false", type: "keyword" }] };
  }

  // Determine context by indentation
  const word = context.matchBefore(/[\w-]*/);
  if (!word && !trimmed.endsWith("-")) return null;
  const from = word ? word.from : context.pos;

  let options;
  if (indent === 0) options = SCHEMA_KEYWORDS.root;
  else if (section === "model") options = SCHEMA_KEYWORDS.model;
  else if (section === "entities") options = indent <= 6 ? SCHEMA_KEYWORDS.entity : SCHEMA_KEYWORDS.field;
  else if (section === "relationships") options = SCHEMA_KEYWORDS.relationship;
  else if (section === "indexes") options = SCHEMA_KEYWORDS.index;
  else if (section === "metrics") options = SCHEMA_KEYWORDS.metric;
  else if (section === "rules") options = SCHEMA_KEYWORDS.rule;
  else if (section === "governance") options = SCHEMA_KEYWORDS.governance;
  else if (section === "glossary") options = SCHEMA_KEYWORDS.glossary;
  else options = SCHEMA_KEYWORDS.root;

  return { from, options: options.map((k) => ({ label: k, type: "property" })) };
}

// Inline validation linter
function yamlLinter(view) {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  const check = runModelChecks(text);
  const diagnostics = [];
  for (const issue of check.issues || []) {
    const path = issue.path || "";
    const msg = issue.message || "";
    const severity = issue.severity === "error" ? "error" : "warning";
    // Try to find the line matching the path
    let line = 1;
    if (path.includes("/entities")) {
      const entityMatch = path.match(/\/entities\/(\d+)/);
      if (entityMatch) {
        const idx = parseInt(entityMatch[1]);
        let count = -1;
        for (let i = 1; i <= view.state.doc.lines; i++) {
          const lt = view.state.doc.line(i).text;
          if (/^\s+-\s+name:/.test(lt) || /^entities:/.test(lt.trim())) {
            count++;
            if (count === idx) { line = i; break; }
          }
        }
      }
    }
    const lineObj = view.state.doc.line(Math.min(line, view.state.doc.lines));
    diagnostics.push({ from: lineObj.from, to: lineObj.to, severity, message: `${path}: ${msg}` });
  }
  return diagnostics;
}

const schemaAutocompletion = autocompletion({ override: [yamlCompletions] });
const validationLinter = linter(yamlLinter, { delay: 800 });

/* Read the current Luna theme from the DOM and subscribe to changes. The
   Shell owns the canonical theme value (midnight | obsidian | paper |
   arctic) and writes it to `data-theme` on <html>; we listen both to the
   custom `datalex:theme-change` event the Settings dialog fires AND to a
   MutationObserver so we stay in sync no matter how it changed. */
function useLunaTheme() {
  const read = () => (typeof document !== "undefined"
    ? (document.documentElement.getAttribute("data-theme") || "midnight")
    : "midnight");

  const [theme, setTheme] = useState(read);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const sync = () => setTheme(read());
    const onEvent = (e) => {
      const next = e?.detail?.theme;
      if (next) setTheme(next);
      else sync();
    };
    window.addEventListener("datalex:theme-change", onEvent);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // Re-sync on mount in case the attribute changed before this effect ran.
    sync();
    return () => {
      window.removeEventListener("datalex:theme-change", onEvent);
      mo.disconnect();
    };
  }, []);

  return theme;
}

export default function YamlEditor({ readOnly = false }) {
  const { activeFileContent, updateContent, activeFile } = useWorkspaceStore();
  const editorRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const lunaTheme = useLunaTheme();
  const isDark = DARK_THEMES.has(lunaTheme);

  const editorExtensions = useMemo(() => [
    yaml(),
    isDark ? DARK_EDITOR_THEME : LIGHT_EDITOR_THEME,
    isDark ? DARK_HIGHLIGHT : LIGHT_HIGHLIGHT,
    EditorView.lineWrapping,
    schemaAutocompletion,
    lintGutter(),
    validationLinter,
  ], [isDark]);

  const onChange = useCallback((value) => {
    if (!readOnly) updateContent(value);
  }, [updateContent, readOnly]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(activeFileContent || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [activeFileContent]);

  if (!activeFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <p className="mb-2">No file open</p>
          <p className="text-xs">Select a file from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {readOnly && (
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-700 shrink-0">
          <Eye size={11} className="shrink-0" />
          <span>View Only — editing disabled</span>
          <button
            onClick={handleCopy}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-amber-300 hover:bg-amber-100 transition-colors text-[10px] font-medium"
            title="Copy YAML to clipboard"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <CodeMirror
          ref={editorRef}
          value={activeFileContent}
          onChange={onChange}
          readOnly={readOnly}
          extensions={editorExtensions}
          theme={isDark ? "dark" : "light"}
          height="100%"
          style={{ height: "100%" }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: !readOnly,
            highlightActiveLine: !readOnly,
            foldGutter: true,
            bracketMatching: true,
            indentOnInput: !readOnly,
            autocompletion: !readOnly,
            closeBrackets: !readOnly,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
