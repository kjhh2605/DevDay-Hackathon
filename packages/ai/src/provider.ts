import OpenAI, { toFile } from 'openai';
import type { ResponseInput, ResponseOutputItem, Tool } from 'openai/resources/responses/responses';
import WebSocket from 'ws';
import { loadAiConfig, type AiConfig } from './config.js';
import { PROMPTS } from './prompts.js';

export type {
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
  Tool,
} from 'openai/resources/responses/responses';

export interface ProviderEvent {
  type: string;
  item_id?: string;
  previous_item_id?: string | null;
  delta?: string;
  transcript?: string;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

export interface RealtimeHandlers {
  onEvent(event: ProviderEvent): void;
  onError(error: Error): void;
  onClose?(): void;
}

export interface RealtimeConnection {
  /** Input is already resampled 24 kHz little-endian PCM16 mono, without a WAV header. */
  append(pcm: Uint8Array): void;
  commit(): void;
  close(): void;
}

export interface AiProvider {
  structured<T>(
    name: string,
    schema: Record<string, unknown>,
    system: string,
    input: unknown,
  ): Promise<T>;
  respond(
    input: ResponseInput,
    tools: Tool[],
  ): Promise<{ output: ResponseOutputItem[]; outputText: string }>;
  transcribe(pcm: Uint8Array, context: string): Promise<string>;
  image(prompt: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  connectTranscription(handlers: RealtimeHandlers): Promise<RealtimeConnection>;
}

export class AiProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** WAV PCM format tag 1, mono, 24 kHz, signed little-endian 16 bit. */
export function pcm16ToWav(pcm: Uint8Array): Uint8Array {
  if (!pcm.byteLength || pcm.byteLength % 2 !== 0) {
    throw new AiProviderError('INVALID_AUDIO', 'PCM16 must contain complete, nonempty samples.');
  }
  const wav = Buffer.alloc(44 + pcm.byteLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcm.byteLength, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.byteLength, 40);
  wav.set(pcm, 44);
  return wav;
}

export interface ProviderAudit {
  capability: 'structured' | 'respond' | 'transcribe' | 'image' | 'realtime';
  model: string;
  requestId: string | null;
  sessionId?: string;
}

export interface ProviderDependencies {
  client?: OpenAI;
  createWebSocket?: (url: string, options: WebSocket.ClientOptions) => WebSocket;
  onAudit?: (audit: ProviderAudit) => void;
}

export class OpenAIProvider implements AiProvider {
  private readonly client: OpenAI;
  private readonly createWebSocket: NonNullable<ProviderDependencies['createWebSocket']>;
  private readonly onAudit: NonNullable<ProviderDependencies['onAudit']>;

  constructor(
    private readonly config: AiConfig = loadAiConfig(),
    dependencies: ProviderDependencies = {},
  ) {
    this.client =
      dependencies.client ??
      new OpenAI({
        apiKey: config.apiKey,
        maxRetries: config.maxRetries,
        timeout: config.textTimeoutMs,
      });
    this.createWebSocket =
      dependencies.createWebSocket ?? ((url, options) => new WebSocket(url, options));
    this.onAudit = dependencies.onAudit ?? (() => {});
  }

  async structured<T>(
    name: string,
    schema: Record<string, unknown>,
    system: string,
    input: unknown,
  ): Promise<T> {
    const response = await this.client.responses.create(
      {
        model: this.config.textModel,
        reasoning: { effort: this.config.reasoningEffort },
        store: false,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
        text: { format: { type: 'json_schema', name, schema, strict: true } },
      },
      { timeout: this.config.textTimeoutMs, maxRetries: 0 },
    );
    this.onAudit({
      capability: 'structured',
      model: this.config.textModel,
      requestId: response._request_id ?? null,
    });
    this.assertCompleted(response);
    if (!response.output_text)
      throw new AiProviderError('EMPTY_OUTPUT', 'OpenAI returned no structured output.');
    try {
      // The application validates this value against the feature's Zod schema before saving.
      return JSON.parse(response.output_text) as T;
    } catch {
      throw new AiProviderError('INVALID_OUTPUT', 'OpenAI returned invalid structured JSON.');
    }
  }

  async respond(
    input: ResponseInput,
    tools: Tool[],
  ): Promise<{ output: ResponseOutputItem[]; outputText: string }> {
    const response = await this.client.responses.create(
      {
        model: this.config.textModel,
        reasoning: { effort: this.config.reasoningEffort },
        store: false,
        include: ['reasoning.encrypted_content'],
        input,
        tools,
        parallel_tool_calls: false,
      },
      { timeout: this.config.textTimeoutMs, maxRetries: 0 },
    );
    this.onAudit({
      capability: 'respond',
      model: this.config.textModel,
      requestId: response._request_id ?? null,
    });
    this.assertCompleted(response);
    // Keep ALL output items, including reasoning, for the next function-result turn.
    return { output: response.output, outputText: response.output_text };
  }

  async transcribe(pcm: Uint8Array, context: string): Promise<string> {
    // SDK 6.49 does not declare languages yet; it serializes documented extra fields.
    const request = {
      model: this.config.correctionModel,
      file: await toFile(pcm16ToWav(pcm), 'utterance.wav', { type: 'audio/wav' }),
      response_format: 'json' as const,
      // Verified on mixed Korean/English audio: the default may stop after the first language span.
      chunking_strategy: this.config.correctionChunkingStrategy,
      // Recording context only. Never translate or run text-only grammar correction here.
      prompt: `${PROMPTS.transcriptionContext}\n${context}`.trim(),
      languages: ['ko', 'en'],
    };
    const response = await this.client.audio.transcriptions.create(request, {
      timeout: this.config.textTimeoutMs,
      maxRetries: 0,
    });
    this.onAudit({
      capability: 'transcribe',
      model: this.config.correctionModel,
      requestId: response._request_id ?? null,
    });
    if (typeof response.text !== 'string' || !response.text.trim()) {
      throw new AiProviderError(
        'EMPTY_TRANSCRIPT',
        'OpenAI returned no transcript for this audio.',
      );
    }
    return response.text;
  }

  async image(prompt: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const response = await this.client.images.generate(
      {
        model: this.config.imageModel,
        prompt,
        n: 1,
        quality: 'low',
        size: '1024x1024',
        output_format: 'png',
      },
      { timeout: this.config.imageTimeoutMs, maxRetries: 0 },
    );
    this.onAudit({
      capability: 'image',
      model: this.config.imageModel,
      requestId: response._request_id ?? null,
    });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded)
      throw new AiProviderError('EMPTY_IMAGE', 'OpenAI returned no generated image bytes.');
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new AiProviderError('INVALID_IMAGE', 'OpenAI did not return the requested PNG image.');
    }
    return { bytes, contentType: 'image/png' };
  }

  connectTranscription(handlers: RealtimeHandlers): Promise<RealtimeConnection> {
    return new Promise((resolve, reject) => {
      const socket = this.createWebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        handshakeTimeout: this.config.realtimeConnectTimeoutMs,
      });
      let ready = false;
      let intentionalClose = false;
      let failed = false;
      const fail = (error: Error) => {
        if (failed || intentionalClose) return;
        failed = true;
        clearTimeout(timer);
        if (!ready) reject(error);
        else handlers.onError(error);
        socket.close();
      };
      const send = (event: Record<string, unknown>) => {
        if (failed || intentionalClose || socket.readyState !== WebSocket.OPEN) {
          throw new AiProviderError('REALTIME_CLOSED', 'The transcription connection is closed.');
        }
        socket.send(JSON.stringify(event), (error) => {
          if (error)
            fail(
              new AiProviderError('REALTIME_SEND_FAILED', 'Could not send transcription audio.'),
            );
        });
      };
      const connection: RealtimeConnection = {
        append: (pcm) => {
          if (pcm.byteLength % 2 !== 0)
            throw new AiProviderError('INVALID_AUDIO', 'PCM16 sample is incomplete.');
          if (pcm.byteLength)
            send({ type: 'input_audio_buffer.append', audio: Buffer.from(pcm).toString('base64') });
        },
        commit: () => send({ type: 'input_audio_buffer.commit' }),
        close: () => {
          intentionalClose = true;
          clearTimeout(timer);
          socket.close(1000);
        },
      };
      const timer = setTimeout(() => {
        fail(
          new AiProviderError('REALTIME_TIMEOUT', 'OpenAI transcription session setup timed out.'),
        );
      }, this.config.realtimeConnectTimeoutMs);
      socket.on('upgrade', (response) => {
        const requestId = response.headers['x-request-id'];
        this.onAudit({
          capability: 'realtime',
          model: this.config.liveTranscribeModel,
          requestId: Array.isArray(requestId) ? (requestId[0] ?? null) : (requestId ?? null),
        });
      });
      socket.on('open', () => {
        send({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24_000 },
                transcription: {
                  model: this.config.liveTranscribeModel,
                  languages: ['ko', 'en'],
                  delay: 'low',
                  prompt: PROMPTS.liveTranscriptionContext,
                },
                turn_detection: null,
              },
            },
          },
        });
      });
      socket.on('message', (data) => {
        if (failed || intentionalClose) return;
        let event: ProviderEvent;
        try {
          event = JSON.parse(data.toString()) as ProviderEvent;
          if (typeof event.type !== 'string') throw new Error('No type');
        } catch {
          fail(
            new AiProviderError(
              'INVALID_REALTIME_EVENT',
              'OpenAI sent an invalid transcription event.',
            ),
          );
          return;
        }
        if (event.type === 'error') {
          fail(
            new AiProviderError(
              event.error?.code || 'REALTIME_ERROR',
              'OpenAI transcription failed.',
            ),
          );
          return;
        }
        if (event.type === 'session.created') {
          const session = event.session as { id?: unknown } | undefined;
          if (typeof session?.id === 'string') {
            this.onAudit({
              capability: 'realtime',
              model: this.config.liveTranscribeModel,
              requestId: null,
              sessionId: session.id,
            });
          }
        }
        if (event.type === 'session.updated' && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve(connection);
        }
        handlers.onEvent(event);
      });
      socket.on('error', () =>
        fail(
          new AiProviderError(
            'REALTIME_CONNECTION_FAILED',
            'OpenAI transcription connection failed.',
          ),
        ),
      );
      socket.on('close', () => {
        clearTimeout(timer);
        if (!intentionalClose && !failed) {
          fail(
            new AiProviderError(
              'REALTIME_CLOSED',
              'OpenAI transcription connection closed unexpectedly.',
            ),
          );
        }
        handlers.onClose?.();
      });
    });
  }

  private assertCompleted(response: { status?: string; output: ResponseOutputItem[] }): void {
    if (response.status !== 'completed')
      throw new AiProviderError('INCOMPLETE_OUTPUT', 'OpenAI did not complete the response.');
    if (
      response.output.some(
        (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'),
      )
    ) {
      throw new AiProviderError('MODEL_REFUSAL', 'OpenAI could not produce the requested result.');
    }
  }
}
