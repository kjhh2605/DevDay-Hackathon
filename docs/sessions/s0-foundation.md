# S0 — 공통 기반·계약·통합

## 작업 목적

공통 계약과 기동 가능한 앱 골격을 먼저 만들어 다른 5개 세션이 서로를 기다리지 않고 구현하게 한다. 이후 계약 변경과 최종 통합을 책임진다. 프로젝트 경로는 `/Users/gnar/orca/projects/DevDay-Hackathon`이다.

## 먼저 읽을 자료

- [PRD](../prd.md), [아키텍처](../architecture/mvp-architecture.md).
- [공유 계약](../implementation/shared-contracts.md) 전체, [작업 계획](../implementation/work-plan.md).
- [인수 기준](../implementation/acceptance.md), [디자인 토큰](../../design/tokens.css).
- [로컬 실행서](../implementation/local-validation.md): G3 통과 전 AWS 리소스를 생성하지 않는 작업 순서.
- [준비 사항·환경변수](../implementation/prerequisites.md), [로컬 예제](../implementation/env/local.env.example).
- [SEED Vite 설치](https://seed-design.io/react/getting-started/installation/vite).

## 소유권

소유: root workspace/package/lockfile/tsconfig/lint·테스트 공통 설정, `.env.example`, `.gitignore`, `packages/contracts`, `packages/client`, `packages/fixtures`, `packages/application-ports`, 계약 문서 변경과 통합 기록.

처음 생성하는 `apps/web`, `apps/api` 골격은 G0에서 S3/S1에게 인계한다. 이후 feature UI·DB·OpenAI adapter·CDK를 직접 병행 구현하지 않는다. 다른 세션도 같은 코드베이스에서 작업하므로 타인의 변경을 되돌리지 않고 변경에 맞춰 통합한다.

## 수행 순서

1. 기존 파일/사용자 변경을 확인하고 원본 `docs/prd.md`, `design/`를 보존한다. 현재 앱 코드가 없다면 pnpm monorepo와 Node 24 기준 골격을 만든다.
2. React+Vite, Fastify, Zod, typed client, fixture package의 build 순서를 정한다. SEED/React/Vite 플러그인과 서버 패키지의 호환 버전을 한 번 선택해 lockfile에 고정한다.
3. 공유 계약의 DTO, endpoint, CommandResult, Error, Event union, Job result union을 실행 가능한 스키마로 만든다. 서버 권한·DB 규칙을 UI 타입으로 대체하지 않는다.
4. 명령·쿼리용 typed client와 Event adapter 인터페이스를 만든다. FE가 provider 응답·DB row를 import하지 않게 package export를 제한한다.
5. S1↔S2의 application port 타입과 fake를 만든다. 특히 job 예약은 S1, 실행은 S2, 커밋 후 publish는 S1 포트를 통해 수행한다는 경계를 고정한다.
6. 두 사용자 fixture와 MSW handler/event mock을 만든다. 정상·빈 데이터·생성 중·실패·stale 피드백·공유 yes/no 상태를 포함한다.
7. 환경변수 계약과 예제를 root `.env.example`에 반영하고 공통 script·테스트 실행 방법을 정해 G0 인계를 작성한다. `.env.local`·`.env.deploy.local`·`.local/`를 먼저 git에서 제외한다. AWS 자격증명 없이 로컬 개발이 가능하도록 저장 port를 분리하고 통합 worktree를 지정한다. S1~S5는 이후 자기 경로의 작업을 시작한다.
8. 세션별 변경을 로컬에서 통합하며 계약 소비 측 typecheck와 의미 검증을 수행한다. G2/G3의 누락 기능을 작업표에 연결한다. S5와 G3 검증 대상 및 통과 기록을 맞춘 뒤 AWS 단계로 넘긴다.

## G0에 제공할 구체적 인터페이스

- `contracts`: 스키마·타입·endpoint registry·event 이름·도구 입력 스키마. 내부 동작까지 정해지지 않은 `any`는 금지.
- `client`: 로그인 cookie를 포함하는 fetch, 오류 타입, DTO 검증, event parse. `actorUserId`를 인수로 받아 임의 사용자를 가장하지 않음.
- `fixtures`: 사용자 A/B, 초대, 이미지/문장 주제, 실시간 전사 상태, review, 수정·재요청, 개인 학습, 경험 draft, job 실패.
- `application-ports`: 공유 계약 11절의 타입. 순환 import 없이 S1 app 조립 가능.
- 공통 scripts: `dev:services`, `db:migrate:local`, `dev`, `dev:lan`, `preview:lan`, `build`, `typecheck`, `contracts:check`, `test:unit`, `test:integration`, `test:e2e`. G0에서는 인터페이스·담당을 고정하고 S1/S3/S5가 서비스·LAN·image 실행을 연결한다. S2/S5 요청으로 `smoke:openai`, infra/deploy 명령을 추가.
- `.env.example`: `APP_ENV`, `MEDIA_DRIVER`, 로컬 DB/파일 경로, 서버 전용 OpenAI 키, 로컬 origin/TLS/쿠키 설정. `.gitignore`에 로컬 비밀·인증서·미디어를 제외한다.
- `setup:local`, `preflight --target=local|lan|aws`: 인터페이스는 S0, script는 S5, API 환경 schema/parser는 S1. 환경파일의 안전한 로딩 규칙과 bool/port/URL 검증을 공유한다. live 검증에는 키가 필요하지만 build/typecheck 및 명시적인 mock 작업은 외부 자격증명 없이 가능해야 한다.

`contracts:check`는 fixture/HTTP/event 스키마의 일치와 strict 도구 schema 변환을 검사한다. 단순 TypeScript 컴파일만으로 실행 시 계약 검증을 대신하지 않는다.

## 독립 작업과 의존 관계

S0는 즉시 시작 가능하다. S3가 색·레이아웃을 수정하는 동안 계약 변경을 요구하지 않는다. S1/S2의 기능 의미 변경만 공통 조정 대상으로 취급한다. S5가 배포 스크립트를 만들 때 root script 추가는 S0가 통합한다.

## 완료 조건과 인계

G0: clean install/build/typecheck가 통과하고 S1~S5가 mock/포트로 자기 작업을 시작할 수 있다. 골격/계약만 만든 시점에 제품 완료로 표시하지 않는다.

배포 전: A01~A27/E01~E08이 실제 로컬 환경에서 통과했고 S5의 `evidence/local-validation.md`에 대상 commit과 결과가 남아 있어야 한다. 미실행 기능을 AWS에서 나중에 검증한다며 G3를 넘기지 않는다.

최종: [인수 기준](../implementation/acceptance.md)의 모든 기능이 실제 구현에 연결되어 있으며, 계약 변경이 문서·fixture·소비 코드에 함께 반영되어 있다. 인계에는 선택 버전, public exports, 공통 명령, 소유권 이전 경로, 미완료 항목을 기록한다.
