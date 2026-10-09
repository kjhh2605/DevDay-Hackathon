import { expect, test, type Locator, type Page } from '@playwright/test';
import { capture, register } from './helpers.js';

const landingHeading = /우리의 이야기가\s*영어가 되는 곳\./;
const sectionIds = ['why', 'features', 'technology'] as const;
const overviewTitle = '말모아 서비스 동작 소개';

async function readVideoState(video: Locator) {
  return video.evaluate((element) => {
    const media = element as unknown as {
      currentSrc: string;
      currentTime: number;
      duration: number;
      readyState: number;
      videoWidth: number;
      paused: boolean;
      error: { code: number } | null;
    };
    return {
      currentSrc: media.currentSrc,
      currentTime: media.currentTime,
      duration: media.duration,
      readyState: media.readyState,
      videoWidth: media.videoWidth,
      paused: media.paused,
      error: media.error?.code ?? null,
    };
  });
}

async function openOverview(page: Page) {
  const mediaResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/media/landing/overview.mp4',
  );
  await page.goto('/');
  await expectLanding(page);
  const response = await mediaResponse;
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toMatch(/^video\/mp4/);
  const video = page.locator(`video[aria-label="${overviewTitle}"]`);
  await expect.poll(async () => (await readVideoState(video)).readyState).toBeGreaterThanOrEqual(1);
  const metadata = await readVideoState(video);
  expect(metadata.currentSrc).toContain('/media/landing/overview.mp4');
  expect(metadata.duration).toBeGreaterThan(0);
  expect(metadata.videoWidth).toBeGreaterThan(0);
  expect(metadata.error).toBeNull();
  return video;
}

async function expectPlaying(video: Locator, after = 0) {
  await expect(video).toHaveJSProperty('paused', false);
  await expect.poll(async () => (await readVideoState(video)).readyState).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await readVideoState(video)).currentTime).toBeGreaterThan(after);
}

async function expectPauseSurvivesScroll(page: Page, video: Locator) {
  await expect(video).toHaveJSProperty('paused', true);
  const pausedAt = (await readVideoState(video)).currentTime;
  await video.evaluate((element) => {
    element.addEventListener(
      'play',
      () => element.setAttribute('data-replayed-after-pause', 'true'),
      {
        once: true,
      },
    );
  });
  await page.locator('#technology').scrollIntoViewIfNeeded();
  await expect(video).not.toBeInViewport();
  await video.scrollIntoViewIfNeeded();
  await expect(video).toBeInViewport();
  // Let viewport observers and the following React effects finish before checking playback.
  await page.evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await expect(video).toHaveJSProperty('paused', true);
  await expect(video).not.toHaveAttribute('data-replayed-after-pause', 'true');
  expect((await readVideoState(video)).currentTime).toBeCloseTo(pausedAt, 3);
  return pausedAt;
}

function observeServiceTraffic(page: Page) {
  const requests: string[] = [];
  const sockets: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push(path);
  });
  page.on('websocket', (socket) => {
    const path = new URL(socket.url()).pathname;
    // The Vite development connection is unrelated to the service session.
    if (path.startsWith('/ws/')) sockets.push(path);
  });
  return { requests, sockets };
}

async function expectLanding(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: landingHeading })).toBeVisible();
  for (const section of sectionIds) {
    await expect(page.locator(`#${section}`)).toBeVisible();
  }
  await expect(page.locator('video')).toHaveCount(6);
  await expect(page.locator('#features video')).toHaveCount(5);
}

test('L01: the public landing works without API access and its CTA opens registration', async ({
  page,
}) => {
  const traffic = observeServiceTraffic(page);
  // Deny API access rather than supplying a fabricated server response.
  // Service navigation below uses the actual E2E API and database.
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await page.goto('/');
  await expectLanding(page);
  for (const section of sectionIds) {
    await page.locator(`#${section}`).scrollIntoViewIfNeeded();
  }
  await page.evaluate('document.fonts.ready');
  expect(traffic.requests).toEqual([]);
  expect(traffic.sockets).toEqual([]);
  await capture(page, 'landing-public');

  await page.unroute('**/api/**');
  const cta = page.getByRole('link', { name: '말모아 시작하기', exact: true }).first();
  await expect(cta).toHaveAttribute('href', '/study');
  await cta.click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '아이디', exact: true })).toBeVisible();
});

test('L02: an existing session sees the landing at root and enters its own service via the CTA', async ({
  page,
  context,
}) => {
  const user = await register(page, '랜딩 재방문');
  await page.close();
  const returning = await context.newPage();
  const traffic = observeServiceTraffic(returning);
  await returning.goto('/');
  await expectLanding(returning);
  expect(traffic.requests).toEqual([]);
  expect(traffic.sockets).toEqual([]);

  await returning.getByRole('link', { name: '말모아 시작하기', exact: true }).first().click();
  await expect(returning).toHaveURL(/\/study$/);
  await expect(returning.getByRole('tab', { name: '스터디', exact: true })).toBeVisible();
  await expect(returning.getByText(`@${user.handle}`, { exact: true })).toBeVisible();
  await expect(returning.getByRole('textbox', { name: '아이디', exact: true })).toHaveCount(0);
});

test('L03: the landing sections and service CTA fit a 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expectLanding(page);
  await page.evaluate('document.fonts.ready');
  for (const section of sectionIds) {
    await page.locator(`#${section}`).scrollIntoViewIfNeeded();
    const width = await page.evaluate<{ viewport: number; document: number; body: number }>(`({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    })`);
    expect(width.document, `${section}: document overflow`).toBeLessThanOrEqual(width.viewport + 1);
    expect(width.body, `${section}: body overflow`).toBeLessThanOrEqual(width.viewport + 1);
  }
  await capture(page, 'landing-mobile');
  await page.getByRole('link', { name: '말모아 시작하기', exact: true }).first().click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toBeVisible();
});

test('L04: reduced-motion visitors can inspect every section without video autoplay', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(`
    document.addEventListener(
      'play',
      (event) => {
        if (event.target instanceof HTMLVideoElement) {
          document.documentElement.dataset.unrequestedVideoPlayback = 'true';
        }
      },
      true,
    );
  `);
  await page.goto('/');
  await expectLanding(page);
  for (const video of await page.locator('video').all()) {
    await video.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        video.evaluate((element) => {
          const { autoplay, paused } = element as unknown as {
            autoplay: boolean;
            paused: boolean;
          };
          return { autoplay, paused };
        }),
      )
      .toEqual({ autoplay: false, paused: true });
  }
  // A clip that starts and is then paused still violates the initial preference.
  await expect(page.locator('html')).not.toHaveAttribute('data-unrequested-video-playback', 'true');
});

test('L05: reduced-motion visitors can play, pause, and resume the real overview video', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const video = await openOverview(page);
  await expect(video).toHaveJSProperty('paused', true);
  const play = page.getByRole('button', { name: `${overviewTitle} 재생`, exact: true });
  const pause = page.getByRole('button', { name: `${overviewTitle} 일시정지`, exact: true });

  await play.click();
  await expectPlaying(video);
  await pause.click();
  const pausedAt = await expectPauseSurvivesScroll(page, video);
  await expect(play).toBeVisible();
  await play.click();
  await expectPlaying(video, pausedAt + 0.05);
  await expect(pause).toBeVisible();
});

test('L06: a native media-control pause persists when an autoplaying video leaves and reenters view', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const video = await openOverview(page);
  await expectPlaying(video);
  await expect(video).toHaveAttribute('controls', '');

  // Space on the focused video operates Chromium's native media controls.
  await video.press('Space');
  const pausedAt = await expectPauseSurvivesScroll(page, video);
  await expect(
    page.getByRole('button', { name: `${overviewTitle} 재생`, exact: true }),
  ).toBeVisible();
  await video.press('Space');
  await expectPlaying(video, pausedAt + 0.05);
});
