# 말모아 발표 근거 부록

발표 본문: [slide-guide.md](slide-guide.md). 작성일 2026-10-09. **이 부록은 10분 발표에 추가되는 슬라이드가 아니다.** 제작자·발표자·심사 질의에 필요한 근거를 보관한다.

## 판정 기준

| 표시 | 의미 |
| --- | --- |
| 이번 실행 확인 | 이번 작업에서 실제 화면·API·모델 응답 또는 테스트 결과를 확인 |
| 코드 확인 | 구현과 호출 경로를 읽어 확인. 모든 조건의 실행 성공을 의미하지 않음 |
| 기존 기록 | 저장소의 과거 테스트 보고서. 이번 작업의 재실행 결과와 구분 |
| 사용자 설명 | 프로젝트 작성자가 이번 대화에서 직접 제공한 개발 경위 |
| 가설 / 다음 검증 | 사용성·사업성·학습 성과에 관한 아직 검증하지 않은 제안 |

코드 기준 HEAD는 `35290d32715d4c2852c0c3f62aa12b1c3d726a79`다. 조사 중 작업 트리에 다른 배포 관련 변경이 있었으며 이를 되돌리거나 발표 작업에 포함하지 않았다. 사실 판단은 Git 메시지만으로 하지 않고 실제 파일을 읽었다. [읽은 핵심 파일의 해시](evidence/source-snapshot.json)도 남겼다.

## 캡처 실행 환경과 범위

- 별도 데이터베이스 `malmoa_presentation_1791527867400`, API `127.0.0.1:4215`, 웹 `127.0.0.1:5185`에서 현재 서비스 코드를 실행했다.
- `AI_MODE=live`; 경험·이미지·전사·보정·문장 피드백·Decisions·챗봇에 실제 OpenAI 호출을 사용했다. Mock provider나 DB fixture 행을 넣지 않았다.
- Chromium 두 개의 분리된 브라우저 컨텍스트, 1600×1000 CSS px, deviceScaleFactor 2. 한 노트북에서 민지·지훈 시연 계정을 새로 만들었다. 둘은 실제 서비스 사용자를 나타내지 않는다.
- 가입·경험 입력·저장·초대·참여·주제 시작·채팅·수정·재요청·승인·학습 조회는 실제 UI로 진행했다. 검증용 조회에는 해당 계정의 정상 HTTP API도 사용했다.
- 음성은 기존 `.local/validation/single-voice/weather.wav`를 읽어 실제 브라우저 WebSocket `/ws/audio`로 전달했다. 물리 마이크나 마이크 버튼으로 녹음하지 않았고 AudioWorklet/VAD 경로도 이번 실행에서 거치지 않았다.
- 녹음 버튼이 꺼져 있는 상태를 이미지에서 바꾸지 않았다. “합성 음성 입력”을 해당 슬라이드에 유지해야 한다.
- 카메라·음성 통화·두 물리 기기·LAN TLS·AWS 운영 배포는 이번 캡처 검증 범위가 아니다. 과거 보고서에 대한 설명도 그 보고서에 명시된 범위를 넘기지 않는다.
- 테스트 입력과 생성 콘텐츠만 공개 근거에 복사했다. 환경변수의 비밀 값·세션 쿠키·인증 파일은 포함하지 않았다.

기계 판독용 근거: [환경](evidence/environment.json), [원본 캡처 시각·URL·해시](evidence/captures.jsonl), [모델 호출 메타데이터](evidence/provider-audit.jsonl), [Decisions 입력·출력](evidence/decisions.jsonl), [음성 파일 정보](evidence/audio-source.json).

Realtime 감사 항목은 연결 요청과 session.created를 각각 기록할 수 있으므로 JSONL의 줄 수를 독립 API 호출 수·비용으로 환산하지 않는다. 토큰·청구액·처리 대기시간의 전체 측정은 수행하지 않았다.

## E01 서비스 맥락과 화면

**코드 확인:** [App.tsx](../../apps/web/src/app/App.tsx)에서 가입, 초대 수신, 스터디, 나의 경험, 나의 학습을 연결한다. [StudyPage.tsx](../../apps/web/src/features/study/StudyPage.tsx)는 공통 주제·전사·마이크·검토·챗봇을 배치한다. [README](../../README.md)는 사람끼리 진행하는 영어 스터디를 설명하지만 최신 챗봇 구조는 코드 및 [chat-decisions.md](../implementation/chat-decisions.md)를 우선했다.

**구분:** 프로젝트 문서에 있는 세션별 개발 지시서는 작업 계획이다. 문서 존재만으로 개발 실행·Codex 작업·배포 완료가 입증되지는 않는다. 실제 코드·실행·사용자 설명과 맞춰 사용했다.

**디자인 근거:** [tokens.css](../../design/tokens.css), [design-system.html](../../design/design-system.html), [seed-theme.css](../../apps/web/src/shared/seed-theme.css), [index.html의 폰트 로딩](../../apps/web/index.html), [App.module.css의 브랜드 구성](../../apps/web/src/app/App.module.css). 색·타입·반경은 이 파일들에서 가져왔다. 새로운 일러스트·목업·주식 이미지를 구현 화면처럼 사용하지 않았다.

## E02 경험과 주제 생성

**코드:** [jobs.ts:76](../../packages/ai/src/jobs.ts#L76)의 주제 생성, [jobs.ts:117](../../packages/ai/src/jobs.ts#L117)의 경험 준비, [schemas.ts](../../packages/ai/src/schemas.ts)의 근거/주제 검사, [prompts.ts](../../packages/ai/src/prompts.ts)의 경험·주제 지시.

| 판단 | 입력 | AI 결과 | 후속 제품 동작 |
| --- | --- | --- | --- |
| 경험 정리 | 경험 원문, 선택 질문 답변, 건너뛰기 여부 | 원문 인용 구절, 관심사, 장소·사람·행동, 선택 질문 | 문자열 근거 검사 → 초안 표시 → 사용자가 확인·수정 후 저장 |
| 대화 주제 | 스터디 참여자의 경험, 학습 표현, 공유 표현, 선택적 특정 참여자 | 이미지/문장 유형, 제목, 상황, 진행 안내, 근거 ID, 이미지 프롬프트 | 스키마·근거 ID 검사 → 이미지 유형이면 실제 PNG 생성·저장 → Topic 반영 |

두 작업 모두 `gpt-6-luna`, Responses API의 `text.format.type=json_schema`, `strict=true`를 사용한다. 추가 Zod 검사가 있다. 특정 참여자가 지정되면 서버 작업에서 그 사용자의 경험만 필터링한다. 경험이 없고 표현만 있는 경우의 문장형 주제는 코드에서 확인했지만 이번 시연은 이미지형 두 주제만 확인했다.

**이번 입력:** “지난 주말 친구 지훈과 부산 해운대에 갔어요. 바닷가를 걷고 시장에서 국밥을 먹었어요. 저는 여행과 사진 촬영에 관심이 있고, 다음에는 제주도에서 일출 사진을 찍고 싶어요.”

**이번 결과:** 보충 질문 없이 확인 화면에 진입. `여행`, `사진 촬영`, `부산 해운대`, `친구 지훈`을 확인하고 저장. 첫 주제 제목은 `A Weekend by the Sea`, `sourceExperienceIds`는 `d69a351f-e79c-499b-9fcd-44e71c4250a1`로 저장 경험과 동일했다. 실제 이미지 미디어가 웹에 표시됐다. [검토 시점의 주제와 원본 구조](evidence/review-result.json)

승인 후 두 번째 주제는 `A Weekend in Busan`. [next-result.json](evidence/next-result.json)에 저장 경험 ID, 공유 표현 ID, 학습 표현 ID가 들어 있다. 실제 전환 트리거는 `button`이다. AI가 선택한 맥락의 적절성이나 학습 효과를 사용자 평가로 검증한 것은 아니다.

## E03 음성 보정과 문장 검토

**호출 경로:** [provider.ts:364](../../packages/ai/src/provider.ts#L364)의 Realtime transcription, [speech.ts](../../packages/ai/src/speech.ts)의 segment/group 관리, [speech-boundary.ts](../../packages/ai/src/speech-boundary.ts)의 발화 경계, [provider.ts:307](../../packages/ai/src/provider.ts#L307)의 음성 재전사, [jobs.ts:169](../../packages/ai/src/jobs.ts#L169)의 마감·문장 분할, [sentences.ts](../../packages/ai/src/sentences.ts)와 [group-sentences.ts](../../packages/ai/src/group-sentences.ts)의 출처 검사.

| 단계 | 입력 → 결과 | 모델 / API |
| --- | --- | --- |
| 원문 전사 | 24kHz mono PCM16 → delta·확정 전사. 한국어/영어 설정, `turn_detection:null` | `gpt-live-transcribe` / Realtime transcription |
| 발화 완료 판단 | 같은 화자의 전사, 대화 맥락, 침묵 시간, 직전 맥락 → `complete / continue / uncertain` + confidence | `gpt-6-luna` / Decisions |
| 인식 보정 | 같은 묶음의 PCM을 WAV로 변환 + 대화 맥락 → 별도 보정 전사 | `gpt-transcribe` / Audio Transcriptions, `chunking_strategy:auto`, `languages:['ko','en']` |
| 문장 단위 구성 | 화자·순서·원문·보정문 → 원문에 정확히 대응하는 문자열 조각 | `gpt-6-luna` / Responses 구조화 출력 |
| 학습 피드백 | 한 문장의 최신 보정문 → 한국어 설명, 영어 표현·뜻·예문 | `gpt-6-luna` / Responses 구조화 출력 |

원문을 LLM이 다시 쓰는 방식이 아니다. 음성 재전사에 번역·문법 교정을 시키지 않는다. 현재 코드는 보정 모델 결과를 원문과의 언어 구성 비교로 다시 거르지 않고 저장한다. 이는 출력이 항상 맞다는 의미가 아니다. 문장 분할 시에는 원문과 보정문의 모든 비공백 문자를 각각 순서대로 한 번씩 포함하는지, 다른 화자를 섞지 않는지, 유효한 출처인지 서버가 검사한다.

**발화 경계 정책:** 발화 종료 후 1초 시점부터 판정 가능. 완료 신뢰도 기준 기본 0.85. 새 발화가 시작되면 이전 판정·타이머를 무효화. 오류·시간 초과·낮은 신뢰도는 10초 최대 침묵 경계를 유지. 한 묶음 PCM 최대 60초. 이 정책의 임계값이 최적이라는 실험은 없다.

**이번 결과:** [audio-source.json](evidence/audio-source.json), [audio-result.json](evidence/audio-result.json), [review-result.json](evidence/review-result.json).

| 종류 | 실제 내용 |
| --- | --- |
| 기존 합성 파일 대본 | `오늘은 좀 피곤해요. She don't like rainy days. We plan a trip to Busan.` |
| 원문 전사 | `오늘은 좀 피곤해요. She don't like rainy days. We planned a trip to Busan.` |
| 음성 재전사 | `오늘은 좀 피곤해요. She don't like rainy days. We plan a trip to Busan.` |
| Decisions | `complete`, confidence `0.67` → 기준 미달, 실제 group `closeReason: silence_timeout` |
| 문장 분할 | 3개 Utterance, 모두 민지의 발화에 귀속 |
| 문장 2 피드백 | “주어가 she일 때는 doesn't를 써요.” |
| 사람이 직접 수정 | `She doesn't like rainy days.`를 UI에 입력. `correctedBy:human`, 기존 피드백 stale |
| 문장 2 재요청 | 최신 correctionRevision에 대해 `items:[]`, 화면 “이 문장은 추가 학습 피드백이 없어요.” |

직접 수정은 테스트 기능 시연이며 “원래 그렇게 말했다”는 주장이 아니다. 모델 보정과 사람 편집을 혼동하지 않는다. [edit-result.json](evidence/edit-result.json), [ReviewPanel.tsx](../../apps/web/src/features/study/ReviewPanel.tsx)에서 직접 수정 표식·원음 UI·stale 상태를 대조할 수 있다.

## E04 챗봇의 판단과 서버 실행

**현재 코드:** [chat-decision.ts](../../packages/ai/src/chat-decision.ts), [provider.ts:194](../../packages/ai/src/provider.ts#L194), [chat.ts:99](../../packages/ai/src/chat.ts#L99), [chat.ts:183](../../packages/ai/src/chat.ts#L183), [chat.ts:355](../../packages/ai/src/chat.ts#L355), [chat.ts:388](../../packages/ai/src/chat.ts#L388), [commands.ts:208](../../apps/api/src/domain/commands.ts#L208).

1. 서버가 현재 스터디 상태로 허용 행동 목록을 만든다.
2. 최신 요청, 본인·같은 스터디의 성공한 최근 대화 최대 20개, 공유 상태, 현재 공통 맥락을 Decisions에 보낸다.
3. 결과 choice가 허용 목록에 있고 confidence ≥0.85일 때 진행한다. 미달·오류·불명확은 되묻기다.
4. Responses 구조화 출력으로 **선택된 하나의 기능** 인자만 추출한다. 필요한 인자가 불명확하면 `null`로 실행을 멈춘다.
5. 서버의 기존 도메인 명령이 사용자, membership/owner, 주제 ID·전환 버전, 수정 revision 등을 해당 작업에 맞게 검사하고 한 번 실행한다.
6. 답변 생성에는 `provider.respond(input, [])`로 실행 도구를 주지 않는다. 결과 설명 도중 임의로 추가 실행하지 않는다.

현재 작업은 자유로운 다중 function-calling 루프가 아니다. 내부에 tool schema와 function-call 결과 형식을 활용하지만, 일반 답변 모델이 도구를 무제한 선택한다고 설명하면 최신 코드와 다르다.

기능 선택지: 상태 조회, 스터디 시작, 주제 마감, 승인·다음 주제, 스터디 종료, 단어 설명·저장, 표현 학습·저장, 내 학습 조회, 특정 문장 피드백 요청. 추가로 공유 수락·거절, 일반 대화, 의도 확인이 있다. 공유 자연어 응답은 직전 성공한 챗봇 답변과 본인·같은 스터디의 단일 pending 제안이 연결될 때만 선택지로 준다. 과거 발화·인용 속 동의를 새 동의로 재사용하지 않도록 설계돼 있다.

**이번 모든 자연어 요청 결과** — 성공한 예만 뽑아 전체 신뢰도를 주장하지 않는다.

| 요청 | 분류 / confidence | 실제 결과 |
| --- | --- | --- |
| 국밥은 영어로 어떻게 말해? | `explain_word / 0.79` | 실행 없이 되묻기 |
| 저는 여행 사진 찍는 것을 좋아해요 라는 영어 표현을 배우고 저장하고 싶어요 | `learn_expression / 0.95` | `I like taking travel photos.` 개인 저장 + pending 공유 제안 |
| 네, 그 표현을 함께 공유해줘 | `accept_expression_share / 0.83` | 실행 없이 되묻기. 이후 UI의 Yes 버튼으로 공유 |
| 현재 주제 대화를 마무리하고 문장별 피드백을 보여줘 | `close_topic / 0.99` | 주제 마감 실행, 이후 3문장 검토·피드백 |
| 검토한 피드백을 승인하고 다음 주제로 넘어갈게 | `advance_topic / 0.42` | 실행 없이 되묻기 |
| 다음 주제로 넘어갈게 | `clarify_intent / 0.51` | 실행 없이 되묻기. 이후 UI 승인·다음 버튼으로 전환 |

근거: [decisions.jsonl](evidence/decisions.jsonl)과 원본 캡처. 신뢰도는 제공자가 돌려준 값이지 정답률이나 교정된 확률의 증거가 아니다. 표본이 작고 요청을 통제한 평가가 아니므로 성공률을 계산해 성능으로 발표하지 않는다. 정상적인 요청의 반복 보류는 실제 사용성 한계다. 이번 문서 작업에서는 임계값을 조정하거나 서비스 코드를 수정하지 않았다.

## E05 승인과 개인 학습 저장

[commands.ts:121](../../apps/api/src/domain/commands.ts#L121)의 `approve`는 모든 문장의 최신 feedback revision을 확인한다. `ownerUserId: u.speakerUserId`로 학습 항목을 저장하므로 편집자·승인자와 발화자를 혼동하지 않는다. 출처 key와 DB 충돌 처리를 통해 동일 항목의 중복 저장을 제한한다. [LearningPage.tsx](../../apps/web/src/features/learning/LearningPage.tsx)는 출처 필터를 제공한다.

이번 시연은 민지만 음성 입력을 보냈다. 민지로 승인·다음 버튼을 누른 뒤 [민지 학습](evidence/learning-result.json)에 스터디 피드백 2개와 챗봇 표현 1개가 있었고, [지훈 학습](evidence/peer-learning-result.json)은 빈 배열이었다. 이것은 해당 계정의 조회·귀속 확인이다. 모든 보안 경계나 동시 승인 조건을 이번 UI 흐름만으로 인증하지 않는다.

## E06 모델과 API 호출

[config.ts:19](../../packages/ai/src/config.ts#L19) 기본값과 [이번 실행 설정](evidence/environment.json)이 일치했다. [provider-audit.jsonl](evidence/provider-audit.jsonl)에 모델·request/session ID가 남아 있다.

| API | 코드상 호출 | 모델 | 처리·검증 |
| --- | --- | --- | --- |
| Responses 구조화 출력 | `client.responses.create`, `text.format=json_schema`, `strict:true`, `store:false` | `gpt-6-luna` | 경험·주제·문장 분할·피드백·챗봇 인자/표현, Zod 및 도메인 검사 |
| Responses 답변 | `client.responses.create`, 현재 chat에서는 `tools:[]` | `gpt-6-luna` | 실행 결과를 한국어로 설명 |
| Decisions | 직접 `fetch('https://api.openai.com/v1/decisions')`, `questions:[{type:'choice',name,...}]` | `gpt-6-luna` | 음성 `speech_completion`, 챗봇 `chat_action`, choice/confidence 검증 |
| Realtime transcription | `wss://api.openai.com/v1/realtime?intent=transcription` + `session.update` | `gpt-live-transcribe` | 24kHz PCM, 부분·확정 원문 |
| Audio Transcriptions | `client.audio.transcriptions.create` | `gpt-transcribe` | 저장 음성으로 별도 인식 보정 |
| Images | `client.images.generate`, `size:'1024x1024'`, `output_format:'png'`, `quality:'low'` | `gpt-image-2.5-flare-2026-09-08` | 실제 PNG byte 검사·미디어 저장 후 Topic 반영 |

“Decisions”는 여기서 API 명칭이다. `decisoins`라는 별도 모델 ID는 코드에 없다. 모델의 일반 출시 상태나 요금에 관한 외부 주장은 하지 않는다. 코드의 실제 모델 ID·호출 방식과 이번 요청 결과를 설명하는 표다.

## E07 검증과 남은 실패

**이번 실행의 검사**

```text
pnpm exec vitest run --project unit \
  packages/ai/src/speech-boundary.test.ts \
  packages/ai/src/chat.test.ts \
  packages/ai/src/group-sentences.test.ts \
  packages/ai/src/provider.test.ts

2026-10-09 15:40 KST
Test Files 4 passed (4)
Tests 76 passed (76)
```

음성 경계, 챗봇 판단·실행 제한, 그룹 문장 출처, 제공자 호출 어댑터에 관한 기존 테스트를 실행했다. 실제 모델 인식률이나 사용자 경험을 이 숫자로 증명하지 않는다. 전체 workspace의 최신 회귀 검사로 확대해 표현하지 않는다.

**이전 기록:** [test-voice/VALIDATION.md](../../packages/test-voice/VALIDATION.md)에 실제 Chrome·BlackHole 가상 장치와 단어별 1–10초 간격의 합성 WAV 검사가 있다. 음성 전송 경로와 인식 품질을 분리했으며, 한국어 단어 누락·다른 언어 인식 사례를 기록했다. 당시 마지막 스크린샷은 시간 초과로 원본 실행이 실패 상태였다는 기록도 유지했다. [Decisions 발화 묶음 검증](../implementation/evidence/2026-10-09-decisions-speech.md)은 이후의 경계 처리·테스트와 남은 실음성 평가를 설명한다. [chat-decisions.md](../implementation/chat-decisions.md)는 해당 변경 당시 live 브라우저 검증을 수행하지 않았다고 기록한다. 이번 발표 작업의 live 검증은 그 이후의 제한된 추가 근거다.

| 상태 | 말할 수 있는 내용 | 말할 수 없는 내용 |
| --- | --- | --- |
| 이번 live 캡처 | 샘플 경험이 주제로 연결되고 실제 전사·수정·저장까지 진행 | 전 사용자·전 문장의 안정적 성공 |
| 전사 비교 한 사례 | 대본의 plan에 대해 raw planned, 보정 plan 관찰 | 실마이크 정확도 몇 % 향상 |
| 직접 수정 | 기존 피드백 stale 표시 → 최신 revision 재요청 | 사용자 검증을 통해 신뢰가 향상됨 |
| 챗봇 | 표현 저장·주제 마감 성공, 공유·다음 요청 보류 | 대부분의 조작이 자연어로 성공 |
| 단위 검사 | 네 파일 76개 통과 | 전체 품질·현장 운영 검증 완료 |

**다음 검증 제안:** 동일한 사람 음성으로 개선 전후 조기 분리·누락을 비교한다. 1/3/9초 멈춤, 작은 목소리, 소음, 한국어·영어 혼용을 포함한다. 챗봇은 정상 요청·모호한 요청·금지된 상태 요청을 구분한 평가셋에서 실행 정확도와 과도한 보류를 같이 본다. 두 물리 기기에서 끝까지 검토·승인하고, 지연과 실제 비용을 측정한다. 이것들은 수행 완료 결과가 아니다.

## E08 도입 가설

**제안의 근거:** 현재 서비스는 기존 사람을 아이디로 초대하고, 한국어 설명과 영어 표현을 제공하며, 참여자의 경험·발화·학습 기록을 연결한다. 이미 모임이 있는 한국어권 대학 영어회화 스터디를 초기 가설로 제안한다. 학교 전체가 구매자로 검증됐다는 뜻이 아니다.

| 항목 | 제안 | 검증 방법 / 현재 상태 |
| --- | --- | --- |
| 이용자 | 정기적으로 만나는 영어 학습자 2인 | 실제 모집·인터뷰 미실행 |
| 도입·운영 | 동아리 운영자 또는 소규모 회화 프로그램 담당자 | 4주 파일럿 제안, 진행표와 참여 안내를 수동 운영 |
| 구매 후보 | 대학 어학교육원·비교과 담당 부서 | 예산 주체·구매 절차·의사 미확인 |
| 가치 | 주제 준비와 표현 정리의 시간 부담 감소, 개인 복습 자료의 축적 | 기존 방식과 준비/정리 시간, 기록 재열람을 비교. 절감 수치 없음 |
| 계속 쓸 이유 | 다음 모임에서 새로운 경험과 승인·공유 표현을 주제로 활용 | 누적 맥락 재사용은 구현; 재참여·복습 습관은 가설 |
| 비용 | 음성 길이·판단/텍스트 호출·이미지·인프라를 스터디 단위로 기록 | 가격·월 비용·수익성 미측정. 토큰량 자체를 성과로 삼지 않음 |
| 수익화 | 프로그램 이용권 또는 활성 스터디 단위 과금 가설 | 파일럿 후 비용 대비 가치와 지불 의사를 확인. 결제 기능 미구현 |
| 기관 운영 요건 | 보관 기간·삭제·동의 안내·기관 계약·관리 요구 확인 | 현재 기관 관리/과금 화면 미구현. 개인정보 처리 적합성을 이번 조사로 인증하지 않음 |

기업·공공기관·지역사회는 별도 확장 후보일 뿐 모두 채택하지 않았다. 비교 검증이 없으므로 시장의 최적 세그먼트라고 단정하지 않는다.

## E09 Codex 활용 근거

**사용자 설명 원문:** “전사 문자 끊기는거 발견 → decisons로 디벨롭, 음성 테스트 모듈 제작, 챗봇도 이상한 요청 처리, decisons로 제한”. 이 설명이 작업 위임·개선 동기의 근거다. 저장소에 있는 작성자 이름만으로 Codex 수행을 추정하지 않았다.

| 작업 | 코드·변경 근거 | 확인 가능한 통합·검토 결과 |
| --- | --- | --- |
| 음성 테스트 모듈 제작 | `6e802a9`, [packages/test-voice](../../packages/test-voice/README.md), [VALIDATION](../../packages/test-voice/VALIDATION.md) | 생성 WAV, 간격·루프백 검사, 인식 오류와 스크린샷 실패를 구분한 기록 |
| 전사 끊김에서 발화 묶음으로 발전 | `0d7d7d0`, [speech-boundary.ts](../../packages/ai/src/speech-boundary.ts), [speech.ts](../../packages/ai/src/speech.ts), [migration 0002](../../apps/api/src/db/migrations/0002_speech_groups.sql) | DB·원문/보정 출처·review 오디오 UI로 연결, 재개/시간 경계 테스트, 이번에는 silence fallback 확인 |
| 부적절한 챗봇 요청 처리 제한 | `35290d3`, [chat-decision.ts](../../packages/ai/src/chat-decision.ts), [chat.ts](../../packages/ai/src/chat.ts), [chat.test.ts](../../packages/ai/src/chat.test.ts) | 상태별 가능한 행동, 단일 실행, 서버 도메인 검사. 이번 live 시연에서는 정상 요청의 과도한 보류도 발견 |

**확인하지 못한 것:** 원본 Codex 대화 로그, 모든 작업의 세부 책임·순서, 사람이 직접 수정한 모든 코드 라인, 개발 시간 단축량. 발표의 “검토·수정”은 사용자가 문제를 발견해 방향을 바꿨다는 설명과 해당 변경·검증 근거에 한정한다. 이번 발표 지시서 작성 과정의 테스트를 해커톤 개발 당시 테스트였다고 바꿔 말하지 않는다.

## 파일 사용과 재생성

- `assets/raw/*.png`: 캡처한 실제 서비스 화면. 수정하지 않은 원본.
- `assets/annotated/*.png`: 발표용 부분 확대·별도 주석. 1920×1080, 로고만 510×138.
- `assets/annotated/*.html`: 원본 이미지와 별도 주석 레이어의 배치 근거. UI를 다시 만든 HTML이 아니다.
- `tools/build-annotations.mjs`: 원본 PNG에서 주석 이미지 재생성. `node docs/presentation/tools/build-annotations.mjs`.
- `tools/build-guide.py`: Markdown으로부터 이미지 포함 열람 HTML 생성. `python3 docs/presentation/tools/build-guide.py`.
- 캡처의 내부 마이크 상태, AI 응답의 별표·문구, 처리 상태까지 그대로 유지했다. 주석은 화면 바깥 설명이므로 UI와 구분된다.
- 07-chat-shared.png는 자연어 공유 요청 직후의 미완료 화면이며 공유 성공 근거로 사용하지 않는다. 최종 공유는 10-shared-confirmed.png와 next-result.json으로 확인했다.
- 별도 로컬 시연 DB와 미디어는 검사 가능하도록 남겼다. 이번 작업의 서버만 종료하며 기존 앱이나 DB를 초기화하지 않는다.

슬라이드별 파일 경로와 발표 타이밍은 [본 지시서](slide-guide.md)에 있다. 세부 심사 배점과 제출 가이드는 미정이며 추후 안내를 반영해야 한다.
