import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
import type WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { AI_DEFAULTS, loadAiConfig } from './config.js';
import { OpenAIProvider, pcm16ToWav } from './provider.js';

const config = { ...AI_DEFAULTS, apiKey: 'test-only-not-a-real-key' };
const output = (text: string) => ({
  id: 'resp_test',
  object: 'response',
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_test',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ],
});

function mockProvider(response: unknown, status = 200) {
  const calls: RequestInit[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init) calls.push(init);
    return Response.json(response, { status });
  });
  const client = new OpenAI({ apiKey: config.apiKey, maxRetries: 0, fetch });
  return { provider: new OpenAIProvider(config, { client }), fetch, calls };
}

class FakeSocket extends EventEmitter {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  receive(event: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(event)));
  }
  send(raw: string, callback: (error?: Error) => void) {
    this.sent.push(JSON.parse(raw));
    callback();
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

describe('OpenAI provider contract', () => {
  it('uses explicit model defaults and fails without a live key', () => {
    expect(() => loadAiConfig({})).toThrow('OPENAI_API_KEY');
    expect(loadAiConfig({ OPENAI_API_KEY: 'x' })).toMatchObject({ ...AI_DEFAULTS, apiKey: 'x' });
  });

  it('wraps the identical samples in a valid mono 24 kHz PCM16 WAV', () => {
    const pcm = Buffer.from([0, 128, 0, 0, 255, 127]);
    const wav = Buffer.from(pcm16ToWav(pcm));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
    expect(() => pcm16ToWav(new Uint8Array(3))).toThrow('PCM16');
  });

  it('serializes strict Responses JSON schema and validates incomplete/refused output', async () => {
    const { provider, calls } = mockProvider(output('{"items":[]}'));
    expect(
      await provider.structured('feedback', { type: 'object' }, 'Coach only.', { text: 'Hi' }),
    ).toEqual({ items: [] });
    expect(JSON.parse(calls[0].body as string)).toMatchObject({
      model: AI_DEFAULTS.textModel,
      store: false,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', strict: true, name: 'feedback' } },
    });
    await expect(
      mockProvider({ ...output('{}'), status: 'incomplete' }).provider.structured('x', {}, '', {}),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_OUTPUT' });
    const refused = {
      ...output('{}'),
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot' }] }],
    };
    await expect(mockProvider(refused).provider.structured('x', {}, '', {})).rejects.toMatchObject({
      code: 'MODEL_REFUSAL',
    });
  });

  it('preserves reasoning output and disables parallel tools and retries', async () => {
    const reasoning = {
      type: 'reasoning',
      id: 'rs_1',
      summary: [],
      encrypted_content: 'encrypted',
    };
    const functionCall = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'get_study_context',
      arguments: '{}',
    };
    const { provider, calls } = mockProvider({ ...output(''), output: [reasoning, functionCall] });
    const result = await provider.respond([{ role: 'user', content: 'Get context.' }], []);
    expect(result.output).toEqual([reasoning, functionCall]);
    expect(JSON.parse(calls[0].body as string)).toMatchObject({
      parallel_tool_calls: false,
      include: ['reasoning.encrypted_content'],
    });
    const failing = mockProvider({ error: { message: 'Unavailable', type: 'server_error' } }, 500);
    await expect(failing.provider.respond([], [])).rejects.toThrow();
    expect(failing.fetch).toHaveBeenCalledTimes(1);
  });

  it('audits only capability, model and provider request ID', async () => {
    const onAudit = vi.fn();
    const client = new OpenAI({
      apiKey: config.apiKey,
      maxRetries: 0,
      fetch: async () =>
        Response.json(output('{}'), { headers: { 'x-request-id': 'req_safe_test' } }),
    });
    const provider = new OpenAIProvider(config, { client, onAudit });
    await provider.structured('test', {}, 'test', {});
    expect(onAudit).toHaveBeenCalledWith({
      capability: 'structured',
      model: AI_DEFAULTS.textModel,
      requestId: 'req_safe_test',
    });
    expect(JSON.stringify(onAudit.mock.calls)).not.toContain(config.apiKey);
  });

  it('uploads a WAV with multilingual hints, recording context and original grammar intact', async () => {
    const { provider, calls } = mockProvider({ text: '어제 I go to cafe.' });
    const pcm = Buffer.from([1, 2, 3, 4]);
    expect(await provider.transcribe(pcm, 'A conversation about a cafe.')).toBe(
      '어제 I go to cafe.',
    );
    const body = calls[0].body as FormData;
    expect(body.getAll('languages[]')).toEqual(['ko', 'en']);
    expect(body.get('chunking_strategy')).toBe('auto');
    expect(body.has('language')).toBe(false);
    expect(body.get('prompt')).toContain('A conversation about a cafe.');
    const wav = Buffer.from(await (body.get('file') as File).arrayBuffer());
    expect(wav.subarray(44)).toEqual(pcm);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('requires actual generated PNG bytes', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const { provider, calls } = mockProvider({ data: [{ b64_json: png.toString('base64') }] });
    expect(await provider.image('Cafe')).toEqual({ bytes: png, contentType: 'image/png' });
    expect(JSON.parse(calls[0].body as string)).toMatchObject({
      model: AI_DEFAULTS.imageModel,
      quality: 'low',
      size: '1024x1024',
      output_format: 'png',
      n: 1,
    });
    await expect(mockProvider({ data: [] }).provider.image('Cafe')).rejects.toMatchObject({
      code: 'EMPTY_IMAGE',
    });
  });

  it('waits for transcription session acknowledgement and forwards item IDs without reordering', async () => {
    const socket = new FakeSocket();
    const onEvent = vi.fn();
    const onError = vi.fn();
    const provider = new OpenAIProvider(config, {
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const connecting = provider.connectTranscription({ onEvent, onError });
    socket.open();
    expect(socket.sent[0]).toMatchObject({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24_000 },
            transcription: { model: 'gpt-live-transcribe', languages: ['ko', 'en'], delay: 'low' },
            turn_detection: null,
          },
        },
      },
    });
    socket.receive({ type: 'session.updated' });
    const connection = await connecting;
    connection.append(new Uint8Array([0, 1]));
    const delta = {
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item_b',
      delta: 'Hello',
    };
    socket.receive(delta); // A delta may arrive before commit acknowledgement.
    connection.commit();
    socket.receive({
      type: 'input_audio_buffer.committed',
      item_id: 'item_b',
      previous_item_id: 'item_a',
    });
    socket.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_b',
      transcript: 'Hello.',
    });
    socket.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_a',
      transcript: 'Earlier.',
    });
    expect(onEvent.mock.calls.map(([event]) => event.item_id)).toEqual([
      undefined,
      'item_b',
      'item_b',
      'item_b',
      'item_a',
    ]);
    expect(socket.sent.slice(1)).toEqual([
      { type: 'input_audio_buffer.append', audio: 'AAE=' },
      { type: 'input_audio_buffer.commit' },
    ]);
    connection.close();
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects setup provider errors with no retry or sensitive error echo', async () => {
    const socket = new FakeSocket();
    const createWebSocket = vi.fn(() => socket as unknown as WebSocket);
    const connecting = new OpenAIProvider(config, { createWebSocket }).connectTranscription({
      onEvent: vi.fn(),
      onError: vi.fn(),
    });
    const rejection = expect(connecting).rejects.toMatchObject({
      code: 'invalid_api_key',
      message: 'OpenAI transcription failed.',
    });
    socket.open();
    socket.receive({
      type: 'error',
      error: { code: 'invalid_api_key', message: 'sensitive diagnostic' },
    });
    await rejection;
    expect(createWebSocket).toHaveBeenCalledTimes(1);
  });
});

describe('Decisions speech classification adapter', () => {
  it('sends a choice question and validates its confidence without retries', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        answers: [
          { type: 'choice', name: 'speech_completion', choice: 'complete', confidence: 0.93 },
        ],
      }),
    );
    const provider = new OpenAIProvider(config, { fetch });
    expect(
      await provider.decideSpeech({ text: 'Yes.', context: 'Travel', silenceMs: 1000 }),
    ).toEqual({ choice: 'complete', confidence: 0.93 });
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe('https://api.openai.com/v1/decisions');
    expect(JSON.parse(init[1].body as string)).toMatchObject({
      model: 'gpt-6-luna',
      questions: [{ type: 'choice', name: 'speech_completion' }],
    });
    expect(JSON.parse(init[1].body as string)).not.toHaveProperty('tools');
  });
  it.each([
    { answers: [{ type: 'refusal', name: 'speech_completion' }] },
    {
      answers: [{ type: 'choice', name: 'speech_completion', choice: 'complete', confidence: 1.1 }],
    },
    { answers: [{ type: 'choice', name: 'speech_completion', choice: 'complete' }] },
    { answers: [{ type: 'choice', name: 'other', choice: 'complete', confidence: 1 }] },
    {},
  ])('fails closed for invalid or refused output %#', async (body) => {
    const fetch = vi.fn(async () => Response.json(body));
    const provider = new OpenAIProvider(config, { fetch });
    expect(
      await provider.decideSpeech({ text: 'I went to', context: '', silenceMs: 1000 }),
    ).toEqual({ choice: 'uncertain', confidence: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 503])('does not retry HTTP %s', async (status) => {
    const fetch = vi.fn(async () => new Response('', { status }));
    const provider = new OpenAIProvider(config, { fetch });
    expect(
      (await provider.decideSpeech({ text: 'Yes', context: '', silenceMs: 1000 })).choice,
    ).toBe('uncertain');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Decisions chat routing adapter', () => {
  const input: import('./chat-decision.js').ChatDecisionInput = {
    text: 'queue 뜻을 알려줘',
    history: [],
    context: {},
    pendingSharing: null,
    allowedChoices: ['explain_word', 'general_chat', 'clarify_intent'],
  };
  it('offers only available choices and validates the chat answer', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        answers: [
          { type: 'choice', name: 'chat_action', choice: 'explain_word', confidence: 0.94 },
        ],
      }),
    );
    const audit = vi.fn();
    const provider = new OpenAIProvider(config, { fetch, onAudit: audit });
    expect(await provider.decideChat(input)).toEqual({ choice: 'explain_word', confidence: 0.94 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    const body = JSON.parse(init.body as string);
    expect(body.questions[0]).toMatchObject({ type: 'choice', name: 'chat_action' });
    expect(body.questions[0].choices.map((choice: { value: string }) => choice.value)).toEqual(
      input.allowedChoices,
    );
    expect(JSON.parse(body.input)).toEqual(input);
    expect(body).not.toHaveProperty('tools');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ capability: 'decision' }));
  });
  it.each([
    {},
    { answers: [] },
    { answers: [null] },
    { answers: [{ type: 'refusal', name: 'chat_action' }] },
    {
      answers: [
        { type: 'choice', name: 'speech_completion', choice: 'explain_word', confidence: 1 },
      ],
    },
    { answers: [{ type: 'choice', name: 'chat_action', choice: 'finish_study', confidence: 1 }] },
    { answers: [{ type: 'choice', name: 'chat_action', choice: 'unknown', confidence: 1 }] },
    {
      answers: [{ type: 'choice', name: 'chat_action', choice: 'explain_word', confidence: -0.1 }],
    },
    { answers: [{ type: 'choice', name: 'chat_action', choice: 'explain_word', confidence: 1.1 }] },
    { answers: [{ type: 'choice', name: 'chat_action', choice: 'explain_word', confidence: '1' }] },
    { answers: [{ type: 'choice', name: 'chat_action', choice: 'explain_word' }] },
  ])('clarifies invalid/refused/unavailable output %#', async (body) => {
    const fetch = vi.fn(async () => Response.json(body));
    expect(await new OpenAIProvider(config, { fetch }).decideChat(input)).toEqual({
      choice: 'clarify_intent',
      confidence: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([429, 500, 503])('does not retry HTTP %s', async (status) => {
    const fetch = vi.fn(async () => new Response('', { status }));
    expect((await new OpenAIProvider(config, { fetch }).decideChat(input)).choice).toBe(
      'clarify_intent',
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('uses the independent chat deadline and fails closed on abort', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init!.signal!;
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const provider = new OpenAIProvider({ ...config, chatDecisionTimeoutMs: 5 }, { fetch });
    expect(await provider.decideChat(input)).toEqual({ choice: 'clarify_intent', confidence: 0 });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
