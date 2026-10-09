/** Record the real running app with Playwright. All private captures stay in .local. */
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const origin = process.env.LANDING_ORIGIN || 'http://127.0.0.1:5185';
const statePath = process.env.LANDING_STATE || '.local/presentation/state.json';
const sessionPath = process.env.LANDING_SESSION || '.local/presentation/a.json';
const state = JSON.parse(await readFile(statePath, 'utf8'));
const phase = process.argv[2];
const run = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve('.local/landing/raw', `${phase}-${run}`);
await mkdir(directory, { recursive: true });
const audioPath = resolve('.local/landing/microphone.wav');
if (phase === 'conversation' || phase === 'command') {
  // The existing presentation voice is synthetic. Surround it with silence so the
  // browser's file microphone feeds exactly one utterance, using the real app UI.
  const wav = await readFile('.local/validation/single-voice/weather.wav');
  let pcm;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') pcm = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!pcm) throw new Error('Source WAV has no data');
  const payload = Buffer.concat([Buffer.alloc(24000 * 2 * 2), pcm, Buffer.alloc(24000 * 2 * 45)]);
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(payload.length + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(payload.length, 40);
  await writeFile(audioPath, Buffer.concat([header, payload]));
}
const browser = await chromium.launch({
  headless: true,
  args:
    phase === 'conversation' || phase === 'command'
      ? [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-audio-capture=${audioPath}`,
        ]
      : [],
});
const context = await browser.newContext({
  baseURL: origin,
  storageState: sessionPath,
  viewport: { width: 1440, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: directory, size: { width: 1440, height: 720 } },
  permissions: phase === 'conversation' || phase === 'command' ? ['microphone'] : [],
});
const started = Date.now();
const page = await context.newPage();
page.setDefaultTimeout(20000);
const marks = [];
const mouse = [];
const mark = (name, extra = {}) => {
  const entry = { name, t: (Date.now() - started) / 1000, ...extra };
  marks.push(entry);
  console.log(JSON.stringify(entry));
  return entry;
};
async function pointer(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error('No click target');
  const target = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(target.x, target.y, { steps: 22 });
  mouse.push({ t: (Date.now() - started) / 1000, ...target, label });
  await page.waitForTimeout(450);
  return locator;
}
async function click(locator, label) {
  await pointer(locator, label);
  mark(label);
  await locator.click();
}
async function ready(url) {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);
}
async function data(path) {
  const r = await page.request.get(`/api/v1${path}`);
  if (!r.ok()) throw new Error(`GET ${path}: ${r.status()}`);
  return (await r.json()).data;
}
const studyUrl = `/study/${state.studyId}`;
try {
  if (phase === 'command') {
    await ready(studyUrl);
    const before = await data(`/studies/${state.studyId}`);
    if (before.topic?.state !== 'talking')
      throw new Error('Command capture requires a talking topic');
    await click(page.getByRole('button', { name: '마이크 켜기', exact: true }), 'mic-on');
    await expect(page.getByText('듣고 있어요…', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await data(`/studies/${state.studyId}`)).segments.some((s) => s.rawText?.trim()),
        { timeout: 100000 },
      )
      .toBe(true);
    await click(page.getByRole('button', { name: '마이크 끄기', exact: true }), 'mic-off');
    await expect
      .poll(
        async () =>
          (await data(`/studies/${state.studyId}`)).speechGroups?.some((g) =>
            g.correctedText?.trim(),
          ),
        { timeout: 100000 },
      )
      .toBe(true);
    const input = page.getByRole('textbox', { name: '개인 챗봇에게 요청', exact: true });
    await pointer(input, 'compose');
    await page.waitForTimeout(600);
    mark('command-ready');
    const request = '현재 주제 대화를 마무리하고 문장별 리뷰를 준비해줘.';
    await input.pressSequentially(request, { delay: 70 });
    await page.waitForTimeout(1200);
    mark('typed-command');
    const sent = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/chat/messages'),
    );
    await click(page.getByRole('button', { name: '보내기', exact: true }), 'send-command');
    const response = (await (await sent).json()).data;
    await expect
      .poll(
        async () => {
          const job = await data(`/jobs/${response.job.id}`);
          if (job.status === 'failed') throw new Error('Chat command failed');
          return job.status;
        },
        { timeout: 100000 },
      )
      .toBe('succeeded');
    const after = await data(`/studies/${state.studyId}`);
    if (!['closing', 'review'].includes(after.topic?.state)) {
      await writeFile(
        '.local/landing/command-failure.json',
        JSON.stringify({ request, response, state: after.topic?.state }, null, 2),
      );
      throw new Error('Chat did not execute close_topic; do not export as success');
    }
    await expect
      .poll(
        async () => {
          const current = await data(`/studies/${state.studyId}`);
          return (
            current.topic?.state === 'review' &&
            current.feedback.length > 0 &&
            current.feedback.every((f) => f.status === 'ready')
          );
        },
        { timeout: 120000 },
      )
      .toBe(true);
    const messages = await data(`/studies/${state.studyId}/chat/messages`);
    const assistant = messages.filter((m) => m.role === 'assistant').at(-1);
    if (!assistant?.commandResults?.length) throw new Error('No actual command result in chat');
    const panel = page.getByRole('complementary', { name: '개인 챗봇' });
    await panel.locator('article').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    mark('command-complete');
    await page.waitForTimeout(3500);
    const review = page.getByRole('region', { name: '문장별 대화 검토' });
    await review.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    mark('review-visible');
    await page.waitForTimeout(2000);
    const accordion = review.locator('article').first().locator('[aria-expanded]').first();
    if (await accordion.count()) await click(accordion, 'review-expand');
    await page.waitForTimeout(3500);
    await writeFile(
      '.local/landing/command-evidence.json',
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          request,
          before: { topicId: before.topic.id, state: before.topic.state },
          after: await data(`/studies/${state.studyId}`),
          assistantMessage: assistant,
          response,
        },
        null,
        2,
      ),
    );
  } else if (phase === 'experience') {
    await ready('/experiences');
    await expect(page.getByRole('heading', { name: '경험과 관심사', exact: true })).toBeVisible();
    mark('ready');
    await page.waitForTimeout(850);
    const input = page.getByRole('textbox', { name: '나의 경험', exact: true });
    await click(input, 'input');
    await input.pressSequentially(state.experienceInput, { delay: 23 });
    mark('typed');
    await page.waitForTimeout(1300);
    await click(page.getByRole('button', { name: '경험 정리하기', exact: true }), 'prepare');
    await expect(page.getByRole('textbox', { name: '정리된 경험', exact: true })).toBeVisible({
      timeout: 120000,
    });
    await page.waitForTimeout(650);
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
    await page.waitForTimeout(650);
    mark('summary');
    await page.waitForTimeout(3100);
    await pointer(page.getByRole('textbox', { name: '관심사', exact: true }), 'interests');
    await page.waitForTimeout(1400);
    mark('interests');
    await page.waitForTimeout(2000);
    await click(page.getByRole('button', { name: '확인하고 저장', exact: true }), 'save');
    await expect(page.getByText('경험을 저장했어요.', { exact: false })).toBeVisible();
    mark('saved');
    await page.waitForTimeout(2100);
  } else if (phase === 'conversation') {
    await ready(studyUrl);
    await expect(page.getByRole('region', { name: '공통 대화 주제' })).toBeVisible();
    const successful = page
      .getByRole('complementary', { name: '개인 챗봇' })
      .locator('article')
      .filter({ hasText: '개인 표현으로 저장했고' });
    if (await successful.count()) await successful.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    mark('ready');
    await page.waitForTimeout(2300);
    await page.mouse.move(720, 390, { steps: 25 });
    await page.mouse.wheel(0, 290);
    await page.waitForTimeout(800);
    mark('topic');
    await page.waitForTimeout(3000);
    await click(page.getByRole('button', { name: '마이크 켜기', exact: true }), 'mic-on');
    await expect(page.getByText('듣고 있어요…', { exact: true })).toBeVisible();
    mark('capturing');
    await expect
      .poll(
        async () => {
          const current = await data(`/studies/${state.studyId}`);
          return current.segments.some((s) => s.rawText?.trim());
        },
        { timeout: 100000 },
      )
      .toBe(true);
    mark('transcript');
    await page.getByRole('region', { name: '실시간 원문과 인식 보정' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1800);
    await click(page.getByRole('button', { name: '마이크 끄기', exact: true }), 'mic-off');
    await expect
      .poll(
        async () => {
          const current = await data(`/studies/${state.studyId}`);
          return current.speechGroups?.some((g) => g.correctedText?.trim());
        },
        { timeout: 100000 },
      )
      .toBe(true);
    await page.getByRole('region', { name: '실시간 원문과 인식 보정' }).scrollIntoViewIfNeeded();
    mark('corrected');
    await page.waitForTimeout(3500);
  } else if (phase === 'assistant') {
    await ready(studyUrl);
    const panel = page.getByRole('complementary', { name: '개인 챗봇' });
    const response = panel.locator('article').filter({ hasText: '개인 표현으로 저장했고' });
    await expect(response).toBeVisible();
    await response.evaluate((el) => {
      const parent = el.parentElement;
      parent.scrollTop = el.offsetTop - parent.offsetTop - 25;
    });
    await page.evaluate(() => window.scrollTo({ top: 205, behavior: 'instant' }));
    await page.waitForTimeout(700);
    mark('ready');
    await pointer(response, 'answer');
    await page.waitForTimeout(2200);
    mark('expression');
    await page.mouse.move(1250, 355, { steps: 22 });
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(700);
    mark('saved-expression');
    await page.waitForTimeout(2800);
    const shared = page
      .getByText('I like taking travel photos.', { exact: true })
      .filter({ has: page.locator('summary') });
    const summary = page.locator('summary').filter({ hasText: 'I like taking travel photos.' });
    await click(summary, 'shared');
    await page.waitForTimeout(2500);
    mark('shared-open');
    await page.waitForTimeout(1800);
  } else if (phase === 'review') {
    await ready(studyUrl);
    let current = await data(`/studies/${state.studyId}`);
    if (current.topic?.state === 'talking') {
      await click(page.getByRole('button', { name: '주제 종료', exact: true }), 'close-topic');
      await expect
        .poll(
          async () => {
            current = await data(`/studies/${state.studyId}`);
            return current.topic?.state;
          },
          { timeout: 180000 },
        )
        .toBe('review');
    }
    await expect
      .poll(
        async () => {
          current = await data(`/studies/${state.studyId}`);
          return current.feedback.length > 0 && current.feedback.every((f) => f.status === 'ready');
        },
        { timeout: 120000 },
      )
      .toBe(true);
    const review = page.getByRole('region', { name: '문장별 대화 검토' });
    await review.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    mark('ready');
    await page.waitForTimeout(1500);
    const first = review.locator('article').first();
    await first.scrollIntoViewIfNeeded();
    await page.waitForTimeout(650);
    mark('sentence');
    const feedback = first
      .locator('button')
      .filter({ hasText: /피곤|tired|today|시제|표현/ })
      .first();
    const buttons = await first.getByRole('button').allTextContents();
    console.log('REVIEW_BUTTONS', JSON.stringify(buttons));
    const accordion = first.locator('[aria-expanded]').first();
    if (await accordion.count()) await click(accordion, 'expand-feedback');
    await page.waitForTimeout(2600);
    mark('feedback');
    const edit = first.getByRole('button', { name: '민지 문장 보정문 수정', exact: true });
    if (await edit.count()) {
      await click(edit, 'edit');
      await page.waitForTimeout(1800);
      mark('editing');
      await click(first.getByRole('button', { name: '취소', exact: true }), 'cancel');
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '.local/landing/inspect/review.png' });
  } else if (phase === 'reuse') {
    await ready(studyUrl);
    let current = await data(`/studies/${state.studyId}`);
    if (current.topic?.state !== 'review')
      throw new Error('Reuse capture requires a reviewed live topic');
    const previousTopic = current.topic;
    const review = page.getByRole('region', { name: '문장별 대화 검토' });
    const sentence = review
      .locator('article')
      .filter({ hasText: /We.*(?:trip|Busan)/ })
      .last();
    await sentence.scrollIntoViewIfNeeded();
    const accordion = sentence.locator('[aria-expanded]').first();
    if (await accordion.count()) await click(accordion, 'expand-source-expression');
    await page.waitForTimeout(600);
    mark('feedback-source');
    await page.waitForTimeout(4000);
    await click(
      page.getByRole('button', { name: '승인하고 다음 주제', exact: true }),
      'approve-next',
    );
    await expect
      .poll(
        async () => {
          current = await data(`/studies/${state.studyId}`);
          if (current.topic?.state === 'failed') throw new Error('Next topic failed');
          return (
            current.topic?.ordinal === previousTopic.ordinal + 1 &&
            current.topic?.state === 'talking'
          );
        },
        { timeout: 250000 },
      )
      .toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(900);
    mark('generated');
    await page.waitForTimeout(3000);
    await page.mouse.move(720, 430, { steps: 20 });
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(900);
    mark('image-instruction');
    await page.waitForTimeout(4500);
    const learned = await data('/me/learning-items');
    await writeFile(
      '.local/landing/reuse-evidence.json',
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          previousTopicId: previousTopic.id,
          currentTopic: current.topic,
          learningItems: learned.filter((item) =>
            current.topic.content.learningExpressionIds.includes(item.id),
          ),
          audioSource:
            'Synthetic presentation WAV via browser microphone; actual live model results.',
        },
        null,
        2,
      ),
    );
    await click(page.getByRole('tab', { name: '나의 학습', exact: true }), 'learning');
    await expect(page.getByRole('heading', { name: '개인 학습 기록' })).toBeVisible();
    await page.waitForTimeout(800);
    await click(page.getByRole('button', { name: '스터디 피드백', exact: true }), 'approved-only');
    mark('learning-saved');
    await page.waitForTimeout(4000);
  } else if (phase === 'learning') {
    await ready('/learning');
    await expect(page.getByRole('heading', { name: '개인 학습 기록' })).toBeVisible();
    mark('ready');
    await page.waitForTimeout(1500);
    await click(
      page.getByRole('button', { name: '스터디 피드백', exact: true }),
      'filter-feedback',
    );
    await page.waitForTimeout(2600);
    await click(page.getByRole('button', { name: '개인 챗봇', exact: true }), 'filter-chat');
    await page.waitForTimeout(2600);
    await click(page.getByRole('button', { name: '전체', exact: true }), 'filter-all');
    await page.mouse.move(934, 603, { steps: 20 });
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(1100);
    mark('all-records');
    await page.waitForTimeout(2000);
  } else
    throw new Error('Phase required: experience | conversation | assistant | command | review | learning | reuse');
  mark('end');
} catch (error) {
  await page
    .screenshot({ path: resolve(directory, 'failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  const file = await page.video().path();
  await context.close();
  await browser.close();
  const manifest = {
    phase,
    run,
    origin,
    viewport: { width: 1440, height: 720 },
    file,
    marks,
    mouse,
    source:
      'Real Playwright recordVideo; no mocked routes, response replacement, or rendered screenshots.',
  };
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(resolve('.local/landing', `${phase}.json`), JSON.stringify(manifest, null, 2));
  console.log('RECORDING', file);
}
