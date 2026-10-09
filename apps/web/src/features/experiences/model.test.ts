import { describe, expect, it } from 'vitest';
import { answeredQuestions, emptyEditor, reviewedFields, toEditor } from './model';

describe('reviewed experience fields', () => {
  it('saves the values the person reviewed, including edits to the original and answers', () => {
    const editor = toEditor({
      id: 'draft-id',
      ownerUserId: 'owner-id',
      revision: 0,
      originalText: '부산에 다녀왔어요',
      summary: '부산 여행',
      questions: [],
      interests: ['여행'],
      context: { place: '부산', people: [], event: null, actions: [] },
      answers: [{ question: '누구와 갔나요?', answer: '친구' }],
    });
    editor.originalText = '친구와 부산을 산책했어요.';
    editor.summary = '친구와 함께한 부산 산책';
    editor.answers[0]!.answer = '친구 민지';
    editor.people = '민지';
    editor.interests = '여행, 산책, 여행';
    expect(reviewedFields(editor)).toEqual({
      originalText: '친구와 부산을 산책했어요.',
      summary: '친구와 함께한 부산 산책',
      answers: [{ question: '누구와 갔나요?', answer: '친구 민지' }],
      interests: ['여행', '산책'],
      context: { place: '부산', people: ['민지'], event: null, actions: [] },
    });
  });

  it('keeps unknown context empty rather than inventing experience details', () => {
    const editor = emptyEditor();
    editor.originalText = '부산에 다녀왔어요';
    editor.summary = '부산에 다녀온 경험';
    expect(reviewedFields(editor).context).toEqual({
      place: null,
      people: [],
      event: null,
      actions: [],
    });
  });

  it('allows all supplementary questions to be skipped, or answered selectively', () => {
    const questions = ['누구와 갔나요?', '무엇을 했나요?'];
    expect(answeredQuestions(questions, {})).toEqual([]);
    expect(
      answeredQuestions(questions, { '누구와 갔나요?': '  ', '무엇을 했나요?': '산책했어요' }),
    ).toEqual([{ question: '무엇을 했나요?', answer: '산책했어요' }]);
  });
});
