import {
  API_BASE_PATH,
  endpointRegistry,
  mediaEndpoint,
  type EndpointName,
  type Job,
} from '@devday/contracts';
import type { AiJobs } from '@devday/application-ports';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { ApiConfig } from '../config.js';
import type { DomainService } from '../domain/service.js';
import { registerErrorHandler } from './errors.js';
import { assertBrowserOrigin, authenticateRequest, SESSION_COOKIE } from './security.js';

export interface HttpRouteOptions {
  service: DomainService;
  aiJobs: AiJobs;
  config: ApiConfig;
}
type Actor = { userId: string };
type Input<K extends EndpointName> = z.output<(typeof endpointRegistry)[K]['input']>;
type Params<K extends EndpointName> = z.output<(typeof endpointRegistry)[K]['params']>;

export function registerHttpRoutes(
  app: FastifyInstance,
  { service, aiJobs, config }: HttpRouteOptions,
): void {
  registerErrorHandler(app);
  const launched = new Set<string>();
  function launch(job: Job, run: (jobId: string) => Promise<void>): void {
    if (job.status !== 'running' || launched.has(job.id)) return;
    launched.add(job.id);
    // All AI implementations persist terminal status; the request never waits for a provider.
    void Promise.resolve()
      .then(() => run(job.id))
      .catch(async (error) => {
        app.log.error({ err: error, jobId: job.id }, 'AI job execution failed');
        await service.failJob(job.id, {
          code: 'AI_FAILED',
          message: 'AI 작업을 완료하지 못했습니다. 새 요청으로 다시 실행해 주세요.',
          details: null,
        });
      })
      .catch((error) => {
        app.log.error({ err: error, jobId: job.id }, 'AI job failure could not be persisted');
      })
      .finally(() => launched.delete(job.id));
  }
  function route<K extends EndpointName>(
    name: K,
    handler: (args: {
      actor: Actor;
      input: Input<K>;
      params: Params<K>;
      request: FastifyRequest;
      reply: FastifyReply;
    }) => Promise<unknown>,
    options: { public?: boolean; status?: number } = {},
  ): void {
    const endpoint = endpointRegistry[name];
    app.route({
      method: endpoint.method,
      url: `${API_BASE_PATH}${endpoint.path}`,
      handler: async (request, reply) => {
        if (endpoint.method !== 'GET') assertBrowserOrigin(request, config);
        const user = options.public ? null : await authenticateRequest(request, service);
        const input = endpoint.input.parse(request.body) as Input<K>;
        const params = endpoint.params.parse(request.params) as Params<K>;
        const data = await handler({
          actor: { userId: user?.id ?? '' },
          input,
          params,
          request,
          reply,
        });
        // Validate responses too: a private/internal field can never accidentally cross the boundary.
        const parsed = endpoint.output.safeParse(data);
        if (!parsed.success)
          throw new Error(`Invalid response for endpoint ${name}`, { cause: parsed.error });
        const output = parsed.data;
        const status =
          name === 'studyCommand' && output && 'jobId' in output && output.jobId !== null
            ? 202
            : (options.status ?? 200);
        return reply
          .code(status)
          .header('cache-control', 'no-store')
          .send({ data: output, requestId: request.id });
      },
    });
  }

  route(
    'register',
    async ({ input, reply }) => {
      const { user, token } = await service.register(input);
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: config.sessionCookieSecure,
        maxAge: 60 * 60 * 24 * 30,
      });
      return user;
    },
    { public: true, status: 201 },
  );
  route('me', async ({ request }) => authenticateRequest(request, service));
  route('resolveUsers', async ({ actor, input }) => service.resolveUsers(actor, input));
  route('invitations', async ({ actor }) => service.invitations(actor));
  route('createStudy', async ({ actor, input }) => service.createStudy(actor, input), {
    status: 201,
  });
  route('joinStudy', async ({ actor, input, params }) =>
    service.joinStudy(actor, params.studyId, input),
  );
  route('studySnapshot', async ({ actor, params }) => service.snapshot(actor, params.studyId));
  route('studyCommand', async ({ actor, params, input }) =>
    service.execute(actor, { studyId: params.studyId, command: input }),
  );
  route('updateCorrection', async ({ actor, params, input }) =>
    service.editCorrection(actor, params.id, input),
  );
  route(
    'requestFeedback',
    async ({ actor, params, input }) => {
      const reserved = await service.startFeedback(actor, params.id, input);
      const job = await service.getJob(actor, reserved.id);
      launch(job, (id) => aiJobs.feedback(id));
      return job;
    },
    { status: 202 },
  );
  route('chatMessages', async ({ actor, params }) => service.listChat(actor, params.studyId));
  route(
    'sendChatMessage',
    async ({ actor, params, input }) => {
      const {
        message,
        job: reserved,
        existing,
      } = await service.beginChat(actor, params.studyId, input);
      const job = await service.getJob(actor, reserved.id);
      if (!existing) launch(job, (id) => aiJobs.chat(id));
      return { message, job };
    },
    { status: 202 },
  );
  route('decideShareProposal', async ({ actor, params, input }) =>
    service.decideShare(actor, params.id, input),
  );
  route('shareProposals', async ({ actor, params }) =>
    service.listShareProposals(actor, params.studyId),
  );
  route('learningItems', async ({ actor }) => service.listLearning(actor));
  route('experiences', async ({ actor }) => service.listExperiences(actor));
  route(
    'prepareExperience',
    async ({ actor, input }) => {
      const reserved = await service.prepareExperience(actor, input);
      const job = await service.getJob(actor, reserved.id);
      launch(job, (id) => aiJobs.prepareExperience(id));
      return job;
    },
    { status: 202 },
  );
  route('createExperience', async ({ actor, input }) => service.saveExperience(actor, input), {
    status: 201,
  });
  route('updateExperience', async ({ actor, params, input }) =>
    service.editExperience(actor, params.id, input),
  );
  route('job', async ({ actor, params }) => service.getJob(actor, params.id));

  app.get(`${API_BASE_PATH}${mediaEndpoint.path}`, async (request, reply) => {
    const user = await authenticateRequest(request, service);
    const { id } = mediaEndpoint.params.parse(request.params);
    const media = await service.resolveMedia({ userId: user.id }, id);
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff');
    if (media.kind === 'redirect') return reply.redirect(media.url);
    return reply.type(media.contentType).send(Buffer.from(media.bytes));
  });
}
