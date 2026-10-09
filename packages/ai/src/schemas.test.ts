import { describe, it, expect } from 'vitest';
import {
  assertGroundedExperience,
  selectExperienceQuestions,
  validateTopicPlan,
} from './schemas.js';
const image = {
  kind: 'image' as const,
  title: 'Busan',
  situationText: 'A trip',
  conversationInstruction: 'Describe the trip.',
  sentence: null,
  sourceExperienceIds: ['a'],
  learningExpressionIds: [] as string[],
  sharedExpressionIds: [] as string[],
  imagePrompt: 'Busan trip',
};
describe('source boundaries', () => {
  it('rejects experiences invented beyond the user source', () => {
    const actual = {
      questions: ['누구와 갔나요?'],
      summaryQuotes: ['부산에 다녀왔어요'],
      interests: ['부산'],
      context: { place: '부산', people: [], event: null, actions: [] },
    };
    expect(() => assertGroundedExperience(actual, '부산에 다녀왔어요', [])).not.toThrow();
    expect(() =>
      assertGroundedExperience(
        { ...actual, context: { ...actual.context, event: '바다에서 수영' } },
        '부산에 다녀왔어요',
        [],
      ),
    ).toThrow('UNGROUNDED');
  });
  it('permits only saved experience IDs belonging to the focused participant', () => {
    const context = {
      experiences: [
        { id: 'a', ownerUserId: 'alice' },
        { id: 'b', ownerUserId: 'bob' },
      ],
      learningExpressions: [],
      sharedExpressions: [],
      focusUserId: 'bob',
    };
    expect(() => validateTopicPlan(image, context)).toThrow('UNKNOWN_TOPIC_SOURCE');
    expect(() =>
      validateTopicPlan({ ...image, sourceExperienceIds: ['b'] }, context),
    ).not.toThrow();
  });
  it('requires expression provenance for sentence branch and excludes unknown private ids', () => {
    const context = {
      experiences: [],
      learningExpressions: [{ id: 'approved' }],
      sharedExpressions: [{ id: 'yes' }],
      focusUserId: null,
    };
    const sentence = {
      ...image,
      kind: 'sentence' as const,
      sourceExperienceIds: [],
      imagePrompt: null,
      sentence: 'I waited in line.',
      learningExpressionIds: ['approved'],
    };
    expect(() => validateTopicPlan(sentence, context)).not.toThrow();
    expect(() =>
      validateTopicPlan({ ...sentence, sharedExpressionIds: ['private-no'] }, context),
    ).toThrow('UNKNOWN_TOPIC_SOURCE');
    expect(() => validateTopicPlan({ ...sentence, learningExpressionIds: [] }, context)).toThrow(
      'SENTENCE_REQUIRES_EXPRESSION',
    );
  });
});

describe('experience question necessity', () => {
  const sparse = {
    questions: ['여행 중 어떤 일을 하셨나요?'],
    summaryQuotes: ['부산에 다녀왔어요'],
    interests: [],
    context: {
      place: '부산',
      people: [] as string[],
      event: null as string | null,
      actions: [] as string[],
    },
  };
  it('retains optional questions when only a place is known and permits skipping them', () => {
    assertGroundedExperience(sparse, '부산에 다녀왔어요', []);
    expect(selectExperienceQuestions(sparse, false)).toEqual(sparse.questions);
    expect(selectExperienceQuestions(sparse, true)).toEqual([]);
  });
  it('suppresses the live regression: an unnecessary memorable-moment question after detailed facts', () => {
    const originalText =
      '지난 토요일 오후 2시 서울숲에서 친구 민수와 3km를 걷고 도시락을 먹었어요. 제주도 여행 계획을 이야기했어요.';
    const detailed = {
      questions: ['그날 가장 기억에 남는 순간은 무엇이었나요?'],
      summaryQuotes: [originalText],
      interests: ['제주도 여행'],
      context: {
        place: '서울숲',
        people: ['친구 민수'],
        event: '제주도 여행 계획을 이야기했어요',
        actions: ['3km를 걷고', '도시락을 먹었어요'],
      },
    };
    assertGroundedExperience(detailed, originalText, []);
    expect(selectExperienceQuestions(detailed, false)).toEqual([]);
  });
  it('treats an explicit solo activity and answered gaps as sufficient context', () => {
    const completed = {
      ...sparse,
      context: { place: '부산', people: ['혼자'], event: null, actions: ['바닷가를 걸었어요'] },
    };
    assertGroundedExperience(completed, '부산에 다녀왔어요', [
      { answer: '혼자 바닷가를 걸었어요' },
    ]);
    expect(selectExperienceQuestions(completed, false)).toEqual([]);
  });
});
