# 구현 시작 전 준비 사항과 환경변수

로컬 구현·검증을 먼저 완료한 뒤 AWS에 배포한다. 사용자에게 필요한 외부 입력, 구현 세션이 생성할 값, 사전 점검을 이 문서에서 구분한다. 제품 구현이나 계정 설정을 완료했다는 문서가 아니다. 환경변수 이름·기본값·조건은 본 문서가 기준이며 S0가 실제 `.env.example`과 함께 유지한다.

## 1. 사용자가 준비할 것

| 시점 | 준비 항목 | 준비 방법 / 완료 조건 |
| --- | --- | --- |
| G1 실제 AI 검증 전 | OpenAI API 프로젝트와 API 키 | 해당 프로젝트의 키를 서버용 `.env.local`에 입력. 채팅이나 문서에 실제 키를 남기지 않음 |
| G1 전 | API 결제·잔액과 모델 호출 권한 | Realtime 전사, Audio Transcriptions, Responses, Images를 실제 호출할 수 있어야 함 |
| G1~G3 | 두 노트북·두 참여자·각 마이크, 같은 개발 LAN | 같은 서버에 접속하며 각 마이크에 본인 음성만 들어오는 테스트 환경. 통합 확인용 브라우저는 우선 같은 최신 Chrome 사용 |
| G1 LAN 검증 전 | 로컬 HTTPS 인증서의 기기별 신뢰 설정 | S5가 mkcert 절차를 준비. 두 번째 노트북에도 공개 CA 인증서 신뢰 설정 필요 |
| G3 통과 후 배포 준비 | 사용할 AWS account와 CLI profile | 계정 ID와 profile 이름을 지정. 서울 리전과 CDK 배포 역할의 권한 확인 |

ChatGPT 구독과 API 사용 요금은 별도다. API 결제 상태를 확인해야 하며 ChatGPT 로그인만으로 앱의 API 호출이 준비되지는 않는다. [OpenAI 결제 안내](https://help.openai.com/en/articles/9039756)

OpenAI 키에는 필요한 endpoint 요청 권한이 있어야 한다. 프로젝트 역할·키 제한·모델 접근 설정을 함께 확인한다. 계정에 조직 확인 요구가 표시되면 해당 절차를 완료한다. 키 문자열이 존재하거나 모델 목록 조회가 성공한 것만으로 네 호출 경로를 통과 처리하지 않는다. [OpenAI 권한](https://developers.openai.com/api/docs/guides/rbac), [조직 확인](https://help.openai.com/en/articles/10910291-api-organization-verification)

키·테스트 기기 준비와 무관하게 S0 기반 작업 및 fixture 기반 UI 구현은 시작할 수 있다. 실제 OpenAI·실마이크 검증이 필요한 G1/G3의 미실행 항목은 그대로 남긴다. AWS 계정은 로컬 개발의 선행 조건이 아니다.

## 2. 현재 개발 호스트에서 확인한 상태

2026-10-09에 버전·파일 존재·Docker 응답을 읽기 방식으로 확인했다. 이후 문서용 예제에 입력된 키 값을 root `.env.local`로 옮기고 로컬 DB 비밀번호·미디어 경로와 git 제외 규칙을 준비했다. 아래 결과는 현재 호스트 기준이며 다른 노트북까지 확인한 결과가 아니다.

| 항목 | 결과 |
| --- | --- |
| Node.js | `v24.20.0` 확인 |
| pnpm | `10.33.2` 확인. 실제 프로젝트 버전 고정은 S0 담당 |
| Docker | CLI/daemon `29.2.1`, daemon 응답 정상 |
| Docker Compose | `v5.1.0` 확인 |
| Git | `2.50.1` 확인 |
| AWS CLI | `2.36.23` 확인. 로그인·계정·배포 권한은 미확인 |
| mkcert | 현재 PATH에서 확인되지 않음. 로컬 LAN HTTPS 준비 때 설치 필요 |
| 프로젝트 root `.env.example` | 아직 없음. S0가 문서용 예제로 생성 |
| 프로젝트 root `.env.local` | 준비됨. 키 값·생성한 로컬 DB 비밀번호·미디어 절대 경로 보관, 파일 권한 0600 |
| OpenAI 키 | `.env.local`에 보관. 실제 유효성·모델 호출 권한·결제 상태는 미검증 |
| git 제외 규칙 | `.env.local`, `.env.deploy.local`, `.local/` 제외를 확인 |
| 앱·workspace·lockfile | 아직 없음. 실행 script는 후속 S0~S5가 구현할 예정 |

패키지 설치, OpenAI API 키 발급·유료 호출, DB 기동·migration, 인증서 설치, AWS 계정 로그인·리소스 생성은 이번 확인에서 실행하지 않았다. 환경파일 준비와 실제 서비스 실행 검증은 구분한다.

## 3. 환경파일과 로딩 규칙

복사 가능한 문서용 예제는 [로컬 환경 예제](env/local.env.example), [배포 CLI 환경 예제](env/deploy.env.example)다. 예제의 빈 키·`REPLACE_` 값은 사용 가능한 자격증명이 아니다.

| 파일 / 값 | 생성·관리 | 사용처 |
| --- | --- | --- |
| root `.env.example` | S0가 로컬 예제를 반영해 생성·버전 관리 | 변수 이름과 안전한 기본값 |
| root `.env.local` | `setup:local`이 없는 파일만 생성. 사용자가 OpenAI 키 입력 | 로컬 API·migration·compose 실행 도구 |
| root `.env.deploy.local` | 배포 CLI 예제로 준비. 사용자 account/profile 입력 | S5의 AWS CLI/CDK 명령만 |
| AWS task 환경 | S5 CDK와 Secrets Manager가 주입 | 실제 AWS 앱과 migration task |

S0는 환경파일 생성 전에 `.env.local`, `.env.deploy.local`, `.local/`를 git에서 제외한다. S5는 같은 로컬 자료를 Docker build context에서도 제외한다. 작업 세션은 실제 환경파일을 통째로 출력하지 않는다.

S0/S1/S3/S5가 지킬 로딩 계약:

- 실행 위치가 어느 package여도 workspace root를 기준으로 환경파일을 찾는다. 우선순위는 **명시적 실행 환경변수 → 선택한 환경파일 → 안전한 기본값**이다. API와 migration은 같은 parser·DB 설정을 사용한다.
- compose가 `.env.local`을 자동으로 읽는다고 가정하지 않는다. `dev:services` wrapper가 해당 파일을 명시하고 DB_NAME/USER/PASSWORD를 POSTGRES_DB/USER/PASSWORD로 매핑한다. PostgreSQL 컨테이너에 OpenAI 키를 포함한 환경파일 전체를 주입하지 않는다.
- `setup:local`은 기존 파일이나 키를 덮어쓰지 않는다. 처음에만 임의의 로컬 DB 비밀번호와 workspace의 미디어 절대 경로를 채운다. 신규 파일의 OpenAI 키는 빈 값으로 남기고 필요한 입력만 알려준다. 이미 준비된 환경파일은 검증해서 사용하고, 지정 미디어 디렉터리가 없으면 생성한다.
- Vite 실행에는 `VITE_API_BASE`와 필요한 로컬 port/origin/TLS 경로만 선택해 전달한다. 서버 환경 전체를 `define`, `process.env` 복제, 넓힌 `envPrefix`로 브라우저에 넣지 않는다. `VITE_` 값은 번들에 노출되므로 비밀을 넣지 않는다. [Vite 환경변수](https://vite.dev/guide/env-and-mode)
- `NODE_ENV`는 각 명령이 정한다. dev는 development, test는 test, build 및 production image는 production이다. 로컬 검증용 production image도 `APP_ENV=local`을 사용한다. 로컬 파일에 `NODE_ENV=development`를 고정해 build에 전파하지 않는다.
- bool은 문자열 `true`/`false`를 명시적으로 파싱하고 port·enum·URL도 시작 시 검사한다. `Boolean("false")` 같은 변환이나 누락된 비밀의 임의 기본값을 쓰지 않는다. 오류에는 변수명과 수정 방법만 표시한다.
- `AI_MODE=mock`을 명시한 개발·자동 검사에서는 OpenAI 키를 요구하지 않는다. G1 실제 호출과 G2/G3 인수, AWS 앱은 `AI_MODE=live`다. 타입 검사·빌드가 API 키나 AWS 자격증명을 요구해서는 안 된다.

## 4. 로컬 환경변수 계약

| 변수 | 기본값 / 필요한 조건 | 담당·주의점 |
| --- | --- | --- |
| `APP_ENV` | `local` / AWS는 `aws` | S1. 인프라 선택 |
| `API_HOST`, `PORT` | 호스트 dev는 `127.0.0.1`, `3000` | S1/S5. 컨테이너는 `API_HOST=0.0.0.0`, 호스트 노출은 loopback |
| `WEB_PORT` | `5173` | S3. dev/preview 모두 같은 port와 strictPort 사용 |
| `AI_MODE` | `live` | S1/S2. mock은 명시적으로 선택한 개발·테스트에만 사용 |
| `OPENAI_API_KEY` | live일 때 필수, 기본값 없음 | 사용자 입력. 서버 전용 |
| `OPENAI_TEXT_MODEL` | `gpt-6-luna` | S2. 함수 호출·구조화 출력 |
| `OPENAI_LIVE_TRANSCRIBE_MODEL` | `gpt-live-transcribe` | S2. 실시간 전사 |
| `OPENAI_CORRECTION_MODEL` | `gpt-transcribe` | S2. 동일 오디오 재전사 |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare-2026-09-08` | S2. 실제 이미지 생성 |
| `DB_HOST`, `DB_PORT` | 호스트 API는 `127.0.0.1`, `5432` | S5. API 컨테이너에서는 compose의 `postgres:5432`로 덮어씀 |
| `DB_NAME`, `DB_USER` | `devday_study`, `devday_app` | S1/S5. compose의 POSTGRES_DB/USER에 같은 값 전달 |
| `DB_PASSWORD` | 초기화 도구가 로컬용 임의 값 생성 | S5. compose의 POSTGRES_PASSWORD와 일치, 재실행 시 재생성 안 함 |
| `DB_SSL_MODE` | 로컬 `disable`, AWS `verify-full` | S1. 연결 옵션으로 명시적으로 변환 |
| `DB_SSL_CA_PATH` | 로컬 빈 값, AWS CA 파일 경로 | S1/S5. AWS는 CA/호스트 이름 검증 유지 |
| `COMPOSE_PROJECT_NAME` | `devday-study-local` | S5. 별도 환경은 이름·port·volume을 함께 분리 |
| `MEDIA_DRIVER` | 로컬 `filesystem`, AWS `s3` | S1. 암묵적인 대체 금지 |
| `MEDIA_LOCAL_DIR` | 현재 workspace의 `.local/media` 절대 경로 | S5가 생성, S1이 읽기/쓰기. 컨테이너에서는 bind mount 경로로 덮어씀 |
| `LOCAL_WEB_ORIGIN` | `http://localhost:5173` | S1/S3. URL의 port와 WEB_PORT 일치. LAN은 아래 HTTPS 설정 |
| `LOCAL_TLS_CERT`, `LOCAL_TLS_KEY` | localhost HTTP는 빈 값, LAN은 실제 절대 경로 | S5 준비, S3 Vite 설정에서 읽음 |
| `SESSION_COOKIE_SECURE` | localhost HTTP는 `false`, LAN/AWS는 `true` | S1. HttpOnly/SameSite=Lax/Path=/는 코드에서 고정 |
| `VITE_API_BASE` | `/api/v1` | S0/S3. FE에 노출해도 되는 상대 경로 |

모델 ID는 현재 선정값이다. S2가 G1에서 실제 SDK 요청 형식·계정 접근·결과를 확인하고 문제가 있으면 OpenAI 내 대체 모델을 검증해 관련 문서와 예제를 함께 갱신한다. 기능을 mock으로 바꿔 통과시키지 않는다.

LAN 검증으로 바꿀 때는 `WEB_PORT`에 맞춰 `LOCAL_WEB_ORIGIN=https://<개발 호스트 LAN IP>:5173`, 인증서/키의 절대 경로, `SESSION_COOKIE_SECURE=true`를 설정한다. `dev:lan`과 `preview:lan`은 LAN에 바인딩하지만 API/DB의 호스트 port는 직접 LAN에 공개할 필요가 없다. 절차는 [로컬 실행서](local-validation.md)를 따른다.

현재 설계에는 별도 JWT 서명 키, OAuth client secret, SMTP 키, SEED/MCP API 키, FE용 OpenAI 키가 필요하지 않다. 세션은 서버가 임의 토큰을 발급하고 DB에 해시를 저장하는 계약이다. WS 주소는 현재 페이지 origin에서 만들고 별도 `VITE_WS_URL`을 두지 않는다. DB 접속은 위 개별 변수로 통일하고 별도 `DATABASE_URL`과 이중 관리하지 않는다.

## 5. AWS 단계에서 필요한 값

G3 통과 후 [AWS 실행서](aws-deployment.md)를 시작한다. 사용자는 `.env.deploy.local`에 `STUDY_AWS_PROFILE`, `STUDY_AWS_ACCOUNT_ID`, `AWS_REGION=ap-northeast-2`를 지정한다. S5의 CLI/CDK wrapper가 해당 profile·account·region을 명시해 사용하고 STS 결과가 지정 계정과 다르면 중단한다. CLI 설치만으로 계정 접근이 확인된 것은 아니다.

| 값 | 준비 주체 / 주입 방법 |
| --- | --- |
| profile의 로그인·배포 역할 | 사용자/계정 관리자. CloudFormation·CDK bootstrap 및 선정 리소스 생성, 필요한 IAM 역할 전달 권한 확인 |
| RDS endpoint·port·DB명 | CDK 출력 |
| RDS 사용자·비밀번호 | Foundation이 만든 secret에서 API/migration task로 주입 |
| `DB_SSL_MODE=verify-full`, `DB_SSL_CA_PATH` | S5가 RDS CA를 image에 포함하고 경로 주입 |
| `MEDIA_BUCKET`, `AWS_REGION` | CDK 출력/배포 설정 |
| `APP_ENV=aws`, `API_HOST=0.0.0.0`, `PORT=3000`, `MEDIA_DRIVER=s3`, `AI_MODE=live`, `SESSION_COOKIE_SECURE=true` | CDK 고정 환경 |
| `OPENAI_API_KEY` | 사용자의 프로젝트 키를 Secrets Manager에 입력 후 주입 |
| 네 `OPENAI_*_MODEL` | G3에서 검증한 값 그대로 주입 |
| CloudFront URL·distribution ID·bucket·task ARN | stack output. 사람이 미리 이름/ARN을 채울 필요 없음 |

AWS 앱에는 profile 파일이나 장기 access key를 넣지 않고 task role을 사용한다. 개발 호스트의 로컬 DB 비밀번호·경로·인증서는 AWS에 복사하지 않는다. RDS는 CA와 서버 이름을 검증하며 TLS를 끄는 방식으로 접속 문제를 우회하지 않는다. [RDS SSL 연결](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)

SSO profile을 사용하는 계정은 배포 세션 전에 해당 로그인을 완료한다. bootstrap도 리소스를 만드는 작업이므로 G3 이후에 실행한다. 사용자 지정 도메인, DNS, ACM 인증서를 미리 구매/준비할 필요는 없다. 선정한 CloudFront 기본 도메인을 사용한다. [CDK 시작·인증](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html), [CDK bootstrap](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)

## 6. 구현 세션이 제공할 사전 점검

아래는 S0가 명령 인터페이스를 확정하고 S5가 구현할 script다. API 환경 parser는 S1이 제공하고 S2는 OpenAI smoke를 제공한다. 현재 실행 가능한 script가 있다는 뜻은 아니다.

| 명령 | 역할 / 통과 기준 |
| --- | --- |
| `pnpm setup:local` | git 제외 확인 → 없는 환경파일 생성 → 로컬 DB 비밀번호·미디어 절대 경로 준비. 기존 파일/DB volume 보존 |
| `pnpm preflight --target=local` | Node/pnpm·Docker/Compose, 환경 schema, live 키 존재, DB 연결/migration, 미디어 임시 파일 쓰기/읽기 확인. OpenAI/AWS 호출 안 함 |
| `pnpm preflight --target=lan` | local 검사 + HTTPS origin·port·인증서/키 존재·대상 IP 확인. 두 브라우저의 신뢰·실마이크는 수동 확인 대기로 별도 표시 |
| `pnpm smoke:openai` | 실제 Realtime·파일 전사·Responses 도구/구조화 출력·이미지 경로를 소량 호출. 모델 ID·성공/실패·request ID 기록, 키는 출력 안 함 |
| `pnpm preflight --target=aws` | G3 기록·대상 코드 확인 후 profile/STS 계정·리전·기존 bootstrap·RDS 옵션·quota 등 읽기 점검. 리소스 생성은 안 함 |

preflight는 빠르게 원인을 알려주는 작은 실행 도구다. 서비스 기능·운영 대시보드로 만들지 않는다. `smoke:openai`는 유료 호출을 명시하며 일반 typecheck/build/test에 숨겨 실행하지 않는다. 짧은 샘플 오디오의 API 성공과 사람이 실제 마이크로 말한 결과 검증은 구분한다.

구현 후의 최초 실행 순서:

```sh
pnpm install --frozen-lockfile
pnpm setup:local
# 사용자가 .env.local의 OPENAI_API_KEY를 채운 뒤 계속
pnpm dev:services
pnpm db:migrate:local
pnpm preflight --target=local
pnpm dev
```

S2는 별도 터미널에서 smoke를 실행하고 G1 결과를 남긴다. S3/S5는 LAN 설정 후 두 기기의 쿠키·WSS·마이크를 확인한다. preflight 통과만으로 G3를 대체하지 않으며 전체 기능 기준은 [인수 문서](acceptance.md)를 따른다.

## 7. 병렬 작업에서 먼저 맞출 사항

- S0가 통합에 쓸 worktree를 지정하고 S5가 그 환경의 프로세스·compose를 관리한다. 기본 port 5173/3000/5432의 통합 환경을 여러 세션이 동시에 띄우지 않는다.
- 별도 앱 환경이 필요하면 해당 worktree의 WEB_PORT/PORT/DB_PORT, LOCAL_WEB_ORIGIN, compose 프로젝트·volume·미디어 경로를 함께 분리한다. port 충돌은 이름과 점유 port만 보고하고 다른 세션의 프로세스를 종료하지 않는다.
- DB migration은 S1, root 의존성·lockfile은 S0가 통합한다. 동일 DB에 서로 다른 branch의 migration을 동시에 적용하지 않는다.
- 테스트 사용자 A/B, 경험이 없는 사용자, 짧은 경험/상세 경험, 혼용 발화 샘플은 S0 fixture와 S5 실제 검증 데이터로 준비한다. 첫 스터디에 경험 입력이 필요하다는 승인된 기본값을 테스트 기동 오류로 오해하지 않는다.
- S2는 선택한 네 모델의 호출을 G1 초기에 확인한다. G3까지 미루거나 계정 오류를 임시 성공 응답으로 숨기지 않는다.

## 8. 막힐 때 먼저 확인할 곳

| 증상 | 먼저 확인 / 담당 |
| --- | --- |
| OpenAI 401/403 | 키 프로젝트·endpoint 권한·모델 접근/계정 확인 요구. 사용자/S2 |
| OpenAI 429 | 오류 code로 결제·사용 한도·요청 빈도 구분. 원인 해결 후 사용자가 새 요청, 자동 재시도 추가 안 함 |
| 두 번째 노트북에서 마이크가 없음 | HTTPS·인증서 신뢰·실제 접속 origin·OS/브라우저 권한. S3/S5 |
| API는 되는데 WS가 거절됨 | 동일 origin proxy·쿠키 Secure·Host/Origin·upgrade. S1/S3 |
| DB 연결 거절 / 비밀번호 오류 | daemon·port·compose 상태·기존 volume에 설정된 계정. S1/S5. 비밀번호 변경을 이유로 volume을 삭제하지 않음 |
| 이미지가 생성됐는데 보이지 않음 | MediaStore 쓰기/읽기·권한·mediaId 경로. AWS는 S3 role/서명 URL. S1/S2 |
| 이미지/텍스트 모델이 사용 불가 | 해당 경로 smoke 결과를 근거로 권한 해결 또는 OpenAI 내 모델 대체 검증. S2/S0 |

실제 입력이 더 필요할 때는 키 값 대신 ‘서버 환경파일 입력 완료’, 사용할 AWS profile/account, 두 기기 검증 가능 여부만 인계한다.
