# 로컬 검증 실행 기록

검증일: 2026-10-09 (Asia/Seoul). **G3 통과 — 아래 최초 기록 이후 사용자가 현재 코드의 남은 실기기 검증 완료를 확인했다.** 최신 근거는 이 문서 마지막의 G4 진입 확인과 `local-validation.json`이다. 아래 최초 기록의 미실행·실패는 당시 사실로 보존한다.

이 파일은 실제 실행 결과만 기록한다. 기계 판독 기록은 `local-validation.json`이며, AWS preflight는 G3 전체 항목 및 검증한 commit·lockfile·소스 지문을 확인하기 전 AWS API를 호출하지 않는다. G3 기록은 사용자 승인 절차를 추가하는 용도가 아니다.

## 대상과 환경

- 검증 대상 구현 commit: `a0c255627cc1320f11645dd495cb817c6836729c`. 이후 증거만 별도 commit할 수 있으며, 구현 소스가 달라지면 관련 검사를 다시 수행한다.
- lockfile SHA-256: `e8d49ab375ecb96da7c3fa9da86b871f054ea7bc06d76aa070be685d47def67e`.
- 증거 경로를 제외한 소스 SHA-256: `62d7e0e08dcb9568f5a32ac8da7f6814b6cf509d08e64bb79a80847980ef02a4`.
- 호스트: macOS 개발 노트북 1대. 사용자가 현재 두 번째 물리 노트북은 없다고 확인했다.
- Node 24.20.0 / pnpm 10.33.2 / Docker 29.2.1 / Compose 5.1.0.
- PostgreSQL 17.11: 실제 Docker `devday-study-local-postgres-1`, `127.0.0.1:5432`, 영속 volume `devday-study-local_postgres-data`.
- `setup:local` 재실행은 `.env.local`을 byte 단위로 보존했다. 이후 5173에서 다른 앱이 응답하는 충돌을 확인해 root가 `PORT=4188`, `WEB_PORT=5188`, `LOCAL_WEB_ORIGIN=http://localhost:5188` 세 항목만 의도적으로 수정했다. 비밀번호·키·나머지 설정은 보존했으며 키 값은 기록하지 않는다.
- 현재 실제 개발 앱은 `http://localhost:5188`, API는 `127.0.0.1:4188`이다. Chromium에서 `말모아` 화면과 `/api/v1/me`의 UNIDENTIFIED JSON 401을 확인했다. 5173을 점유한 별도 앱 프로세스는 종료하지 않았다.
- 자동 E2E에서는 별도 API/web port와 `AI_MODE=mock`을 명시한다. 두 browser context는 두 물리 기기의 인수 증거를 대체하지 않는다.

## 확인된 실행

| 실행 | 결과 | 확인 범위 |
| --- | --- | --- |
| `pnpm setup:local` | 통과 | 재실행 전후 기존 `.env.local`의 bytes가 동일함을 assert, 미디어·인증서 디렉터리 준비 |
| PostgreSQL compose 시작 | 통과 | DB healthy, loopback port, DB 변수만 컨테이너 주입, volume 생성 |
| `pnpm db:migrate:local` | 통과 | 실제 PostgreSQL에 `0001_initial` 적용 |
| `pnpm preflight --target=local` | 통과 | 버전, 공통 환경 parser, DB/migration, 미디어 임시 bytes 쓰기/읽기/삭제 |
| 도구용 TypeScript 검사 | 통과 | `pnpm exec tsc --noEmit -p tsconfig.tools.json` |
| `pnpm preflight --target=aws` | 예상대로 거절 | G3 증거 미완성 상태에서 exit 1, AWS API·배포 실행 없음 |
| mkcert 설치·LAN 인증서 발급 | 통과 | mkcert 1.4.4, SAN `172.24.100.52`/localhost/loopback |
| `pnpm preflight --target=lan` | 통과 | 위 local 검사 및 HTTPS origin·Secure 쿠키 설정·인증서 SAN·유효기간·키 일치. 브라우저 신뢰·실마이크는 포함하지 않음 |
| `mkcert -install` 시스템 신뢰 설치 | 실패/사용자 실행 필요 | macOS 관리자 인증이 필요하며 비대화형 세션에서 sudo 암호를 받을 수 없음 |
| `pnpm test:e2e` | 통과 | 최종 4개 41.5초, 실제 API·별도 PostgreSQL `devday_study_e2e`, AI_MODE=mock, 독립 A/B context |
| layout Playwright | 통과 | 2개 31.6초, chat 폭·review 위치·버튼 순서를 test-only CSS로 바꾼 상태에서 동일 사용자 흐름 |
| provider failure Playwright | 통과 | 1개 32.5초, 실제 API/DB/이벤트와 테스트 provider의 실패·명시적 재시도·동시 next 검사 |
| `pnpm --filter @devday/infra typecheck` | 통과 | CDK 3 stack의 TypeScript 검사 |
| 인프라 template/SPA 검사 | 통과 | 10개: 네트워크·단일 task·retention·IAM·비밀·캐시·SPA·단방향 의존성 |
| `pnpm infra:synth` | 통과 | strict/no-lookups, AWS 자격증명 환경변수 해제·설정 파일 `/dev/null` 상태에서도 통과 |
| `pnpm build:api-image` | 통과 | `node:24.20.0-bookworm-slim`, linux/amd64, lockfile 설치·API bundle·production 의존성·RDS CA 포함 |
| `pnpm test:image` | 통과 | 실제 image의 동일 migration, 경험·개인 학습·이미지 저장, 스터디 종료, 컨테이너 재시작 후 세션·기록·동일 bytes 재조회 |
| build preview HTTPS/WSS probe | 통과 | CA·호스트명 검증, Secure/HttpOnly/SameSite=Lax 쿠키, 미가입 JSON 401, `/ws/events`와 `/ws/audio` 101 및 heartbeat |
| `pnpm typecheck` | 통과 | 전체 workspace와 root 도구 strict TypeScript 검사 |
| `pnpm contracts:check` | 통과 | 39개 계약 검사 |
| `pnpm test:unit` | 통과 | 최종 회귀 수정 이후 27개 파일, 250개 검사 |
| `pnpm test:integration` | 통과 | 실제 PostgreSQL 도메인/HTTP 통합 15개 |
| `pnpm build` | 통과 | API bundle·web 정적 build |
| `pnpm test:audio-browser` | 통과 | 실제 Chromium AudioWorklet·VAD 경로, capture 1회로 2개 stream·3개 segment·32개 chunk, segment_ready 1900ms 지연. 입력은 합성/fake audio이며 실마이크 인수가 아님 |

### 최종 회귀 검사와 근거

최종 구현 commit에서는 지연된 `segment_ready` 동안 캡처된 다음 발화가 직전 segment commit 후 전송되도록 수정했고, timeout이 지난 피드백과 job 상태가 하나의 실패로 저장되도록 보완했다. [audio-delayed-ready.json](reports/audio-delayed-ready.json)은 실제 Chromium의 minified production bundle에서 1900ms ack 지연·3개 발화 segment·순서와 flush·다음 주제의 capture 재사용·종료 후 track 해제를 검사했다. 마이크 입력은 생성한 신호, 서버는 엄격한 protocol emulator다. timeout 실패 경합은 `apps/api/test/domain.integration.test.ts`와 AI jobs 회귀 검사에서 검증했다.

[layout-independence/](reports/layout-independence/)의 8개 측정 결과는 chat 330→440px, topic보다 먼저 놓인 review, next/finish 버튼 역순을 증명한다. [실제 내용이 있는 검토 화면](screenshots/layout-review-populated.png)과 [개인 chat·공유 화면](screenshots/layout-chat-sharing.png)을 보존했다. DOM 위치가 바뀐 상태에서도 상대 수정·재피드백·승인, 개인/공유 구분, 자연어 next가 통과했다.

[E07 저장 결과](reports/e07-provider-failure.json)는 양쪽 UI의 진행/실패, 자동 재시도 없음, 명시적 피드백 재시도, 동시 next 202/409, 실패 이미지의 같은 topic·ordinal 재시도를 확인한다. 이전 승인과 학습 기록은 중복되지 않았다. 실제 DB에 남은 실패/성공 job과 fixture provider 호출 수 image 3회·feedback 2회를 저장했다. [피드백 실패](screenshots/e07-feedback-failed.png), [이미지 실패](screenshots/e07-image-failed.png), [명시적 재시도 복구](screenshots/e07-image-recovered.png) 화면은 테스트 전용 실패 주입 결과다.

smoke 검증 helper는 마지막 단어의 정확한 비교, 기대 조건이 없을 때 `not_verified`, 입력·요청 audit 지문을 검사하도록 수정했고 24개 helper 검사가 통과했다. 이번 후속 검증에는 추가 유료 OpenAI 호출이 없었다. CI에는 baseline/layout/failure/audio 검사를 구성했으며, 원격 CI 자체를 실행했다고 주장하지 않는다.

### 실제 OpenAI와 제품 연결

아래 실제 OpenAI 호출들은 이전 검증 주기에 실행되어 구현 commit `3d31883457a5aaaf6334a8a9a699102ff8cd6369`의 기록에 포함된 결과다. 각 보고서의 원래 시각·요청 ID·품질 실패를 보존했으며 최종 commit에서 새로 호출한 결과로 표시하지 않는다. 이후 변경은 오디오 ack 순서·timeout 상태 경합·smoke 판정 보완이며 provider 요청과 prompt는 그대로다.

자격증명을 포함하지 않는 실행 보고서를 [`reports/`](reports/)에 보관했다. 녹음·inspection session·쿠키·환경파일·프로세스 로그는 저장소에 넣지 않았다.

- [live-flow.json](reports/live-flow.json): 2026-10-09T04:20:21Z~04:22:01Z, 실제 OpenAI·PostgreSQL·파일 저장소·HTTP/WS의 12단계 제품 흐름 통과. 질문 skip/경험 수정, 초대, 실제 이미지, 파일 기반 전사/보정·문장 피드백, 상대 수정, private 단어/표현·공유 yes/no, 자연어 next, 마지막 승인, 프로세스 재시작 후 A 7개/B 6개 학습 항목·경험·이미지 재조회. 실제 이미지 1,757,251 bytes의 SHA-256은 `573fb27ea6c82cef4d1a0f9142dba1e1597523c57685dcd8baccf9e6b326430a`다. 두 HTTP/WS 사용자에게 같은 합성 WAV를 보낸 검사이며, 실제 마이크·두 물리 기기는 아니다.
- [OpenAI 최종 네 경로](reports/openai-final-audited-smoke.json): 실제 Realtime, 같은 오디오 재전사, Responses 구조화 출력/도구, Images 요청은 각각 성공했다. 모델은 `gpt-live-transcribe`, `gpt-transcribe`, `gpt-6-luna`, `gpt-image-2.5-flare-2026-09-08`이다. **전체 품질 판정은 실패**다. Realtime 결과에서 요구한 마지막 단어 `human` 검사가 실패하여 `passed=false`, `transcriptionChecksPassed=false`를 유지했다. 호출 성공만으로 G1/G3 음성 품질을 통과시키지 않는다.
- [영어 대화 맥락의 Realtime 추가 검사](reports/openai-live-english-context.json)는 해당 합성 샘플의 한국어·학습자 문법·마지막 단어 검사를 통과했다. 이 제한된 별도 검사로 앞선 전체 검사 실패를 지우지 않는다.
- [앞선 두 합성 화자 음성의 회귀 기록](reports/live-flow-two-voice-regression.json)을 별도로 남겼다. 언어 누락/품질 실패를 성공 데이터로 바꾸지 않았다.
- [실제 지명/문장 분기](reports/live-branches.json): 지명한 참여자의 경험만 generation snapshot과 이미지 근거로 사용, 경험 없는 상태의 CONTEXT_REQUIRED, 공유한 표현으로 문장+진행 지시 생성, 두 번째 자연어 next 문구의 승인·다음 문장 생성까지 3개 분기 통과. [강화한 A18 검사](reports/live-named-participant.json)는 B에게 기존 원예 경험이 있어도 A를 지명하면 B의 경험 ID가 제외되는 것을 실제 생성 입력에서 확인했다.
- [상세 경험에 불필요한 질문이 나온 기존 실패](reports/live-branches-detailed-question-regression.json)를 보존했다. schema·prompt·분기 수정 후 [실제 상세 경험 재검증](reports/live-detailed-experience.json)에서 원문에 이미 장소·사람·사건·행동이 있는 경우 질문 0개와 grounded 정리본을 받았다. 해당 실행은 draft까지만 검사했고, 편집/저장/재조회는 E2E와 주 흐름에서 확인했다.
- 실제 생성 이미지 렌더는 [live-image-topic.png](screenshots/live-image-topic.png)와 [메타데이터](reports/live-image-topic.json)에 보관했다. [경험 카드](screenshots/experience-cards.png), [출처별 개인 학습](screenshots/learning-loaded-mixed-sources.png), [문장 검토](screenshots/review-populated.png)는 명시적 AI fixture의 화면이다. 세 주요 화면의 라이트 테마·색상·폰트/아이콘 배치와 읽기 가능성을 직접 확인했으며, `apps/web/seed-design/ui/`의 실제 `@seed-design/react` 사용 및 `design/tokens.css` 연결도 확인했다.

Playwright는 다음을 실제 HTTP/WS/DB와 UI로 확인했다: 가입과 중복 거절, B가 다른 화면에 있을 때 전역 초대, 경험 없는 시작의 CONTEXT_REQUIRED, 보충 질문 생략과 기존 답변 보존·원문/정리/맥락 수정·저장·재조회, 양쪽 공통 상태와 동일 권한, 개인 chat/학습 비노출, 단어·표현 저장, no·pending·yes 결정과 중복 yes 방지, 공유 표현의 다음 주제 반영, 스터디 종료. 추가 audio 검사는 각 사용자 소켓에 200ms 합성 PCM을 전송하여 두 review 행·상대 수정·stale·문장별 재요청·동시 next 202+409·단일 생성·발화자 저장·마지막 승인·새 스터디 ID를 확인했다. AI 출력은 명시적 fixture이며 실마이크·실제 OpenAI 결과가 아니다. `.local/validation/screenshots/`에 주요 상태 화면이 있으며, 로컬 HTML 결과는 `tests/e2e/test-results/e2e-report/index.html`, `tests/e2e/test-results/e2e-layout-report/index.html`, `tests/e2e/test-results/e2e-failure-report/index.html`이다. 재현에 필요한 간결한 측정·DB 결과와 선택한 화면은 저장소의 `reports/`, `screenshots/`에 보관했다.

### API image와 재시작 결과

최종 timeout·audio 회귀 수정 이후 API rebuild 후 2026-10-09T04:41:42.362Z에 image 검증을 완료했다. image ID는 `sha256:443d21c4b5e567a7a7375392d76fdf7db8569c5f3b61db507013409b9c2ba01f`, 실제 Node 버전은 `v24.20.0`이다. runtime에 `.env.local`·로컬 TLS 인증서가 없고 `/app/certs/global-bundle.pem`이 있음을 확인했다.

별도 DB `devday_study_image_1791520876034`에서 API image의 `apps/api/dist/db/migrate.js`를 실행했다. `AI_MODE=mock`, 빈 OpenAI key로 경험과 실제 미디어 파일·개인 학습 항목 1개를 만들었다. 현재 주제를 검토하고 스터디를 종료한 다음 컨테이너를 재시작했다. 기존 쿠키의 사용자, 경험 ID/내용, 학습 항목, 이미지 bytes가 같았으며 B에게 A의 개인 기록이 노출되지 않았다. fixture PNG는 68 bytes, SHA-256 `5e3d382db4dd83d59aa5742793ad6b7903409e865c83bcbc54835049f043bc15`다. 이 값은 **실제 OpenAI 생성 이미지 증거가 아니다**. 저장소 증거는 [image-validation.json](reports/image-validation.json), 로컬 로그는 `.local/image-validation.log`다.

### HTTPS·쿠키·WSS 결과

최종 image로 2026-10-09T04:42:25.553Z에 Vite build preview `https://172.24.100.52:5176`에서 production API image port 3100으로 proxy를 검증했다. `scripts/local/verify-https.mjs`는 공개 mkcert CA를 명시하고 TLS 검증을 유지한 HTTPS/WSS 클라이언트다. 익명 `/api/v1/me`는 HTML 대신 JSON 401, 가입 쿠키는 Secure/HttpOnly/SameSite=Lax, 같은 쿠키로 me 조회 및 `/ws/events`·`/ws/audio` 101+heartbeat가 통과했다. [https-validation.json](reports/https-validation.json)에 결과를 남겼다. **OS/브라우저 신뢰·실마이크·두 물리 기기 결과는 아니다.** 검사 후 해당 API 컨테이너와 TLS preview만 중지했다. PostgreSQL volume과 현재 live 개발 앱 4188/5188은 유지했다.

## G3 인수 상태

아래는 완료 판정표다. 구현·자동 검사의 부분 근거는 후속 결과에 덧붙이며, 실제 요구 범위보다 넓게 통과로 표시하지 않는다.

| 항목 | 현재 실행 근거 | 남은 G3 판정 |
| --- | --- | --- |
| A01 | 실제 API/DB 중복 handle·세션 분리: `tests/e2e/study.spec.ts`, `apps/api/test/http.integration.test.ts` | 두 기기 E01 대기 |
| A02 | 타 화면 전역 초대 모달·가입·동일 스터디: E2E, `invitation.png` | 두 기기 E01 대기 |
| A03 | 양 actor 시작/close/next/finish·새 스터디 ID: `shared-state.spec.ts`, `review-audio.spec.ts` | 두 기기 실제 흐름 대기 |
| A04 | 서로 다른 A/B context와 쿠키의 HTTP/WS 공통 state 확인 | 두 물리 노트북 동기화 미실행 |
| A05 | private chat/WS/학습 owner 분리: E2E/HTTP 통합 및 `reports/live-flow.json` 실제 Responses | 두 기기 사용자 흐름 대기 |
| A06 | 합성 PCM 두 화자의 `/ws/audio` 귀속과 지연 ack 3개 segment 순서: `review-audio.spec.ts`, `reports/audio-delayed-ready.json` | 두 실제 마이크·계속 켜기 미실행 |
| A07 | 실제 합성 파일 전사/보정, 한국어·학습자 문법 확인; 네 경로 최종 smoke에서 raw 마지막 단어 검사 실패 기록 | 실마이크 청취 비교 미실행; API 성공과 품질을 구분 |
| A08 | raw/보정 별도 필드와 화면: `synthetic-live-transcript.png`, speech/provider 검사 | 실마이크와 동일 오디오 보정의 실제 품질 비교 미실행 |
| A09 | 라이브 전사 화면·발화자 순서의 합성 PCM 검사 | 실제 교대 발화 화면 인수 미실행 |
| A10 | synthetic audio 종료→2문장 review→summary/상세: `review-audio.spec.ts`, `review-populated.png` | 실제 마지막 발화·여러/긴 문장 비교 미실행 |
| A11 | B가 A 보정문 편집, 양쪽 화면·stale 상태: `review-audio.spec.ts` | 두 기기 E04 대기 |
| A12 | 해당 문장만 refeedback; 오래된 revision 거절·timeout 실패 원자 저장: `review-audio.spec.ts`, domain/jobs 통합·단위 검사, E07 UI | 두 기기 실제 피드백 E04 대기 |
| A13 | E2E/domain 동시 next 및 실제 OpenAI 자연어 next·발화자 학습 저장: `reports/live-flow.json` | 두 기기 실제 발화 대기 |
| A14 | 첫 finish는 review, 최종 finish 승인 저장·ended: `review-audio.spec.ts`, domain 통합 | 두 기기 마지막 실제 발화 E08 대기 |
| A15 | 부족한 입력 질문/skip와 수정 후 실제 상세 입력 질문0개: `reports/live-detailed-experience.json` | 두 기기 사용자 흐름 대기 |
| A16 | 원문/정리/맥락 수정·같은 ID 저장·재조회·owner 검사: `experiences.spec.ts`, image 재시작 검사 | 실제 모델이 없는 사건을 추가하지 않았는지 사람 비교 대기 |
| A17 | 실제 OpenAI 첫 이미지/next와 경험·yes 공유 입력 확인: `reports/live-flow.json` | 두 기기 실제 흐름 대기 |
| A18 | 동명이인 단위 검사와 B의 기존 경험을 제외한 실제 A 지명 이미지: `reports/live-named-participant.json` | 두 기기 사용자 흐름 대기 |
| A19 | 실제 경험 이미지·표현만 있는 문장 분기 모두 instruction 포함: `reports/live-flow.json`, `reports/live-branches.json` | 두 기기 사용자 흐름 대기 |
| A20 | 실제 Responses 두 자연어 next 문구가 승인·저장·생성 실행: live-flow/live-branches 보고서 | 두 기기 실제 흐름 대기 |
| A21 | 실제 Responses 단어 의미 개인 저장·상대 비노출: `reports/live-flow.json`; image 재시작 | 두 기기 사용자 흐름 대기 |
| A22 | 표현 개인 저장 후 no/pending/yes 분기: `shared-state.spec.ts`, `chat-sharing.png` | 두 기기 실제 표현 흐름 대기 |
| A23 | yes만 공통·다음 입력 포함, 중복 yes=1: E2E/domain 및 실제 `reports/live-flow.json` | 두 기기 사용자 흐름 대기 |
| A24 | 학습 원문/보정/출처·개인 목록 및 재시작 조회: `learning-loaded-mixed-sources.png`, image 검사 | 두 기기 E08 대기 |
| A25 | 네 경로 실제 요청 성공·1.7MB 실제 이미지·실제 feedback: OpenAI/live-flow 보고서 | speech-quality 최종 smoke 실패 및 실제 마이크 미검증으로 전체 통과 아님 |
| A26 | 실제 PostgreSQL 동시 next·unique job·stale 및 E07 양쪽 UI 진행/실패/명시적 재시도: `reports/e07-provider-failure.json` | 실제 두 기기 진행/실패 표시 E07 대기 |
| A27 | 실제 SEED·local tokens·세 경로 라이트 화면을 직접 검토, `screenshots/`에 주요 화면 보존 | 데스크톱 현재 렌더 확인; 전체 G3는 별도 미통과 |
| A28 | AWS 배포 후 확인 | G4 범위; AWS 실행 없음 |
| E01 | A/B context 가입·타 화면 초대·CONTEXT_REQUIRED 자동 통과 | 두 물리 노트북 실행 미실행 |
| E02 | 실제 질문 skip/수정저장/재조회 및 수정 후 상세 원문 직접 정리 통과 | 두 기기 사용자 실행과 경험 충실도의 사람 비교 대기 |
| E03 | 실제 OpenAI image bytes+합성 WAV live 전사/보정: `reports/live-flow.json` | 실마이크 교대 발화·전사 충실도 비교 미실행 |
| E04 | synthetic 마감·두 문장·상대 편집·refeedback/stale 자동 통과; 위치 변경 측정/화면 `reports/layout-independence/`, `layout-review-populated.png` | 실제 마지막 발화·긴 문장 청취 비교 미실행 |
| E05 | private/공유 no·pending·yes/중복/다음 입력 자동 통과 | 두 기기 actual OpenAI 사용자 흐름 미실행 |
| E06 | 실제 지명·sentence 분기·두 자연어 next와 발화자 저장: live-flow/live-branches 보고서 | 두 기기 실제 발화 포함 사용자 흐름 미실행 |
| E07 | 실제 API/DB/두 context에서 동시 next/단일 생성/실패/명시적 재요청과 승인·학습 비중복 통과: `reports/e07-provider-failure.json` | 두 기기 UI에서 실패 주입 인수 미실행 |
| E08 | image 재시작의 세션·경험·학습·미디어 bytes 영속성 통과 | 두 물리 기기의 마지막 실제 발화 승인/재조회 미실행 |

## 남은 외부 조건

1. 두 번째 물리 노트북과 참여자·마이크가 필요하다. 같은 호스트의 A/B browser context 결과만으로 E01–E08을 완료할 수 없다.
2. 개발 호스트 터미널에서 `mkcert -install`을 실행해 macOS 인증으로 공개 CA를 신뢰해야 한다. 두 번째 기기에는 **공개 `rootCA.pem`만** 신뢰시킨다. CA 개인키와 서버 개인키를 옮기지 않는다.
3. `AI_MODE=live`의 실제 마이크 발화와 결과를 사람이 비교해야 한다. 합성 WAV와 fake audio는 이를 대체하지 않는다.

G3 필수 항목이 남아 있으므로 bootstrap, stack deploy, ECR 게시, 웹 업로드를 수행하지 않았다.

## G4 진입 확인 (2026-10-09)

사용자는 남은 두 물리 노트북·실마이크 G3 검증을 묻는 질문에 **“검증 완료 — 결과 전달”**, 검증 버전 질문에 **“현재 코드로 배포 진행”**이라고 답했다. 이를 현재 앱 코드의 G3 완료 확인으로 기록했다. 실기기 검사 결과는 사용자 확인에 근거하며, 에이전트가 관찰한 결과가 아니다. 기기 모델·브라우저·녹음 자료는 전달되지 않았다. 이전 기계 판독 기록은 `reports/g3-before-user-confirmation.json`에 보존했다.

배포 대상은 사용자가 선택한 `default` / `004376454721` / `ap-northeast-2`이다. 기준 commit은 `35290d32715d4c2852c0c3f62aa12b1c3d726a79`이며 G4 추가 파일은 아직 commit하지 않은 작업 트리다. 정확한 소스·lockfile 지문은 JSON에 기록했다. 사용자 소유 `prompts/project-presentation.md`는 수정하지 않았다.

이번 세션에서 타입 검사, 단위 306개, 계약 39개, PostgreSQL 통합 17개, E2E 4개(50.8초), build, CDK synth, linux/amd64 image build, 동일 image migration 및 재시작 후 저장 재조회가 통과했다. 앱 기능 코드는 바꾸지 않았고 배포 도구·Decisions 환경 전달·컨테이너 readiness만 추가했다. AWS 환경의 실기기 G4 인수는 이 확인과 별개로 [릴리스 기록](release.md)에 남긴다.

## 웹 재배포 검증 (2026-10-09)

사용자 요청으로 랜딩 페이지·영상과 `malmoa-demo` 초대 힌트를 반영했다. `8b755ac` + 한 줄 UI 변경을 대상으로 전체 TypeScript 검사, 웹 production build, E2E 10개(기존 서비스 4개·랜딩 6개, 1.1분), offline CDK synth를 통과했다. API·공유 package 소스는 현재 AWS API image를 만든 release worktree와 파일 비교 결과 동일하다.

검증 기록의 현재 소스 지문은 `422738ea069d77423147ee3d799c4913d6a3b8f0a0c27ced2f7ed436fcce58c9`이다. 이전 G3 JSON은 [보관본](reports/g3-before-web-redeployment.json)에 남겼으며, 실기기·실마이크 및 변경 없는 서버의 기존 검증은 역사적 근거로 유지한다. 이번 웹 재배포에서 물리 기기 검사를 다시 수행하지 않았다.

웹 게시, 실제 배포 브라우저 확인, 가상 경험 10개를 가진 테스트 계정의 결과는 [릴리스 기록](release.md#웹-재배포와-테스트-계정-2026-10-09)에 있다.

## 챗봇 임계값 API 재배포 준비 (2026-10-09)

검증 대상은 commit `a26b7959f6c2706742363be6ac97d318cccbaca3`이다. 챗봇 Decisions의 자동 실행 confidence 하한은 `0.85`에서 `0.5`로 낮췄고, 음성 Decisions의 `SPEECH_DECISION_CONFIDENCE=0.85`는 유지했다. `0.49` 및 비정상 confidence를 거부하는 경계 검사를 포함해 챗봇 단위 검사 35개가 통과했다.

전체 TypeScript 검사, 단위 306개, 계약 39개, PostgreSQL 통합 17개, offline CDK synth, linux/amd64 API image build를 통과했다. 로컬 image ID는 `sha256:31fcf7528ff6028b114d91c4656c796ad1821d8b7425aca0a178edeee81bd574`다. 웹 production build의 `index.html`과 해시 asset 4개의 SHA-256은 [기존 웹 재배포 목록](reports/aws-web-redeployment.json)과 모두 일치했다. 웹 재게시가 필요하지 않다.

이번 소스에서 브라우저 E2E 10개와 linux/amd64 image 재시작·기록 재조회도 다시 통과했다. 이전 G3의 실기기·실마이크 사용자 확인과 로컬 실제 OpenAI 호출은 역사적 근거이며, AWS URL의 두 물리 기기 G4 인수는 계속 미확인이다. 소스 지문과 실행 범위는 [JSON 기록](local-validation.json)에 남겼다. 배포 후 실제 OpenAI 검사는 [릴리스 기록](release.md#api-임계값-재배포-2026-10-09)에 구분해 기록했다.
