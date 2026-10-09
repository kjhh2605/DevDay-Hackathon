import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommandResult, LearningItem, Topic } from '../../packages/contracts/src/dto.js';
import { capture, createAndJoin, register, responseData, snapshot } from './helpers.js';
import { sendSyntheticSegment } from './synthetic-audio.js';

async function fixtureState(page: Page, studyId: string) {
  const response = await page.request.get(`/api/__e2e/failure-state/${studyId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    calls: { image: number; feedback: number };
    topics: Topic[];
  };
}

async function learning(page: Page) {
  return responseData<LearningItem[]>(await page.request.get('/api/v1/me/learning-items'));
}

test('E07: real adapter failures remain failed until explicit retry without repeating approval or learning', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  testInfo.annotations.push({
    type: 'environment',
    description:
      'Real PostgreSQL/API/events/Chromium; test-only failing MockAiProvider. Two browser contexts, synthetic PCM, no physical microphones or OpenAI evidence.',
  });
  const aContext = await browser.newContext({ baseURL });
  const bContext = await browser.newContext({ baseURL });
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const aUser = await register(a, '실패 검증 A');
    const bUser = await register(b, '실패 검증 B');
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
    expect(firstTopic.ordinal).toBe(1);
    await sendSyntheticSegment(a, studyId, firstTopic.id);

    await test.step('feedback shows running then failed on both browsers and persists without auto retry', async () => {
      await b.getByRole('button', { name: '주제 종료', exact: true }).click();
      await expect
        .poll(async () =>
          (await snapshot(a, studyId)).jobs.some(
            (job) => job.kind === 'utterance.feedback' && job.status === 'running',
          ),
        )
        .toBe(true);
      for (const page of [a, b]) {
        await expect(
          page.getByRole('status').filter({ hasText: '잠시만요, 준비하고 있어요.' }),
        ).toBeVisible();
        await expect(
          page.getByText('마지막 발화까지 담고, 문장별 피드백을 정리하고 있어요.'),
        ).toBeVisible();
      }
      await capture(a, 'e07-feedback-running');
      for (const page of [a, b]) {
        await expect(page.getByRole('region', { name: '문장별 대화 검토' })).toBeVisible();
        await expect(page.getByText('생성 실패', { exact: true })).toBeVisible();
        await expect(page.getByRole('alert')).toContainText('AI 처리에 실패했습니다.');
      }
      await capture(a, 'e07-feedback-failed');
      const failed = await snapshot(a, studyId);
      expect(failed.topic?.state).toBe('review');
      expect(failed.feedback).toHaveLength(1);
      expect(failed.feedback[0]).toMatchObject({ status: 'failed', error: { code: 'AI_FAILED' } });
      const feedbackJobs = failed.jobs.filter((job) => job.kind === 'utterance.feedback');
      expect(feedbackJobs).toHaveLength(1);
      expect(feedbackJobs[0]).toMatchObject({
        status: 'failed',
        error: { code: 'AI_FAILED' },
        result: null,
      });
      expect(feedbackJobs[0]!.finishedAt).toBeTruthy();
      for (let observation = 0; observation < 5; observation++) {
        await a.waitForTimeout(300);
        expect((await fixtureState(a, studyId)).calls.feedback).toBe(1);
        expect(
          (await snapshot(b, studyId)).jobs.filter((job) => job.kind === 'utterance.feedback'),
        ).toEqual(feedbackJobs);
      }
      expect(await learning(a)).toEqual([]);
      expect(await learning(b)).toEqual([]);

      await b.getByRole('button', { name: '이 문장 피드백 재요청', exact: true }).click();
      for (const page of [a, b])
        await expect(
          page
            .getByRole('region', { name: '문장별 대화 검토' })
            .getByText('생성 중', { exact: true }),
        ).toBeVisible();
      await capture(b, 'e07-feedback-explicit-retry');
      for (const page of [a, b])
        await expect(page.getByText('최신 보정문 기준', { exact: true })).toBeVisible();
      const retried = await snapshot(a, studyId);
      expect(retried.feedback[0]?.status).toBe('ready');
      expect(
        retried.jobs
          .filter((job) => job.kind === 'utterance.feedback')
          .map((job) => job.status)
          .sort(),
      ).toEqual(['failed', 'succeeded']);
      expect((await fixtureState(a, studyId)).calls.feedback).toBe(2);
      expect(await learning(a)).toEqual([]);
    });

    const review = await snapshot(a, studyId);
    const next = (page: Page) =>
      page.request.post(`/api/v1/studies/${studyId}/commands`, {
        data: {
          type: 'topic.advance',
          commandId: randomUUID(),
          expectedTopicId: firstTopic.id,
          expectedTransitionVersion: review.study.transitionVersion,
          focusUserId: null,
        },
      });
    const responses = await Promise.all([next(a), next(b)]);
    expect(responses.map((response) => response.status()).sort()).toEqual([202, 409]);
    const applied = await responseData<CommandResult>(responses.find((response) => response.ok())!);
    expect(applied.outcome).toBe('applied');
    expect((await responses.find((response) => response.status() === 409)!.json()).error.code).toBe(
      'STALE_TOPIC',
    );

    await test.step('concurrent next reserves one active image job, whose adapter fails visibly', async () => {
      for (const page of [a, b]) {
        await expect(
          page.getByRole('heading', { name: '우리에게 맞는 주제를 준비하고 있어요' }),
        ).toBeVisible();
        await expect(
          page.getByRole('status').filter({ hasText: '잠시만요, 준비하고 있어요.' }),
        ).toBeVisible();
      }
      const generating = await snapshot(a, studyId);
      expect(generating.topic).toMatchObject({ ordinal: 2, state: 'generating' });
      expect(generating.topic!.id).toBe(applied.topicId);
      expect(generating.topic!.generationJobId).toBe(applied.jobId);
      expect(
        generating.jobs.filter((job) => job.kind === 'topic.generate' && job.status === 'running'),
      ).toHaveLength(1);
      expect((await fixtureState(a, studyId)).topics.map((topic) => topic.ordinal)).toEqual([1, 2]);
      await capture(a, 'e07-image-running');
      for (const page of [a, b]) {
        await expect(
          page.getByRole('heading', { name: '이번 주제를 만들지 못했어요' }),
        ).toBeVisible();
        await expect(page.getByRole('alert')).toContainText('AI 처리에 실패했습니다.');
      }
      await capture(b, 'e07-image-failed');
    });

    const failed = await snapshot(a, studyId);
    const failedTopic = failed.topic!;
    const failedJob = failed.jobs.find((job) => job.id === failedTopic.generationJobId)!;
    expect(failedTopic).toMatchObject({ ordinal: 2, state: 'failed', content: null });
    expect(failedJob).toMatchObject({
      kind: 'topic.generate',
      status: 'failed',
      error: { code: 'AI_FAILED' },
      result: null,
    });
    expect(failedJob.finishedAt).toBeTruthy();
    const approved = (await fixtureState(a, studyId)).topics[0]!;
    expect(approved).toMatchObject({ id: firstTopic.id, state: 'approved' });
    expect(approved.approvedAt).toBeTruthy();
    const saved = await learning(a);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      source: 'approved_feedback',
      ownerUserId: aUser.id,
      sourceUtteranceId: review.utterances[0]!.id,
    });
    expect(await learning(b)).toEqual([]);
    for (let observation = 0; observation < 5; observation++) {
      await a.waitForTimeout(300);
      expect((await fixtureState(a, studyId)).calls).toEqual({ image: 2, feedback: 2 });
      expect((await snapshot(a, studyId)).topic).toEqual(failedTopic);
      expect((await snapshot(b, studyId)).jobs).toEqual(failed.jobs);
    }

    await test.step('explicit same-topic retry creates a new job without another approval or learning write', async () => {
      await a.getByRole('button', { name: '같은 주제 다시 생성', exact: true }).click();
      for (const page of [a, b])
        await expect(
          page.getByRole('heading', { name: '우리에게 맞는 주제를 준비하고 있어요' }),
        ).toBeVisible();
      await expect.poll(async () => (await snapshot(b, studyId)).topic?.state).toBe('talking');
      const recovered = await snapshot(a, studyId);
      expect(recovered.topic).toMatchObject({
        id: failedTopic.id,
        ordinal: failedTopic.ordinal,
        state: 'talking',
      });
      expect(recovered.topic!.generationJobId).not.toBe(failedJob.id);
      expect(recovered.jobs.find((job) => job.id === failedJob.id)).toEqual(failedJob);
      expect(
        recovered.jobs
          .filter((job) => job.kind === 'topic.generate' && job.targetId === failedTopic.id)
          .map((job) => job.status)
          .sort(),
      ).toEqual(['failed', 'succeeded']);
      const state = await fixtureState(a, studyId);
      expect(state.calls).toEqual({ image: 3, feedback: 2 });
      expect(state.topics.map((topic) => topic.ordinal)).toEqual([1, 2]);
      expect(state.topics[0]).toEqual(approved);
      expect(await learning(a)).toEqual(saved);
      expect(await learning(b)).toEqual([]);
      for (const page of [a, b])
        await expect(page.getByRole('button', { name: '주제 종료', exact: true })).toBeVisible();
      await capture(a, 'e07-image-recovered');
      await testInfo.attach('e07-persisted-evidence.json', {
        body: JSON.stringify(
          {
            studyId,
            providerCalls: state.calls,
            topics: state.topics,
            jobs: recovered.jobs,
            savedLearning: saved,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    });
  } finally {
    await Promise.all([aContext.close(), bContext.close()]);
  }
});
