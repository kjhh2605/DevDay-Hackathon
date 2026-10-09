import { expect, test } from '@playwright/test';
import { capture, createAndJoin, register, snapshot } from './helpers.js';

test('A01/A02: duplicate registration, invitation on learning screen, and context-required start', async ({
  browser,
  baseURL,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'environment',
    description:
      'Real PostgreSQL/API; AI_MODE=mock. Independent browser contexts, not physical laptops.',
  });
  const aContext = await browser.newContext({ baseURL });
  const bContext = await browser.newContext({ baseURL });
  const duplicateContext = await browser.newContext({ baseURL });
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const aUser = await register(a, 'A 사용자');
    const bUser = await register(b, 'B 사용자');
    expect(aUser.id).not.toBe(bUser.id);

    await test.step('the UI rejects an existing handle without identifying a new user', async () => {
      const duplicate = await duplicateContext.newPage();
      await duplicate.goto('/study');
      await capture(duplicate, 'registration');
      await duplicate.getByRole('textbox', { name: '이름', exact: true }).fill('중복 사용자');
      await duplicate.getByRole('textbox', { name: '아이디', exact: true }).fill(aUser.handle);
      const response = duplicate.waitForResponse(
        (res) => res.url().endsWith('/api/v1/auth/register') && res.request().method() === 'POST',
      );
      await duplicate.getByRole('button', { name: '시작하기', exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(409);
      expect((await result.json()).error.code).toBe('HANDLE_TAKEN');
      await expect(duplicate.getByRole('alert')).toBeVisible();
      expect((await duplicate.request.get('/api/v1/me')).status()).toBe(401);
    });

    await b.getByRole('tab', { name: '나의 학습', exact: true }).click();
    const beforeInvitation = b.url();
    const studyId = await createAndJoin(a, b, bUser.handle);
    expect(beforeInvitation).toContain('/learning');
    const [aSnapshot, bSnapshot] = await Promise.all([snapshot(a, studyId), snapshot(b, studyId)]);
    expect(aSnapshot.study).toEqual(bSnapshot.study);
    expect(aSnapshot.study.members.every((member) => member.state === 'joined')).toBe(true);

    const response = a.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/studies/${studyId}/commands`) &&
        res.request().method() === 'POST',
    );
    await a.getByRole('button', { name: '첫 주제 시작', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(422);
    expect((await result.json()).error.code).toBe('CONTEXT_REQUIRED');
    await expect(a.getByRole('alert')).toContainText(/경험/);
    await capture(a, 'context-required');
    const after = await snapshot(b, studyId);
    expect(after.study.status).toBe('waiting');
    expect(after.topic).toBeNull();
  } finally {
    await Promise.all([aContext.close(), bContext.close(), duplicateContext.close()]);
  }
});
