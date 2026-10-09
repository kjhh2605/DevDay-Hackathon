import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Experience } from '../../packages/contracts/src/dto.js';
import { capture, register, responseData } from './helpers.js';

test('A15/A16: skip optional questions, save reviewed experience, edit and reload with owner isolation', async ({
  browser,
  baseURL,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'environment',
    description:
      'Real PostgreSQL/API; deterministic mock experience preparation. Does not assess live model fidelity.',
  });
  const aContext = await browser.newContext({ baseURL });
  const bContext = await browser.newContext({ baseURL });
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const user = await register(a, '경험 작성자');
    const bUser = await register(b, '다른 사용자');
    await a.getByRole('tab', { name: '나의 경험', exact: true }).click();
    await a.getByRole('textbox', { name: '나의 경험', exact: true }).fill('부산에 다녀왔어요');
    await a.getByRole('button', { name: '경험 정리하기', exact: true }).click();
    await expect(a.getByRole('region', { name: '선택 보충 질문' })).toBeVisible();
    await capture(a, 'experience-questions');
    await a.getByRole('button', { name: '답변 없이 계속하기', exact: true }).click();
    await expect(a.getByRole('textbox', { name: '경험 원문', exact: true })).toHaveValue(
      '부산에 다녀왔어요',
    );
    const reviewedSummary = '부산 여행 경험을 영어 대화로 나누고 싶다.';
    await a.getByRole('textbox', { name: '정리된 경험', exact: true }).fill(reviewedSummary);
    await a.getByRole('textbox', { name: '관심사', exact: true }).fill('여행, 영어');
    await capture(a, 'experience-review');
    await a.getByRole('button', { name: '확인하고 저장', exact: true }).click();
    await expect(a.getByRole('status').filter({ hasText: '경험을 저장했어요' })).toBeVisible();
    const stored = await responseData<Experience[]>(await a.request.get('/api/v1/me/experiences'));
    expect(stored).toHaveLength(1);
    const experience = stored[0]!;
    expect(experience).toMatchObject({
      ownerUserId: user.id,
      originalText: '부산에 다녀왔어요',
      summary: reviewedSummary,
      answers: [],
      interests: ['여행', '영어'],
    });

    await a.reload();
    await a.getByRole('button', { name: `${reviewedSummary} 경험 수정`, exact: true }).click();
    const editedSummary = '부산에 다녀온 이야기를 다음 스터디에서 나누고 싶다.';
    await a.getByRole('textbox', { name: '정리된 경험', exact: true }).fill(editedSummary);
    await a
      .getByRole('textbox', { name: '경험 원문', exact: true })
      .fill('부산 해운대에 다녀왔어요');
    await a.getByRole('textbox', { name: '장소', exact: true }).fill('부산 해운대');
    await a.getByRole('textbox', { name: '관심사', exact: true }).fill('여행, 바다');
    await a.getByRole('button', { name: '확인하고 저장', exact: true }).click();
    await expect(a.getByRole('status').filter({ hasText: '경험을 저장했어요' })).toBeVisible();
    await a.reload();
    await expect(
      a.getByRole('button', { name: `${editedSummary} 경험 수정`, exact: true }),
    ).toBeVisible();
    await capture(a, 'experience-cards');
    const reloaded = await responseData<Experience[]>(
      await a.request.get('/api/v1/me/experiences'),
    );
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({
      id: experience.id,
      summary: editedSummary,
      originalText: '부산 해운대에 다녀왔어요',
      interests: ['여행', '바다'],
      context: { place: '부산 해운대' },
    });
    expect(reloaded[0]!.revision).toBeGreaterThan(experience.revision);

    await b.getByRole('tab', { name: '나의 경험', exact: true }).click();
    await expect(b.getByText(editedSummary, { exact: true })).toHaveCount(0);
    expect(await responseData<Experience[]>(await b.request.get('/api/v1/me/experiences'))).toEqual(
      [],
    );
    const forbidden = await b.request.patch(`/api/v1/me/experiences/${experience.id}`, {
      data: {
        originalText: experience.originalText,
        answers: [],
        summary: '다른 사용자의 수정 시도',
        interests: [],
        context: experience.context,
        commandId: randomUUID(),
      },
    });
    expect([403, 404]).toContain(forbidden.status());
    expect(
      (await responseData<Experience[]>(await a.request.get('/api/v1/me/experiences')))[0]!.summary,
    ).toBe(editedSummary);

    await test.step('sufficient experience goes directly to review and remains separate', async () => {
      const detailed =
        '지난 주말 친구 민지와 부산 해운대 시장에 갔다. 점심으로 국밥을 먹고 바닷가를 걸으며 다음 여행 계획을 이야기했다.';
      await b.getByRole('textbox', { name: '나의 경험', exact: true }).fill(detailed);
      await b.getByRole('button', { name: '경험 정리하기', exact: true }).click();
      await expect(b.getByRole('textbox', { name: '경험 원문', exact: true })).toHaveValue(
        detailed,
      );
      await expect(b.getByRole('region', { name: '선택 보충 질문' })).toHaveCount(0);
      await expect(b.getByRole('textbox', { name: '정리된 경험', exact: true })).not.toHaveValue(
        '',
      );
      await b.getByRole('button', { name: '확인하고 저장', exact: true }).click();
      await expect(b.getByRole('status').filter({ hasText: '경험을 저장했어요' })).toBeVisible();
      const bStored = await responseData<Experience[]>(
        await b.request.get('/api/v1/me/experiences'),
      );
      expect(bStored).toHaveLength(1);
      expect(bStored[0]).toMatchObject({
        ownerUserId: bUser.id,
        originalText: detailed,
        answers: [],
      });
      expect(bStored[0]!.id).not.toBe(experience.id);
      expect(
        await responseData<Experience[]>(await a.request.get('/api/v1/me/experiences')),
      ).toHaveLength(1);
    });

    await test.step('skipping remaining questions preserves an answer already typed', async () => {
      await b.getByRole('button', { name: '새 경험 쓰기', exact: true }).click();
      await b.getByRole('textbox', { name: '나의 경험', exact: true }).fill('부산에 다녀왔어요');
      await b.getByRole('button', { name: '경험 정리하기', exact: true }).click();
      const questions = b.getByRole('region', { name: '선택 보충 질문' });
      const answer = '해변에 앉아 파도 소리를 들었어요.';
      await questions.getByRole('textbox').first().fill(answer);
      await b.getByRole('button', { name: '남은 질문 건너뛰기', exact: true }).click();
      await expect(b.getByRole('textbox', { name: '정리된 경험', exact: true })).not.toHaveValue(
        '',
      );
      await b.getByRole('button', { name: '확인하고 저장', exact: true }).click();
      await expect(b.getByRole('status').filter({ hasText: '경험을 저장했어요' })).toBeVisible();
      const records = await responseData<Experience[]>(
        await b.request.get('/api/v1/me/experiences'),
      );
      expect(records).toHaveLength(2);
      const withAnswer = records.find((item) => item.originalText === '부산에 다녀왔어요')!;
      expect(withAnswer.answers).toHaveLength(1);
      expect(withAnswer.answers[0]!.answer).toBe(answer);
      expect(withAnswer.answers[0]!.question).toBeTruthy();
    });
  } finally {
    await Promise.all([aContext.close(), bContext.close()]);
  }
});
