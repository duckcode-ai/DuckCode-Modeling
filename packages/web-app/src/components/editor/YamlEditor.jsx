import React, { useCallback, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import useWorkspaceStore from "../../stores/workspaceStore";

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontSize: "13px",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace",
  },
  ".cm-content": {
    caretColor: "#2563eb",
    padding: "8px 0",
  },
  ".cm-cursor": {
    borderLeftColor: "#2563eb",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(59, 130, 246, 0.15) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(59, 130, 246, 0.06)",
  },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    color: "#94a3b8",
    border: "none",
    borderRight: "1px solid #e2e8f0",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    color: "#475569",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 12px",
    minWidth: "40px",
  },
  ".cm-foldGutter": {
    width: "12px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    outline: "1px solid rgba(59, 130, 246, 0.3)",
  },
});

const extensions = [
  yaml(),
  lightTheme,
  EditorView.lineWrapping,
];

export default function YamlEditor() {
  const { activeFileContent, updateContent, activeFile } = useWorkspaceStore();
  const editorRef = useRef(null);

  const onChange = useCallback((value) => {
    updateContent(value);
  }, [updateContent]);

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
    <div className="flex-1 overflow-hidden">
      <CodeMirror
        ref={editorRef}
        value={activeFileContent}
        onChange={onChange}
        extensions={extensions}
        theme="light"
        height="100%"
        style={{ height: "100%" }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          bracketMatching: true,
          indentOnInput: true,
          autocompletion: false,
          closeBrackets: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}
