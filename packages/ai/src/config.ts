export interface AiConfig {
  apiKey: string;
  textModel: string;
  liveTranscribeModel: string;
  correctionModel: string;
  imageModel: string;
  reasoningEffort: 'low';
  textTimeoutMs: number;
  imageTimeoutMs: number;
  realtimeConnectTimeoutMs: number;
  maxRetries: 0;
  correctionChunkingStrategy: 'auto';
}

export const AI_DEFAULTS = Object.freeze({
  textModel: 'gpt-6-luna',
  liveTranscribeModel: 'gpt-live-transcribe',
  correctionModel: 'gpt-transcribe',
  imageModel: 'gpt-image-2.5-flare-2026-09-08',
  reasoningEffort: 'low' as const,
  textTimeoutMs: 60_000,
  imageTimeoutMs: 180_000,
  realtimeConnectTimeoutMs: 60_000,
  maxRetries: 0 as const,
  correctionChunkingStrategy: 'auto' as const,
});

/** Server-only configuration. Never include this object in logs or public DTOs. */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for AI_MODE=live.');
  return {
    ...AI_DEFAULTS,
    apiKey,
    textModel: env.OPENAI_TEXT_MODEL?.trim() || AI_DEFAULTS.textModel,
    liveTranscribeModel:
      env.OPENAI_LIVE_TRANSCRIBE_MODEL?.trim() || AI_DEFAULTS.liveTranscribeModel,
    correctionModel: env.OPENAI_CORRECTION_MODEL?.trim() || AI_DEFAULTS.correctionModel,
    imageModel: env.OPENAI_IMAGE_MODEL?.trim() || AI_DEFAULTS.imageModel,
  };
}
