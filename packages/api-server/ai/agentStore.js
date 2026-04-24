import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const AGENT_DIR = join(".datalex", "agent");
const CHATS_FILE = "chats.json";
const MEMORY_FILE = "memory.json";
const INDEX_FILE = "index.json";
const SQLITE_FILE = "runtime.sqlite";
const SQLITE_ENABLED = !["0", "false", "no"].includes(String(process.env.DATALEX_AI_SQLITE || "1").toLowerCase());
let sqliteModulePromise = null;

function nowIso() {
  return new Date().toISOString();
}

function agentPath(project, file = "") {
  return join(project.path, AGENT_DIR, file);
}

async function loadSqliteModule() {
  if (!SQLITE_ENABLED) return null;
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("node:sqlite").catch(() => null);
  }
  return sqliteModulePromise;
}

async function withSqlite(project, fn) {
  const mod = await loadSqliteModule();
  const DatabaseSync = mod?.DatabaseSync;
  if (!DatabaseSync) return null;
  await mkdir(agentPath(project), { recursive: true });
  const db = new DatabaseSync(agentPath(project, SQLITE_FILE));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_json_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return fn(db);
  } catch (_err) {
    return null;
  } finally {
    try { db.close(); } catch (_err) {}
  }
}

async function readSqliteJson(project, file) {
  const row = await withSqlite(project, (db) => {
    return db.prepare("SELECT value FROM ai_json_store WHERE key = ?").get(file);
  });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch (_err) {
    return null;
  }
}

async function writeSqliteJson(project, file, value) {
  await withSqlite(project, (db) => {
    db.prepare(`
      INSERT INTO ai_json_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(file, JSON.stringify(value), nowIso());
    return true;
  });
}

async function readJson(project, file, fallback) {
  const sqliteValue = await readSqliteJson(project, file);
  if (sqliteValue) return sqliteValue;
  try {
    const raw = await readFile(agentPath(project, file), "utf-8");
    const parsed = JSON.parse(raw);
    await writeSqliteJson(project, file, parsed);
    return parsed;
  } catch (_err) {
    return fallback;
  }
}

async function writeJson(project, file, value) {
  await mkdir(agentPath(project), { recursive: true });
  await writeFile(agentPath(project, file), `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await writeSqliteJson(project, file, value);
}

export async function getAiRuntimeStorageInfo(project) {
  const sqliteAvailable = Boolean((await loadSqliteModule())?.DatabaseSync);
  return {
    mode: sqliteAvailable && SQLITE_ENABLED ? "sqlite+json" : "json",
    jsonDir: agentPath(project),
    sqlitePath: agentPath(project, SQLITE_FILE),
    sqliteEnabled: SQLITE_ENABLED,
    sqliteAvailable,
  };
}

export async function persistAiIndexSnapshot(project, index) {
  const snapshot = {
    version: 1,
    projectId: index?.projectId,
    builtAt: index?.builtAt,
    projectPath: index?.projectPath,
    modelPath: index?.modelPath,
    recordCount: Array.isArray(index?.records) ? index.records.length : 0,
    typedCounts: index?.typedCounts || {},
    dbtArtifacts: index?.dbtArtifacts || {},
    records: Array.isArray(index?.records) ? index.records : [],
  };
  await writeJson(project, INDEX_FILE, snapshot);
  return snapshot;
}

function normalizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function titleFromMessage(message) {
  const clean = normalizeText(message).replace(/[^\w\s-]/g, "").trim();
  if (!clean) return "New modeling chat";
  const words = clean.split(/\s+/).slice(0, 7);
  return words.join(" ");
}

export async function listAiChats(project, { limit = 50 } = {}) {
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  return (Array.isArray(store.chats) ? store.chats : [])
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, limit);
}

export async function getAiChat(project, chatId) {
  if (!chatId) return null;
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  return (Array.isArray(store.chats) ? store.chats : []).find((chat) => chat.id === chatId) || null;
}

export async function createAiChat(project, { title, message } = {}) {
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  const time = nowIso();
  const chat = {
    id: randomUUID(),
    title: title || titleFromMessage(message),
    createdAt: time,
    updatedAt: time,
    messages: [],
  };
  store.version = 1;
  store.chats = Array.isArray(store.chats) ? store.chats : [];
  store.chats.unshift(chat);
  await writeJson(project, CHATS_FILE, store);
  return chat;
}

export async function appendAiChatMessages(project, chatId, messages = []) {
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  store.version = 1;
  store.chats = Array.isArray(store.chats) ? store.chats : [];
  let chat = store.chats.find((item) => item.id === chatId);
  if (!chat) {
    chat = await createAiChat(project, { message: messages.find((m) => m.role === "user")?.content || "" });
    chatId = chat.id;
    const refreshed = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
    store.chats = refreshed.chats;
    chat = store.chats.find((item) => item.id === chatId);
  }
  const time = nowIso();
  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (const message of messages) {
    chat.messages.push({
      id: message.id || randomUUID(),
      role: message.role,
      content: String(message.content || ""),
      createdAt: message.createdAt || time,
      metadata: message.metadata || {},
    });
  }
  chat.updatedAt = time;
  await writeJson(project, CHATS_FILE, store);
  return chat;
}

export async function listAiMemories(project) {
  const store = await readJson(project, MEMORY_FILE, { version: 1, memories: [] });
  return (Array.isArray(store.memories) ? store.memories : [])
    .filter((memory) => !memory.supersededBy)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export async function upsertAiMemories(project, memories = []) {
  const store = await readJson(project, MEMORY_FILE, { version: 1, memories: [] });
  store.version = 1;
  store.memories = Array.isArray(store.memories) ? store.memories : [];
  const existing = new Map(store.memories.filter((m) => !m.supersededBy).map((m) => [normalizeText(m.content).toLowerCase(), m]));
  const added = [];
  const time = nowIso();
  for (const item of memories) {
    const content = normalizeText(item.content);
    if (!content) continue;
    const key = content.toLowerCase();
    if (existing.has(key)) continue;
    const memory = {
      id: randomUUID(),
      category: item.category || "business_standard",
      content,
      sourceChatId: item.sourceChatId || null,
      createdAt: time,
      updatedAt: time,
      supersededBy: null,
    };
    store.memories.unshift(memory);
    existing.set(key, memory);
    added.push(memory);
  }
  if (added.length) await writeJson(project, MEMORY_FILE, store);
  return added;
}

export async function deleteAiMemory(project, memoryId) {
  const store = await readJson(project, MEMORY_FILE, { version: 1, memories: [] });
  const before = Array.isArray(store.memories) ? store.memories.length : 0;
  store.memories = (Array.isArray(store.memories) ? store.memories : []).filter((memory) => memory.id !== memoryId);
  if (store.memories.length !== before) {
    await writeJson(project, MEMORY_FILE, store);
    return true;
  }
  return false;
}

export function extractModelingMemories(message) {
  const text = String(message || "");
  const candidates = [];
  const lines = text.split(/\r?\n|[.;]\s+/).map(normalizeText).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^(always|never|prefer|use|do not|don't|avoid)\b/.test(lower)) {
      candidates.push({ category: "user_preference", content: line });
    } else if (/\b(naming|name|suffix|prefix|convention)\b/.test(lower)) {
      candidates.push({ category: "naming_rule", content: line });
    } else if (/\b(glossary|term|definition|dictionary)\b/.test(lower)) {
      candidates.push({ category: "glossary_convention", content: line });
    } else if (/\b(dbt|schema.yml|test|contract|source|exposure|metric)\b/.test(lower)) {
      candidates.push({ category: "dbt_implementation_rule", content: line });
    } else if (/\b(standard|naming convention|business rule|modeling rule|dbt rule)\b/.test(lower)) {
      candidates.push({ category: "business_standard", content: line });
    } else if (/\b(domain|subject area|bounded context)\b/.test(lower) && /\b(means|should|must|is)\b/.test(lower)) {
      candidates.push({ category: "domain_decision", content: line });
    }
  }
  return candidates.slice(0, 8);
}

export function renderMemoryContext(memories = []) {
  const active = memories.slice(0, 20);
  if (!active.length) return "";
  const lines = active.map((memory) => `- [${memory.category}] ${memory.content}`);
  return `Persisted DataLex modeling memory:\n${lines.join("\n")}`;
}
