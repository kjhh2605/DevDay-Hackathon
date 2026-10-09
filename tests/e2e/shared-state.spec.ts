import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type {
  ChatMessage,
  LearningItem,
  SharedExpression,
  ShareProposal,
} from '../../packages/contracts/src/dto.js';
import {
  capture,
  createAndJoin,
  observeEvents,
  register,
  responseData,
  snapshot,
} from './helpers.js';

async function sendChat(page: Page, studyId: string, text: string) {
  const prior = await responseData<ChatMessage[]>(
    await page.request.get(`/api/v1/studies/${studyId}/chat/messages`),
  );
  const existing = new Set(prior.map((message) => message.id));
  await page.getByRole('textbox', { name: '개인 챗봇에게 요청', exact: true }).fill(text);
  await page.getByRole('button', { name: '보내기', exact: true }).click();
  let reply: ChatMessage | undefined;
  await expect
    .poll(
      async () => {
        const messages = await responseData<ChatMessage[]>(
          await page.request.get(`/api/v1/studies/${studyId}/chat/messages`),
        );
        reply = messages.find(
          (message) => !existing.has(message.id) && message.role === 'assistant',
        );
        return reply?.status;
      },
      { message: `Chat job should complete for: ${text}` },
    )
    .toBe('succeeded');
  return reply!;
}

async function assertTalkingOnBoth(a: Page, b: Page, studyId: string) {
  await expect.poll(async () => (await snapshot(a, studyId)).topic?.state).toBe('talking');
  const [aSnapshot, bSnapshot] = await Promise.all([snapshot(a, studyId), snapshot(b, studyId)]);
  expect(aSnapshot.topic).toEqual(bSnapshot.topic);
  const topic = aSnapshot.topic!;
  expect(topic.content?.conversationInstruction).toBeTruthy();
  await expect(a.getByRole('button', { name: '주제 종료', exact: true })).toBeVisible();
  await expect(b.getByRole('button', { name: '주제 종료', exact: true })).toBeVisible();
  await expect(a.getByText(topic.content!.conversationInstruction, { exact: true })).toBeVisible();
  await expect(b.getByText(topic.content!.conversationInstruction, { exact: true })).toBeVisible();
  return topic;
}

test('A03/A04/A05/A21–A24: shared progress, private chat, explicit sharing, next context and final finish', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  testInfo.annotations.push({
    type: 'environment',
    description:
      'Real PostgreSQL/API/events/files with AI_MODE=mock. No microphone or live OpenAI claim.',
  });
  const aContext = await browser.newContext({ baseURL });
  const bContext = await browser.newContext({ baseURL });
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const bEvents = observeEvents(b);
    const aUser = await register(a, '공유 A');
    const bUser = await register(b, '공유 B');
    await a.getByRole('tab', { name: '나의 경험', exact: true }).click();
    await a.getByRole('textbox', { name: '나의 경험', exact: true }).fill('부산에 다녀왔어요');
    await a.getByRole('button', { name: '경험 정리하기', exact: true }).click();
    await a.getByRole('button', { name: '답변 없이 계속하기', exact: true }).click();
    await a
      .getByRole('textbox', { name: '정리된 경험', exact: true })
      .fill('부산 여행을 다녀온 경험');
    await a.getByRole('button', { name: '확인하고 저장', exact: true }).click();
    await expect(a.getByRole('status').filter({ hasText: '경험을 저장했어요' })).toBeVisible();
    const studyId = await createAndJoin(a, b, bUser.handle);
    await a.getByRole('button', { name: '첫 주제 시작', exact: true }).click();
    const firstTopic = await assertTalkingOnBoth(a, b, studyId);
    expect(firstTopic.content?.kind).toBe('image');
    expect(bEvents.join('\n')).toContain(firstTopic.id);
    expect(bEvents.join('\n')).toContain('study.changed');
    await capture(a, 'study-topic');
    const media = await a.request.get(`/api/v1/media/${firstTopic.content!.imageMediaId}`);
    expect(media.ok()).toBe(true);
    expect(media.headers()['content-type']).toMatch(/^image\//);
    expect((await media.body()).byteLength).toBeGreaterThan(0);

    await test.step('word explanation stays in A chat, learning, and user events', async () => {
      const reply = await sendChat(a, studyId, 'resilient 단어 뜻 알려줘');
      expect(reply.learningItemIds).toHaveLength(1);
      expect(reply.shareProposalId).toBeNull();
      const aItems = await responseData<LearningItem[]>(
        await a.request.get('/api/v1/me/learning-items'),
      );
      expect(aItems).toHaveLength(1);
      expect(aItems[0]).toMatchObject({ ownerUserId: aUser.id, kind: 'word', source: 'chat' });
      expect(
        await responseData<LearningItem[]>(await b.request.get('/api/v1/me/learning-items')),
      ).toEqual([]);
      expect(
        await responseData<ChatMessage[]>(
          await b.request.get(`/api/v1/studies/${studyId}/chat/messages`),
        ),
      ).toEqual([]);
      await expect(b.getByText('resilient 단어 뜻 알려줘', { exact: true })).toHaveCount(0);
      expect(bEvents.join('\n')).not.toContain('resilient');
      expect(bEvents.join('\n')).not.toContain(reply.id);
      expect(bEvents.join('\n')).not.toContain(reply.learningItemIds[0]);
    });

    let accepted: SharedExpression | undefined;
    await test.step('no and pending remain personal, yes is shared once', async () => {
      const declined = await sendChat(a, studyId, '포기하지 않는다는 표현을 영어로 알려줘');
      expect(declined.shareProposalId).toBeTruthy();
      await a.getByRole('button', { name: 'No, 나만 보기', exact: true }).last().click();
      await expect(a.getByText('나의 학습에만 보관해요.', { exact: true })).toBeVisible();
      expect((await snapshot(b, studyId)).sharedExpressions).toHaveLength(0);
      const pending = await sendChat(a, studyId, '다시 도전한다는 표현을 영어로 알려줘');
      expect(pending.shareProposalId).toBeTruthy();
      expect((await snapshot(b, studyId)).sharedExpressions).toHaveLength(0);
      const toShare = await sendChat(a, studyId, '함께 해냈다는 표현을 영어로 알려줘');
      expect(toShare.shareProposalId).toBeTruthy();
      await a.getByRole('button', { name: 'Yes, 공유하기', exact: true }).last().click();
      await expect.poll(async () => (await snapshot(b, studyId)).sharedExpressions.length).toBe(1);
      accepted = (await snapshot(b, studyId)).sharedExpressions[0]!;
      expect(accepted.sourceProposalId).toBe(toShare.shareProposalId);
      expect(accepted.contributorUserId).toBe(aUser.id);
      await expect(b.getByText(accepted.expression, { exact: true })).toBeVisible();
      const duplicate = await a.request.post(
        `/api/v1/share-proposals/${toShare.shareProposalId}/decision`,
        { data: { accepted: true, commandId: randomUUID() } },
      );
      expect(duplicate.ok()).toBe(true);
      expect((await snapshot(b, studyId)).sharedExpressions).toHaveLength(1);
      await a.getByRole('tab', { name: '나의 학습', exact: true }).click();
      await expect(a.getByRole('heading', { name: '개인 학습 기록', exact: true })).toBeVisible();
      await a.getByRole('tab', { name: '스터디', exact: true }).click();
      await expect(
        a
          .getByRole('complementary', { name: '개인 챗봇' })
          .getByText('공유했어요', { exact: true }),
      ).toBeVisible();
      await expect(a.getByText('나의 학습에만 보관해요.', { exact: true })).toBeVisible();
      await expect(a.getByRole('button', { name: 'Yes, 공유하기', exact: true })).toHaveCount(1);
      const proposals = await responseData<ShareProposal[]>(
        await a.request.get(`/api/v1/studies/${studyId}/share-proposals`),
      );
      expect(proposals.find((item) => item.id === declined.shareProposalId)?.status).toBe(
        'declined',
      );
      expect(proposals.find((item) => item.id === pending.shareProposalId)?.status).toBe('pending');
      expect(proposals.find((item) => item.id === toShare.shareProposalId)?.status).toBe(
        'accepted',
      );
      expect(
        await responseData<ShareProposal[]>(
          await b.request.get(`/api/v1/studies/${studyId}/share-proposals`),
        ),
      ).toEqual([]);
      await capture(a, 'chat-sharing');
      expect(
        await responseData<LearningItem[]>(await b.request.get('/api/v1/me/learning-items')),
      ).toEqual([]);
      expect(
        await responseData<ChatMessage[]>(
          await b.request.get(`/api/v1/studies/${studyId}/chat/messages`),
        ),
      ).toEqual([]);
    });

    await test.step('B closes, A advances, and both receive the same next topic', async () => {
      await b.getByRole('button', { name: '주제 종료', exact: true }).click();
      await expect(a.getByRole('region', { name: '문장별 대화 검토' })).toBeVisible();
      await expect(b.getByRole('region', { name: '문장별 대화 검토' })).toBeVisible();
      await capture(a, 'study-review');
      await a.getByRole('button', { name: '승인하고 다음 주제', exact: true }).click();
      const secondTopic = await assertTalkingOnBoth(a, b, studyId);
      expect(secondTopic.id).not.toBe(firstTopic.id);
      expect(secondTopic.ordinal).toBe(2);
      expect(secondTopic.content!.sharedExpressionIds).toEqual([accepted!.id]);
      await b.getByRole('button', { name: '주제 종료', exact: true }).click();
      await expect(
        a.getByRole('button', { name: '승인하고 스터디 종료', exact: true }),
      ).toBeVisible();
      await a.getByRole('button', { name: '승인하고 스터디 종료', exact: true }).click();
      await expect.poll(async () => (await snapshot(b, studyId)).study.status).toBe('ended');
      await a.reload();
      const savedItems = await responseData<LearningItem[]>(
        await a.request.get('/api/v1/me/learning-items'),
      );
      expect(savedItems).toHaveLength(4);
      expect(
        savedItems.every((item) => item.ownerUserId === aUser.id && item.source === 'chat'),
      ).toBe(true);
      await a.getByRole('tab', { name: '나의 학습', exact: true }).click();
      const learning = a.getByRole('region', { name: '저장된 학습 표현' });
      await expect(learning).toBeVisible();
      await expect(learning.getByRole('heading', { level: 2 })).toHaveCount(savedItems.length);
      await expect(
        learning.getByRole('heading', { name: savedItems[0]!.expression, exact: true }),
      ).toBeVisible();
      await capture(a, 'learning-records');
    });
  } finally {
    await Promise.all([aContext.close(), bContext.close()]);
  }
});
