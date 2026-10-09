// Layout-only annotation: source PNG pixels are placed unchanged in HTML.
// No UI text, application DOM, model result, or screenshot pixels are repainted.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(root,'assets/annotated'); await mkdir(out,{recursive:true});
const sources=new Map();
async function src(name){if(!sources.has(name)){const b=await readFile(resolve(root,'assets/raw',name+'.png'));sources.set(name,{uri:'data:image/png;base64,'+b.toString('base64'),width:b.readUInt32BE(16)/2,height:b.readUInt32BE(20)/2});}return sources.get(name);}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function label(x,y,w,title,body,tone='purple'){return `<section style="position:absolute;left:${x}px;top:${y}px;width:${w}px"><h2 style="color:${tone==='mint'?'#106F57':'#5431A6'}">${title}</h2><p>${body}</p></section>`;}
async function crop(name,rect,x,y,scale,focus=[]){const s=await src(name);const [cx,cy,w,h]=rect;return `<div class="crop" style="left:${x}px;top:${y}px;width:${w*scale}px;height:${h*scale}px"><img alt="${name}: unmodified screenshot crop" src="${s.uri}" style="position:absolute;width:${s.width*scale}px;height:${s.height*scale}px;max-width:none;left:${-cx*scale}px;top:${-cy*scale}px">${focus.map(f=>`<div class="focus ${f[4]||''}" style="left:${(f[0]-cx)*scale}px;top:${(f[1]-cy)*scale}px;width:${f[2]*scale}px;height:${f[3]*scale}px"></div>`).join('')}</div>`;}
const footer=text=>`<footer>${text}</footer>`;
const sheets=[];
sheets.push({name:'s03-experience',body:
 label(55,130,380,'01 · 나의 경험','직접 쓴 이야기<br>→ AI 정리 확인<br>→ 저장')+
 label(55,535,375,'대화의 소재','부산 해운대<br>여행 · 사진 촬영')+
 await crop('03-experience-saved',[280,760,518,322],510,100,2.58,[[302,938,148,36,'honey']])+
 footer('실제 저장 후 재조회 화면 · 시연용 경험 · 강조는 캡처 바깥의 주석과 테두리만 사용')});
sheets.push({name:'s04-topic',body:
 await crop('05-topic',[66,180,1115,712],45,82,1.10,[[94,756,1055,108]])+
 label(1340,130,510,'02 · 함께 대화','저장한 부산 여행을<br>공통 주제로 연결')+
 label(1340,410,510,'대화 진행 안내','주말 경험을 설명하고<br>상대의 바다 여행 취향을<br>물어보도록 안내')+
 label(1340,750,510,'실제 연결 확인','같은 스터디의 두 계정<br>+ 저장한 경험 ID')+
 footer('실제 서비스가 생성한 이미지 주제 · 그림은 AI 생성 콘텐츠이며 사용자 경험의 실사 사진이 아님')});
sheets.push({name:'s05-chat',body:
 label(60,24,800,'03 · 표현을 배우고 저장','')+
 await crop('06b-chat-expression',[1218,374,300,404],70,100,2.10,[[1218,650,294,118,'honey']])+
 label(960,24,860,'04 · 채팅으로 주제 마무리','')+
 await crop('09-review',[1218,505,300,292],960,114,2.70)+
 '<p style="position:absolute;left:960px;top:935px;font-size:29px">주제 마감 이후 문장별 피드백 생성 완료</p>'+
 footer('일부 자연어 요청은 신뢰도 기준에 못 미쳐 보류됨 · 모든 동작의 채팅 성공을 뜻하지 않음')});
sheets.push({name:'s06-review-edit',body:
 label(60,26,1750,'05 · 보정문을 직접 고치면, 기존 피드백을 다시 확인','')+
 await crop('12-edited-stale',[77,990,650,287],58,235,2.12,[[147,1000,87,28,'mint']])+
 label(1500,265,365,'원문은 유지','She don’t…는<br>원문에 그대로 보존')+
 label(1500,550,365,'최신 문장 기준','보정문 저장 후<br>‘재요청 필요’로 전환')+
 footer('수정 기능 시연: 사용자가 don’t → doesn’t를 직접 입력 · 음성 재전사의 결과로 주장하지 않음')});
sheets.push({name:'s06-learning',body:
 label(65,40,1780,'06 · 승인한 피드백은 말한 사람의 학습 기록으로','')+
 await crop('15-learning',[280,345,515,292],70,195,1.72,[[303,368,100,34,'mint']])+
 await crop('15-learning',[280,651,515,292],1015,195,1.72,[[303,675,100,34]])+
 label(70,765,815,'스터디 피드백','검토·수정·재요청 후 승인한 표현', 'mint')+
 label(1015,765,815,'개인 챗봇','대화 중 요청해 저장한 표현')+
 footer('승인은 ‘승인하고 다음 주제’ 버튼으로 완료 · 민지 3개 / 지훈 0개: 이 시연의 조회 결과')});
sheets.push({name:'s08-transcript',body:
 label(70,40,1780,'같은 음성을 다시 전사한 결과','')+
 await crop('08-transcript',[125,961,560,55],95,190,3.05,[[467,964,190,22,'honey'],[437,992,135,21,'mint']])+
 label(80,470,850,'인식 보정','planned → plan<br>합성 음성의 대본과 일치한 사례')+
 label(1030,470,790,'문법 피드백은 다음 단계','She don’t…는 보정문에도 유지<br>문장별 검토에서 doesn’t를 제안')+
 footer('기존 합성 WAV → 실제 음성 WebSocket → live OpenAI · 실마이크·일반 인식 정확도 검증 아님')});
sheets.push({name:'s10-clarification',body:
 label(70,55,700,'실행이 보류된 실제 요청','')+
 await crop('06-chat-expression',[1218,372,302,272],75,170,2.52)+
 label(1000,190,815,'분류는 explain_word','“국밥은 영어로 어떻게 말해?”<br>신뢰도 0.79 / 기준 0.85')+
 label(1000,475,815,'결과는 되묻기','저장이나 주제 전환을 실행하지 않음')+
 label(1000,715,815,'다음 검증','과도한 보류율과 실제 오실행을<br>함께 측정해 임계값·문구 평가')+
 footer('1회 관찰 사례 · 신뢰도는 모델 출력값이며 실제 정확도를 뜻하지 않음')});
const css=`*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#F8F6FF;color:#111;font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo",sans-serif}.crop{position:absolute;overflow:hidden;border-radius:18px;border:2px solid #DCCCFF;background:white}.focus{position:absolute;border:4px solid #7F4FE6;border-radius:8px;pointer-events:none}.focus.honey{border-color:#F0AF14}.focus.mint{border-color:#1FAF7F}h2{font-size:39px;line-height:1.35;font-weight:750;margin:0 0 25px;letter-spacing:-.03em}p{font-size:35px;line-height:1.6;margin:0;letter-spacing:-.02em}footer{position:absolute;left:65px;right:65px;bottom:25px;font-size:25px;color:#5D5D5D;border-top:1px solid #E3E3E3;padding-top:18px;line-height:1.35}`;
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
for(const sheet of sheets){const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css"><style>${css}</style><body>${sheet.body}</body></html>`;await writeFile(resolve(out,sheet.name+'.html'),html);await page.setContent(html);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(out,sheet.name+'.png')});console.log(sheet.name);}
const logo=await crop('05-topic',[33,16,170,46],0,0,3);await page.setViewportSize({width:510,height:138});await page.setContent(`<html><style>body{margin:0}.crop{position:relative;overflow:hidden}</style><body>${logo}</body></html>`);await page.screenshot({path:resolve(out,'brand-from-ui.png')});
await writeFile(resolve(out,'manifest.json'),JSON.stringify({method:'Unmodified source PNG elements, browser clipping/scaling, separate CSS borders and text. No generative image editing.',size:[1920,1080],files:sheets.map(s=>s.name+'.png')},null,2));await browser.close();
