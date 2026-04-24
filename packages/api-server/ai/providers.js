import { getProviderMeta, normalizeProviderName } from "./providerMeta.js";

export class AiProviderError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function envValue(name) {
  return name ? String(process.env[name] || "").trim() : "";
}

export function resolveAiProviderConfig(input = {}) {
  const provider = normalizeProviderName(input.provider || process.env.DATALEX_AI_PROVIDER || "local");
  const meta = getProviderMeta(provider);
  if (!meta) {
    throw new AiProviderError(400, "AI_PROVIDER_UNSUPPORTED", `Unsupported AI provider: ${provider}`);
  }
  const model = String(input.model || process.env.DATALEX_AI_MODEL || meta.defaultModel || "").trim();
  const baseUrl = String(input.baseUrl || envValue(meta.baseUrlEnvVar) || process.env.DATALEX_AI_BASE_URL || "").trim();
  const apiKey = String(input.apiKey || envValue(meta.envVar) || "").trim();
  return {
    provider,
    label: meta.label,
    model,
    baseUrl,
    apiKey,
    envKey: meta.envVar,
    baseUrlEnvKey: meta.baseUrlEnvVar,
    requiresApiKey: meta.apiKey === "required",
  };
}

async function parseProviderBody(response, fallback = {}) {
  const body = await response.json().catch(() => fallback);
  return body && typeof body === "object" ? body : fallback;
}

function assertConfigured(config) {
  if (!config.provider || config.provider === "local") return false;
  if (config.requiresApiKey && !config.apiKey) {
    throw new AiProviderError(
      400,
      "AI_PROVIDER_NOT_CONFIGURED",
      `Missing ${config.envKey || "API key"} for ${config.provider}.`,
    );
  }
  return true;
}

async function callOpenAiCompatible(config, messages, { baseUrl, path = "/chat/completions", authPrefix = "Bearer" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${authPrefix} ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  const body = await parseProviderBody(response);
  if (!response.ok) {
    throw new AiProviderError(response.status, "AI_PROVIDER_ERROR", body?.error?.message || `${config.provider} request failed`, body);
  }
  return body?.choices?.[0]?.message?.content || "";
}

export async function callAiProvider(config, messages) {
  if (!assertConfigured(config)) return null;

  if (config.provider === "openai") {
    return callOpenAiCompatible(config, messages, {
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
    });
  }

  if (config.provider === "mistral") {
    return callOpenAiCompatible(config, messages, {
      baseUrl: config.baseUrl || "https://api.mistral.ai/v1",
    });
  }

  if (config.provider === "openrouter") {
    return callOpenAiCompatible(config, messages, {
      baseUrl: config.baseUrl || "https://openrouter.ai/api/v1",
    });
  }

  if (config.provider === "anthropic") {
    const system = messages.find((m) => m.role === "system")?.content || "";
    const user = messages.filter((m) => m.role !== "system").map((m) => `${m.role}: ${m.content}`).join("\n\n");
    const response = await fetch(`${config.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 3000,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const body = await parseProviderBody(response);
    if (!response.ok) {
      throw new AiProviderError(response.status, "AI_PROVIDER_ERROR", body?.error?.message || "Anthropic request failed", body);
    }
    return (body?.content || []).map((part) => part?.text || "").join("\n");
  }

  if (config.provider === "gemini") {
    const url = `${config.baseUrl || "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n") }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    const body = await parseProviderBody(response);
    if (!response.ok) {
      throw new AiProviderError(response.status, "AI_PROVIDER_ERROR", body?.error?.message || "Gemini request failed", body);
    }
    return body?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || "";
  }

  if (config.provider === "ollama") {
    const response = await fetch(`${config.baseUrl || "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
      }),
    });
    const body = await parseProviderBody(response);
    if (!response.ok) {
      throw new AiProviderError(response.status, "AI_PROVIDER_ERROR", body?.error || "Ollama request failed", body);
    }
    return body?.message?.content || "";
  }

  throw new AiProviderError(400, "AI_PROVIDER_UNSUPPORTED", `Unsupported AI provider: ${config.provider}`);
}
