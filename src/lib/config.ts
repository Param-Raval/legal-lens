// Configuration for the application
export type AIProvider = 'openai' | 'ollama';

export interface AppConfig {
  provider: AIProvider;
  openai: { baseUrl: string; apiKey: string; model: string };
  ollama: { baseUrl: string; visionModel: string; reasoningModel: string };
}

/** Read config fresh from process.env on every call so that runtime
 *  updates (e.g. via the /api/settings endpoint) take effect immediately. */
export function getConfig(): AppConfig {
  return {
    provider: (process.env.AI_PROVIDER || 'openai') as AIProvider,
    openai: {
      baseUrl: (process.env.GPT4O_ENDPOINT || '').replace(/\/+$/, ''),
      apiKey: process.env.GPT4O_API_KEY || '',
      model: process.env.GPT4O_DEPLOYMENT || 'gpt-4o',
    },
    ollama: {
      baseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(
        /\/+$/,
        '',
      ),
      visionModel: process.env.OLLAMA_MODEL || 'qwen2.5vl',
      reasoningModel: process.env.OLLAMA_REASONING_MODEL || 'deepseek-r1:8b',
    },
  };
}

/** Throws immediately if the selected provider is missing its base URL / key. */
export function validateConfig() {
  const config = getConfig();
  if (config.provider === 'openai') {
    if (!config.openai.baseUrl) {
      throw new Error(
        'GPT4O_ENDPOINT is not set. Configure it in Settings.',
      );
    }
    if (!config.openai.apiKey) {
      throw new Error(
        'GPT4O_API_KEY is not set. Configure it in Settings.',
      );
    }
    try {
      new URL(config.openai.baseUrl);
    } catch {
      throw new Error(
        `GPT4O_ENDPOINT is not a valid URL: "${config.openai.baseUrl}". It must start with https://.`,
      );
    }
  } else {
    if (!config.ollama.baseUrl) {
      throw new Error('OLLAMA_BASE_URL is not set.');
    }
  }
}
