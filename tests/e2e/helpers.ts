import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import type { Study, StudySnapshot, User } from '../../packages/contracts/src/dto.js';

export const uniqueHandle = (label: string) => `e2e-${label}-${randomUUID().slice(0, 12)}`;

export async function responseData<T>(response: APIResponse): Promise<T> {
  expect(
    response.ok(),
    `${response.status()} ${response.url()}: ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as { data: T; requestId: string };
  expect(body.requestId).toBeTruthy();
  return body.data;
}

export async function register(page: Page, displayName: string, handle = uniqueHandle('user')) {
  await page.goto('/study');
  await page.getByRole('textbox', { name: '이름', exact: true }).fill(displayName);
  await page.getByRole('textbox', { name: '아이디', exact: true }).fill(handle);
  const response = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/api/v1/auth/register'),
  );
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  const received = await response;
  expect(received.ok()).toBeTruthy();
  const body = (await received.json()) as { data: User };
  await expect(page.getByRole('tab', { name: '나의 경험', exact: true })).toBeVisible();
  return body.data;
}

export async function createAndJoin(a: Page, b: Page, bHandle: string) {
  await a.getByRole('tab', { name: '스터디', exact: true }).click();
  await a.getByRole('button', { name: '스터디 만들기', exact: true }).click();
  await a.getByRole('textbox', { name: '초대할 아이디', exact: true }).fill(bHandle);
  const response = a.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/api/v1/studies'),
  );
  await a.getByRole('button', { name: '초대하고 만들기', exact: true }).click();
  const received = await response;
  expect(received.ok()).toBeTruthy();
  const { data: study } = (await received.json()) as { data: Study };
  const invitation = b.getByRole('dialog', { name: '스터디 초대가 도착했어요' });
  await expect(invitation).toBeVisible();
  await capture(b, 'invitation');
  expect((await b.request.get(`/api/v1/studies/${study.id}`)).status()).toBe(403);
  await invitation.getByRole('button', { name: '참여하기', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(a, study.id)).study.members.filter((member) => member.state === 'joined')
          .length,
    )
    .toBe(2);
  await expect(b.getByRole('button', { name: '첫 주제 시작', exact: true })).toBeVisible();
  return study.id;
}

export async function snapshot(page: Page, studyId: string) {
  return responseData<StudySnapshot>(await page.request.get(`/api/v1/studies/${studyId}`));
}

export function observeEvents(page: Page) {
  const messages: string[] = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws/events') return;
    socket.on('framereceived', (frame) => messages.push(String(frame.payload)));
  });
  return messages;
}

export async function capture(page: Page, name: string) {
  const directory = new URL('../../.local/validation/screenshots/', import.meta.url);
  if (test.info().project.name === 'layout-perturbed') name = `layout-${name}`;
  await mkdir(directory, { recursive: true });
  await page.evaluate('document.fonts.ready');
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    fullPage: true,
    animations: 'disabled',
  });
}
