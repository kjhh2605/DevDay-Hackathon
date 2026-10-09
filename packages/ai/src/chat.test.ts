import { describe, expect, it, vi } from 'vitest';
import type { ApplicationPorts, ChatExecutionContext } from '@devday/application-ports';
import type { ChatMessage, ShareProposal, StudySnapshot } from '@devday/contracts';
import type {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';
import type { AiProvider } from './provider.js';
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
    respond: vi.fn(async (_input: ResponseInput, _tools: unknown) => response()),
    structured: vi.fn(async () => ({
      expression: 'keep going',
      meaning: '계속하다',
      example: 'Keep going.',
    })),
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

describe('private chat tools', () => {
  it('saves word then expression serially, preserves reasoning, and records only persisted IDs', async () => {
    const test = setup();
    const reasoning = {
      type: 'reasoning' as const,
      id: 'reasoning-id',
      summary: [],
      encrypted_content: 'encrypted-reasoning',
    };
    test.provider.respond.mockResolvedValueOnce(
      response([
        reasoning,
        call('explain_word', { word: 'resilient', context: null }),
        call('learn_expression', { text: '포기하지 않다', context: null }),
      ]),
    );
    const order: string[] = [];
    test.provider.structured.mockImplementation(async () => {
      order.push('generate');
      return { expression: 'keep going', meaning: '계속하다', example: 'Keep going.' };
    });
    test.services.learning.saveFromChat.mockImplementation(async (_actor, input) => {
      order.push('save');
      return {
        id: id(30 + input.toolOrdinal),
        ownerUserId: actor.userId,
        kind: input.kind,
        ...input,
        source: 'chat',
        sourceKey: `chat:${input.messageId}:${input.toolOrdinal}`,
        sourceStudyId: id(2),
        sourceUtteranceId: null,
        createdAt: stamp,
      };
    });
    await test.run();
    expect(order).toEqual(['generate', 'save', 'generate', 'save']);
    expect(test.provider.respond.mock.calls[1]![0]).toContainEqual(reasoning);
    expect(test.services.learning.saveFromChat).toHaveBeenNthCalledWith(
      1,
      actor,
      expect.objectContaining({ studyId: id(2), messageId: id(3), toolOrdinal: 1, kind: 'word' }),
    );
    expect(test.services.learning.saveFromChat).toHaveBeenNthCalledWith(
      2,
      actor,
      expect.objectContaining({ toolOrdinal: 2, kind: 'expression' }),
    );
    expect(test.services.sharing.createProposal).toHaveBeenCalledExactlyOnceWith(actor, {
      studyId: id(2),
      learningItemId: id(32),
    });
    expect(test.services.chat.complete).toHaveBeenCalledWith(
      id(3),
      expect.objectContaining({ learningItemIds: [id(31), id(32)], shareProposalId: id(20) }),
    );
    expect(test.provider.respond.mock.calls[0]![1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'explain_word', strict: true })]),
    );
  });

  it('does not create a sharing proposal for a word', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([call('explain_word', { word: 'resilient', context: null })]),
    );
    await test.run();
    expect(test.services.learning.saveFromChat).toHaveBeenCalledOnce();
    expect(test.services.sharing.createProposal).not.toHaveBeenCalled();
  });

  it.each([
    ['start_study', 'study.start', null],
    ['advance_topic', 'topic.advance', id(4)],
    ['close_topic', 'topic.close', id(4)],
    ['finish_study', 'study.finish', id(4)],
  ] as const)('maps %s to its reserved domain command', async (tool, command, expectedTopicId) => {
    const test = setup({ expectedTopicId });
    test.provider.respond.mockResolvedValueOnce(
      response([
        call(tool, tool === 'start_study' || tool === 'advance_topic' ? { focusUserId: null } : {}),
      ]),
    );
    await test.run();
    expect(test.services.studyCommands.execute).toHaveBeenCalledExactlyOnceWith(actor, {
      studyId: id(2),
      command: expect.objectContaining({
        type: command,
        expectedTopicId,
        expectedTransitionVersion: 7,
        commandId: expect.stringMatching(/^[\da-f-]{36}$/),
      }),
    });
    expect(test.services.chat.complete).toHaveBeenCalledWith(
      id(3),
      expect.objectContaining({
        commandResults: [expect.objectContaining({ outcome: 'applied' })],
      }),
    );
  });

  it('keeps the reserved target after state reads and multiple commands', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('get_study_context'),
        call('advance_topic', { focusUserId: null }),
        call('finish_study'),
      ]),
    );
    test.snapshot.study.currentTopicId = id(44);
    test.snapshot.study.transitionVersion = 100;
    await test.run();
    for (const [_actor, input] of test.services.studyCommands.execute.mock.calls)
      expect(input.command).toMatchObject({ expectedTopicId: id(4), expectedTransitionVersion: 7 });
  });

  it('queries only the authenticated user and requests feedback at the latest revision', async () => {
    const test = setup();
    test.services.learning.list.mockResolvedValue([
      { id: id(70), ownerUserId: actor.userId },
      { id: id(71), ownerUserId: id(9) },
    ]);
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('list_my_learning', { query: 'queue' }),
        call('request_sentence_feedback', { utteranceId: id(50) }),
      ]),
    );
    await test.run();
    expect(test.services.learning.list).toHaveBeenCalledExactlyOnceWith(actor, 'queue');
    expect(test.services.feedback.start).toHaveBeenCalledExactlyOnceWith(
      actor,
      id(50),
      12,
      expect.any(String),
    );
    expect(JSON.stringify(test.resultInputs())).toContain(id(70));
    expect(JSON.stringify(test.resultInputs())).not.toContain(id(71));
  });

  it('rejects another topic sentence without starting feedback', async () => {
    const test = setup();
    test.services.feedback.getUtterance.mockResolvedValue({
      id: id(50),
      studyId: id(2),
      topicId: id(88),
      correctionRevision: 12,
    });
    test.provider.respond.mockResolvedValueOnce(
      response([call('request_sentence_feedback', { utteranceId: id(50) })]),
    );
    await test.run();
    expect(test.services.feedback.start).not.toHaveBeenCalled();
    expect(test.resultInputs()).toContainEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'STALE_TOPIC' }),
      }),
    );
  });

  it('strictly rejects injected actor args and unknown consent tools', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('explain_word', { word: 'queue', context: null, userId: id(9) }),
        call('decide_share', { accepted: true }),
      ]),
    );
    await test.run();
    expect(test.services.learning.saveFromChat).not.toHaveBeenCalled();
    expect(test.services.sharing.decide).not.toHaveBeenCalled();
    expect(
      test.resultInputs().every((result) => !result.ok && result.error?.code === 'INVALID_INPUT'),
    ).toBe(true);
  });

  it('asks for a handle when a participant name is ambiguous', async () => {
    const test = setup({ text: '민수 경험으로 다음 주제 만들어줘' });
    test.snapshot.study.members.push(
      { userId: id(8), displayName: '민수', handle: 'm1', state: 'joined' },
      { userId: id(9), displayName: '민수', handle: 'm2', state: 'joined' },
    );
    test.provider.respond.mockResolvedValueOnce(
      response([call('advance_topic', { focusUserId: id(8) })]),
    );
    await test.run();
    expect(test.services.studyCommands.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(test.resultInputs())).toContain('AMBIGUOUS_PARTICIPANT');
    expect(JSON.stringify(test.resultInputs())).toContain('m1');
    expect(JSON.stringify(test.resultInputs())).toContain('m2');
  });

  it('rejects a nonmember focus and permits an explicitly chosen handle', async () => {
    const test = setup({ text: '@m1 경험으로 다음 주제 만들어줘' });
    test.snapshot.study.members.push(
      { userId: id(8), displayName: '민수', handle: 'm1', state: 'joined' },
      { userId: id(9), displayName: '민수', handle: 'm2', state: 'joined' },
    );
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('advance_topic', { focusUserId: id(88) }, 'bad'),
        call('advance_topic', { focusUserId: id(8) }, 'good'),
      ]),
    );
    await test.run();
    expect(test.services.studyCommands.execute).toHaveBeenCalledOnce();
    expect(test.services.studyCommands.execute.mock.calls[0]![1].command.focusUserId).toBe(id(8));
  });

  it('canonicalizes mutation args and does not retry failed or successful mutations', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('explain_word', { word: 'queue', context: null }, 'a'),
        {
          ...call('explain_word'),
          call_id: 'b',
          arguments: '{ "context": null, "word": "queue" }',
        },
        call('finish_study', {}, 'c'),
        call('finish_study', {}, 'd'),
      ]),
    );
    test.services.studyCommands.execute.mockRejectedValue(new Error('secret SQL password'));
    await test.run();
    expect(test.services.learning.saveFromChat).toHaveBeenCalledOnce();
    expect(test.services.studyCommands.execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(test.resultInputs())).not.toContain('secret SQL');
  });

  it('prevents a reused call id from changing args, including an id first seen on a cache hit', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('explain_word', { word: 'queue', context: null }, 'a'),
        call('explain_word', { word: 'queue', context: null }, 'b'),
        call('explain_word', { word: 'other', context: null }, 'b'),
      ]),
    );
    await test.run();
    expect(test.services.learning.saveFromChat).toHaveBeenCalledOnce();
    expect(test.resultInputs()).toContainEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_INPUT' }) }),
    );
  });

  it('refreshes successful reads with a new call id after a write', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([
        call('list_my_learning', { query: null }, 'a'),
        call('explain_word', { word: 'queue', context: null }),
        call('list_my_learning', { query: null }, 'b'),
      ]),
    );
    await test.run();
    expect(test.services.learning.list).toHaveBeenCalledTimes(2);
  });

  it('stops after six responses and retains successful saves in a failed message', async () => {
    const test = setup();
    test.provider.respond.mockImplementation(async () =>
      response([call('explain_word', { word: 'queue', context: null })]),
    );
    await expect(test.run()).rejects.toThrow('AI_FAILED');
    expect(test.provider.respond).toHaveBeenCalledTimes(6);
    expect(test.services.learning.saveFromChat).toHaveBeenCalledOnce();
    expect(test.services.chat.fail).toHaveBeenCalledWith(
      id(3),
      expect.objectContaining({ code: 'AI_FAILED' }),
      expect.objectContaining({ learningItemIds: [id(31)] }),
    );
    expect(test.services.chat.complete).not.toHaveBeenCalled();
  });

  it('does not save late model output after the job becomes terminal', async () => {
    const test = setup();
    test.provider.respond.mockResolvedValueOnce(
      response([call('explain_word', { word: 'queue', context: null })]),
    );
    test.provider.structured.mockImplementation(async () => {
      test.services.jobs.isRunning.mockResolvedValue(false);
      return { expression: 'queue', meaning: '줄', example: 'Join the queue.' };
    });
    await expect(test.run()).rejects.toThrow('PROCESS_INTERRUPTED');
    expect(test.services.learning.saveFromChat).not.toHaveBeenCalled();
    expect(test.services.chat.complete).not.toHaveBeenCalled();
  });

  it('keeps foreign private history and raw transcript out of model inputs', async () => {
    const test = setup({
      history: [
        message({ ownerUserId: id(9), text: 'FOREIGN_PRIVATE' }),
        message({ studyId: id(8), text: 'OTHER_STUDY_PRIVATE' }),
        message({ text: 'OWN_CONTEXT' }),
      ],
    });
    test.snapshot.segments = [{ rawText: 'UNTRUSTED_RAW' }] as StudySnapshot['segments'];
    await test.run();
    const input = JSON.stringify(test.provider.respond.mock.calls[0]![0]);
    expect(input).toContain('OWN_CONTEXT');
    expect(input).not.toMatch(/FOREIGN_PRIVATE|OTHER_STUDY_PRIVATE|UNTRUSTED_RAW/);
  });
});

describe('server-side natural language sharing decisions', () => {
  it.each([
    ['yes', true],
    ['네', true],
    ['no', false],
    ['아니요', false],
  ] as const)(
    'accepts direct %s only for the immediately preceding sole pending proposal',
    async (text, accepted) => {
      const test = setup({ text, history: [message({ shareProposalId: id(20) })] });
      test.services.sharing.listPending.mockResolvedValue([proposal()]);
      await test.run();
      expect(test.services.sharing.decide).toHaveBeenCalledExactlyOnceWith(actor, {
        proposalId: id(20),
        accepted,
        commandId: expect.any(String),
      });
      expect(test.provider.respond).not.toHaveBeenCalled();
    },
  );

  it.each(['multiple', 'unrelated-latest', 'late-proposal', 'foreign-proposal'] as const)(
    'does not infer consent for %s',
    async (scenario) => {
      const test = setup({ text: 'yes', history: [message({ shareProposalId: id(20) })] });
      test.services.sharing.listPending.mockResolvedValue([proposal()]);
      if (scenario === 'multiple')
        test.services.sharing.listPending.mockResolvedValue([proposal(), proposal({ id: id(21) })]);
      if (scenario === 'unrelated-latest')
        test.context.history.push(
          message({ id: id(11), text: '다른 답변', shareProposalId: null }),
        );
      if (scenario === 'late-proposal')
        test.services.sharing.listPending.mockResolvedValue([proposal({ id: id(21) })]);
      if (scenario === 'foreign-proposal')
        test.services.sharing.listPending.mockResolvedValue([proposal({ ownerUserId: id(9) })]);
      await test.run();
      expect(test.services.sharing.decide).not.toHaveBeenCalled();
      expect(test.services.chat.complete).toHaveBeenCalledWith(
        id(3),
        expect.objectContaining({ text: expect.stringContaining('표현') }),
      );
    },
  );

  it.each(['yes, but do not share', '"yes"라는 뜻?', 'yes no'])(
    'does not treat %s as consent',
    async (text) => {
      const test = setup({ text, history: [message({ shareProposalId: id(20) })] });
      test.services.sharing.listPending.mockResolvedValue([proposal()]);
      await test.run();
      expect(test.services.sharing.decide).not.toHaveBeenCalled();
      expect(test.provider.respond).toHaveBeenCalledOnce();
    },
  );
});
