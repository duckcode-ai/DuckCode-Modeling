/* ShareBundleDialog — export the current diagram as a self-contained
 * HTML file for read-only sharing. No server round-trip, no external
 * assets — just a Blob + download trigger.
 *
 * Payload shape (passed via `openModal("shareBundle", payload)`):
 *   {
 *     title,           // string, required
 *     projectName,     // string, optional
 *     ref,             // git ref / tag for provenance, optional
 *     tables,          // adapted table list (required)
 *     relationships,   // adapted relationships (required)
 *     subjectAreas,    // [{name, color?, description?}] optional
 *   }
 *
 * Mirrors the look of ExportDdlDialog (Modal + primary-action row +
 * save/copy footer). Differs in that generation is synchronous and
 * purely client-side — there's no API call, so no spinner.
 */
import React, { useMemo, useState } from "react";
import { Download, Copy, Check, Share2, Eye, EyeOff } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import Modal from "./Modal";
import { generateShareBundleHtml, downloadShareBundle } from "../../lib/shareBundle";

function slugify(s) {
  return String(s || "diagram")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "diagram";
}

export default function ShareBundleDialog() {
  const { closeModal, modalPayload, addToast } = useUiStore();
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const projectPath = useWorkspaceStore((s) => s.projectPath);

  const payload = modalPayload || {};
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const relationships = Array.isArray(payload.relationships) ? payload.relationships : [];
  const subjectAreas = Array.isArray(payload.subjectAreas) ? payload.subjectAreas : [];
  const suggestedTitle = payload.title || activeFile?.name?.replace(/\.(diagram|model)\.ya?ml$/i, "") || "Diagram";

  const [title, setTitle] = useState(suggestedTitle);
  const [description, setDescription] = useState("");
  const [includePreview, setIncludePreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => generateShareBundleHtml({
    title: title || suggestedTitle,
    description,
    projectName: payload.projectName,
    ref: payload.ref,
    tables,
    relationships,
    subjectAreas,
  }), [title, description, suggestedTitle, payload.projectName, payload.ref, tables, relationships, subjectAreas]);

  const byteLen = useMemo(() => new Blob([html]).size, [html]);

  const onDownload = () => {
    const filename = `${slugify(title)}.html`;
    downloadShareBundle(html, filename);
    addToast?.({ type: "success", message: `Downloaded ${filename} (${(byteLen / 1024).toFixed(1)} KB)` });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      addToast?.({ type: "error", message: `Copy failed: ${err.message}` });
    }
  };

  const tCount = tables.length;
  const rCount = relationships.length;

  return (
    <Modal
      icon={<Share2 size={14} />}
      title="Share diagram"
      subtitle={`Self-contained HTML · ${tCount} entities · ${rCount} relationships`}
      size={includePreview ? "xl" : "md"}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>Close</button>
          <button type="button" className="panel-btn" onClick={onCopy}>
            {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy HTML</>}
          </button>
          <button type="button" className="panel-btn primary" onClick={onDownload} style={{ minWidth: 96, justifyContent: "center" }}>
            <Download size={11} /> Download
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}>
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={suggestedTitle}
            className="panel-input"
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}>
          <span>Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this diagram show? Who should read it?"
            rows={2}
            className="panel-input"
            style={{ fontFamily: "inherit", resize: "vertical" }}
          />
        </label>

        <div style={{
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
          padding: "8px 10px",
          background: "var(--bg-1)",
          border: "1px solid var(--border-default)",
          borderRadius: 6,
          fontSize: 11, color: "var(--text-tertiary)",
        }}>
          <span>Size: <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}>{(byteLen / 1024).toFixed(1)} KB</strong></span>
          <span>·</span>
          <span>No external assets · Renders in any browser</span>
          <button
            type="button"
            onClick={() => setIncludePreview((v) => !v)}
            style={{
              marginLeft: "auto",
              fontSize: 11,
              padding: "3px 8px",
              background: "transparent",
              border: "1px solid var(--border-default)",
              borderRadius: 4,
              color: "var(--text-secondary)",
              cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}
          >
            {includePreview ? <><EyeOff size={10} /> Hide preview</> : <><Eye size={10} /> Show preview</>}
          </button>
        </div>

        {includePreview && (
          <div style={{
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            overflow: "hidden",
            height: 420,
            background: "var(--bg-0, #fff)",
          }}>
            <iframe
              title="Share bundle preview"
              srcDoc={html}
              sandbox=""
              style={{ width: "100%", height: "100%", border: 0 }}
            />
          </div>
        )}

        {!includePreview && (
          <p className="dlx-modal-hint" style={{ marginTop: 0 }}>
            <strong>Download</strong> drops an HTML file on disk; <strong>Copy HTML</strong> puts the
            full markup on your clipboard (paste into email, GitHub, or Notion).
            The bundle has no network dependencies and honors the viewer's
            dark-mode preference automatically.
          </p>
        )}
      </div>
    </Modal>
  );
}
