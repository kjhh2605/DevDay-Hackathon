import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { AudioServerMessage } from '../../packages/contracts/src/audio.js';
import { snapshot } from './helpers.js';

/** Exercise the real audio transport with a synthetic tone. The mock transcript is a fixture, not recognized speech. */
export async function sendSyntheticSegment(page: Page, studyId: string, topicId: string) {
  const pcm = Buffer.alloc(4_800 * 2); // 200 ms, 24 kHz, mono PCM16.
  for (let sample = 0; sample < 4_800; sample++)
    pcm.writeInt16LE(
      Math.round(Math.sin((sample * 2 * Math.PI * 440) / 24_000) * 6_000),
      sample * 2,
    );
  const url = new URL('/ws/audio', page.url());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const segmentId = await page.evaluate(
    async ({ url, topicId, pcmBase64, clientStreamId, clientSegmentId }) => {
      const socket = new WebSocket(url);
      const inbox: AudioServerMessage[] = [];
      let failure: string | null = null;
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as AudioServerMessage;
        if (message.type === 'heartbeat.ping')
          socket.send(JSON.stringify({ type: 'heartbeat.pong' }));
        else if (message.type === 'audio.error') failure = message.error.message;
        else inbox.push(message);
      });
      socket.addEventListener('error', () => {
        failure = 'Synthetic audio socket failed';
      });
      const receive = async <T extends AudioServerMessage['type']>(
        type: T,
      ): Promise<Extract<AudioServerMessage, { type: T }>> => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (failure) throw new Error(failure);
          const index = inbox.findIndex((message) => message.type === type);
          if (index >= 0)
            return inbox.splice(index, 1)[0] as Extract<AudioServerMessage, { type: T }>;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`No ${type} acknowledgement from the real audio endpoint`);
      };
      try {
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener('open', () => resolve(), { once: true });
          socket.addEventListener('error', () => reject(new Error('Audio socket did not open')), {
            once: true,
          });
        });
        socket.send(
          JSON.stringify({
            type: 'audio.start',
            topicId,
            clientStreamId,
            format: 'pcm16',
            sampleRate: 24_000,
            channels: 1,
          }),
        );
        const ready = await receive('audio.ready');
        socket.send(
          JSON.stringify({
            type: 'audio.segment_start',
            streamId: ready.streamId,
            clientSegmentId,
          }),
        );
        const segment = await receive('audio.segment_ready');
        socket.send(
          JSON.stringify({
            type: 'audio.chunk',
            streamId: ready.streamId,
            clientSegmentId,
            seq: 0,
            pcmBase64,
          }),
        );
        socket.send(
          JSON.stringify({
            type: 'audio.segment_commit',
            streamId: ready.streamId,
            clientSegmentId,
            lastSeq: 0,
          }),
        );
        // audio.stop waits for the committed segment's real server persistence/correction pipeline.
        // The following pong is queued after stop and proves stop was handled before we close the socket.
        socket.send(JSON.stringify({ type: 'audio.stop', streamId: ready.streamId }));
        socket.send(JSON.stringify({ type: 'heartbeat.ping' }));
        await receive('heartbeat.pong');
        return segment.segmentId;
      } finally {
        socket.close();
      }
    },
    {
      url: url.href,
      topicId,
      pcmBase64: pcm.toString('base64'),
      clientStreamId: randomUUID(),
      clientSegmentId: randomUUID(),
    },
  );
  await expect
    .poll(async () => {
      const segment = (await snapshot(page, studyId)).segments.find(
        (item) => item.id === segmentId,
      );
      return segment?.rawStatus === 'ready' && segment.correctionStatus === 'ready';
    })
    .toBe(true);
  return segmentId;
}
