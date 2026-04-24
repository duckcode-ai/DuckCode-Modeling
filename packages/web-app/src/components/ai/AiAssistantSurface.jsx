import React from "react";
import { AlertTriangle, Check, ClipboardList, Send, Sparkles, Wand2 } from "lucide-react";
import { askAi, fetchAiChat, fetchAiChats, validateAiProposal } from "../../lib/api";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import AiProposalPreview from "./AiProposalPreview";

const AI_WORK_STEPS = [
  "Finding the most relevant dbt and DataLex context",
  "Checking selected object, relationships, and validation signals",
  "Applying modeling skills and project memory",
  "Preparing a concise answer and reviewable YAML proposal",
];

function storageValue(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (_err) {
    return fallback;
  }
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_err) {
    return String(value || "");
  }
}

function proposalTitle(change, index) {
  const type = change?.type || change?.operation || "change";
  const path = change?.path || change?.fullPath || change?.toPath || change?.name || "";
  return `${index + 1}. ${String(type).replace(/_/g, " ")}${path ? ` · ${path}` : ""}`;
}

function buildAiReviewDocument({ result, context, message }) {
  const agentRun = result?.agent_run || {};
  const agents = Array.isArray(agentRun.agents) ? agentRun.agents : [];
  const skills = Array.isArray(agentRun.selected_skills) ? agentRun.selected_skills : [];
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const changes = Array.isArray(result?.proposed_changes) ? result.proposed_changes : [];
  const questions = Array.isArray(result?.questions) ? result.questions : [];
  const risks = Array.isArray(agentRun.risks) ? agentRun.risks : [];
  const validationImpact = result?.validation_impact || agentRun.validation_impact || "";
  const lines = [];

  lines.push("# DataLex AI Review Plan");
  lines.push("");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  if (context?.activeFilePath || context?.filePath) lines.push(`Active file: ${context.activeFilePath || context.filePath}`);
  if (context?.entityName) lines.push(`Selected entity: ${context.entityName}`);
  if (context?.relationshipName) lines.push(`Selected relationship: ${context.relationshipName}`);
  if (message) {
    lines.push("");
    lines.push("## User Request");
    lines.push(message);
  }
  lines.push("");
  lines.push("## Answer");
  lines.push(result?.answer || "No answer returned.");

  if (agents.length > 0) {
    lines.push("");
    lines.push("## Agents");
    agents.forEach((agent) => {
      lines.push(`- ${agent.label || agent.id}${agent.id ? ` (${agent.id})` : ""}`);
    });
  }

  if (skills.length > 0) {
    lines.push("");
    lines.push("## Skills Used");
    skills.forEach((skill) => {
      lines.push(`- ${skill.name || skill.path}${skill.path ? ` — ${skill.path}` : ""}`);
    });
  }

  if (sources.length > 0) {
    lines.push("");
    lines.push("## Context Sources");
    sources.slice(0, 20).forEach((source, index) => {
      lines.push(`${index + 1}. ${source.kind || "source"}: ${source.name || source.path || "unnamed"}`);
      if (source.path) lines.push(`   Path: ${source.path}`);
      if (source.description) lines.push(`   Context: ${source.description}`);
    });
  }

  if (questions.length > 0) {
    lines.push("");
    lines.push("## Follow-Up Questions");
    questions.forEach((question) => lines.push(`- ${question}`));
  }

  if (risks.length > 0) {
    lines.push("");
    lines.push("## Risks");
    risks.forEach((risk) => lines.push(`- ${risk}`));
  }

  if (validationImpact) {
    lines.push("");
    lines.push("## Validation Impact");
    lines.push(typeof validationImpact === "string" ? validationImpact : compactJson(validationImpact));
  }

  lines.push("");
  lines.push("## Proposed Changes");
  if (changes.length === 0) {
    lines.push("No YAML changes were proposed.");
  } else {
    changes.forEach((change, index) => {
      lines.push("");
      lines.push(`### ${proposalTitle(change, index)}`);
      if (change.rationale) {
        lines.push("");
        lines.push("Rationale:");
        lines.push(String(change.rationale));
      }
      if (change.validation_impact) {
        lines.push("");
        lines.push("Validation impact:");
        lines.push(typeof change.validation_impact === "string" ? change.validation_impact : compactJson(change.validation_impact));
      }
      lines.push("");
      lines.push("```json");
      lines.push(compactJson(change));
      lines.push("```");
    });
  }

  return {
    title: changes.length > 0 ? `AI proposal review · ${changes.length} change${changes.length === 1 ? "" : "s"}` : "AI answer review",
    subtitle: context?.activeFilePath || context?.filePath || "Workspace context",
    content: lines.join("\n"),
    proposals: changes,
  };
}

function renderInlineMarkdown(text, keyPrefix) {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      parts.push(<code key={key} className="ai-md-inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

function MarkdownText({ text }) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let list = null;
  let codeLines = null;

  const flushList = () => {
    if (!list) return;
    const Tag = list.type === "ol" ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blocks.length}`} className="ai-md-list">
        {list.items.map((item, idx) => (
          <li key={idx}>{renderInlineMarkdown(item, `li-${blocks.length}-${idx}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  const flushCode = () => {
    if (!codeLines) return;
    blocks.push(
      <pre key={`code-${blocks.length}`} className="ai-md-code">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim().startsWith("```")) {
      if (codeLines) flushCode();
      else {
        flushList();
        codeLines = [];
      }
      return;
    }
    if (codeLines) {
      codeLines.push(rawLine);
      return;
    }
    if (!line.trim()) {
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(
        <div key={`heading-${blocks.length}`} className={`ai-md-heading level-${heading[1].length}`}>
          {renderInlineMarkdown(heading[2], `h-${blocks.length}`)}
        </div>
      );
      return;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(unordered[1]);
      return;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[1]);
      return;
    }
    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`}>{renderInlineMarkdown(line, `p-${blocks.length}`)}</p>
    );
  });

  flushList();
  flushCode();
  return <div className="ai-markdown">{blocks.length ? blocks : null}</div>;
}

export default function AiAssistantSurface({ payload = null, onClose, compact = false }) {
  const addToast = useUiStore((s) => s.addToast);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const applyAiProposalChanges = useWorkspaceStore((s) => s.applyAiProposalChanges);
  const openAiReviewDocument = useUiStore((s) => s.openAiReviewDocument);

  const [message, setMessage] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [chatId, setChatId] = React.useState(null);
  const [turns, setTurns] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [validation, setValidation] = React.useState(null);
  const [pinnedSkills, setPinnedSkills] = React.useState([]);
  const [disabledSkills, setDisabledSkills] = React.useState([]);
  const [error, setError] = React.useState("");
  const [chatHistory, setChatHistory] = React.useState([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [workStepIndex, setWorkStepIndex] = React.useState(0);
  const [lastRequest, setLastRequest] = React.useState("");
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    setMessage("");
    setResult(null);
    setChatId(null);
    setTurns([]);
    setValidation(null);
    setError("");
  }, [payload]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns, result, loading, error, workStepIndex]);

  React.useEffect(() => {
    if (!loading) {
      setWorkStepIndex(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setWorkStepIndex((index) => (index + 1) % AI_WORK_STEPS.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [loading]);

  const loadChatHistory = React.useCallback(async () => {
    if (!activeProjectId) {
      setChatHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await fetchAiChats(activeProjectId);
      setChatHistory(Array.isArray(response?.chats) ? response.chats : []);
    } catch (_err) {
      setChatHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeProjectId]);

  React.useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

  const context = React.useMemo(() => {
    const payloadContext = payload?.context || {};
    return {
      source: payload?.source || "ui",
      activeFilePath: activeFile?.path || activeFile?.fullPath || "",
      fileName: activeFile?.name || "",
      filePath: payloadContext.filePath || activeFile?.path || activeFile?.fullPath || "",
      activeYamlPreview: String(activeFileContent || "").slice(0, 5000),
      ...payloadContext,
    };
  }, [payload, activeFile, activeFileContent]);

  const submit = async () => {
    if (loading || !activeProjectId || !message.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    const userText = message.trim();
    setLastRequest(userText);
    setMessage("");
    setTurns((items) => [...items, { role: "user", content: userText }]);
    try {
      const provider = storageValue("datalex.ai.provider", "local");
      const model = storageValue("datalex.ai.model", "");
      const baseUrl = storageValue("datalex.ai.baseUrl", "");
      const apiKey = storageValue("datalex.ai.apiKey", "");
      const response = await askAi({
        projectId: activeProjectId,
        chatId: chatId || undefined,
        message: userText,
        context,
        provider: {
          provider,
          model: model || undefined,
          baseUrl: baseUrl || undefined,
          apiKey: apiKey || undefined,
        },
        skills: {
          pinned: pinnedSkills,
          disabled: disabledSkills,
        },
      });
      setChatId(response.chatId || chatId || null);
      setResult(response);
      setTurns((items) => [...items, { role: "assistant", content: response.answer || "No answer returned." }]);
      loadChatHistory();
    } catch (err) {
      setError(err?.message || String(err));
      setMessage(userText);
      setTurns((items) => items.filter((item, idx) => idx !== items.length - 1 || item.role !== "user" || item.content !== userText));
    } finally {
      setLoading(false);
    }
  };

  const openHistoryChat = async (historyChatId) => {
    if (!activeProjectId || !historyChatId) return;
    setError("");
    setResult(null);
    setValidation(null);
    try {
      const response = await fetchAiChat(activeProjectId, historyChatId);
      const chat = response?.chat;
      const messages = Array.isArray(chat?.messages) ? chat.messages : [];
      const latestAssistantWithResult = [...messages]
        .reverse()
        .find((message) => message?.role === "assistant" && message?.metadata?.aiResult);
      const restoredResult = latestAssistantWithResult?.metadata?.aiResult || null;
      const latestUserBeforeResult = latestAssistantWithResult
        ? [...messages]
          .slice(0, messages.indexOf(latestAssistantWithResult))
          .reverse()
          .find((message) => message?.role === "user")
        : [...messages].reverse().find((message) => message?.role === "user");
      setChatId(chat?.id || historyChatId);
      setTurns(messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content || "",
      })));
      setResult(restoredResult);
      setLastRequest(latestUserBeforeResult?.content || "");
    } catch (err) {
      setError(`Could not open chat history: ${err?.message || err}`);
    }
  };

  const apply = async () => {
    const changes = result?.proposed_changes || [];
    if (!changes.length) return;
    setApplying(true);
    setError("");
    try {
      const applied = await applyAiProposalChanges(changes);
      addToast({
        type: "success",
        message: `Applied ${applied?.applied?.length || changes.length} AI proposal change${changes.length === 1 ? "" : "s"}.`,
      });
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setApplying(false);
    }
  };

  const validate = async () => {
    const changes = result?.proposed_changes || [];
    if (!changes.length || !activeProjectId) return;
    setValidating(true);
    setError("");
    try {
      const response = await validateAiProposal({
        projectId: activeProjectId,
        changes,
      });
      setValidation(response);
      addToast({
        type: response.valid ? "success" : "error",
        message: response.valid ? "AI proposal validation passed." : "AI proposal validation found blocking issues.",
      });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setValidating(false);
    }
  };

  const sources = result?.sources || [];
  const changes = result?.proposed_changes || [];
  const agentRun = result?.agent_run || null;
  const selectedSkills = agentRun?.selected_skills || [];
  const activeMemory = result?.memory?.active || [];
  const examples = React.useMemo(() => {
    const target = context.entityName || context.fileName || "this model";
    return [
      `Explain what ${target} is missing and how to improve it.`,
      "Create a conceptual model from this business scenario.",
      "Find weak relationships, missing owners, descriptions, and tests.",
      "Propose YAML changes, but keep them small and reviewable.",
    ];
  }, [context.entityName, context.fileName]);
  const togglePinSkill = (skillPath) => {
    if (!skillPath) return;
    setPinnedSkills((items) => items.includes(skillPath) ? items.filter((item) => item !== skillPath) : [...items, skillPath]);
    setDisabledSkills((items) => items.filter((item) => item !== skillPath));
  };
  const toggleDisableSkill = (skillPath) => {
    if (!skillPath) return;
    setDisabledSkills((items) => items.includes(skillPath) ? items.filter((item) => item !== skillPath) : [...items, skillPath]);
    setPinnedSkills((items) => items.filter((item) => item !== skillPath));
  };
  const hasSkillControls = pinnedSkills.length > 0 || disabledSkills.length > 0;
  const currentWorkStep = AI_WORK_STEPS[workStepIndex] || AI_WORK_STEPS[0];
  const reviewDocument = result ? buildAiReviewDocument({ result, context, message: lastRequest }) : null;
  const openReviewPlan = () => {
    if (!reviewDocument) return;
    openAiReviewDocument(reviewDocument);
  };

  return (
    <div className={`ai-assistant-layout ${compact ? "compact" : ""} ${hasSkillControls ? "" : "no-chat-header"}`}>
      {hasSkillControls && (
        <section className="ai-chat-card ai-chat-card-minimal">
          <div className="ai-skill-control-strip">
            {pinnedSkills.length > 0 && <span>Pinned skills: {pinnedSkills.length}</span>}
            {disabledSkills.length > 0 && <span>Disabled skills: {disabledSkills.length}</span>}
          </div>
        </section>
      )}

      <div className="ai-chat-scroll" ref={scrollRef}>
        {activeProjectId && (
          <details className="ai-history-strip" open={turns.length === 0}>
            <summary>AI Chat History · {historyLoading ? "loading" : chatHistory.length}</summary>
            <div className="ai-history-list">
              {!historyLoading && chatHistory.length === 0 && (
                <div className="ai-history-empty">No saved chats yet. Your next question will appear here.</div>
              )}
              {chatHistory.slice(0, 8).map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className={`ai-history-row ${chat.id === chatId ? "active" : ""}`}
                  onClick={() => openHistoryChat(chat.id)}
                >
                  <span>{chat.title || "New modeling chat"}</span>
                  <small>{chat.messageCount || 0} messages</small>
                </button>
              ))}
            </div>
          </details>
        )}

        {turns.length === 0 && (
          <div className="ai-chat-empty">
            <span className="ai-chat-empty-icon"><Sparkles size={18} /></span>
            <strong>Ask DataLex AI to help with the model.</strong>
            <p>Use natural language. The agent can explain context, find gaps, and propose YAML changes for review.</p>
            <div className="ai-suggestion-list">
              {examples.map((example) => (
                <button key={example} type="button" className="ai-suggestion" onClick={() => setMessage(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.length > 0 && (
          <div className="ai-thread">
          {turns.map((turn, idx) => (
            <div key={`${turn.role}-${idx}`} className={`ai-message ${turn.role}`}>
              <div className="ai-message-role">{turn.role === "assistant" ? "DataLex AI" : "You"}</div>
              <div className="ai-message-body"><MarkdownText text={turn.content} /></div>
            </div>
          ))}
          {loading && (
            <div className="ai-message assistant">
              <div className="ai-message-role">DataLex AI</div>
              <div className="ai-message-body ai-thinking">
                <span className="ai-thinking-pulse" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{currentWorkStep}</span>
              </div>
            </div>
          )}
          </div>
        )}

        {result && (
          <div className="ai-result-grid">
            {agentRun && (
              <details className="panel-section ai-result-section" open>
                <summary className="ai-result-summary">Agent run · {(agentRun.agents || []).map((agent) => agent.label || agent.id).join(", ")}</summary>
                <div className="ai-agent-chip-list">
                  {(agentRun.agents || []).map((agent) => (
                    <span key={agent.id} className="ai-agent-chip">{agent.label || agent.id}</span>
                  ))}
                </div>
                {selectedSkills.length > 0 && (
                  <div className="ai-skill-used-list">
                    <div className="ai-mini-heading">Skills used</div>
                    {selectedSkills.map((skill) => (
                      <div key={skill.path || skill.name} className="ai-skill-used-row">
                        <div>
                          <strong>{skill.name}</strong>
                          <span>{skill.path}</span>
                        </div>
                        <button type="button" className={`panel-btn mini ${pinnedSkills.includes(skill.path) ? "primary" : ""}`} onClick={() => togglePinSkill(skill.path)}>
                          {pinnedSkills.includes(skill.path) ? "Pinned" : "Pin"}
                        </button>
                        <button type="button" className={`panel-btn mini ${disabledSkills.includes(skill.path) ? "danger" : ""}`} onClick={() => toggleDisableSkill(skill.path)}>
                          {disabledSkills.includes(skill.path) ? "Disabled" : "Disable"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {activeMemory.length > 0 && (
                  <div className="ai-memory-used-list">
                    <div className="ai-mini-heading">Memory used</div>
                    {activeMemory.slice(0, 4).map((memory) => (
                      <div key={memory.id || memory.content} className="muted">[{memory.category}] {memory.content}</div>
                    ))}
                  </div>
                )}
              </details>
            )}

            <details className="panel-section ai-result-section">
              <summary className="ai-result-summary">Context used · {sources.length} sources</summary>
              {sources.length === 0 ? (
                <div className="muted">No indexed sources matched.</div>
              ) : (
                <div className="ai-source-list">
                  {sources.slice(0, 8).map((source, idx) => (
                    <div key={`${source.path}-${source.name}-${idx}`} className="panel-card" style={{ padding: 8 }}>
                      <strong>{source.kind}</strong> · {source.name || source.path}
                      <div className="muted">{source.path}</div>
                    </div>
                  ))}
                </div>
              )}
            </details>

            <div className="panel-section ai-result-section ai-proposal-section">
              <div className="ai-proposal-title-row">
                <div className="panel-section-title">Proposed YAML Changes</div>
                <button className="panel-btn mini" type="button" onClick={openReviewPlan}>
                  <ClipboardList size={12} /> Review plan
                </button>
              </div>
              {changes.length === 0 ? (
                <div className="muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={14} /> No file changes proposed.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {changes.map((change, idx) => (
                    <details key={idx} className="panel-card" open={idx === 0} style={{ padding: 8 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                        <Check size={12} /> {proposalTitle(change, idx)}
                      </summary>
                      <AiProposalPreview change={change} />
                      {change.rationale && <div className="muted ai-proposal-rationale"><MarkdownText text={change.rationale} /></div>}
                      <details className="ai-proposal-technical">
                        <summary>YAML/change details</summary>
                        <pre>{compactJson(change)}</pre>
                      </details>
                    </details>
                  ))}
                </div>
              )}
              {validation && (
                <div className={`ai-validation-box ${validation.valid ? "ok" : "bad"}`}>
                  <strong>{validation.valid ? "Validation passed" : "Validation failed"}</strong>
                  <span>
                    {validation.summary?.valid || 0}/{validation.summary?.total || 0} valid,
                    {" "}{validation.summary?.errors || 0} errors,
                    {" "}{validation.summary?.warnings || 0} warnings
                  </span>
                  {(validation.results || []).flatMap((item) => item.errors || []).slice(0, 4).map((item, idx) => (
                    <div key={idx} className="ai-inline-error">{item.message}</div>
                  ))}
                  {(validation.results || []).flatMap((item) => item.warnings || []).slice(0, 4).map((item, idx) => (
                    <div key={idx} className="muted">{item}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="ai-action-row">
        {onClose && <button className="panel-btn" type="button" onClick={onClose}>Close</button>}
        <textarea
          className="panel-textarea ai-prompt"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={compact ? 3 : 4}
          placeholder="Ask something like: build a customer 360 conceptual model, explain missing relationships, or propose YAML fixes..."
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
              event.preventDefault();
              submit();
              return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button className="panel-btn ai-send-btn" type="button" onClick={submit} disabled={loading || !message.trim()}>
          {loading ? "Thinking..." : <><Send size={12} /> Ask</>}
        </button>
        {result && changes.length > 0 && (
          <button className="panel-btn" type="button" onClick={validate} disabled={validating}>
            {validating ? "Validating..." : "Validate"}
          </button>
        )}
        {result && changes.length > 0 && (
          <button className="panel-btn primary" type="button" onClick={apply} disabled={applying || validation?.valid === false}>
            {applying ? "Applying..." : `Apply ${changes.length}`}
          </button>
        )}
        <span className="ai-composer-hint">Enter to ask · Shift Enter for newline</span>
        {error && <span className="ai-inline-error">{error}</span>}
      </div>
    </div>
  );
}

export function AiAssistantEmpty() {
  return (
    <div className="ai-empty">
      <Wand2 size={18} />
      <strong>Ask AI</strong>
      <span>Select an entity, relationship, file, or use the prompt to analyze the active workspace.</span>
    </div>
  );
}
