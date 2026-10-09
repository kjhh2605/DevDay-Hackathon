import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { capture } from './helpers.js';

export const isLayoutVariant = (info: TestInfo) => info.project.name === 'layout-perturbed';

const css = `
div:has(> aside[aria-label="개인 챗봇"]) {
  grid-template-columns: minmax(0, 1fr) 440px !important;
}
:where(div:has(> section[aria-label="공통 대화 주제"]) > *) { order: 10 !important; }
section[aria-label="문장별 대화 검토"] { order: 20 !important; }
section[aria-label="공통 대화 주제"] { order: 30 !important; }
div:has(> section[aria-label="공통 대화 주제"]) > footer { order: 40 !important; }
footer > div:has(> button + button) { flex-direction: row-reverse !important; }
`;

async function evidence(info: TestInfo, name: string, measurement: unknown) {
  const content = JSON.stringify(measurement, null, 2);
  await info.attach(name, { body: content, contentType: 'application/json' });
  const directory = new URL('../../.local/validation/layout-independence/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`${info.file.split('/').at(-1)}-${name}.json`, directory), content);
}

/** Runtime-only stylesheet; no product DOM handlers, DTOs, API requests, or tools are patched. */
export async function perturbStudyLayout(page: Page, info: TestInfo, actor: string) {
  if (!isLayoutVariant(info)) return;
  await page.setViewportSize({ width: 1440, height: 1000 });
  const chat = page.getByRole('complementary', { name: '개인 챗봇' });
  const close = page.getByRole('button', { name: '주제 종료', exact: true });
  const finish = page.getByRole('button', { name: '스터디 종료 요청', exact: true });
  await expect(close).toBeVisible();
  const [chatBefore, closeBefore, finishBefore] = await Promise.all([
    chat.boundingBox(),
    close.boundingBox(),
    finish.boundingBox(),
  ]);
  expect(closeBefore!.x).toBeGreaterThan(finishBefore!.x);
  const style = await page.addStyleTag({ content: css });
  await style.evaluate((element) => element.setAttribute('data-e2e-layout-variant', 'true'));
  await expect.poll(async () => (await chat.boundingBox())!.width).toBe(440);
  const [chatAfter, closeAfter, finishAfter] = await Promise.all([
    chat.boundingBox(),
    close.boundingBox(),
    finish.boundingBox(),
  ]);
  expect(chatAfter!.width - chatBefore!.width).toBeGreaterThan(80);
  expect(closeAfter!.x).toBeLessThan(finishAfter!.x);
  await evidence(info, `${actor}-chat-and-controls`, {
    before: { chat: chatBefore, close: closeBefore, finish: finishBefore },
    after: { chat: chatAfter, close: closeAfter, finish: finishAfter },
  });
  await capture(page, `perturbed-talking-${actor}`);
}

/** Compare the same populated review in original and perturbed layouts before the real edit/advance flow. */
export async function assertReviewLayoutChanged(page: Page, info: TestInfo, actor: string) {
  if (!isLayoutVariant(info)) return;
  const style = page.locator('style[data-e2e-layout-variant]');
  const review = page.getByRole('region', { name: '문장별 대화 검토' });
  const topic = page.getByRole('region', { name: '공통 대화 주제' });
  const next = page.getByRole('button', { name: '승인하고 다음 주제', exact: true });
  const finish = page.getByRole('button', { name: '승인하고 스터디 종료', exact: true });
  await expect(review).toBeVisible();
  await style.evaluate((element) => element.setAttribute('media', 'not all'));
  const [reviewBefore, topicBefore, nextBefore, finishBefore] = await Promise.all([
    review.boundingBox(),
    topic.boundingBox(),
    next.boundingBox(),
    finish.boundingBox(),
  ]);
  expect(topicBefore!.y + topicBefore!.height).toBeLessThanOrEqual(reviewBefore!.y);
  expect(nextBefore!.x).toBeGreaterThan(finishBefore!.x);
  await style.evaluate((element) => element.setAttribute('media', 'all'));
  const [reviewAfter, topicAfter, nextAfter, finishAfter] = await Promise.all([
    review.boundingBox(),
    topic.boundingBox(),
    next.boundingBox(),
    finish.boundingBox(),
  ]);
  expect(reviewAfter!.y + reviewAfter!.height).toBeLessThanOrEqual(topicAfter!.y);
  expect(nextAfter!.x).toBeLessThan(finishAfter!.x);
  await evidence(info, `${actor}-review-order`, {
    before: { review: reviewBefore, topic: topicBefore, next: nextBefore, finish: finishBefore },
    after: { review: reviewAfter, topic: topicAfter, next: nextAfter, finish: finishAfter },
  });
  await capture(page, `perturbed-review-${actor}`);
}
