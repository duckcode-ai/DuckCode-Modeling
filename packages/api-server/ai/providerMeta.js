export const PROVIDER_META = {
  local: {
    label: "Local",
    envVar: "",
    baseUrlEnvVar: "",
    defaultModel: "",
    apiKey: "none",
    models: [],
  },
  openai: {
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    baseUrlEnvVar: "OPENAI_BASE_URL",
    defaultModel: "gpt-4o-mini",
    apiKey: "required",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini"],
  },
  anthropic: {
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    baseUrlEnvVar: "ANTHROPIC_BASE_URL",
    defaultModel: "claude-3-5-sonnet-latest",
    apiKey: "required",
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  },
  gemini: {
    label: "Gemini",
    envVar: "GEMINI_API_KEY",
    baseUrlEnvVar: "GEMINI_BASE_URL",
    defaultModel: "gemini-1.5-flash",
    apiKey: "required",
    models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
  },
  mistral: {
    label: "Mistral",
    envVar: "MISTRAL_API_KEY",
    baseUrlEnvVar: "MISTRAL_BASE_URL",
    defaultModel: "mistral-small-latest",
    apiKey: "required",
    models: ["mistral-small-latest", "mistral-large-latest"],
  },
  openrouter: {
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    baseUrlEnvVar: "OPENROUTER_BASE_URL",
    defaultModel: "openai/gpt-4.1-mini",
    apiKey: "required",
    models: ["openai/gpt-4.1-mini", "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5"],
  },
  ollama: {
    label: "Ollama",
    envVar: "",
    baseUrlEnvVar: "OLLAMA_BASE_URL",
    defaultModel: "llama3.1",
    apiKey: "none",
    models: ["llama3.1", "llama3.2", "qwen2.5", "mistral"],
  },
};

export function normalizeProviderName(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "google") return "gemini";
  if (!value) return "local";
  return value;
}

export function getProviderMeta(provider) {
  return PROVIDER_META[normalizeProviderName(provider)] || null;
}

export function listProviderMeta() {
  return Object.entries(PROVIDER_META).map(([id, meta]) => ({ id, ...meta }));
}
