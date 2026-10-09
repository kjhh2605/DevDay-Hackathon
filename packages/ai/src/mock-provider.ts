import { randomUUID } from 'node:crypto';
import type { TopicContext } from '@devday/application-ports';
import type { ResponseInput, ResponseOutputItem, Tool } from 'openai/resources/responses/responses';
import {
  AiProviderError,
  type AiProvider,
  type RealtimeConnection,
  type RealtimeHandlers,
} from './provider.js';

export interface MockProviderOptions {
  /** A fixture transcript, never inferred from the supplied PCM. */
  transcript?: string;
}

const MOCK = '[Mock AI]';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiProviderError('INVALID_MOCK_INPUT', 'Mock fixture input must be an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function sentences(value: string): string[] {
  // Preserve every character; punctuation boundaries are deterministic fixture behavior.
  return value.match(/[^.!?。！？]*[.!?。！？]+\s*|[^.!?。！？]+$/gu) ?? [];
}
function message(outputText: string): { output: ResponseOutputItem[]; outputText: string } {
  const marked = `${MOCK} ${outputText}`;
  return {
    output: [
      {
        type: 'message',
        id: `mock_message_${randomUUID()}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: marked, annotations: [], logprobs: [] }],
      },
    ],
    outputText: marked,
  };
}

/** Explicit development fixture. No method calls an AI service or provides real-AI acceptance evidence. */
export class MockAiProvider implements AiProvider {
  private readonly transcript: string;
  constructor(options: MockProviderOptions = {}) {
    this.transcript = options.transcript?.trim() || `${MOCK} I enjoy learning English.`;
  }

  async structured<T>(
    name: string,
    _schema: Record<string, unknown>,
    _system: string,
    input: unknown,
  ): Promise<T> {
    const source = record(input);
    let result: unknown;
    switch (name) {
      case 'experience_analysis': {
        const originalText = text(source.originalText);
        if (!originalText.trim())
          throw new AiProviderError(
            'INVALID_MOCK_INPUT',
            'An experience fixture requires original text.',
          );
        const answers = Array.isArray(source.answers)
          ? source.answers.map((answer) => text(record(answer).answer)).filter(Boolean)
          : [];
        result = {
          // Length is only a fixture branch selector, not an assessment of real experience quality.
          questions:
            source.skipQuestions || answers.length || originalText.trim().length >= 60
              ? []
              : [`${MOCK} 그 경험에서 기억에 남는 장면은 무엇인가요?`],
          summaryQuotes: [originalText, ...answers],
          interests: [],
          context: { place: null, people: [], event: originalText, actions: [] },
        };
        break;
      }
      case 'topic_plan': {
        const context = source as unknown as TopicContext;
        const experiences = context.experiences.filter(
          (item) => !context.focusUserId || item.ownerUserId === context.focusUserId,
        );
        const expressions = [...context.learningExpressions, ...context.sharedExpressions];
        if (!experiences.length && !expressions.length)
          throw new AiProviderError('CONTEXT_REQUIRED', 'Mock topics require saved context.');
        const image = experiences.length > 0;
        result = {
          kind: image ? 'image' : 'sentence',
          title: `${MOCK} 저장한 경험과 표현으로 대화하기`,
          situationText:
            `${MOCK} ${experiences.map((item) => item.summary).join(' ')} ${expressions.map((item) => item.expression).join(' / ')}`.trim(),
          conversationInstruction: `${MOCK} 저장한 경험을 서로 이야기하고 제시된 표현을 사용해 보세요.`,
          sentence: image ? null : expressions.map((item) => item.expression).join(' / '),
          sourceExperienceIds: experiences.map((item) => item.id),
          learningExpressionIds: context.learningExpressions.map((item) => item.id),
          sharedExpressionIds: context.sharedExpressions.map((item) => item.id),
          imagePrompt: image
            ? `${MOCK} Fixture image for: ${experiences.map((item) => item.summary).join(' ')}`
            : null,
        };
        break;
      }
      case 'sentence_feedback': {
        const correctedText = text(source.correctedText);
        if (!correctedText.trim())
          throw new AiProviderError(
            'INVALID_MOCK_INPUT',
            'A feedback fixture requires corrected text.',
          );
        // A single labelled fixture exercises revision approval and speaker-owned saving.
        // It makes no claim that the supplied sentence needs a real language correction.
        result = {
          items: [
            {
              category: `${MOCK} 개발 검증`,
              summary: `${MOCK} 문장 학습 저장 예시`,
              explanation: `${MOCK} 현재 보정문으로 피드백 검토와 학습 저장 흐름을 확인하는 모의 항목입니다.`,
              expression: correctedText,
              meaning: `${MOCK} 입력된 보정문을 그대로 보관하는 테스트용 학습 항목`,
              example: correctedText,
            },
          ],
        };
        break;
      }
      case 'sentence_ranges': {
        const segments = (
          source.segments as Array<{
            id: string;
            startOrder: number;
            rawText: string;
            correctedText: string;
          }>
        )
          .slice()
          .sort((a, b) => a.startOrder - b.startOrder);
        result = {
          sentences: segments.flatMap((segment) => {
            const raw = sentences(segment.rawText);
            const corrected = sentences(segment.correctedText);
            // Never guess alignment when corrections changed the sentence boundaries.
            if (raw.length !== corrected.length)
              return [
                {
                  slices: [
                    {
                      segmentId: segment.id,
                      rawSlice: segment.rawText,
                      correctedSlice: segment.correctedText,
                    },
                  ],
                },
              ];
            return raw.map((rawSlice, index) => ({
              slices: [{ segmentId: segment.id, rawSlice, correctedSlice: corrected[index] }],
            }));
          }),
        };
        break;
      }
      case 'chat_learning': {
        const request = record(source.request);
        if (source.kind === 'word') {
          const word = text(request.word);
          result = {
            expression: word,
            meaning:
              word.toLowerCase() === 'resilient'
                ? `${MOCK} 어려움에서 회복하는, 회복력이 있는`
                : `${MOCK} “${word}”의 테스트용 뜻풀이`,
            example:
              word.toLowerCase() === 'resilient'
                ? 'She stayed resilient after the setback.'
                : `This fixture practices the word “${word}”.`,
          };
        } else {
          const requestText = text(request.text);
          const [expression, meaning, example] = /포기|give up/iu.test(requestText)
            ? ['Never give up.', '포기하지 마세요.', 'I will never give up on my dream.']
            : /다시|도전|try again/iu.test(requestText)
              ? [
                  'Give it another try.',
                  '다시 한번 도전해 보세요.',
                  'I will give it another try tomorrow.',
                ]
              : /함께|together/iu.test(requestText)
                ? [
                    'We did it together.',
                    '우리는 함께 해냈어요.',
                    'It was hard, but we did it together.',
                  ]
                : [
                    'Let me put it this way.',
                    '이렇게 표현해 볼게요.',
                    'Let me put it this way: practice helps.',
                  ];
          result = { expression, meaning: `${MOCK} ${meaning}`, example };
        }
        break;
      }
      default:
        throw new AiProviderError(
          'UNSUPPORTED_MOCK_SCHEMA',
          `No deterministic fixture is defined for ${name}.`,
        );
    }
    return result as T;
  }

  async respond(
    input: ResponseInput,
    tools: Tool[],
  ): Promise<{ output: ResponseOutputItem[]; outputText: string }> {
    const latest = input.at(-1);
    if (latest?.type === 'function_call_output') {
      const result = record(JSON.parse(text(latest.output)));
      if (!result.ok)
        return message(text(record(result.error).message) || '도구 실행에 실패했어요.');
      if (Array.isArray(result.data))
        return message(
          result.data.length
            ? result.data.map((item) => text(record(item).expression)).join('\n')
            : '저장한 학습 기록이 없어요.',
        );
      const data = record(result.data);
      if (data.saved === true) {
        const item = record(data.item);
        const explanation = `${text(item.expression)}\n${text(item.meaning)}\n${text(item.example)}\n개인 학습 기록에 저장했어요.`;
        return message(
          data.proposal ? `${explanation}\n이 표현을 스터디에 공유할까요? yes / no` : explanation,
        );
      }
      if (typeof data.outcome === 'string') return message(`요청 처리 상태: ${data.outcome}`);
      return message(JSON.stringify(data));
    }
    const lastUser = input.findLast((item) => 'role' in item && item.role === 'user');
    const request = lastUser && 'content' in lastUser ? text(lastUser.content) : '';
    let name: string | null = null;
    let args: Record<string, unknown> = {};
    if (/단어|word|뜻/iu.test(request) && !/표현|expression/iu.test(request)) {
      name = 'explain_word';
      args = { word: request.match(/[a-z][a-z'-]*/iu)?.[0] ?? request, context: null };
    } else if (/표현|expression/iu.test(request)) {
      name = 'learn_expression';
      args = { text: request, context: null };
    } else if (/다음\s*주제|next\s*topic/iu.test(request)) {
      name = 'advance_topic';
      args = { focusUserId: null };
    } else if (/주제.*(?:종료|마감|끝)|(?:close|end)\s*(?:the\s*)?topic/iu.test(request))
      name = 'close_topic';
    else if (/스터디.*(?:종료|끝)|(?:finish|end)\s*(?:the\s*)?study/iu.test(request))
      name = 'finish_study';
    else if (/시작|start.*study/iu.test(request)) {
      name = 'start_study';
      args = { focusUserId: null };
    } else if (/학습.*(?:기록|목록)|my\s*learning/iu.test(request)) {
      name = 'list_my_learning';
      args = { query: null };
    } else if (/상태|참여자|context|status/iu.test(request)) name = 'get_study_context';
    if (!name || !tools.some((tool) => tool.type === 'function' && tool.name === name))
      return message('개발용 모의 응답입니다. 단어, 표현 또는 스터디 명령을 입력해 주세요.');
    return {
      output: [
        {
          type: 'function_call',
          id: `mock_function_${randomUUID()}`,
          call_id: `mock_call_${randomUUID()}`,
          name,
          arguments: JSON.stringify(args),
          status: 'completed',
        },
      ],
      outputText: '',
    };
  }

  async transcribe(pcm: Uint8Array, _context: string): Promise<string> {
    if (!pcm.byteLength || pcm.byteLength % 2)
      throw new AiProviderError(
        'INVALID_AUDIO',
        'Mock input requires nonempty complete PCM16 samples.',
      );
    return this.transcript;
  }

  async image(_prompt: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    return { bytes: Buffer.from(PNG, 'base64'), contentType: 'image/png' };
  }

  async connectTranscription(handlers: RealtimeHandlers): Promise<RealtimeConnection> {
    let closed = false;
    let size = 0;
    let previousId: string | null = null;
    const assertOpen = () => {
      if (closed)
        throw new AiProviderError(
          'REALTIME_CLOSED',
          'The mock transcription connection is closed.',
        );
    };
    return {
      append: (pcm) => {
        assertOpen();
        if (pcm.byteLength % 2)
          throw new AiProviderError('INVALID_AUDIO', 'PCM16 sample is incomplete.');
        size += pcm.byteLength;
      },
      commit: () => {
        assertOpen();
        if (!size)
          throw new AiProviderError('INVALID_AUDIO', 'No mock PCM audio has been appended.');
        size = 0;
        const itemId = `mock_item_${randomUUID()}`;
        const previous = previousId;
        previousId = itemId;
        // Emulate asynchronous server acknowledgement after the caller records its commit.
        queueMicrotask(() => {
          if (closed) return;
          handlers.onEvent({
            type: 'input_audio_buffer.committed',
            item_id: itemId,
            previous_item_id: previous,
          });
          handlers.onEvent({
            type: 'conversation.item.input_audio_transcription.delta',
            item_id: itemId,
            delta: this.transcript,
          });
          handlers.onEvent({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id: itemId,
            transcript: this.transcript,
          });
        });
      },
      close: () => {
        if (!closed) {
          closed = true;
          handlers.onClose?.();
        }
      },
    };
  }
}

export function createMockProvider(options: MockProviderOptions = {}): MockAiProvider {
  return new MockAiProvider(options);
}
