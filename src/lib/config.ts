// Configuration for the application
export type AIProvider = 'openai' | 'ollama';

export const config = {
  provider: (process.env.AI_PROVIDER || 'openai') as AIProvider,
  openai: {
    baseUrl: (process.env.GPT4O_ENDPOINT || '').replace(/\/+$/, ''),
    apiKey: process.env.GPT4O_API_KEY || '',
    model: process.env.GPT4O_DEPLOYMENT || 'gpt-4o',
  },
  ollama: {
    baseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    visionModel: process.env.OLLAMA_MODEL || 'qwen2.5vl',
    reasoningModel: process.env.OLLAMA_REASONING_MODEL || 'deepseek-r1:8b',
  },
};

/** Throws immediately if the selected provider is missing its base URL / key. */
export function validateConfig() {
  if (config.provider === 'openai') {
    if (!config.openai.baseUrl) {
      throw new Error(
        'GPT4O_ENDPOINT is not set. Add it in Vercel → Settings → Environment Variables.'
      );
    }
    if (!config.openai.apiKey) {
      throw new Error(
        'GPT4O_API_KEY is not set. Add it in Vercel → Settings → Environment Variables.'
      );
    }
    // Quick sanity-check: must be a valid absolute URL
    try {
      new URL(config.openai.baseUrl);
    } catch {
      throw new Error(
        `GPT4O_ENDPOINT is not a valid URL: "${config.openai.baseUrl}". It must start with https://.`
      );
    }
  } else {
    if (!config.ollama.baseUrl) {
      throw new Error('OLLAMA_BASE_URL is not set.');
    }
  }
}
