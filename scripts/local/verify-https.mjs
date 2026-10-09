import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')),
);
assert.ok(
  args.origin && args.ca,
  'Usage: node scripts/local/verify-https.mjs --origin=https://<LAN-IP>:5176 --ca=<public-rootCA.pem>',
);
const origin = new URL(args.origin);
assert.equal(origin.protocol, 'https:');
const ca = readFileSync(args.ca);
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const WebSocket = requireApi('ws');
function http(path, body, cookie) {
  return new Promise((done, reject) => {
    const json = body === undefined ? null : JSON.stringify(body);
    const req = request(
      new URL(path, origin),
      {
        ca,
        rejectUnauthorized: true,
        method: json ? 'POST' : 'GET',
        headers: {
          Origin: origin.origin,
          ...(json
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          done({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('HTTPS probe timed out.')));
    if (json) req.write(json);
    req.end();
  });
}
const page = await http('/');
assert.equal(page.status, 200);
assert.match(page.headers['content-type'], /text\/html/);
const anonymous = await http('/api/v1/me');
assert.equal(anonymous.status, 401);
assert.match(anonymous.headers['content-type'], /application\/json/);
assert.equal(JSON.parse(anonymous.body).error.code, 'UNIDENTIFIED');
const registered = await http('/api/v1/auth/register', {
  displayName: 'HTTPS validation',
  handle: `https-${randomUUID().slice(0, 12)}`,
});
assert.ok(registered.status === 200 || registered.status === 201);
const setCookie = registered.headers['set-cookie'][0];
assert.match(setCookie, /; Secure(?:;|$)/i);
assert.match(setCookie, /; HttpOnly(?:;|$)/i);
assert.match(setCookie, /; SameSite=Lax(?:;|$)/i);
const cookie = setCookie.split(';')[0];
assert.equal((await http('/api/v1/me', undefined, cookie)).status, 200);
async function wss(path) {
  return new Promise((done, reject) => {
    const endpoint = new URL(path, origin);
    endpoint.protocol = 'wss:';
    const socket = new WebSocket(endpoint, {
      ca,
      rejectUnauthorized: true,
      headers: { Origin: origin.origin, Cookie: cookie },
    });
    let upgraded = false;
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${path} heartbeat timed out.`));
    }, 10_000);
    socket.on('upgrade', (response) => {
      upgraded = response.statusCode === 101;
    });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'heartbeat.ping' })));
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'heartbeat.pong') {
        clearTimeout(timeout);
        socket.close();
        assert.ok(upgraded);
        done(true);
      } else if (message.type === 'error' || message.type === 'audio.error') {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(`${path} returned ${message.error.code}.`));
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
await wss('/ws/events');
await wss('/ws/audio');
const result = {
  passedAt: new Date().toISOString(),
  origin: origin.origin,
  builtPreview: true,
  caAndHostnameVerified: true,
  secureHttpOnlyLaxCookie: true,
  anonymousApiJson401: true,
  eventsWss101AndHeartbeat: true,
  audioWss101AndHeartbeat: true,
  limitation:
    'Explicit CA verification by Node; OS/browser trust, microphones and two physical laptops remain separate manual checks.',
};
writeFileSync(
  resolve(root, '.local/https-validation-result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
