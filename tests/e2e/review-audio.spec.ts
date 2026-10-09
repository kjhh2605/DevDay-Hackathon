import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { ChatMessage, LearningItem } from '../../packages/contracts/src/dto.js';
import { capture, createAndJoin, register, responseData, snapshot } from './helpers.js';
import { sendSyntheticSegment } from './synthetic-audio.js';
import { assertReviewLayoutChanged, perturbStudyLayout } from './layout-variant.js';

test('synthetic PCM: live rows, peer correction, feedback revision, concurrent next and speaker-owned approval', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  testInfo.annotations.push({
    type: 'environment',
    description:
      'Actual /ws/audio and PostgreSQL; 200ms synthetic tone and explicit mock transcription/feedback. No microphone or recognition-quality evidence.',
  });
  const aContext = await browser.newContext({ baseURL });
  const bContext = await browser.newContext({ baseURL });
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const aUser = await register(a, '음성 A');
    const bUser = await register(b, '음성 B');
    await a.getByRole('tab', { name: '나의 경험', exact: true }).click();
    await a.getByRole('textbox', { name: '나의 경험', exact: true }).fill('부산에 다녀왔어요');
    await a.getByRole('button', { name: '경험 정리하기', exact: true }).click();
    await a.getByRole('button', { name: '답변 없이 계속하기', exact: true }).click();
    await a.getByRole('button', { name: '확인하고 저장', exact: true }).click();
    await expect(a.getByRole('status').filter({ hasText: '경험을 저장했어요' })).toBeVisible();
    const studyId = await createAndJoin(a, b, bUser.handle);
    await a.getByRole('button', { name: '첫 주제 시작', exact: true }).click();
    await expect.poll(async () => (await snapshot(a, studyId)).topic?.state).toBe('talking');
    const firstTopic = (await snapshot(a, studyId)).topic!;
    await perturbStudyLayout(a, testInfo, 'A');
    await perturbStudyLayout(b, testInfo, 'B');
    const [aSegmentId, bSegmentId] = await Promise.all([
      sendSyntheticSegment(a, studyId, firstTopic.id),
      sendSyntheticSegment(b, studyId, firstTopic.id),
    ]);
    const recorded = await snapshot(a, studyId);
    expect(recorded.segments).toHaveLength(2);
    expect(recorded.segments.find((segment) => segment.id === aSegmentId)?.speakerUserId).toBe(
      aUser.id,
    );
    expect(recorded.segments.find((segment) => segment.id === bSegmentId)?.speakerUserId).toBe(
      bUser.id,
    );
    await expect(a.getByRole('region', { name: '실시간 원문과 인식 보정' })).toContainText(
      '[Mock AI] I enjoy learning English.',
    );
    await expect(b.getByRole('region', { name: '실시간 원문과 인식 보정' })).toContainText(
      '[Mock AI] I enjoy learning English.',
    );
    await capture(a, 'synthetic-live-transcript');

    await b.getByRole('button', { name: '주제 종료', exact: true }).click();
    const reviewA = a.getByRole('region', { name: '문장별 대화 검토' });
    const reviewB = b.getByRole('region', { name: '문장별 대화 검토' });
    await expect(reviewA.getByRole('article')).toHaveCount(2);
    await expect(reviewB.getByRole('article')).toHaveCount(2);
    await assertReviewLayoutChanged(a, testInfo, 'A');
    await assertReviewLayoutChanged(b, testInfo, 'B');
    const before = await snapshot(a, studyId);
    const utteranceA = before.utterances.find((item) => item.speakerUserId === aUser.id)!;
    const utteranceB = before.utterances.find((item) => item.speakerUserId === bUser.id)!;
    expect(utteranceA.sourceRanges.map((range) => range.segmentId)).toEqual([aSegmentId]);
    expect(utteranceB.sourceRanges.map((range) => range.segmentId)).toEqual([bSegmentId]);
    const originalOtherFeedback = before.feedback.find(
      (item) => item.utteranceId === utteranceB.id,
    )!;
    const originalFeedback = before.feedback.find((item) => item.utteranceId === utteranceA.id)!;
    expect(originalFeedback.items.length).toBeGreaterThan(0);
    const aRowOnB = reviewB
      .getByRole('article')
      .filter({ has: b.getByText(aUser.displayName, { exact: true }) });
    await aRowOnB
      .getByRole('button', { name: originalFeedback.items[0]!.summary, exact: true })
      .click();
    await expect(
      aRowOnB.getByText(originalFeedback.items[0]!.explanation, { exact: true }),
    ).toBeVisible();
    await aRowOnB
      .getByRole('button', { name: `${aUser.displayName} 문장 보정문 수정`, exact: true })
      .click();
    const edited = '[Mock input] I enjoy learning English with my friend.';
    await aRowOnB.getByRole('textbox', { name: '인식 보정문 수정', exact: true }).fill(edited);
    await aRowOnB.getByRole('button', { name: '보정문 저장', exact: true }).click();
    const aRowOnA = reviewA
      .getByRole('article')
      .filter({ has: a.getByText(aUser.displayName, { exact: true }) });
    for (const row of [aRowOnA, aRowOnB]) {
      await expect(row.getByText(edited, { exact: true })).toBeVisible();
      await expect(row.getByText('수정됨 · 재요청 필요', { exact: true })).toBeVisible();
    }
    const stale = await snapshot(a, studyId);
    const editedUtterance = stale.utterances.find((item) => item.id === utteranceA.id)!;
    expect(editedUtterance.rawText).toBe(utteranceA.rawText);
    expect(editedUtterance.correctionRevision).toBeGreaterThan(utteranceA.correctionRevision);
    expect(stale.feedback.find((item) => item.utteranceId === utteranceA.id)?.status).toBe('stale');
    await aRowOnB.getByRole('button', { name: '이 문장 피드백 재요청', exact: true }).click();
    await expect(aRowOnA.getByText('최신 보정문 기준', { exact: true })).toBeVisible();
    const reviewed = await snapshot(a, studyId);
    expect(reviewed.feedback.find((item) => item.utteranceId === utteranceA.id)).toMatchObject({
      status: 'ready',
      inputCorrectionRevision: editedUtterance.correctionRevision,
    });
    expect(reviewed.feedback.find((item) => item.utteranceId === utteranceB.id)).toEqual(
      originalOtherFeedback,
    );
    expect(
      await responseData<LearningItem[]>(await a.request.get('/api/v1/me/learning-items')),
    ).toEqual([]);
    expect(
      await responseData<LearningItem[]>(await b.request.get('/api/v1/me/learning-items')),
    ).toEqual([]);
    await capture(a, 'review-populated');

    const command = {
      type: 'topic.advance',
      expectedTopicId: firstTopic.id,
      expectedTransitionVersion: reviewed.study.transitionVersion,
      focusUserId: null,
    };
    const results = await Promise.all([
      a.request.post(`/api/v1/studies/${studyId}/commands`, {
        data: { ...command, commandId: randomUUID() },
      }),
      b.request.post(`/api/v1/studies/${studyId}/commands`, {
        data: { ...command, commandId: randomUUID() },
      }),
    ]);
    expect(results.map((response) => response.status()).sort()).toEqual([202, 409]);
    expect((await results.find((response) => response.status() === 409)!.json()).error.code).toBe(
      'STALE_TOPIC',
    );
    await expect.poll(async () => (await snapshot(a, studyId)).topic?.state).toBe('talking');
    const second = await snapshot(a, studyId);
    expect(second.topic!.ordinal).toBe(2);
    expect(second.jobs.filter((job) => job.kind === 'topic.generate')).toHaveLength(2);
    expect(
      second.jobs.filter(
        (job) => job.kind === 'topic.generate' && job.targetId === second.topic!.id,
      ),
    ).toHaveLength(1);
    const [aLearning, bLearning] = await Promise.all([
      responseData<LearningItem[]>(await a.request.get('/api/v1/me/learning-items')),
      responseData<LearningItem[]>(await b.request.get('/api/v1/me/learning-items')),
    ]);
    expect(aLearning).toHaveLength(1);
    expect(bLearning).toHaveLength(1);
    expect(aLearning[0]).toMatchObject({
      ownerUserId: aUser.id,
      source: 'approved_feedback',
      sourceUtteranceId: utteranceA.id,
    });
    expect(bLearning[0]).toMatchObject({
      ownerUserId: bUser.id,
      source: 'approved_feedback',
      sourceUtteranceId: utteranceB.id,
    });
    expect(new Set([...aLearning, ...bLearning].map((item) => item.sourceKey)).size).toBe(2);

    await sendSyntheticSegment(a, studyId, second.topic!.id);
    await b.getByRole('button', { name: '스터디 종료 요청', exact: true }).click();
    await expect(reviewA.getByRole('article')).toHaveCount(1);
    const finalReview = await snapshot(a, studyId);
    expect(finalReview.study.status).toBe('active');
    expect(finalReview.topic!.state).toBe('review');
    expect(
      await responseData<LearningItem[]>(await a.request.get('/api/v1/me/learning-items')),
    ).toHaveLength(1);
    await a.getByRole('button', { name: '승인하고 스터디 종료', exact: true }).click();
    await expect.poll(async () => (await snapshot(b, studyId)).study.status).toBe('ended');
    const finalItems = await responseData<LearningItem[]>(
      await a.request.get('/api/v1/me/learning-items'),
    );
    expect(finalItems).toHaveLength(2);
    expect(
      finalItems.some((item) => item.sourceUtteranceId === finalReview.utterances[0]!.id),
    ).toBe(true);
    expect(
      await responseData<LearningItem[]>(await b.request.get('/api/v1/me/learning-items')),
    ).toHaveLength(1);
    // Add a genuine persisted chat-origin item in a new waiting study for the mixed-source record view.
    await a.getByRole('button', { name: '새 스터디 만들기', exact: true }).click();
    const newStudyId = await createAndJoin(a, b, bUser.handle);
    expect(newStudyId).not.toBe(studyId);
    await a
      .getByRole('textbox', { name: '개인 챗봇에게 요청', exact: true })
      .fill('resilient 단어 뜻 알려줘');
    await a.getByRole('button', { name: '보내기', exact: true }).click();
    await expect
      .poll(async () =>
        (
          await responseData<ChatMessage[]>(
            await a.request.get(`/api/v1/studies/${newStudyId}/chat/messages`),
          )
        ).some((message) => message.role === 'assistant' && message.status === 'succeeded'),
      )
      .toBe(true);
    await a.getByRole('tab', { name: '나의 학습', exact: true }).click();
    const learning = a.getByRole('region', { name: '저장된 학습 표현' });
    await expect(learning.getByRole('heading', { level: 2 })).toHaveCount(3);
    await capture(a, 'learning-loaded-mixed-sources');
    await a
      .getByRole('group', { name: '학습 기록 출처' })
      .getByRole('button', { name: '스터디 피드백', exact: true })
      .click();
    await expect(learning.getByRole('heading', { level: 2 })).toHaveCount(2);
    await a
      .getByRole('group', { name: '학습 기록 출처' })
      .getByRole('button', { name: '개인 챗봇', exact: true })
      .click();
    await expect(learning.getByRole('heading', { name: 'resilient', exact: true })).toBeVisible();
    await expect(learning.getByRole('heading', { level: 2 })).toHaveCount(1);
  } finally {
    await Promise.all([aContext.close(), bContext.close()]);
  }
});
