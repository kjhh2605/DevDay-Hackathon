import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { strictToolDefinitions } from '@devday/contracts';
import { MockAiProvider } from './mock-provider.js';
import {
  assertGroundedExperience,
  ExperienceAnalysisSchema,
  FeedbackOutputSchema,
  SentencePlanSchema,
  TopicPlanSchema,
  validateTopicPlan,
} from './schemas.js';
import { mapSentenceRanges } from './sentences.js';
import type { ProviderEvent, ResponseInput } from './provider.js';

const id = (digit: string) => `00000000-0000-4000-8000-00000000000${digit}`;
const provider = new MockAiProvider();

describe('explicit development mock provider', () => {
  it('preserves only literal experience facts and supports question, answer, skip and sufficient fixture branches', async () => {
    const originalText = '부산에 다녀왔어요';
    const analyze = async (input: unknown) =>
      ExperienceAnalysisSchema.parse(
        await provider.structured('experience_analysis', {}, '', input),
      );
    const first = await analyze({ originalText, answers: [], skipQuestions: false });
    expect(first.questions).toHaveLength(1);
    expect(() => assertGroundedExperience(first, originalText, [])).not.toThrow();
    const answered = await analyze({
      originalText,
      answers: [{ answer: '친구와 갔어요' }],
      skipQuestions: false,
    });
    expect(answered.questions).toEqual([]);
    expect(() =>
      assertGroundedExperience(answered, originalText, [{ answer: '친구와 갔어요' }]),
    ).not.toThrow();
    expect((await analyze({ originalText, answers: [], skipQuestions: true })).questions).toEqual(
      [],
    );
    expect(
      (
        await analyze({
          originalText:
            '지난 주말 친구 민지와 부산 해운대 시장에 갔다. 점심으로 국밥을 먹고 바닷가를 걸으며 다음 여행 계획을 이야기했다.',
          answers: [],
          skipQuestions: false,
        })
      ).questions,
    ).toEqual([]);
  });

  it('uses only the immutable supplied topic snapshot without mutating it', async () => {
    const context = {
      studyId: id('1'),
      topicId: id('2'),
      ordinal: 1,
      focusUserId: id('3'),
      experiences: [
        {
          id: id('4'),
          ownerUserId: id('3'),
          summary: '부산',
          interests: [],
          context: { place: null, people: [], event: '부산', actions: [] },
        },
        {
          id: id('5'),
          ownerUserId: id('6'),
          summary: '서울',
          interests: [],
          context: { place: null, people: [], event: '서울', actions: [] },
        },
      ],
      learningExpressions: [],
      sharedExpressions: [
        {
          id: id('7'),
          studyId: id('1'),
          contributorUserId: id('3'),
          expression: 'Keep going.',
          meaning: '계속해요',
          example: 'Keep going.',
          sourceProposalId: id('8'),
        },
      ],
    };
    const before = structuredClone(context);
    const plan = TopicPlanSchema.parse(await provider.structured('topic_plan', {}, '', context));
    validateTopicPlan(plan, context);
    expect(plan.sourceExperienceIds).toEqual([id('4')]);
    expect(plan.sharedExpressionIds).toEqual([id('7')]);
    expect(context).toEqual(before);
    const sentenceContext = { ...context, experiences: [] };
    const sentencePlan = TopicPlanSchema.parse(
      await provider.structured('topic_plan', {}, '', sentenceContext),
    );
    validateTopicPlan(sentencePlan, sentenceContext);
    expect(sentencePlan.kind).toBe('sentence');
  });

  it('splits exact source sentences while retaining all text and source order', async () => {
    const source = [
      {
        id: id('1'),
        speakerUserId: id('2'),
        startOrder: 1,
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:02Z',
        rawText: '어제 I go home.It is fun!',
        correctedText: '어제 I go home.It is fun!',
      },
    ];
    const plan = SentencePlanSchema.parse(
      await provider.structured('sentence_ranges', {}, '', { segments: source }),
    );
    const drafts = mapSentenceRanges(source, plan);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((item) => item.rawText).join('')).toBe(source[0].rawText);
  });

  it('returns a labelled feedback fixture bound to the supplied correction for approval persistence', async () => {
    const correctedText = '[Mock input] I enjoy learning English with my friend.';
    const result = FeedbackOutputSchema.parse(
      await provider.structured('sentence_feedback', {}, '', { correctedText }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ expression: correctedText, example: correctedText });
    expect(result.items[0].summary).toContain('[Mock AI]');
    expect(result.items[0].explanation).toContain('모의 항목');
    await expect(
      provider.structured('sentence_feedback', {}, '', { correctedText: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_MOCK_INPUT' });
  });

  it.each([
    ['resilient 단어 뜻 알려줘', 'explain_word'],
    ['포기하지 않는다는 표현을 영어로 알려줘', 'learn_expression'],
    ['다시 도전한다는 표현을 영어로 알려줘', 'learn_expression'],
    ['함께 해냈다는 표현을 영어로 알려줘', 'learn_expression'],
  ])('routes the latest intent: %s', async (request, name) => {
    const result = await provider.respond(
      [
        { role: 'user', content: '스터디 시작' },
        { role: 'assistant', content: '이전 응답' },
        { role: 'user', content: request },
      ],
      strictToolDefinitions(),
    );
    expect(result.output[0]).toMatchObject({ type: 'function_call', name });
  });

  it('derives success or failure from actual tool results and labels every response as mock', async () => {
    const output = (data: unknown): ResponseInput => [
      { type: 'function_call_output', call_id: 'call', output: JSON.stringify(data) },
    ];
    const success = await provider.respond(
      output({
        ok: true,
        data: {
          saved: true,
          item: { expression: 'Keep going.', meaning: '계속해요', example: 'Keep going.' },
          proposal: { id: id('1') },
        },
      }),
      [],
    );
    expect(success.outputText).toContain('[Mock AI]');
    expect(success.outputText).toContain('Keep going.');
    expect(success.outputText).toContain('yes / no');
    const failed = await provider.respond(
      output({ ok: false, error: { message: '주제가 바뀌었어요.' } }),
      [],
    );
    expect(failed.outputText).toBe('[Mock AI] 주제가 바뀌었어요.');
    expect(failed.outputText).not.toContain('저장');
  });

  it('returns a decodable static PNG and never claims to transcribe actual audio', async () => {
    const image = await provider.image('fixture');
    const bytes = Buffer.from(image.bytes);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    let offset = 8;
    const compressed: Buffer[] = [];
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      expect(crc32(bytes.subarray(offset + 4, offset + 8 + length))).toBe(
        bytes.readUInt32BE(offset + 8 + length),
      );
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    expect(inflateSync(Buffer.concat(compressed)).length).toBeGreaterThan(0);
    expect(await provider.transcribe(new Uint8Array([0, 0]), 'real audio')).toContain('[Mock AI]');
  });

  it('emits ordered per-commit item IDs and matching configurable transcript fixtures', async () => {
    const events: ProviderEvent[] = [];
    const fake = new MockAiProvider({ transcript: 'Fixture audio.' });
    const connection = await fake.connectTranscription({
      onEvent: (event) => events.push(event),
      onError: (error) => {
        throw error;
      },
    });
    for (let count = 0; count < 2; count++) {
      connection.append(new Uint8Array([0, 0]));
      connection.commit();
    }
    await Promise.resolve();
    expect(events.map((event) => event.type)).toEqual(
      Array.from({ length: 2 }, () => [
        'input_audio_buffer.committed',
        'conversation.item.input_audio_transcription.delta',
        'conversation.item.input_audio_transcription.completed',
      ]).flat(),
    );
    expect(events[3].previous_item_id).toBe(events[0].item_id);
    expect(events[3].item_id).not.toBe(events[0].item_id);
    expect(events[2].transcript).toBe('Fixture audio.');
    expect(await fake.transcribe(new Uint8Array([0, 0]), '')).toBe('Fixture audio.');
    connection.close();
    expect(() => connection.append(new Uint8Array([0, 0]))).toThrow('closed');
  });
});
