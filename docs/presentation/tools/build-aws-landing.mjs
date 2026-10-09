import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Uses the supplied presentation runtime. Screens are copied from the landing
// assets or extracted from its released videos; product UI is never recreated.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error('Set RUNTIME_NODE_MODULES to the supplied runtime');
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(modules, '@oai/artifact-tool/dist/artifact_tool.mjs')));
const build = path.join(root, '.local/presentation/aws-landing-revision');
const asset = path.join(root, 'docs/presentation/assets/landing');
await fs.mkdir(path.join(build, 'renders'), { recursive: true });

const C = {
  bg: '#F8F6FF', white: '#FFFFFF', ink: '#111111', muted: '#5D5D5D',
  purple: '#7F4FE6', deep: '#5431A6', darkest: '#2E1A66', pale: '#F0E8FF',
  stroke: '#DCCCFF', line: '#E3E3E3', mint: '#1FAF7F', green: '#106F57',
  mintBg: '#EFFCF6', honey: '#F0AF14', honeyBg: '#FFF9EA',
};
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
p.theme.defaultFont = 'Pretendard';
p.theme.colorScheme = { name: '말모아', themeColors: {
  accent1: C.purple, accent2: C.mint, accent3: C.honey, accent4: '#EF4A88',
  accent5: C.deep, accent6: C.stroke, bg1: C.bg, bg2: C.white,
  tx1: C.ink, tx2: C.muted, dk1: C.ink, dk2: C.deep,
  lt1: C.white, lt2: C.pale, hlink: C.purple, folHlink: C.deep,
} };
const timings = [35,40,40,45,45,50,50,45,55,45,60,45,45];
const animations = [];
const slides = [];
let seq = 0;

function text(s, value, x, y, w, h, size = 26, color = C.ink, bold = false, name) {
  const el = s.shapes.add({ geometry: 'textbox', name: name || `text-${++seq}`,
    position: { left:x, top:y, width:w, height:h }, fill:'none', line:{fill:'none',width:0} });
  el.text = value;
  el.text.style = { typeface:'Pretendard', fontSize:size, color, bold, insets:0,
    wrap:'square', autoFit:'none', verticalAlignment:'top', lineSpacing:1.16 };
  return el;
}
function rect(s, x, y, w, h, fill, stroke = 'none', radius = 0, name) {
  return s.shapes.add({ geometry: radius ? 'roundRect' : 'rect', name:name || `surface-${++seq}`,
    position:{left:x,top:y,width:w,height:h}, fill,
    line:{fill:stroke,width:stroke === 'none' ? 0 : 1.2}, ...(radius ? {borderRadius:radius} : {}) });
}
function rule(s, x, y, w, fill=C.stroke) { return rect(s,x,y,w,1,fill); }
function footer(s, n, label='말모아  /  사람과 나누는 영어 대화') {
  rule(s,56,666,1168);
  text(s,label,56,681,1060,22,15,C.muted);
  text(s,`${String(n).padStart(2,'0')}  /  13`,1142,680,84,24,15,C.deep,true);
}
function head(s, section, title, n, label) {
  text(s,section,56,42,1020,24,17,C.deep,true);
  text(s,title,56,85,1168,66,44,C.ink,true);
  footer(s,n,label);
}
async function image(s, file, x, y, w, h, crop, name) {
  const bytes = await fs.readFile(path.isAbsolute(file) ? file : path.join(asset,file));
  return s.images.add({ blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
    contentType:file.endsWith('.jpg') ? 'image/jpeg':'image/png',
    alt:`랜딩사이트 실제 화면: ${path.basename(file)}`, name,
    fit:'cover', ...(crop ? {crop} : {}),
    position:{left:x,top:y,width:w,height:h}, geometry:'roundRect', borderRadius:12 });
}
const crop = (x,y,w,h) => ({left:x/1600,top:y/900,right:1-(x+w)/1600,bottom:1-(y+h)/900});
async function screen(s,file,x,y,w,h,region=[80,105,1440,720],name) {
  rect(s,x-1,y-1,w+2,h+2,C.white,C.stroke,13);
  return image(s,file,x,y,w,h,crop(...region),name);
}
async function logo(s,x=56,y=42,w=190,name) {
  return image(s,path.join(root,'docs/presentation/assets/annotated/brand-from-ui.png'),x,y,w,w*138/510,undefined,name);
}
function note(n, script, sources, details='') {
  const elapsed = timings.slice(0,n-1).reduce((a,b)=>a+b,0);
  const mmss = sec => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  return `슬라이드 ${n}. ${mmss(elapsed)}–${mmss(elapsed+timings[n-1])}, ${timings[n-1]}초\n\n발표 대본\n${script}\n\n근거와 범위\n${details}\n\n출처 (프로젝트 루트 기준)\n${sources.join('\n')}`;
}
function slide(n,script,sources,details='') {
  const s=p.slides.add(); s.background.fill=C.bg;
  s.speakerNotes.text=note(n,script,sources,details); slides.push(s); return s;
}
async function render(s,name) {
  const b=await p.export({slide:s,format:'png',scale:1.5});
  await fs.writeFile(path.join(build,'renders',name+'.png'),new Uint8Array(await b.arrayBuffer()));
}
function arrow(s,from,to,fromSide='right',toSide='left',color=C.stroke,style='solid') {
  const c=s.shapes.connect(from,to,{kind:'straight',fromSide,toSide,
    line:{fill:color,width:2,style},tail:{type:'triangle',width:'sm',length:'sm'}});
  c.bringToFront(); return c;
}
function node(s,title,body,x,y,w,h,{fill=C.white,stroke=C.stroke,color=C.ink,bodyColor=C.muted,size=23}={}) {
  const box=rect(s,x,y,w,h,fill,stroke,12);
  text(s,title,x+18,y+16,w-36,34,size,color,true);
  if(body) text(s,body,x+18,y+55,w-36,h-64,19,bodyColor);
  return box;
}
function table(s,values,x,y,w,h,widths,bodySize=24) {
  const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});
  t.styleOptions={headerRow:false,bandedRows:false};
  t.borders.assign({fill:C.line,width:0.6,style:'solid'});
  t.cells.block({row:0,column:0,rowCount:values.length,columnCount:values[0].length}).assign({
    fill:C.white,textStyle:{typeface:'Pretendard',fontSize:bodySize,color:C.ink},
    margins:{left:20,right:16,top:10,bottom:10},anchor:'center'});
  for(let c=0;c<values[0].length;c++) {
    const cell=t.getCell(0,c);cell.fill=C.pale;
    cell.text.style={typeface:'Pretendard',fontSize:20,color:C.deep,bold:true};
  }
  return t;
}
function beginBuild(s,n) {
  const start=s.shapes.items.length+s.images.items.length+s.tables.items.length;
  rect(s,0,0,1280,720,C.bg,'none',0,`build-${n}-cover`);
  return start;
}
function endBuild(s,n) {
  // The XML postprocessor groups everything after this named cover. A single
  // native Appear effect reveals the complete second composition on one click.
  animations.push({slide:n,coverName:`build-${n}-cover`});
}

// 01. Retain the opening and the user's edited message, with a clearer hierarchy.
{
  const s=slide(1,'AI가 일과 학습을 도와주는 시대에, 사람과 이야기하는 시간은 어떻게 달라질까요? [한 번 클릭] AI와의 대화는 늘어가지만, 사람과의 대화는 줄어들고 있습니다. 말모아는 이 문제의식에서 시작했습니다.',
    ['docs/presentation/output/말모아_10분_프로젝트발표_편집가능.pptx'],
    '후반 문구는 사용자가 편집한 원본을 유지했다. 정량적으로 측정한 시장 추세가 아닌 프로젝트의 문제의식으로 소개한다.');
  await logo(s);text(s,'AI가 인간을\n대체할까?',56,213,1120,186,76,C.ink,true);
  text(s,'취업 기회도, 함께 공부하던 시간도?',60,447,1110,52,32,C.muted);
  footer(s,1);await render(s,'01-a');
  beginBuild(s,1);await logo(s);
  text(s,'AI와의 대화는 늘어가지만,',56,219,1168,78,54,C.ink,true);
  text(s,'사람과의 대화는\n줄어들고 있습니다.',56,322,1168,170,62,C.deep,true);
  footer(s,1);endBuild(s,1);await render(s,'01-b');
}
// 02. Keep the edited product framing and its three-step relationship.
{
  const s=slide(2,'AI가 발전해도 대화의 중심에는 사람이 있어야 합니다. 말모아는 사람과 나누는 영어 대화를 돕습니다. 내 경험으로 주제를 준비하고, 함께 이야기한 뒤, 배운 표현을 다음 대화에 다시 가져옵니다.',
    ['design/tokens.css','apps/web/src/features/landing/LandingPage.tsx'],
    '기존 지인의 영어 스터디를 지원한다. 새 친구 매칭과 음성 통화 중계 기능은 현재 범위에 없다.');
  await logo(s);
  text(s,'AI가 발전해도,\n대화의 중심에는 사람이 있어야 합니다.',56,174,1168,154,51,C.ink,true);
  text(s,'사람과 나누는 영어 대화를 돕는 AI, 말모아',56,358,1168,50,31,C.deep,true);
  const labels=['내 경험을 남기고','함께 대화하고','배운 표현을 다시 본다'];
  let prev;
  for(let i=0;i<3;i++) {const x=56+i*405;text(s,String(i+1).padStart(2,'0'),x,471,60,33,23,C.purple,true);
    const a=text(s,labels[i],x,519,354,44,29,C.ink,true);if(prev)arrow(s,prev,a);prev=a;}
  footer(s,2);await render(s,'02');
}
// 03. Landing experience screen, with editable labels outside the screenshot.
{
  const s=slide(3,'여행처럼 일상에서 겪은 일을 짧게 적습니다. AI가 정리한 경험과 관심사를 본인이 확인하고 저장합니다. 이 기록이 함께 이야기할 주제의 재료가 됩니다.',
    ['apps/web/public/media/landing/experience.jpg','docs/landing/video-production.md','packages/ai/src/jobs.ts'],
    '랜딩사이트 경험 영상의 실제 포스터다. 원문, AI 정리, 관심사 필드를 그대로 보여준다.');
  head(s,'01  경험','내 경험으로 시작하는 영어 대화',3);
  text(s,'직접 쓴 이야기',56,211,276,38,27,C.deep,true);
  text(s,'친구와 다녀온\n부산 여행을 기록',56,260,276,90,27);
  rule(s,56,386,240);
  text(s,'AI 정리 확인',56,421,276,38,27,C.deep,true);
  text(s,'관심사와 장소를\n확인한 뒤 저장',56,470,276,88,27);
  await screen(s,'experience.jpg',354,185,870,435);
  await render(s,'03');
}
// 04. Keep the existing click from topic to transcript, using landing frames.
{
  const s=slide(4,'저장한 경험을 바탕으로 같은 이미지 주제를 만납니다. 부산 여행 사진과 대화 안내를 함께 보고 이야기를 시작합니다. [한 번 클릭] 발화는 실시간 원문으로 남고, 같은 음성을 다시 전사한 인식 보정도 함께 확인합니다.',
    ['apps/web/public/media/landing/conversation.jpg','apps/web/public/media/landing/conversation.mp4','docs/landing/video-production.md'],
    'TOPIC 02의 실제 생성 이미지이며 사용자의 경험을 촬영한 사진이 아니다. 합성 WAV를 파일 마이크로 입력해 실제 API를 호출한 시연이다. 물리 마이크 인수 결과와 구분한다.');
  head(s,'02  함께 대화','같은 이미지에서 시작하는 대화',4,'서비스에서 생성한 이미지 주제 / 시연 계정의 실제 화면');
  await screen(s,'conversation.jpg',56,185,850,425);
  text(s,'부산 여행의 한 장면',946,211,278,74,27,C.deep,true);
  text(s,'경험에서 만든\n공통 이미지 주제',946,306,278,90,27);
  rule(s,946,431,278);
  text(s,'두 사람이 같은 주제로\n서로의 이야기를\n이어갑니다',946,467,278,120,25);
  await render(s,'04-a');
  beginBuild(s,4);
  head(s,'02  함께 대화','원문과 인식 보정을 함께 확인',4,'합성 음성을 사용한 실제 서비스 시연 / 물리 마이크 검증과 구분');
  await screen(s,'transcript.png',56,204,1168,353,[121,276,1329,402]);
  text(s,'말한 내용은 원문으로 남기고, 인식 보정 결과를 나란히 보여줍니다',56,599,1168,42,27,C.deep,true);
  endBuild(s,4);await render(s,'04-b');
}
// 05. Actual natural-language request and completed operation from landing.
{
  const s=slide(5,'개인 챗봇에서 표현을 배우고 저장하거나 스터디 기능을 요청할 수 있습니다. 여기서는 현재 주제를 마무리하고 문장별 리뷰를 준비해 달라고 요청했습니다. 서버가 허용된 동작을 실행하고 실제 검토 화면으로 전환했습니다.',
    ['apps/web/public/media/landing/assistant.mp4','apps/web/public/media/landing/assistant.jpg','docs/landing/video-production.md','packages/ai/src/chat.ts'],
    '해당 시연의 commandResults.outcome=applied, talking→review, 피드백 3개 ready를 확인했다. 랜딩 영상에 적용한 내부 작업 UUID 흐림은 그대로 유지한다. 위쪽의 별도 보류 응답은 요청 전의 이전 대화이므로 화면에서는 입력 필드만 확대한다.');
  head(s,'03  개인 챗봇','자연어 요청으로 스터디 기능 실행',5);
  text(s,'요청',56,185,350,32,23,C.deep,true);
  text(s,'실행 결과',505,185,719,32,23,C.deep,true);
  await screen(s,'assistant-request.png',56,245,392,232,[941,442,511,302]);
  text(s,'주제 마무리와\n문장별 리뷰를 요청',56,525,380,79,25,C.ink,true);
  await screen(s,'assistant.jpg',505,234,719,359.5);
  text(s,'주제 마감 후 문장별 피드백 생성',505,610,719,34,24,C.green,true);
  await render(s,'05');
}
// 06. Review, then approved learning reused in the next image topic.
{
  const s=slide(6,'내가 말한 문장을 원문과 인식 보정으로 비교하고 학습 표현을 검토합니다. 문장을 직접 수정하거나 피드백을 다시 요청할 수 있습니다. [한 번 클릭] 승인한 “We’re planning a trip to Busan.”이 개인 학습에 저장됐고 다음 부산 이미지 주제의 대화 안내에 반영됐습니다.',
    ['apps/web/public/media/landing/review.jpg','apps/web/public/media/landing/reuse.mp4','apps/web/public/media/landing/reuse.jpg','docs/landing/video-production.md','docs/presentation/evidence/learning-result.json','docs/presentation/evidence/next-result.json'],
    '새 랜딩 영상에서 편집기를 연 동작은 취소로 끝났으므로 이 화면을 수정 저장 성공으로 설명하지 않는다. 학습 재사용 예시는 첫 주제의 approved_feedback 항목이 TOPIC 02의 generation_input과 learningExpressionIds에 포함된 사례다. 모든 과거 표현을 자동으로 포함하거나 이미지 픽셀에 문장을 넣는다는 의미가 아니다.');
  head(s,'04  검토와 학습','피드백을 검토하고, 내 학습에 저장',6);
  await screen(s,'review.jpg',56,183,852,444,[121,108,1329,692]);
  text(s,'내가 말한 문장',946,209,278,40,27,C.deep,true);
  text(s,'원문을 보존하고\n인식 보정을 비교',946,262,278,80,26);
  rule(s,946,396,278);
  text(s,'내가 배울 표현',946,435,278,40,27,C.green,true);
  text(s,'피드백을 검토한 뒤\n학습 기록으로 저장',946,488,278,91,26);
  await render(s,'06-a');
  beginBuild(s,6);
  head(s,'04  검토와 학습','배운 표현을 다음 대화에 다시 활용',6,'직전 주제에서 승인한 표현을 다음 이미지 주제에 반영한 실제 사례');
  text(s,'승인한 학습 표현',56,184,550,34,24,C.green,true);
  text(s,'다음 이미지 주제',668,184,556,34,24,C.deep,true);
  await screen(s,'learning.png',56,239,552,311,[343,398,680,383]);
  await screen(s,'reuse.jpg',668,239,556,311,[122,105,1318,737]);
  text(s,'We’re planning a trip to Busan.',56,578,552,42,29,C.green,true);
  text(s,'부산 여행 계획을 다시 영어로',668,578,556,42,28,C.deep,true);
  endBuild(s,6);await render(s,'06-b');
}
// 07. Native table, kept editable and visually calmer than the source.
{
  const s=slide(7,'경험 정리와 주제, 피드백, 챗봇에는 Responses를 사용합니다. 발화 완료와 행동 분류에는 Decisions를 사용합니다. 실시간 전사와 원본 음성 재전사는 별도 모델이며, 주제 이미지는 Images API로 생성합니다. 모든 결과는 서버가 검증하고 저장합니다.',
    ['packages/ai/src/config.ts','packages/ai/src/provider.ts','docs/presentation/evidence/provider-audit.jsonl'],
    '모델명은 저장소 설정과 2026-10-09 실제 호출 기록의 값이다. 모델 가용성이나 미래 설정을 일반화하지 않는다.');
  head(s,'기술  /  OpenAI','OpenAI 모델과 서비스 연결',7,'모델은 환경변수로 설정 / 서버가 결과를 검증하고 저장');
  const t=table(s,[['역할','실제 설정 모델','연결 API'],
    ['경험, 주제, 피드백, 챗봇','gpt-6-luna','Responses'],
    ['발화 완료와 행동 분류','gpt-6-luna','Decisions'],
    ['실시간 원문 전사','gpt-live-transcribe','Realtime transcription'],
    ['같은 음성 재전사','gpt-transcribe','Audio Transcriptions'],
    ['대화 주제 이미지','gpt-image-2.5-flare-\n2026-09-08','Images']],56,179,1168,394,[388,442,338],23);
  t.rows[0].height=46;for(let i=1;i<6;i++)t.rows[i].height=i===5?88:65;
  const a=text(s,'React / SEED',56,605,245,34,24,C.deep,true);
  const b=text(s,'Fastify HTTP / WS',398,605,283,34,24,C.deep,true);
  const c=text(s,'OpenAI + PostgreSQL + S3',793,605,430,34,24,C.deep,true);
  arrow(s,a,b);arrow(s,b,c);await render(s,'07');
}
// 08. Update the explanation to the actual landing transcript, rather than the
// older 'planned → plan' capture which is absent from the new frame.
{
  const s=slide(8,'인식 보정과 학습 피드백은 다른 단계입니다. 같은 음성을 다시 전사하자 한글로 인식된 “레이니 데이즈”가 “rainy days”로 보정됐습니다. “She don’t”는 그대로 남았습니다. 문법이나 더 자연스러운 표현은 이후 문장별 검토에서 다룹니다.',
    ['apps/web/public/media/landing/conversation.mp4','packages/ai/src/provider.ts','docs/landing/video-production.md'],
    'conversation.mp4 10.1초의 실제 화면이다. 원문: 오늘은 좀 피곤해요. She don’t like 레이니 데이즈. We plan a trip to Busan. 인식 보정: 오늘은 좀 피곤해요. She don’t like rainy days. We plan a trip to Busan. 합성 음성 1개 사례이며 일반 정확도 수치를 뜻하지 않는다.');
  head(s,'기술  /  음성 처리','음성 인식 보정과 학습 피드백',8,'합성 음성을 사용한 시연 사례 / 인식 보정의 일반 정확도를 뜻하지 않음');
  await screen(s,'transcript.png',56,188,1168,147,[121,298,1329,168]);
  text(s,'인식 보정',56,397,532,41,28,C.green,true);
  text(s,'“레이니 데이즈”를\n“rainy days”로 인식',56,455,532,92,32,C.ink,true);
  text(s,'같은 원본 음성을 다시 전사',56,573,532,39,24,C.muted);
  text(s,'학습 피드백',692,397,532,41,28,C.deep,true);
  text(s,'“She don’t…”는\n인식 보정에도 유지',692,455,532,92,32,C.ink,true);
  text(s,'문법과 표현은 문장별 검토에서 제안',692,573,532,39,24,C.muted);
  await render(s,'08');
}
// 09. Two aligned, native decision flows.
{
  const s=slide(9,'Decisions는 발화 완료와 챗봇 행동을 분류합니다. 발화에서는 전사와 침묵 시간을 보고 묶음을 판단하고, 주제 마감 후 Responses가 문장으로 나눕니다. 챗봇에서는 서버가 허용한 행동만 고릅니다. 분류 결과와 별개로 서버가 출처, 소유권, 상태와 버전을 검사합니다.',
    ['packages/ai/src/speech-boundary.ts','packages/ai/src/group-sentences.ts','packages/ai/src/chat.ts','apps/api/src/domain/commands.ts','docs/presentation/evidence/decisions.jsonl'],
    '원래 발표 증거의 음성 경계 설정은 최초 침묵 1초, 완료 신뢰도 기준 0.85, 최대 침묵 10초였다. 배포 릴리스의 speech 2000ms 설정과 섞지 않는다. 해당 초기 시연은 complete 0.67로 기준 미달 후 silence_timeout으로 확정됐다. 신뢰도는 정답률이 아니다.');
  head(s,'기술  /  Decisions','AI의 분류와 서버의 실행 검사',9,'Decisions는 API 명칭 / 문장 분할은 Responses / 신뢰도는 정확도 수치가 아님');
  text(s,'발화 묶음과 문장 저장',56,179,1168,37,29,C.deep,true);
  const r1=[['전사와 맥락','같은 화자, 침묵 시간'],['Decisions','완료 / 계속 / 불확실'],['Responses','주제 마감 후 문장 분할'],['서버 검증','출처, 순서, 누락, 화자']];
  const r2=[['요청과 현재 상태','가능한 행동을 제공'],['Decisions','허용된 행동 중 선택'],['구조화된 인자','기능에 필요한 값 생성'],['서버 실행 검사','멤버십, 소유권, 버전']];
  for(const [r,y] of [[r1,239],[r2,489]]) {
    let prev;
    for(let i=0;i<4;i++) {const x=56+i*303;const last=i===3;
      const box=node(s,r[i][0],r[i][1],x,y,259,118,{fill:last?C.mintBg:C.white,stroke:last?'#AFF6D7':C.stroke,color:last?C.green:C.ink,size:24});
      if(prev)arrow(s,prev,box);prev=box;}
  }
  rule(s,56,401,1168);
  text(s,'챗봇의 행동 선택과 권한',56,429,1168,37,29,C.deep,true);
  await render(s,'09');
}
// 10. Deployment toolchain, not a service-runtime MCP dependency.
{
  const s=slide(10,'Codex와 AWS MCP를 활용해 서울 리전에 배포를 진행했습니다. CDK로 기반 리소스를 구성하고 컨테이너 이미지를 ECR에 게시했습니다. 동일 이미지로 DB 마이그레이션을 완료한 뒤 앱을 시작하고 CloudFront와 웹을 연결했습니다. 후속 랜딩 재배포에서는 AWS MCP로 계정과 배포 대상을 확인하고 S3 게시와 CloudFront 갱신을 진행했습니다. HTTPS, 두 WebSocket, OpenAI와 데이터 연결, task 교체 후 영속성도 확인했습니다.',
    ['사용자 설명: AWS MCP를 사용해 배포 진행','docs/implementation/evidence/release.md','docs/architecture/aws-deployed-architecture.md','infra/src/stacks.ts','scripts/deploy/cli.ts'],
    '최초 AWS 배포와 후속 웹 재배포 기록을 함께 따른다. 후속 웹 배포는 AWS MCP의 계정·stack output 조회로 대상 버킷을 확인한 뒤 presigned S3 PUT으로 23개 파일을 게시했고, CloudFront invalidation 완료를 확인했다. API image, ECS task, DB schema, 네트워크는 유지했으며 웹은 랜딩·영상과 테스트 초대 아이디 안내를 반영했다. 출처: docs/implementation/evidence/release.md의 웹 재배포와 테스트 계정 절, reports/aws-web-redeployment.json, reports/aws-web-invalidation.json. AWS MCP는 개발·배포 과정에 쓰이며 제품 요청 경로의 의존성이 아니다. 작업 시간 절감 수치는 주장하지 않는다. AWS URL에서 두 물리 노트북·실마이크 G4 인수 결과는 미확인이다.');
  head(s,'배포  /  AWS MCP','AWS MCP를 활용한 배포',10,'2026-10-09 배포 기록 기준 / AWS URL의 두 실기기·실마이크 인수 결과는 미확인');
  text(s,'AWS MCP로 배포 대상을 확인하고, S3 게시와 CloudFront 갱신을 진행했습니다',56,170,1168,54,28,C.deep,true);
  const steps=[['기반 구성','VPC, RDS, S3\nSecrets Manager'],['API 배포','CDK / ECR\nECS Fargate'],['DB 반영과 앱 시작','일회성 migration 성공\n앱 task 1개 시작'],['서비스 공개','CloudFront 연결\n웹 파일 S3 게시']];
  let prev;
  for(let i=0;i<4;i++) {const x=56+i*303;
    text(s,String(i+1).padStart(2,'0'),x,259,72,35,25,C.purple,true);
    const n=node(s,steps[i][0],steps[i][1],x,310,259,135,{fill:i===3?C.pale:C.white,size:23});
    if(prev)arrow(s,prev,n);prev=n;}
  text(s,'배포 후 확인',56,497,230,36,25,C.green,true);
  text(s,'HTTPS와 WebSocket, OpenAI와 DB·이미지 연결\nECS task 교체 후 같은 세션과 학습 데이터 재조회',303,493,921,78,26);
  text(s,'d31qyxseqz8321.cloudfront.net',56,600,1168,40,28,C.deep,true);
  await render(s,'10');
}
// 11. Editable architecture. Nodes represent deployed resources; no AWS icons
// or decorative raster drawing is substituted for the actual topology.
{
  const s=slide(11,'브라우저는 하나의 CloudFront 주소로 접속합니다. 정적 웹은 비공개 S3에서 제공하고 API와 WebSocket은 VPC Origin, 내부 ALB를 거쳐 Fargate의 Fastify로 전달합니다. 앱은 RDS에 데이터를, 별도 S3에 이미지를 저장합니다. 외부 OpenAI 호출은 앱 task의 public IPv4와 Internet Gateway를 사용합니다. 비밀값은 Secrets Manager, 로그는 CloudWatch로 관리합니다.',
    ['docs/architecture/aws-deployed-architecture.md','docs/architecture/aws-runtime.svg','infra/src/stacks.ts','docs/implementation/evidence/release.md'],
    'CloudFront는 글로벌 서비스, 나머지 AWS 리소스는 서울 리전이다. VPC는 2 AZ의 public/isolated subnet을 갖는다. 내부 ALB와 RDS는 private isolated, Fargate는 public subnet. 앱 task는 1개, RDS는 Single-AZ라 다중 AZ 앱 가용성을 제공하지 않는다. CloudFront→S3는 OAC/HTTPS, VPC Origin→ALB는 HTTP:80, ALB→task는 HTTP:3000, task→RDS는 verify-full TLS:5432. API/WS 캐시 비활성. task 인바운드는 ALB SG만 허용. NAT Gateway와 VPC endpoint는 없다. Media S3는 API 권한 확인 후 브라우저에 presigned GET을 제공한다. 간결한 요청 경로 다이어그램으로 미디어 조회의 브라우저 리다이렉트와 task 시작 시 ECR/Secrets/로그 의존선은 본문 및 노트로 설명한다.');
  head(s,'배포  /  서비스 구조','말모아 AWS 아키텍처',11,'서울 리전 ap-northeast-2 / 앱 task 1개, RDS Single-AZ');
  // Region boundary deliberately excludes the global CloudFront and OpenAI.
  rect(s,453,272,771,252,C.white,C.stroke,16);
  text(s,'AWS 서울  /  VPC',477,286,280,27,19,C.deep,true);
  const browser=node(s,'브라우저','React SPA',56,335,158,101,{size:22});
  const edge=node(s,'CloudFront','HTTPS / WSS',258,335,165,101,{fill:C.pale,size:22,color:C.deep});
  const web=node(s,'Web S3','비공개 정적 웹',258,173,165,109,{fill:C.mintBg,stroke:'#AFF6D7',size:22,color:C.green});
  const alb=node(s,'Internal ALB','HTTP :80',477,335,188,101,{size:22});
  const ecs=node(s,'ECS Fargate','Fastify API / WS',722,335,222,101,{fill:C.deep,stroke:C.deep,color:C.white,bodyColor:C.white,size:25});
  const db=node(s,'RDS PostgreSQL','TLS :5432',995,335,205,101,{fill:C.mintBg,stroke:'#AFF6D7',color:C.green,size:20});
  const media=node(s,'Media S3','비공개 생성 이미지',722,173,222,109,{fill:C.mintBg,stroke:'#AFF6D7',color:C.green,size:23});
  const ai=node(s,'OpenAI API','전사, 판단, 이미지',722,548,222,98,{fill:C.pale,color:C.deep,size:23});
  // Short labels remain clear of node text and connector endpoints.
  arrow(s,browser,edge);arrow(s,edge,alb);arrow(s,alb,ecs);arrow(s,ecs,db);
  arrow(s,edge,web,'top','bottom',C.mint);
  arrow(s,ecs,media,'top','bottom',C.mint);
  arrow(s,ecs,ai,'bottom','top',C.purple,'dashed');
  text(s,'OAC',281,303,92,22,16,C.green);
  text(s,'/api/*  /ws/*',427,245,260,24,19,C.deep,true);
  text(s,'VPC Origin',441,315,140,19,14,C.deep);
  text(s,'내부 ALB와 DB는 private subnet',477,475,310,25,18,C.muted);
  text(s,'앱은 public subnet',976,475,230,25,19,C.muted);
  text(s,'public IPv4 / IGW',960,552,256,27,18,C.deep);
  text(s,'외부 API 송신',960,584,256,26,18,C.muted);
  text(s,'Secrets Manager',56,546,280,28,21,C.deep,true);
  text(s,'키와 DB 자격증명 주입',56,581,300,29,20,C.muted);
  text(s,'CloudWatch Logs',377,546,285,28,21,C.deep,true);
  text(s,'앱 로그 보관',377,581,285,29,20,C.muted);
  await render(s,'11');
}
// 12. Keep the existing introduction hypothesis in the project palette.
{
  const s=slide(12,'첫 도입 후보는 정기적으로 만나는 대학 영어회화 스터디입니다. 학생 두 명이 사용하고 동아리나 회화 프로그램 담당자가 운영합니다. 구매 후보는 대학 어학교육원이나 비교과 부서입니다. 4주 시범 운영에서 준비 시간, 재참여와 복습을 확인하려고 합니다.',
    ['docs/presentation/evidence-audit.md#e08-도입-가설'],
    '사용자, 운영자, 구매자는 도입 가설이다. 가격, 지불 의사, 비용 절감, 유지율은 미측정이다. 기관 관리 대시보드와 과금 기능은 없으며 파일럿은 외부 운영표로 보완한다.');
  head(s,'도입 가설','대학 영어회화 스터디',12,'구매 의사, 가격, 비용 절감과 유지율은 미측정');
  const t=table(s,[['누가','제안하는 첫 사용 맥락'],['이용자','정기적으로 만나는 한국어권 학습자 2인'],['운영자','동아리와 소규모 회화 프로그램 담당자'],['구매 후보','대학 어학교육원과 비교과 프로그램 담당 부서']],56,185,1168,278,[225,943],26);
  t.rows[0].height=47;for(let i=1;i<4;i++)t.rows[i].height=77;
  text(s,'기대 가치',56,511,214,34,25,C.deep,true);
  text(s,'주제 준비와 표현 정리 부담 감소',293,507,931,42,30,C.ink,true);
  text(s,'첫 검증',56,587,214,34,25,C.green,true);
  text(s,'4주 시범 운영에서 준비 시간, 재참여, 복습 관찰',293,584,931,46,27);
  await render(s,'12');
}
// 13. Preserve the closing build; add the deployment to the Codex evidence.
{
  const s=slide(13,'Codex는 발견한 문제를 구현으로 개선하는 데 활용했습니다. 끊기는 전사는 음성 테스트 모듈과 발화 묶음으로, 부적절한 요청 처리는 행동 분류와 서버 검사로 보완했습니다. AWS MCP와 함께 실제 서비스 배포도 진행했습니다. [한 번 클릭] 사람과 이야기하는 시간은 이어가고, 준비와 기록은 말모아가 돕습니다.',
    ['packages/test-voice/README.md','packages/ai/src/speech-boundary.ts','packages/ai/src/chat-decision.ts','docs/implementation/evidence/release.md','사용자 설명: Codex 및 AWS MCP 활용'],
    'Codex를 사용한 경위는 사용자 설명에 근거한다. 코드와 통합 경로, 실제 배포 검증 결과, AWS MCP를 활용한 후속 웹 게시 기록을 확인했다. Codex 작업 시간이나 생산성 개선 수치는 제시하지 않는다.');
  head(s,'Codex 활용','발견한 문제를 Codex와 개선',13);
  const t=table(s,[['발견한 문제','Codex와 진행한 작업','결과 확인'],
    ['전사가 끊겨 문맥이 나뉨','음성 테스트 모듈\nDecisions 발화 묶음','저장, 보정, 리뷰 통합\n경계 테스트'],
    ['부적절한 요청 처리','가능한 행동 분류\n서버 실행 제한','실제 실행에서\n성공과 보류 확인'],
    ['외부에서 서비스 사용','AWS MCP와 CDK로\nAWS 배포 진행','HTTPS와 WebSocket\n데이터 영속성 검증']],56,181,1168,358,[330,430,408],25);
  t.rows[0].height=49;for(let i=1;i<4;i++)t.rows[i].height=103;
  text(s,'사람이 발견한 문제를 기준으로 결과를 검토하고 통합했습니다',56,585,1168,48,30,C.deep,true);
  await render(s,'13-a');
  beginBuild(s,13);await logo(s,56,47,210);
  text(s,'사람과 이야기하는 시간은\n이어가고,',56,209,1168,159,62,C.ink,true);
  text(s,'준비와 기록은\n말모아가 돕습니다',56,419,1168,149,57,C.deep,true);
  footer(s,13);endBuild(s,13);await render(s,'13-b');
}

await fs.writeFile(path.join(build,'animation-plan.json'),JSON.stringify(animations,null,2));
await fs.writeFile(path.join(build,'font-policy.json'),JSON.stringify({basis:'design',families:['Pretendard']},null,2));
await fs.writeFile(path.join(build,'presentation.json'),JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(path.join(build,'candidate.pptx'));
console.log(JSON.stringify({slides:slides.length,seconds:timings.reduce((a,b)=>a+b,0),build,animations}));
