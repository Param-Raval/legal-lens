// Configuration for the application
export type AIProvider = 'openai' | 'ollama';

export const config = {
  provider: (process.env.AI_PROVIDER || 'openai') as AIProvider,
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL || '',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:1234',
    visionModel: process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl',
    reasoningModel: process.env.OLLAMA_REASONING_MODEL || 'deepseek-r1:8b',
  },
};
