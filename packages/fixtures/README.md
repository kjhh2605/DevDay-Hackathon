# Contract fixtures

Explicit development/test mocks for independent UI work. These are not live provider or acceptance evidence.

`createFixtureStore({ userId, scenario })` creates independent state. Scenarios are `waiting`, `talking`, `review` (default), `generating`, `failed`, and `empty`. The user ID configures the mock session; it is not an HTTP actor argument. Use separate stores for independent stories, or `setCurrentUser` to exercise another member against the same state.

```ts
import { setupWorker } from 'msw/browser';
import { createFixtureStore, createHandlers, fixtureIds } from '@devday/fixtures';

const store = createFixtureStore({ userId: fixtureIds.userA, scenario: 'review' });
const worker = setupWorker(...createHandlers(store));
await worker.start();
```

Every JSON endpoint uses the central endpoint registry, validates both input and output, and retains mutations in the store. Long-running mock operations remain running so stories can explicitly exercise pending, success, and failure states through `store.state`; no real OpenAI operation is performed. Error responses use the same envelope as the real API. Personal reads and shared snapshots preserve ownership boundaries.

The event hub routes the actual contract union to subscribed study members or an individual user. The socket factory implements the typed client’s socket interface:

```ts
import { connectEvents } from '@devday/client';
import { createMockEventHub, createMockSocketFactory, events } from '@devday/fixtures';

const hub = createMockEventHub(store);
const connection = connectEvents({
  socketFactory: createMockSocketFactory(hub, fixtureIds.userA),
  onSnapshot: (snapshot) => console.log(snapshot),
  onEvent: (event) => console.log(event),
});
connection.subscribe(fixtureIds.study);
// When a story simulates a committed update, publish its corresponding event.
hub.publishToStudy(fixtureIds.study, events.find((event) => event.type === 'feedback.updated')!);
// Clean up to stop the client heartbeat.
connection.close();
```

Named exports include two users, invitations, image/sentence topics, live/raw/ready transcript segments, sentence source ranges, edited utterances, ready/empty/stale/running/failed feedback, per-owner learning/experiences/chat, pending/accepted/declined sharing, all job result kinds, and every event variant. Importing the seeds validates them with the runtime contract schemas.
