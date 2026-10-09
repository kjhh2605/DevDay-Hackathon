import { describe, expect, it, vi } from 'vitest';
import type { ApplicationPorts, ChatExecutionContext } from '@devday/application-ports';
import type { ChatMessage, ShareProposal, StudySnapshot } from '@devday/contracts';
import type {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';
import type { ChatDecision } from './chat-decision.js';
import type { AiProvider } from './provider.js';
import { MockAiProvider } from './mock-provider.js';
import { runChat } from './chat.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { userId: id(1) };
const stamp = '2026-10-09T00:00:00.000Z';
function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: id(10),
    ownerUserId: actor.userId,
    studyId: id(2),
    revision: 0,
    role: 'assistant',
    text: '공유할까요?',
    status: 'succeeded',
    commandResults: [],
    learningItemIds: [],
    shareProposalId: null,
    createdAt: stamp,
    ...overrides,
  };
}
function proposal(overrides: Partial<ShareProposal> = {}): ShareProposal {
  return {
    id: id(20),
    ownerUserId: actor.userId,
    studyId: id(2),
    revision: 0,
    learningItemId: id(30),
    expression: 'keep going',
    status: 'pending',
    decidedAt: null,
    ...overrides,
  };
}
function call(name: string, args: unknown = {}, callId = name): ResponseFunctionToolCall {
  return { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) };
}
const response = (
  output: ResponseOutputItem[] = [],
  outputText = '처리 결과를 확인해 주세요.',
) => ({ output, outputText });
function setup(overrides: Partial<ChatExecutionContext> = {}) {
  const context: ChatExecutionContext = {
    actor,
    studyId: id(2),
    messageId: id(3),
    expectedTopicId: id(4),
    expectedTransitionVersion: 7,
    text: '도와줘',
    history: [],
    ...overrides,
  };
  const snapshot: StudySnapshot = {
    study: {
      id: id(2),
      revision: 1,
      status: 'active',
      currentTopicId: id(4),
      transitionVersion: 7,
      members: [{ userId: actor.userId, handle: 'alice', displayName: '앨리스', state: 'joined' }],
      createdAt: stamp,
      endedAt: null,
    },
    topic: {
      id: id(4),
      revision: 1,
      studyId: id(2),
      ordinal: 1,
      state: 'review',
      focusUserId: null,
      content: null,
      generationJobId: id(5),
      approvedAt: null,
    },
    utterances: [],
    feedback: [],
    segments: [],
    jobs: [],
    sharedExpressions: [],
  };
  const completed = message({ id: context.messageId });
  const services = {
    chat: {
      readForJob: vi.fn(async () => context),
      complete: vi.fn(async () => completed),
      fail: vi.fn(async () => {}),
    },
    jobs: { isRunning: vi.fn(async () => true) },
    studies: { snapshot: vi.fn(async () => snapshot) },
    studyCommands: {
      execute: vi.fn(async (_actor, input) => ({
        commandId: input.command.commandId,
        outcome: 'applied',
        studyId: id(2),
        topicId: id(40),
        jobId: id(41),
        transitionVersion: 8,
      })),
    },
    learning: {
      saveFromChat: vi.fn(async (_actor, input) => ({
        id: id(30 + input.toolOrdinal),
        ownerUserId: actor.userId,
        kind: input.kind,
        expression: input.expression,
        meaning: input.meaning,
        example: input.example,
        source: 'chat',
        sourceKey: `chat:${input.messageId}:${input.toolOrdinal}`,
        sourceStudyId: id(2),
        sourceUtteranceId: null,
        createdAt: stamp,
      })),
      list: vi.fn(
        async (_actor: unknown, _query: unknown) => [] as { id: string; ownerUserId: string }[],
      ),
    },
    sharing: {
      listPending: vi.fn(async () => [] as ShareProposal[]),
      createProposal: vi.fn(async () => proposal()),
      decide: vi.fn(async (_actor, input) => ({
        proposal: proposal({ status: input.accepted ? 'accepted' : 'declined', decidedAt: stamp }),
        sharedExpression: null,
      })),
    },
    feedback: {
      getUtterance: vi.fn(async () => ({
        id: id(50),
        studyId: id(2),
        topicId: id(4),
        correctionRevision: 12,
      })),
      start: vi.fn(async () => ({ id: id(51), status: 'running' })),
    },
  };
  const provider = {
    decideChat: vi.fn(
      async (_input: import('./chat-decision.js').ChatDecisionInput): Promise<ChatDecision> => ({
        choice: 'general_chat',
        confidence: 1,
      }),
    ),
    respond: vi.fn(async (_input: ResponseInput, _tools: unknown) => response()),
    structured: vi.fn(
      async (..._args: unknown[]): Promise<unknown> => ({
        expression: 'keep going',
        meaning: '계속하다',
        example: 'Keep going.',
      }),
    ),
  };
  const ports = services as unknown as ApplicationPorts;
  const run = () => runChat(id(99), ports, provider as unknown as AiProvider);
  const resultInputs = () =>
    provider.respond.mock.calls.flatMap(([input]) =>
      input
        .filter((item) => item.type === 'function_call_output')
        .map(
          (item) =>
            JSON.parse(String(item.output)) as {
              ok: boolean;
              data?: unknown;
              error?: { code: string; message: string };
            },
        ),
    );
  return { context, snapshot, services, provider, run, resultInputs };
}

function select(
  test: ReturnType<typeof setup>,
  choice: ChatDecision['choice'],
  args: unknown = {},
) {
  test.provider.decideChat.mockResolvedValue({ choice, confidence: 1 });
  test.provider.structured.mockResolvedValueOnce({ arguments: args });
}

describe('Decision routed chat', () => {
  it.each([
    ['start_study', 'study.start', null, 'waiting', null],
    ['advance_topic', 'topic.advance', id(4), 'active', 'review'],
    ['close_topic', 'topic.close', id(4), 'active', 'talking'],
    ['finish_study', 'study.finish', id(4), 'active', 'review'],
  ] as const)(
    'executes selected %s exactly once with reserved versions',
    async (tool, command, topicId, status, state) => {
      const test = setup({ expectedTopicId: topicId });
      test.snapshot.study.status = status;
      test.snapshot.topic = state ? { ...test.snapshot.topic!, state } : null;
      select(
        test,
        tool,
        tool === 'start_study' || tool === 'advance_topic' ? { focusUserId: null } : {},
      );
      await test.run();
      expect(test.services.studyCommands.execute).toHaveBeenCalledExactlyOnceWith(actor, {
        studyId: id(2),
        command: expect.objectContaining({
          type: command,
          expectedTopicId: topicId,
          expectedTransitionVersion: 7,
          commandId: expect.any(String),
        }),
      });
      expect(test.provider.respond).toHaveBeenCalledOnce();
      expect(test.provider.respond.mock.calls[0]![1]).toEqual([]);
    },
  );

  it.each(['explain_word', 'learn_expression'] as const)(
    'generates and privately saves %s',
    async (choice) => {
      const test = setup();
      select(
        test,
        choice,
        choice === 'explain_word'
          ? { word: 'queue', context: null }
          : { text: '계속하다', context: null },
      );
      await test.run();
      expect(test.services.learning.saveFromChat).toHaveBeenCalledExactlyOnceWith(
        actor,
        expect.objectContaining({
          kind: choice === 'explain_word' ? 'word' : 'expression',
          messageId: id(3),
          toolOrdinal: 1,
        }),
      );
      expect(test.services.sharing.createProposal).toHaveBeenCalledTimes(
        choice === 'explain_word' ? 0 : 1,
      );
      expect(test.services.chat.complete).toHaveBeenCalledWith(
        id(3),
        expect.objectContaining({ learningItemIds: [id(31)] }),
      );
    },
  );

  it('reads shared state without mutations', async () => {
    const test = setup();
    select(test, 'get_study_context');
    await test.run();
    expect(test.services.studies.snapshot).toHaveBeenCalledTimes(2);
    expect(test.services.studyCommands.execute).not.toHaveBeenCalled();
  });

  it('filters learning records to the authenticated owner', async () => {
    const test = setup();
    select(test, 'list_my_learning', { query: 'queue' });
    test.services.learning.list.mockResolvedValue([
      { id: id(70), ownerUserId: actor.userId },
      { id: id(71), ownerUserId: id(9) },
    ]);
    await test.run();
    expect(test.services.learning.list).toHaveBeenCalledExactlyOnceWith(actor, 'queue');
    expect(JSON.stringify(test.resultInputs())).toContain(id(70));
    expect(JSON.stringify(test.resultInputs())).not.toContain(id(71));
  });

  it('requests feedback at the latest revision', async () => {
    const test = setup();
    select(test, 'request_sentence_feedback', { utteranceId: id(50) });
    await test.run();
    expect(test.services.feedback.start).toHaveBeenCalledExactlyOnceWith(
      actor,
      id(50),
      12,
      expect.any(String),
    );
  });

  it('rejects another topic sentence', async () => {
    const test = setup();
    select(test, 'request_sentence_feedback', { utteranceId: id(50) });
    test.services.feedback.getUtterance.mockResolvedValue({
      id: id(50),
      studyId: id(2),
      topicId: id(88),
      correctionRevision: 12,
    });
    await test.run();
    expect(test.services.feedback.start).not.toHaveBeenCalled();
    expect(JSON.stringify(test.resultInputs())).toContain('STALE_TOPIC');
  });

  it.each([0.49, NaN, Infinity, 1.01])(
    'does not execute a low or malformed confidence %s',
    async (confidence) => {
      const test = setup();
      test.provider.decideChat.mockResolvedValue({ choice: 'finish_study', confidence });
      await test.run();
      expect(test.services.studyCommands.execute).not.toHaveBeenCalled();
      expect(test.provider.structured).not.toHaveBeenCalled();
      expect(test.provider.respond).not.toHaveBeenCalled();
    },
  );

  it('does not substitute topic closing for unavailable next topic', async () => {
    const test = setup({ text: '다음 주제로 넘어가자' });
    test.snapshot.topic!.state = 'talking';
    test.provider.decideChat.mockResolvedValue({ choice: 'advance_topic', confidence: 1 });
    await test.run();
    expect(test.provider.decideChat.mock.calls[0]).toBeDefined();
    expect(test.services.studyCommands.execute).not.toHaveBeenCalled();
    expect(test.services.chat.complete).toHaveBeenCalledWith(
      id(3),
      expect.objectContaining({ text: expect.stringContaining('피드백을 검토') }),
    );
  });

  it('asks about ambiguous or compound requests without executing', async () => {
    const test = setup({ text: '단어 저장하고 스터디 종료해줘' });
    test.provider.decideChat.mockResolvedValue({ choice: 'clarify_intent', confidence: 1 });
    await test.run();
    expect(test.provider.structured).not.toHaveBeenCalled();
    expect(test.services.studyCommands.execute).not.toHaveBeenCalled();
    expect(test.services.learning.saveFromChat).not.toHaveBeenCalled();
  });

  it('asks when arguments are unresolved', async () => {
    const test = setup();
    select(test, 'request_sentence_feedback', null);
    await test.run();
    expect(test.services.feedback.start).not.toHaveBeenCalled();
    expect(test.provider.respond).not.toHaveBeenCalled();
  });

  it('rejects injected actor arguments', async () => {
    const test = setup();
    select(test, 'explain_word', { word: 'queue', context: null, userId: id(9) });
    await expect(test.run()).rejects.toThrow();
    expect(test.services.learning.saveFromChat).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'validates duplicate participant names (explicit handle: %s)',
    async (explicit) => {
      const test = setup({ text: explicit ? '@m1 경험으로 다음 주제' : '민수 경험으로 다음 주제' });
      test.snapshot.study.members.push(
        { userId: id(8), displayName: '민수', handle: 'm1', state: 'joined' },
        { userId: id(9), displayName: '민수', handle: 'm2', state: 'joined' },
      );
      select(test, 'advance_topic', { focusUserId: id(8) });
      await test.run();
      expect(test.services.studyCommands.execute).toHaveBeenCalledTimes(explicit ? 1 : 0);
      if (!explicit) expect(JSON.stringify(test.resultInputs())).toContain('AMBIGUOUS_PARTICIPANT');
    },
  );

  it('does not retry a failed command or expose its exception', async () => {
    const test = setup();
    select(test, 'finish_study');
    test.services.studyCommands.execute.mockRejectedValue(new Error('secret SQL password'));
    await test.run();
    expect(test.services.studyCommands.execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(test.resultInputs())).not.toContain('secret SQL');
  });

  it('cannot execute a tool emitted by the final response', async () => {
    const test = setup();
    select(test, 'explain_word', { word: 'queue', context: null });
    test.provider.respond.mockResolvedValue(response([call('finish_study')]));
    await expect(test.run()).rejects.toThrow('AI_FAILED');
    expect(test.services.studyCommands.execute).not.toHaveBeenCalled();
    expect(test.services.chat.fail).toHaveBeenCalledWith(
      id(3),
      expect.anything(),
      expect.objectContaining({ learningItemIds: [id(31)] }),
    );
  });

  it.each(['decision', 'arguments', 'learning'])(
    'discards late %s output after job termination',
    async (stage) => {
      const test = setup();
      select(test, 'explain_word', { word: 'queue', context: null });
      if (stage === 'decision')
        test.provider.decideChat.mockImplementation(async () => {
          test.services.jobs.isRunning.mockResolvedValue(false);
          return { choice: 'explain_word', confidence: 1 };
        });
      else {
        if (stage === 'arguments') test.provider.structured.mockReset();
        test.provider.structured.mockImplementation(async () => {
          test.services.jobs.isRunning.mockResolvedValue(false);
          return stage === 'arguments'
            ? { arguments: { word: 'queue', context: null } }
            : { expression: 'queue', meaning: '줄', example: 'Queue.' };
        });
      }
      await expect(test.run()).rejects.toThrow('PROCESS_INTERRUPTED');
      expect(test.services.learning.saveFromChat).not.toHaveBeenCalled();
      expect(test.services.chat.complete).not.toHaveBeenCalled();
    },
  );

  it('keeps foreign history and raw transcripts out of all model inputs', async () => {
    const test = setup({
      history: [
        message({ ownerUserId: id(9), text: 'FOREIGN_PRIVATE' }),
        message({ studyId: id(8), text: 'OTHER_STUDY_PRIVATE' }),
        message({ text: 'OWN_CONTEXT' }),
      ],
    });
    test.snapshot.segments = [{ rawText: 'UNTRUSTED_RAW' }] as StudySnapshot['segments'];
    await test.run();
    const input = JSON.stringify([
      test.provider.respond.mock.calls,
      test.provider.decideChat.mock.calls,
    ]);
    expect(input).toContain('OWN_CONTEXT');
    expect(input).not.toMatch(/FOREIGN_PRIVATE|OTHER_STUDY_PRIVATE|UNTRUSTED_RAW/);
    expect(test.provider.structured).not.toHaveBeenCalled();
  });
});

describe('Decision sharing routes', () => {
  it.each([
    ['응, 그 표현 공유해줘', true],
    ['나만 볼게', false],
  ] as const)(
    'handles %s against the sole immediately preceding proposal',
    async (text, accepted) => {
      const test = setup({ text, history: [message({ shareProposalId: id(20) })] });
      test.services.sharing.listPending.mockResolvedValue([proposal()]);
      test.provider.decideChat.mockResolvedValue({
        choice: accepted ? 'accept_expression_share' : 'decline_expression_share',
        confidence: 1,
      });
      await test.run();
      expect(test.services.sharing.decide).toHaveBeenCalledExactlyOnceWith(actor, {
        proposalId: id(20),
        accepted,
        commandId: expect.any(String),
      });
      expect(test.provider.structured).not.toHaveBeenCalled();
      expect(test.provider.respond).not.toHaveBeenCalled();
    },
  );

  it.each([
    'multiple',
    'unrelated-latest',
    'late-proposal',
    'foreign-proposal',
    'other-study',
    'already-decided',
  ] as const)('blocks consent for %s even if the model selects acceptance', async (scenario) => {
    const test = setup({ text: 'yes', history: [message({ shareProposalId: id(20) })] });
    test.services.sharing.listPending.mockResolvedValue([proposal()]);
    if (scenario === 'multiple')
      test.services.sharing.listPending.mockResolvedValue([proposal(), proposal({ id: id(21) })]);
    if (scenario === 'unrelated-latest')
      test.context.history.push(message({ id: id(11), shareProposalId: null }));
    if (scenario === 'late-proposal')
      test.services.sharing.listPending.mockResolvedValue([proposal({ id: id(21) })]);
    if (scenario === 'foreign-proposal')
      test.services.sharing.listPending.mockResolvedValue([proposal({ ownerUserId: id(9) })]);
    if (scenario === 'other-study')
      test.services.sharing.listPending.mockResolvedValue([proposal({ studyId: id(8) })]);
    if (scenario === 'already-decided')
      test.services.sharing.listPending.mockResolvedValue([proposal({ status: 'accepted' })]);
    test.provider.decideChat.mockResolvedValue({
      choice: 'accept_expression_share',
      confidence: 1,
    });
    await test.run();
    expect(test.services.sharing.decide).not.toHaveBeenCalled();
  });
});

describe('development mock through the full chat pipeline', () => {
  it('saves an expression, answers from the result, then shares via Decisions', async () => {
    const test = setup({ text: '함께 해냈어요 영어 표현 알려줘' });
    const provider = new MockAiProvider();
    await runChat(id(99), test.services as unknown as ApplicationPorts, provider);
    expect(test.services.learning.saveFromChat).toHaveBeenCalledOnce();
    expect(test.services.chat.complete).toHaveBeenLastCalledWith(
      id(3),
      expect.objectContaining({ text: expect.stringContaining('공유할까요?') }),
    );
    test.context.text = '응, 그 표현 공유해줘';
    test.context.messageId = id(6);
    test.context.history = [message({ shareProposalId: id(20) })];
    test.services.sharing.listPending.mockResolvedValue([proposal()]);
    await runChat(id(98), test.services as unknown as ApplicationPorts, provider);
    expect(test.services.sharing.decide).toHaveBeenCalledExactlyOnceWith(
      actor,
      expect.objectContaining({ accepted: true, proposalId: id(20) }),
    );
  });
});
