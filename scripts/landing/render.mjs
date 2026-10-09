/** Edit true browser recordings into the landing films. No product UI is synthesized. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const FF = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const PROBE = process.env.FFPROBE || '/opt/homebrew/bin/ffprobe';
const WORK = resolve('.local/landing/render');
const OUT = resolve('apps/web/public/media/landing');
await mkdir(WORK, { recursive: true });
await mkdir(OUT, { recursive: true });
const fontPath = resolve('.local/landing/graphics/PretendardVariable.woff2');
try {
  await stat(fontPath);
} catch {
  await mkdir(resolve('.local/landing/graphics'), { recursive: true });
  const f = spawnSync('unzip', [
    '-p',
    'docs/landing/reference/immersive-61-source.zip',
    'scripts/motion-kit/brand/fonts/PretendardVariable.woff2',
  ]);
  if (f.status !== 0) throw new Error('Motion reference ZIP needed for font extraction');
  await writeFile(fontPath, f.stdout);
}
const font = await readFile(fontPath);
const manifests = {};
for (const phase of [
  'experience',
  'conversation',
  'assistant',
  'review',
  'learning',
  'reuse',
  'command',
]) {
  try {
    manifests[phase] = JSON.parse(await readFile(`.local/landing/${phase}.json`, 'utf8'));
  } catch {}
}
const marker = (phase, name) => {
  const m = manifests[phase]?.marks.find((m) => m.name === name);
  if (!m) throw new Error(`Missing ${phase}.${name}: run capture.mjs ${phase} first`);
  return m.t;
};
const clip = (phase, name, offset, duration) => ({
  phase,
  in: Math.max(0, marker(phase, name) + offset),
  duration,
});
// Camera curves follow Career Hacker Alex record-camera-tour and
// record-punch-hold-return; coordinates and timings are adapted to actual UI.
const k = (t, z, x = 0.5, y = 0.5, e = 'inOut') => ({ t, z, x, y, e });
const camera = (kind, duration) => {
  const r = duration / 12;
  const plans = {
    experience: [
      k(0, 1),
      k(0.7, 1),
      k(1.35, 1.19, 0.5, 0.62),
      k(5.85, 1.19, 0.5, 0.62),
      k(6.35, 1.23, 0.5, 0.44, 'out'),
      k(9.05, 1.23, 0.5, 0.44),
      k(9.75, 1),
      k(12, 1),
    ],
    conversation: [
      k(0, 1.04, 0.4, 0.5),
      k(0.7, 1.04, 0.4, 0.5),
      k(1.35, 1.25, 0.38, 0.53),
      k(4.4, 1.25, 0.38, 0.53),
      k(5.25, 1),
      k(6.2, 1),
      k(6.65, 1.3, 0.38, 0.63, 'out'),
      k(10.85, 1.3, 0.38, 0.63),
      k(11.65, 1.05, 0.4, 0.5),
      k(12, 1.05, 0.4, 0.5),
    ],
    assistant: [
      k(0, 1.1, 0.8, 0.65),
      k(0.7, 1.65, 0.89, 0.72),
      k(4.2, 1.65, 0.89, 0.72),
      k(4.6, 1.65, 0.89, 0.4, 'out'),
      k(7.1, 1.65, 0.89, 0.4),
      k(7.6, 1),
      k(8.2, 1),
      k(9, 1.33, 0.38, 0.5),
      k(10.8, 1.33, 0.38, 0.5),
      k(11.7, 1),
      k(12, 1),
    ],
    review: [
      k(0, 1.3, 0.37, 0.45),
      k(1.3, 1.3, 0.37, 0.45),
      k(1.54, 1.42, 0.37, 0.41, 'out'),
      k(5.1, 1.42, 0.37, 0.41),
      k(5.85, 1.3, 0.38, 0.38),
      k(7.1, 1.3, 0.38, 0.38),
      k(7.65, 1),
      k(9.1, 1),
      k(9.7, 1.17, 0.5, 0.5),
      k(11.1, 1.17, 0.5, 0.5),
      k(12, 1),
    ],
    reuse: [
      k(0, 1),
      k(0.7, 1),
      k(1.35, 1.32, 0.32, 0.55),
      k(4.0, 1.32, 0.32, 0.55),
      k(4.75, 1),
      k(5.8, 1),
      k(6.5, 1.18, 0.38, 0.5),
      k(7.6, 1.18, 0.38, 0.5),
      k(8.3, 1.29, 0.38, 0.7),
      k(11.35, 1.29, 0.38, 0.7),
      k(12, 1.15, 0.38, 0.65),
    ],
  };
  return plans[kind].map((p) => ({ ...p, t: p.t * r }));
};
const specs = [
  {
    name: 'experience',
    number: 1,
    title: '일상의 경험을, 대화의 시작으로',
    caption: '짧은 메모를 남기고, AI가 정리한 내용을 직접 확인해요.',
    clips: () => [
      clip('experience', 'input', -0.25, 5),
      clip('experience', 'prepare', -0.45, 1.15),
      clip('experience', 'summary', 0, 3.1),
      clip('experience', 'save', -0.6, 2.75),
    ],
    poster: 7.1,
  },
  {
    name: 'conversation',
    number: 2,
    title: '같은 장면을 보고, 함께 이야기해요',
    caption: '경험에서 만든 주제로 말하고, 원문과 인식 보정을 함께 확인해요.',
    clips: () => [
      clip('conversation', 'ready', 0, 4.9),
      clip('conversation', 'mic-on', -0.45, 1.15),
      clip('conversation', 'transcript', -0.2, 2.65),
      clip('conversation', 'corrected', 0, 3.3),
    ],
    poster: 2.0,
  },
  {
    name: 'assistant',
    number: 3,
    title: '채팅으로 요청하고, 스터디를 조작해요',
    caption: '채팅으로 주제 마무리를 요청하고, 문장별 검토를 시작해요.',
    clips: () => [
      clip('command', 'command-ready', 0, 3.6),
      clip('command', 'send-command', -0.35, 1),
      clip('command', 'command-complete', 0, 3),
      clip('command', 'review-visible', 0, 4.4),
    ],
    poster: 11.5,
  },
  {
    name: 'review',
    number: 4,
    title: '내가 말한 문장을, 더 정확하게',
    caption: '원문과 보정문을 비교하고, 학습할 표현을 직접 검토해요.',
    clips: () => [clip('review', 'ready', -0.6, 11.8)],
    poster: 5.8,
  },
  {
    name: 'reuse',
    number: 5,
    title: '배운 표현으로, 다음 이미지 주제를 만나요',
    caption: '이전 주제에서 저장한 표현: “We’re planning a trip to Busan.”',
    captionStages: [
      { start: 0, end: 5.2, text: '이전 주제에서 저장한 표현: “We’re planning a trip to Busan.”' },
      {
        start: 5.2,
        end: 13,
        text: '그 표현이 반영된 다음 이미지 주제 — 부산 여행 계획을 다시 영어로',
      },
    ],
    clips: () => [
      clip('learning', 'ready', 0, 5.2),
      clip('conversation', 'ready', 0, 3.2),
      clip('assistant', 'ready', 0, 4.6),
    ],
    poster: 10.2,
  },
];
const heroClips = {
  experience: () => [
    clip('experience', 'input', -0.25, 3),
    clip('experience', 'summary', 0, 3.2),
    clip('experience', 'save', -0.6, 1.8),
  ],
  conversation: () => [
    clip('conversation', 'ready', 0, 3),
    clip('conversation', 'transcript', -0.2, 2.2),
    clip('conversation', 'corrected', 0, 2.8),
  ],
  assistant: () => [
    clip('command', 'command-ready', 0, 2.4),
    clip('command', 'send-command', -0.35, 0.7),
    clip('command', 'command-complete', 0, 2),
    clip('command', 'review-visible', 0, 2.9),
  ],
  review: () => [clip('review', 'ready', -0.6, 8)],
  reuse: () => [clip('learning', 'ready', 0, 3), clip('assistant', 'ready', 0, 5)],
};
const heroTitles = {
  experience: '우리의 경험으로 시작하고',
  conversation: '함께 영어로 이야기하고',
  assistant: '채팅으로, 스터디 기능을 실행하고',
  review: '내가 말한 문장을 돌아보고',
  reuse: '배운 표현으로, 다음 이미지를 만나요',
};
function ease(p, kind) {
  return kind === 'out'
    ? `(1-pow(1-(${p}),4))`
    : `if(lt(${p},0.5),8*pow(${p},4),1-8*pow(1-(${p}),4))`;
}
function curve(keys, property, t = 'in_time') {
  let expression = String(keys.at(-1)[property]);
  for (let n = keys.length - 1; n >= 1; n--) {
    const a = keys[n - 1],
      b = keys[n];
    const p = `clip((${t}-${a.t.toFixed(4)})/${(b.t - a.t).toFixed(4)},0,1)`;
    const value =
      a[property] === b[property]
        ? String(a[property])
        : `(${a[property]}+(${b[property] - a[property]})*(${ease(p, b.e)}))`;
    expression = `if(lt(${t},${b.t.toFixed(4)}),${value},${expression})`;
  }
  return expression;
}
const browser = await chromium.launch({ headless: true });
const graphics = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});
const baseCSS = `@font-face{font-family:Film;src:url(data:font/woff2;base64,${font.toString('base64')})}*{box-sizing:border-box}html,body{margin:0;width:1600px;height:900px;background:transparent;font-family:Film,sans-serif}body{color:#282333}`;
async function overlay(spec, label) {
  const png = resolve(WORK, `${label}-overlay.png`);
  const steps = Array.from(
    { length: 5 },
    (_, i) => `<i style="background:${i + 1 <= spec.number ? '#7948e4' : '#e3deed'}"></i>`,
  ).join('');
  await graphics.setContent(
    `<style>${baseCSS}.number{position:absolute;left:80px;top:31px;font-size:17px;font-weight:650;color:#7341d1;letter-spacing:1px;border:1px solid #d6c8ee;border-radius:50%;width:40px;height:40px;display:grid;place-items:center}.title{position:absolute;left:137px;top:29px;font-size:32px;font-weight:700;letter-spacing:-1px}.brand{position:absolute;right:80px;top:33px;font-size:23px;font-weight:750;letter-spacing:-.7px}.brand small{font-size:10px;letter-spacing:2px;font-weight:600;margin-left:12px;color:#81788d}.caption{position:absolute;left:80px;top:847px;font-size:22px;font-weight:550;letter-spacing:-.3px}.status{position:absolute;right:80px;top:852px;font-size:11px;color:#82798e;letter-spacing:.4px}.steps{position:absolute;right:80px;top:76px;display:flex;gap:5px}.steps i{display:block;width:42px;height:3px;border-radius:5px}.frame{position:absolute;left:79px;top:105px;width:1442px;height:722px;border:1px solid #ddd5e7;box-shadow:0 14px 32px rgba(54,34,83,.04)}.rule{position:absolute;bottom:0;width:100%;height:5px;background:#e8e1f2}.rule b{display:block;width:${spec.number * 20}%;height:5px;background:#8050e8}</style><div class="number">${String(spec.number).padStart(2, '0')}</div><div class="title">${spec.title}</div><div class="brand">말모아<small>MALMOA</small></div><div class="steps">${steps}</div><div class="frame"></div><div class="caption">${spec.caption}</div><div class="status">실제 서비스 화면 · 시연 데이터</div><div class="rule"><b></b></div>`,
  );
  await graphics.evaluate(() => document.fonts.ready);
  await graphics.screenshot({ path: png, omitBackground: true });
  return png;
}
await graphics.setViewportSize({ width: 70, height: 70 });
await graphics.setContent(
  `<style>html,body{margin:0;background:transparent}</style><svg width="70" height="70" viewBox="0 0 70 70"><circle cx="20" cy="20" r="18" fill="#8952ee" fill-opacity=".17" stroke="#8952ee" stroke-opacity=".38"/><path d="M20 18 L20 46 L29 39 L36 51 L41 48 L34 36 L47 34 Z" fill="white" stroke="#6f37d1" stroke-width="2.3" stroke-linejoin="round"/></svg>`,
);
const cursor = resolve(WORK, 'cursor.png');
await graphics.screenshot({ path: cursor, omitBackground: true });
await graphics.setViewportSize({ width: 1600, height: 900 });
async function run(args) {
  return new Promise((ok, no) => {
    const child = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', no);
    child.on('exit', (code) => (code === 0 ? ok() : no(new Error(`ffmpeg ${code}: ${err}`))));
  });
}
const evidence = [];
async function render(spec, clips, label, dest) {
  const duration = clips.reduce((sum, c) => sum + c.duration, 0);
  const encoded = resolve(WORK, `${label}-encoded.mp4`);
  const captionStages = spec.captionStages || [{ start: 0, end: duration, text: spec.caption }];
  const overlayPaths = [];
  for (const [n, stage] of captionStages.entries())
    overlayPaths.push(await overlay({ ...spec, caption: stage.text }, `${label}-${n}`));
  const args = ['-threads', '2'];
  const filters = [];
  let clock = 0;
  const events = [];
  clips.forEach((c, i) => {
    args.push('-ss', c.in.toFixed(3), '-t', c.duration.toFixed(3), '-i', manifests[c.phase].file);
    const redactJobId =
      c.phase === 'command' && c.in >= marker('command', 'command-complete') - 0.5;
    filters.push(
      `[${i}:v]fps=30,trim=duration=${c.duration},setpts=PTS-STARTPTS,scale=1440:720,setsar=1[${redactJobId ? `private${i}` : `c${i}`}]`,
    );
    if (redactJobId) {
      // The real model response contains an internal job UUID. Blur only its two
      // inline-code boxes, measured in the original 1440×720 recording. Keep the
      // applied command status and real review screen untouched.
      filters.push(`[private${i}]split=2[main${i}a][id${i}a]`);
      filters.push(`[id${i}a]crop=172:24:1174:315,boxblur=7:3:3:3[blur${i}a]`);
      filters.push(`[main${i}a][blur${i}a]overlay=1174:315[masked${i}a]`);
      filters.push(`[masked${i}a]split=2[main${i}b][id${i}b]`);
      filters.push(`[id${i}b]crop=94:24:1107:339,boxblur=7:3:3:3[blur${i}b]`);
      filters.push(`[main${i}b][blur${i}b]overlay=1107:339[c${i}]`);
    }
    for (const mark of manifests[c.phase].marks) {
      const mouse = manifests[c.phase].mouse.find((m) => m.label === mark.name);
      if (mouse && mark.t >= c.in && mark.t < c.in + c.duration)
        events.push({ t: clock + mark.t - c.in, x: mouse.x, y: mouse.y });
    }
    clock += c.duration;
  });
  filters.push(
    clips.map((_, i) => `[c${i}]`).join('') + `concat=n=${clips.length}:v=1:a=0[edited]`,
  );
  for (const path of overlayPaths) args.push('-loop', '1', '-i', path);
  args.push('-loop', '1', '-i', cursor);
  let stage = 'edited';
  if (events.length) {
    filters.push(
      `[${clips.length + overlayPaths.length}:v]format=rgba,split=${events.length}` +
        events.map((_, i) => `[cursor${i}]`).join(''),
    );
    events.forEach((e, i) => {
      filters.push(
        `[${stage}][cursor${i}]overlay=x=${(e.x - 20).toFixed(2)}:y=${(e.y - 20).toFixed(2)}:enable='between(t,${Math.max(0, e.t - 0.35).toFixed(3)},${(e.t + 0.55).toFixed(3)})':shortest=1[p${i}]`,
      );
      stage = `p${i}`;
    });
  }
  const keys = camera(spec.name, duration);
  const z = curve(keys, 'z');
  const x = curve(keys, 'x');
  const y = curve(keys, 'y');
  filters.push(
    `[${stage}]scale=2880:1440,zoompan=z='${z}':x='max(0,min(iw-iw/zoom,iw*(${x})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${y})-ih/zoom/2))':d=1:s=1440x720:fps=30[screen]`,
  );
  filters.push(`color=c=0xf8f7f3:s=1600x900:r=30:d=${duration}[bg]`);
  filters.push('[bg][screen]overlay=80:106:shortest=1[framed]');
  let framed = 'framed';
  captionStages.forEach((caption, n) => {
    filters.push(
      `[${clips.length + n}:v]format=rgba${n === 0 ? ',fade=t=in:st=0.1:d=0.35:alpha=1' : ''}[labels${n}]`,
    );
    filters.push(
      `[${framed}][labels${n}]overlay=0:0:shortest=1:enable='gte(t,${caption.start})*lt(t,${caption.end})'[labeled${n}]`,
    );
    framed = `labeled${n}`;
  });
  filters.push(`[${framed}]format=yuv420p[out]`);
  args.push(
    '-filter_complex_threads',
    '2',
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-t',
    String(duration),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '24',
    '-maxrate',
    '2000k',
    '-bufsize',
    '4000k',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-movflags',
    '+faststart',
    '-metadata',
    `title=말모아 — ${spec.title}`,
    '-metadata',
    'comment=Actual browser recording of the live service with sample data; silent editorial motion graphics.',
    encoded,
  );
  await writeFile(resolve(WORK, `${label}-filter.txt`), filters.join(';\n'));
  await run(args);
  await rename(encoded, dest);
  evidence.push({
    file: dest.split('/').at(-1),
    duration,
    clips: clips.map((c) => ({ ...c, rawRecording: manifests[c.phase].file.split('/').at(-1) })),
    camera: keys,
    motionReferences: ['record-camera-tour', 'record-punch-hold-return'],
  });
  console.log('RENDERED', label, duration);
}
function timestamp(sec) {
  const ms = Math.round(sec * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
const requested = process.argv.slice(2);
const chosen = specs.filter((s) => !requested.length || requested.includes(s.name));
// Graphics are prepared sequentially; at most two encoder processes run at once.
for (const spec of chosen) {
  const dest = resolve(OUT, `${spec.name}.mp4`);
  await render(spec, spec.clips(), spec.name, dest);
  await run([
    '-ss',
    String(spec.poster),
    '-i',
    dest,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    resolve(OUT, `${spec.name}.jpg`),
  ]);
  const durationProbe = spawnSync(
    PROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', dest],
    { encoding: 'utf8' },
  );
  if (durationProbe.status !== 0) throw new Error(durationProbe.stderr);
  const duration = Number(JSON.parse(durationProbe.stdout).format.duration);
  await writeFile(
    resolve(OUT, `${spec.name}.vtt`),
    'WEBVTT\n\n' +
      (spec.captionStages || [{ start: 0, end: duration, text: spec.caption }])
        .map(
          (c) =>
            `${timestamp(c.start)} --> ${timestamp(Math.min(c.end, duration))}\n${spec.title}\n${c.text}\n`,
        )
        .join('\n'),
  );
}
if (!requested.length || requested.includes('overview')) {
  const paths = [];
  for (const spec of specs) {
    const dest = resolve(WORK, `overview-${spec.name}.mp4`);
    await render(
      {
        ...spec,
        title: heroTitles[spec.name],
        ...(spec.name === 'reuse'
          ? {
              captionStages: [
                { start: 0, end: 3, text: spec.captionStages[0].text },
                { start: 3, end: 8, text: spec.captionStages[1].text },
              ],
            }
          : {}),
      },
      heroClips[spec.name](),
      `overview-${spec.name}`,
      dest,
    );
    paths.push(dest);
  }
  const args = paths.flatMap((p) => ['-i', p]);
  const f = [];
  let prev = '0:v';
  for (let n = 1; n < paths.length; n++) {
    f.push(
      `[${prev}][${n}:v]xfade=transition=fade:duration=0.2:offset=${(n * 7.8).toFixed(1)}[v${n}]`,
    );
    prev = `v${n}`;
  }
  await run([
    ...args,
    '-filter_complex_threads',
    '2',
    '-filter_complex',
    f.join(';'),
    '-map',
    `[${prev}]`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '24',
    '-maxrate',
    '2000k',
    '-bufsize',
    '4000k',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-movflags',
    '+faststart',
    resolve(OUT, 'overview.mp4'),
  ]);
  await run([
    '-ss',
    '10',
    '-i',
    resolve(OUT, 'overview.mp4'),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    resolve(OUT, 'overview.jpg'),
  ]);
  await writeFile(
    resolve(OUT, 'overview.vtt'),
    'WEBVTT\n\n' +
      specs
        .flatMap((s, i) =>
          s.name === 'reuse'
            ? [
                {
                  start: 31.2,
                  end: 34.2,
                  title: heroTitles[s.name],
                  text: s.captionStages[0].text,
                },
                {
                  start: 34.2,
                  end: 39.2,
                  title: heroTitles[s.name],
                  text: s.captionStages[1].text,
                },
              ]
            : [{ start: i * 7.8, end: (i + 1) * 7.8, title: heroTitles[s.name], text: s.caption }],
        )
        .map((c) => `${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.title}\n${c.text}\n`)
        .join('\n'),
  );
}
await browser.close();
const outputs = [];
for (const name of [
  ...chosen.map((s) => s.name),
  ...(!requested.length || requested.includes('overview') ? ['overview'] : []),
]) {
  const file = resolve(OUT, `${name}.mp4`);
  const probe = spawnSync(
    PROBE,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size:stream=codec_name,width,height,pix_fmt,r_frame_rate',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) throw new Error(probe.stderr);
  outputs.push({ name, ...JSON.parse(probe.stdout) });
}
await writeFile(resolve(WORK, 'edit-manifest.json'), JSON.stringify(evidence, null, 2));
await writeFile(resolve(WORK, 'ffprobe.json'), JSON.stringify(outputs, null, 2));
console.log(JSON.stringify(outputs, null, 2));
