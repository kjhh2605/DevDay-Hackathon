# 함께 말하는 영어 스터디

사람 간 영어 대화를 돕는 스터디 앱입니다. 경험을 바탕으로 주제를 만들고, 참여자별 음성의 원문 전사와 인식 보정문을 나란히 표시합니다. 주제 종료 후 문장별 피드백을 검토하고 승인하면 발화자의 개인 학습 기록으로 저장합니다.

## 로컬 실행

Node **24.20.0**, pnpm **10.33.2**, Docker와 Docker Compose가 필요합니다.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
# .env.local에 서버 전용 OPENAI_API_KEY 설정
pnpm dev:services
pnpm db:migrate:local
pnpm preflight --target=local
pnpm dev
```

웹 주소는 `.env.local`의 `LOCAL_WEB_ORIGIN`과 Vite 실행 로그에서 확인합니다. 새 환경의 기본값은 웹 `http://localhost:5173`, API `127.0.0.1:3000`, PostgreSQL `127.0.0.1:5432`이며, 웹의 `/api`·`/ws` 프록시를 통해 접근합니다. 다른 앱이 기본 포트를 사용 중이면 `PORT`, `WEB_PORT`, `LOCAL_WEB_ORIGIN`을 함께 맞춰 주세요. Vite는 포트가 사용 중일 때 다른 포트로 자동 이동하지 않습니다. 현재 검증 환경의 실제 주소는 [검증 기록](docs/implementation/evidence/local-validation.md)에 있습니다.

환경 설정과 LAN HTTPS 절차는 [로컬 실행서](docs/implementation/local-validation.md)를 따릅니다. `setup:local`은 기존 환경파일과 DB volume을 보존합니다.

외부 자격증명 없이 타입 검사·빌드를 수행할 수 있습니다. 실제 제품 흐름은 PostgreSQL, 파일 저장소와 OpenAI를 사용합니다. 일반 자동 테스트의 명시적인 AI fake와 실제 모델 호출을 구분합니다.

```sh
pnpm typecheck
pnpm contracts:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm infra:synth
pnpm build:api-image
# 유료 OpenAI 호출: 일반 테스트와 별도로 실행
pnpm smoke:openai
```

## 코드 구성

- `apps/web`: React·SEED UI, 스터디·개인 챗봇·경험·학습 기록.
- `apps/api`: Fastify HTTP/WebSocket, PostgreSQL 트랜잭션, 사용자 세션, 미디어 저장.
- `packages/contracts`, `client`, `fixtures`, `application-ports`: 검증 가능한 공유 계약, typed client, 테스트 데이터, 서버 내부 포트.
- `packages/ai`, `audio-client`: OpenAI 처리와 브라우저 PCM·VAD 캡처.
- `scripts/local`, `infra`, `tests/e2e`: 로컬 환경, AWS CDK 코드, 인수 검사.

[구현 계획](docs/implementation/work-plan.md)의 G0~G3는 로컬 범위입니다. G3의 실제 두 노트북·실마이크 검증을 포함한 필수 항목이 모두 통과하기 전에는 AWS를 배포하지 않습니다. 실행 결과와 미실행 항목은 [검증 기록](docs/implementation/evidence/local-validation.md)에 구분해 남깁니다.
