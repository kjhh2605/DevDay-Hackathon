import { http, HttpResponse } from 'msw';
import { API_BASE_PATH, endpointRegistry, type EndpointName } from '@devday/contracts';
import { createFixtureStore, FixtureError, type FixtureStore } from './store.js';

/** Registry paths, parsers, and responses stay in lockstep with the real typed client. */
export function createHandlers(store: FixtureStore = createFixtureStore(), baseUrl = '') {
  return (Object.keys(endpointRegistry) as EndpointName[]).map((name) => {
    const endpoint = endpointRegistry[name];
    const method =
      endpoint.method === 'GET' ? http.get : endpoint.method === 'POST' ? http.post : http.patch;
    return method(`${baseUrl}${API_BASE_PATH}${endpoint.path}`, async ({ request, params }) => {
      const requestId = crypto.randomUUID();
      try {
        const body: unknown = request.method === 'GET' ? undefined : await request.json();
        const input = endpoint.input.safeParse(body);
        const path = endpoint.params.safeParse(params);
        if (!input.success || !path.success) {
          return HttpResponse.json(
            {
              error: {
                code: 'INVALID_INPUT',
                message: '요청 내용을 확인해 주세요.',
                details: null,
              },
              requestId,
            },
            { status: 400 },
          );
        }
        const data = store.execute(name, path.data, input.data);
        const asynchronous =
          ['requestFeedback', 'sendChatMessage', 'prepareExperience'].includes(name) ||
          (name === 'studyCommand' &&
            typeof data === 'object' &&
            data !== null &&
            'jobId' in data &&
            data.jobId !== null);
        return HttpResponse.json({ data, requestId }, { status: asynchronous ? 202 : 200 });
      } catch (error) {
        if (error instanceof FixtureError) {
          return HttpResponse.json(
            { error: { code: error.code, message: error.message, details: null }, requestId },
            { status: error.status },
          );
        }
        if (error instanceof SyntaxError) {
          return HttpResponse.json(
            {
              error: { code: 'INVALID_INPUT', message: 'JSON 요청이 필요해요.', details: null },
              requestId,
            },
            { status: 400 },
          );
        }
        throw error;
      }
    });
  });
}
