# 말모아 · MALMOA

**우리의 경험으로 대화하고, 함께 나눈 영어를 나의 학습 기록으로.**

말모아는 사람끼리 진행하는 영어 스터디를 AI가 지원하는 웹 서비스입니다. 참여자의 경험을 대화 주제로 만들고, 각자의 음성을 전사해 함께 확인하며, 주제 종료 후 문장별 피드백을 검토하고 승인하면 발화자의 개인 학습 기록에 저장합니다.

## 프로젝트 소개

영어 스터디에서는 대화 주제를 준비하고, 말하는 중 떠오르지 않는 표현을 찾고, 대화 후 배운 내용을 따로 정리해야 합니다. 말모아는 이 과정을 하나의 스터디 흐름으로 연결합니다.

- **대화 준비:** 참여자가 직접 기록한 경험과 관심사를 주제 생성에 활용합니다.
- **대화 중 도움:** 개인 챗봇에서 단어 뜻과 영어 표현을 묻고, 자연어로 스터디 진행을 요청합니다.
- **대화 후 복습:** 자신이 말한 문장에 대한 피드백을 검토하고, 승인한 단어·표현을 개인 기록으로 모읍니다.

대상 사용자는 자신의 경험을 소재로 함께 영어를 연습하는 한국어 사용자입니다. 참여자는 각자 브라우저와 마이크를 사용하며, 같은 스터디의 주제·전사·검토 상태를 공유합니다.

## 주요 기능


| 기능       | 사용자가 할 수 있는 일                                                                   |
| -------- | ------------------------------------------------------------------------------- |
| 가입·초대    | 표시 이름과 아이디로 가입하고, 상대 아이디로 스터디에 초대합니다. 초대는 다른 화면에서도 확인할 수 있습니다.                  |
| 나의 경험    | 경험을 자유롭게 입력하고 선택적 보충 질문에 답하거나 건너뜁니다. 원문·정리본·맥락을 확인하고 수정해 저장합니다.                 |
| 맞춤 대화 주제 | 저장된 경험과 학습·공유 표현을 바탕으로 이미지 또는 문장 주제와 대화 진행 안내를 생성합니다. 특정 참여자의 경험을 지정할 수도 있습니다.  |
| 실시간 전사   | 각 참여자의 마이크 입력을 받아 발화자별 원문 전사와 음성 기반 인식 보정문을 함께 표시합니다.                           |
| 문장별 검토   | 주제를 마치면 문장별 피드백을 확인합니다. 참여자가 보정문을 수정하고 해당 문장의 피드백을 다시 요청하거나 원본 오디오를 재생할 수 있습니다. |
| 개인 챗봇    | 단어 뜻·영어 표현을 묻고 개인 기록에 저장합니다. “다음 주제로 넘어갈게” 같은 요청을 스터디 명령으로 연결합니다.               |
| 표현 공유    | 개인 챗봇에서 얻은 표현은 사용자가 공유에 동의한 뒤 공통 화면과 다음 주제 생성에 반영합니다.                           |
| 나의 학습    | 승인된 피드백을 해당 발화자의 기록으로 저장합니다. 스터디 피드백·챗봇 단어·챗봇 표현 등 출처별로 조회합니다.                  |


개인 챗봇과 학습 기록은 사용자별로 구분합니다. 공통 스터디 상태는 WebSocket으로 동기화하며, 승인·저장·주제 전환은 서버의 권한과 상태 검사를 거칩니다.

### 사용 흐름

1. 두 참여자가 각각 가입하고, **나의 경험**에 대화 소재를 저장합니다.
2. 한 참여자가 상대를 초대하고, 초대를 받은 참여자가 스터디에 들어갑니다.
3. 스터디를 시작하면 경험 기반 대화 주제와 진행 안내가 표시됩니다.
4. 마이크를 켜고 대화하면서 발화자별 원문과 보정문을 확인합니다.
5. 개인 챗봇에서 필요한 표현을 찾고, 함께 연습할 표현은 공유에 동의합니다.
6. 주제를 마친 뒤 문장별 피드백을 검토·수정하고 승인해 다음 주제로 넘어갑니다.
7. 마지막 주제도 검토·승인한 뒤 스터디를 종료하고 **나의 학습**에서 기록을 확인합니다.

## OpenAI 모델 활용 — 서비스 기능과의 연결

아래 모델명은 [`packages/ai/src/config.ts`](packages/ai/src/config.ts)에 정의된 **기본 설정값**입니다. 서버 환경변수로 변경할 수 있으며, 호출 어댑터는 [`provider.ts`](packages/ai/src/provider.ts), 기능별 처리 흐름은 [`jobs.ts`](packages/ai/src/jobs.ts)에 있습니다.


| 기본 모델                            | 사용 API                       | 연결된 서비스 기능   | 입력 → 처리 결과                                                 |
| -------------------------------- | ---------------------------- | ------------ | ---------------------------------------------------------- |
| `gpt-6-luna`                     | Responses API · 구조화 출력       | 경험 정리·보충 질문  | 사용자가 쓴 경험과 답변 → 원문에 근거한 정리본, 관심사·상황 정보, 선택적 질문             |
| `gpt-6-luna`                     | Responses API · 구조화 출력       | 대화 주제 설계     | 경험·학습 표현·공유 표현 → 이미지/문장 유형, 주제 제목·상황·진행 안내, 이미지 생성 프롬프트    |
| `gpt-6-luna`                     | Responses API · 구조화 출력       | 문장 분할·학습 피드백 | 전사·보정문 → 검토할 문장 단위; 각 문장의 최신 보정문 → 한국어 설명과 영어 표현·예문        |
| `gpt-6-luna`                     | Responses API · 도구 호출        | 개인 챗봇·자연어 조작 | 사용자의 요청과 허용된 스터디 맥락 → 주제 진행, 단어·표현 학습 및 저장 등의 제품 도구 실행     |
| `gpt-live-transcribe`            | Realtime API · transcription | 대화 중 원문 전사   | 브라우저에서 전송한 24 kHz PCM 음성 → 실시간 부분 전사와 확정 원문                |
| `gpt-6-luna`                     | Decisions API                | 발화 묶음의 완료 판단 | 같은 화자의 전사와 침묵 시간 → `complete`·`continue`·`uncertain` 및 신뢰도 |
| `gpt-transcribe`                 | Audio Transcriptions API     | 음성 기반 인식 보정  | 발화 묶음의 원본 오디오와 대화 맥락 → 원문과 별도로 보관하는 보정 전사                  |
| `gpt-image-2.5-flare-2026-09-08` | Images API                   | 경험 기반 이미지 주제 | 주제 설계에서 만든 프롬프트 → 공통 스터디 화면에 표시하는 1024×1024 PNG            |


### 음성에서 학습 기록까지

```text
참여자별 마이크
  → AudioWorklet · VAD · 24 kHz PCM16 전송
  → gpt-live-transcribe: 원문 전사
  → Decisions API: 같은 화자의 발화 완료 판단
  → gpt-transcribe: 묶음 오디오를 다시 전사해 인식 보정
  → gpt-6-luna: 문장 단위 구성 · 학습 피드백
  → 참여자 검토·수정·승인
  → 발화자 개인 학습 기록
```

**인식 보정과 영어 학습 피드백은 별도 단계입니다.** 인식 보정은 저장된 음성을 다시 전사하는 작업이고, 자연스러운 영어 표현과 한국어 설명은 이후 문장별 피드백에서 제공합니다. 원문과 보정문을 함께 보관해 검토 화면에서 비교할 수 있습니다.

Decisions API는 기본적으로 발화 종료 후 1초 시점부터 완료 여부를 판단하며, 완료 신뢰도 기준은 `0.85`입니다. 발화가 재개되면 이전 판정을 무효화하고, 최대 침묵 10초에서 묶음 경계를 확정합니다. 관련 구현은 [`speech-boundary.ts`](packages/ai/src/speech-boundary.ts)에 있습니다.

### 모델 출력과 제품 동작의 연결

- 구조화 출력은 JSON Schema로 요청하고 Zod 스키마로 검증합니다. 경험 정리는 원문·답변의 실제 문자열을 근거로 검사합니다.
- 개인 챗봇의 도구 호출은 서버가 사용자·권한·현재 주제·수정 버전을 확인한 뒤 실행합니다. 표현 공유 여부는 사용자의 동의로 결정합니다.
- 보정문을 수정하면 해당 버전으로 피드백을 다시 생성합니다. 승인 시 최신 피드백을 확인하고 발화자에게 학습 항목을 저장합니다.
- OpenAI API 키는 서버 환경변수로 관리합니다. 브라우저는 애플리케이션 API와 음성 WebSocket에 연결합니다.

**테스트용 음성 생성:** 별도 [`packages/test-voice`](packages/test-voice/README.md) 패키지는 `gpt-4o-mini-tts`와 기본 음색 `coral`을 사용해 합성 WAV를 생성합니다. macOS에서 재생하거나 가상 마이크로 입력해 음성 경로를 시험하는 개발 도구입니다.

## 기술 구성

```text
React · Vite · SEED Design
        │ HTTP / WebSocket
Fastify API
        ├─ PostgreSQL: 사용자·스터디·경험·전사·피드백·학습 기록
        ├─ 미디어 저장소: 이미지·오디오 (로컬 파일 / S3 어댑터)
        └─ OpenAI: Responses · Realtime · Decisions · Audio · Images
```


AWS 구성은 CDK 코드로 정의되어 있습니다. CloudFront·S3, ALB·ECS Fargate, RDS PostgreSQL, Secrets Manager 등의 구성과 실행 절차는 [`infra/README.md`](infra/README.md)에 정리되어 있습니다.

## 프로젝트 구조

pnpm 워크스페이스 기반 모노레포입니다. 실행 애플리케이션은 `apps/`, 여러 기능에서 사용하는 공유 모듈은 `packages/`, 배포 인프라는 `infra/`에 둡니다.

```text
.
├─ apps/                         # 실행 애플리케이션
│  ├─ web/                       # React · Vite 웹 프런트엔드
│  │  ├─ src/app/                # 앱 진입 화면, 라우팅, 전역 상태·스타일
│  │  ├─ src/features/           # 가입(auth), 스터디(study), 챗봇(chat), 경험(experiences), 학습(learning)
│  │  ├─ src/shared/             # 공통 UI, API·이벤트·세션·오디오 연결
│  │  └─ seed-design/ui/         # SEED Design 기반 UI 컴포넌트
│  └─ api/                       # Fastify HTTP · WebSocket 서버
│     ├─ src/domain/             # 계정·스터디 진행·음성·개인 기록의 업무 규칙
│     ├─ src/http/               # HTTP 라우트, 인증·보안 검사, 오류 응답
│     ├─ src/realtime/           # WebSocket 연결과 사용자·스터디별 이벤트 전파
│     ├─ src/db/                 # PostgreSQL 연결, 스키마, 마이그레이션
│     ├─ src/features/ai/        # 서버 업무 흐름과 AI 작업 연결
│     ├─ src/storage/            # 이미지·오디오 저장소의 로컬 파일·S3 구현
│     ├─ scripts/               # API 빌드 스크립트
│     └─ test/                  # 서버 설정·미디어·HTTP·업무 규칙 테스트
├─ packages/                    # 애플리케이션 간 공유 패키지
│  ├─ contracts/                # HTTP·이벤트·오디오·AI 도구의 공유 타입과 검증 스키마
│  ├─ client/                   # 타입이 지정된 HTTP API·WebSocket 이벤트 클라이언트
│  ├─ application-ports/        # 서버·AI 간 인터페이스와 테스트용 대체 구현
│  ├─ ai/                       # OpenAI 어댑터, 프롬프트, 주제·피드백·챗봇·음성 처리
│  ├─ audio-client/             # 브라우저 마이크 캡처, VAD, 리샘플링, 음성 전송
│  ├─ fixtures/                 # UI 개발·테스트용 샘플 데이터와 모의 HTTP·이벤트 처리
│  └─ test-voice/               # 테스트용 합성 음성 생성·검증·재생 및 가상 마이크 도구
├─ infra/                       # AWS CDK 인프라 프로젝트
│  ├─ bin/                     # CDK 앱 실행 진입점
│  ├─ src/                     # AWS 스택과 SPA 경로 재작성 코드
│  └─ test/                    # 생성된 인프라 템플릿 검사
├─ scripts/                     # 개발·배포·검증용 실행 도구
│  ├─ local/                   # 로컬 환경 설정, 서비스 실행, 인증서·사전 점검
│  ├─ deploy/                  # 배포 환경 검사와 배포 전 검증 단계
│  └─ validation/              # 실제 서비스 흐름·분기 실행 및 결과 확인
├─ tests/                       # 여러 애플리케이션을 연결하는 시나리오 테스트
│  ├─ e2e/                     # Playwright 기반 브라우저 흐름·오류·화면 배치 검증
│  └─ live/                    # 실제 OpenAI를 사용하는 서비스 흐름·분기 검증
├─ docs/                        # 제품 요구사항과 개발·운영 문서
│  ├─ architecture/            # MVP 시스템 아키텍처
│  ├─ implementation/          # 구현 계획, 로컬 실행·AWS 배포·검증 절차
│  │  ├─ env/                  # 로컬·배포 환경변수 예시
│  │  └─ evidence/             # 검증 결과와 실행 보고서
│  └─ sessions/                # 개발 세션별 작업 범위와 인수인계 문서
├─ design/                      # 디자인 시스템 HTML과 공통 디자인 토큰
├─ prompts/                     # 구현 계획·테스트 음성 데이터 작업용 프롬프트
└─ .github/workflows/           # GitHub Actions CI 워크플로
```

패키지 내부의 `src/`는 구현 코드, `test/`는 별도 테스트, `scripts/`는 해당 패키지의 보조 실행 도구를 담습니다. 일부 단위 테스트는 구현 파일 옆의 `*.test.ts`로 관리합니다. 실행·검증 과정에서 생성되는 `node_modules/`, `dist/`, `.local/`, `test-results/`, `cdk.out/` 등은 위 구조에서 생략했습니다.

## 로컬 실행

**준비:** Node.js `24.20.0`, pnpm `10.33.2`, Docker·Docker Compose, 사용할 모델에 접근 가능한 OpenAI API 키.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
# 생성된 .env.local에 서버 전용 OPENAI_API_KEY 설정
pnpm dev:services
pnpm db:migrate:local
pnpm preflight --target=local
pnpm dev
```

새 환경의 기본 웹 주소는 `http://localhost:5173`입니다. API는 `127.0.0.1:3000`, PostgreSQL은 `127.0.0.1:5432`이며 웹의 `/api`·`/ws` 프록시를 사용합니다. 실제 접속 주소는 `.env.local`의 `LOCAL_WEB_ORIGIN`과 Vite 실행 로그에서 확인하세요. 포트 변경 시 `PORT`, `WEB_PORT`, `LOCAL_WEB_ORIGIN`을 함께 설정합니다.

`setup:local`은 기존 환경파일과 DB volume을 보존합니다. 실제 모델을 사용하는 기본 설정은 `AI_MODE=live`이며 API 사용 요금이 발생합니다. 테스트용 AI 구현은 `AI_MODE=mock`으로 선택합니다. LAN에서 다른 기기의 마이크를 사용할 때 필요한 HTTPS 설정은 [로컬 실행서](docs/implementation/local-validation.md)를 따릅니다.

### 검사 명령

```sh
pnpm typecheck
pnpm contracts:check
pnpm test:unit
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:audio-browser
pnpm build
pnpm infra:synth
pnpm build:api-image

# 실제 OpenAI를 호출하는 별도 유료 검사
pnpm smoke:openai
```
