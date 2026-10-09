import { randomUUID } from 'node:crypto';
import type { Actor, ApplicationPorts } from '@devday/application-ports';
import {
  createAiJobs,
  OpenAIProvider,
  publicAiError,
  SpeechService,
  type AiProvider,
} from '@devday/ai';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface AiFeatureOptions {
  ports: ApplicationPorts;
  provider?: AiProvider;
  speechPolicy?: import('@devday/ai').SpeechServiceOptions;
}
export function createAiFeature({
  ports,
  provider = new OpenAIProvider(),
  speechPolicy,
}: AiFeatureOptions) {
  const speech = new SpeechService(ports, provider, speechPolicy);
  const jobs = createAiJobs(ports, provider, speech);
  return {
    jobs,
    speech,
    registerAudio(app: FastifyInstance, authenticate: (request: FastifyRequest) => Promise<Actor>) {
      app.get('/ws/audio', { websocket: true }, (socket, request) => {
        const send = (message: unknown) => {
          if (socket.readyState === 1) socket.send(JSON.stringify(message));
        };
        // Install message handlers before awaiting cookie lookup so first audio.start cannot be dropped.
        const connection = authenticate(request).then((actor) =>
          speech.createConnection(actor, send),
        );
        let queue = Promise.resolve();
        const heartbeat = setInterval(() => send({ type: 'heartbeat.ping' }), 20_000);
        socket.on('message', (buffer) => {
          queue = queue
            .then(async () => {
              const input = await connection;
              if (buffer.toString().length > 100_000) throw new Error('AUDIO_FRAME_TOO_LARGE');
              await input.receive(JSON.parse(buffer.toString()));
            })
            .catch(async (error: unknown) => {
              send({ type: 'audio.error', error: publicAiError(error), requestId: randomUUID() });
              (await connection.catch(() => null))?.disconnect();
              socket.close(1008, 'Audio input failed');
            });
        });
        socket.on('close', () => {
          clearInterval(heartbeat);
          void connection.then((input) => input.disconnect()).catch(() => undefined);
        });
        socket.on('error', () => {
          clearInterval(heartbeat);
          void connection.then((input) => input.disconnect()).catch(() => undefined);
        });
        void connection.catch(() => {
          send({
            type: 'audio.error',
            error: {
              code: 'UNIDENTIFIED',
              message: '가입 후 마이크를 사용할 수 있습니다.',
              details: null,
            },
            requestId: randomUUID(),
          });
          socket.close(1008, 'Unidentified');
        });
      });
      app.addHook('onClose', async () => speech.shutdown());
    },
  };
}
