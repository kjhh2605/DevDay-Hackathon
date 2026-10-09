# 로컬 구현·검증 실행서

**구현 → 로컬 전체 검증(G3) → AWS 배포 → 배포 환경 검증(G4)** 순서로 진행한다. G0~G3에서는 AWS 리소스를 만들거나 배포하지 않는다. CDK 코드 작성·synth와 Docker 빌드는 병렬로 준비한다. 이 문서는 실행 기준이며, 명령별 실제 실행 결과와 G3 판정은 [로컬 검증 기록](evidence/local-validation.md)에서 확인한다.

로컬 검증에서도 실제 마이크와 실제 OpenAI를 사용한다. 앱·DB·파일 저장소를 로컬에서 실행한다는 의미이며, 인터넷 없이 동작하는 모드를 만드는 것은 아니다. 기능 범위는 [PRD](../prd.md), 단계별 기준은 [작업 계획](work-plan.md), 검사 항목은 [인수 기준](acceptance.md)을 따른다.

## 1. 로컬 구성과 AWS에서 바뀌는 부분

| 구성 | 로컬 G0~G3 | AWS G4 |
| --- | --- | --- |
| React 앱 | Vite dev, 최종 확인은 build 결과의 preview | S3 Web + CloudFront |
| HTTP / WS | Vite의 동일 origin proxy → Fastify 1개 | CloudFront → 내부 ALB → 같은 Fastify 컨테이너 1개 |
| DB | Docker PostgreSQL 17 + 영속 volume | RDS PostgreSQL 17 |
| 이미지·WAV | `LocalFilesystemMediaStore`, `.local/media`에 실제 bytes 저장 | `S3MediaStore`, private S3 |
| AI | 서버의 실제 OpenAI 호출, `AI_MODE=live` | 같은 provider·모델 설정 |
| 비밀 | git에서 제외한 서버용 `.env.local` | Secrets Manager |

도메인 로직·DB schema/migration·DTO·명령·이벤트·프롬프트는 공통으로 사용한다. SQLite나 메모리 DB로 통합 검증하지 않는다. 로컬 파일 저장도 실제 저장·읽기를 수행하며 더미 이미지 URL로 대체하지 않는다. LocalStack 같은 AWS 에뮬레이터는 필수 의존성에 넣지 않는다.

S1은 `MediaStore.put/resolveImage` 포트의 두 adapter를 구현한다. FE는 환경과 관계없이 `/api/v1/media/:id`를 사용한다. 참여자 검사 후 로컬에서는 이미지 bytes를 응답하고 AWS에서는 S3 서명 URL로 redirect한다. 두 경우 모두 인증 검사와 `Cache-Control: no-store`를 유지한다. raw WAV의 공개 다운로드 API는 만들지 않는다.

## 2. 환경과 실행 명령

전체 변수 이름·기본값·조건은 [준비 사항과 환경변수](prerequisites.md)를 기준으로 한다. S0는 이 계약을 실제 `.env.example`에 반영하고, S1/S3/S5가 소유 코드에서 구현한다. 아래는 로컬 실행에 쓰는 요약이다. 현재 저장소에 실행 가능한 script가 이미 있다고 가정하지 않는다.

| 변수 | 로컬 설정 |
| --- | --- |
| `APP_ENV=local` | 로컬 인프라 선택. AWS는 `APP_ENV=aws` |
| `API_HOST`, `PORT`, `WEB_PORT` | 호스트 API는 127.0.0.1:3000, 웹은 5173. dev/preview port 고정 |
| `AI_MODE=live`, `OPENAI_API_KEY` | 실제 기능 검증. 키는 서버 프로세스에만 전달 |
| `OPENAI_*_MODEL` | [모델 선정값](../architecture/mvp-architecture.md)과 동일 |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | 로컬 PostgreSQL 접속값. 컨테이너 안에서는 compose 서비스명 사용 |
| `DB_SSL_MODE=disable`, `DB_SSL_CA_PATH` | 로컬 DB는 TLS 미사용. AWS는 verify-full과 RDS CA 경로 |
| `COMPOSE_PROJECT_NAME` | 기본 devday-study-local. 다른 환경은 port/volume과 함께 분리 |
| `MEDIA_DRIVER=filesystem`, `MEDIA_LOCAL_DIR` | 호스트에서는 저장소의 `.local/media` 절대 경로, 컨테이너에서는 해당 bind mount 경로 |
| `LOCAL_WEB_ORIGIN` | 단일 기기는 `http://localhost:5173`, 두 기기는 호스트의 LAN HTTPS URL |
| `LOCAL_TLS_CERT`, `LOCAL_TLS_KEY` | LAN 검증용 인증서 경로. 서버 설정만 읽음 |
| `SESSION_COOKIE_SECURE` | localhost HTTP는 false, LAN HTTPS와 AWS는 true |
| `VITE_API_BASE=/api/v1` | 공개 경로만 주입. API 주소와 WS host를 기기별로 하드코딩하지 않음 |

`NODE_ENV`는 빌드/런타임 최적화에 쓰고 인프라 선택과 분리한다. 따라서 production image도 `APP_ENV=local`로 검증할 수 있다. `APP_ENV=aws`에서는 `MEDIA_DRIVER=s3`, `AI_MODE=live`, Secure 쿠키를 강제하며 로컬 adapter로 조용히 대체하지 않는다. `filesystem` 선택 시 AWS 자격증명·bucket·Secrets Manager 조회가 기동 조건이 되어서는 안 된다.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
# 생성된 .env.local에 사용자가 OPENAI_API_KEY를 입력
pnpm dev:services
pnpm db:migrate:local
pnpm preflight --target=local
pnpm dev
```

`setup:local`은 기존 환경파일을 보존하며 로컬 DB 비밀번호와 미디어 경로를 처음에만 준비한다. `dev:services`는 로컬 PostgreSQL을 영속 volume으로 실행한다. `dev`는 API와 Vite를 시작한다. API/migration은 root `.env.local`을 읽고 compose wrapper는 DB 설정만 컨테이너에 매핑한다. Vite에는 공개 값과 로컬 port/origin/TLS 경로만 전달한다. DB는 호스트 loopback에만 노출한다. `.local/`, `.env.local`, `.env.deploy.local`, 인증서·개인키·녹음은 git 및 Docker build context에서 제외한다. 재기동 검증에서 volume을 삭제하는 reset 명령을 사용하지 않는다.

개별 UI 구현은 MSW/fixture로 시작할 수 있다. 실제 연결로 전환할 때 adapter 한 곳에서 mock을 끄고, 로컬 통합 및 인수 기록에 `AI_MODE=live`와 실제 API/DB 사용 여부를 남긴다.

## 3. 배포 없이 두 노트북과 마이크 검증하기

초기 자동 검사는 같은 컴퓨터의 독립된 A/B 브라우저 context로 수행한다. G3에서는 두 물리 노트북이 같은 LAN의 한 개발 서버에 접속한다. 노트북마다 별도 API·DB를 띄워 서로 다른 스터디를 검사하지 않는다.

마이크의 `getUserMedia()`는 보안 컨텍스트가 필요하다. 같은 컴퓨터의 localhost는 개발에 사용할 수 있지만, 다른 노트북에서 접속하는 일반 LAN IP의 HTTP 페이지는 이 예외에 해당하지 않는다. 따라서 두 기기 검증에는 신뢰된 로컬 HTTPS를 준비한다. [MDN 마이크 접근 조건](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

1. 개발 호스트에 mkcert를 설치하고 로컬 CA를 신뢰하도록 설정한다. 호스트의 LAN IP를 인증서 대상에 포함해 인증서를 발급한다. IP가 바뀌면 다시 발급한다.
2. 테스트할 두 번째 노트북에도 **공개 CA 인증서 `rootCA.pem`만** 설치해 브라우저가 신뢰하도록 한다. CA 개인키 `rootCA-key.pem`과 서버 개인키는 전달하지 않는다. mkcert는 개발 기기에만 사용한다. [mkcert 공식 사용법](https://github.com/FiloSottile/mkcert)
3. S5가 인증서·로컬 실행 절차를 준비하고 S3가 Vite 설정을 적용한다. `dev:lan`은 인증서를 읽어 HTTPS로 기동하고 LAN 접근을 허용한다. `/api`와 `/ws`를 API로 proxy하며 WS upgrade를 켜고 경로·Host·Origin을 유지한다. 명시한 테스트 origin만 API가 허용한다. [Vite 서버 설정](https://vite.dev/config/server-options)
4. 두 노트북 모두 같은 `https://<호스트 LAN IP>:5173`에 접속한다. 인증서 오류 없이 `window.isSecureContext=true`, 사용자별 세션 쿠키, `/ws/events`·`/ws/audio` 연결, 각 마이크 권한을 확인한다. 브라우저 보안 검사 해제 옵션을 통과 방법으로 쓰지 않는다.
5. G3 최종 확인에는 `pnpm build` 결과를 `pnpm preview:lan`으로 같은 HTTPS origin에서 제공한다. dev 서버를 먼저 종료하고 port를 고정한다. preview의 HTTPS·proxy도 명시하고, 같은 API production image를 로컬 DB·파일 저장소에 연결해 검사한다. Vite preview는 이 로컬 확인에만 사용한다. [Vite preview 설정](https://vite.dev/config/preview-options)

LAN 방화벽/무선 AP의 기기 간 접근이 막히면 해당 개발 네트워크를 해결한다. 로컬 마이크 연결 실패를 이유로 AWS 조기 배포로 순서를 바꾸지 않는다. 각 마이크에는 해당 참여자 음성만 들어온다는 PRD 전제는 유지한다.

## 4. 단계별 검증과 배포 시작 조건

| 단계 | 로컬에서 확인할 것 | 담당 |
| --- | --- | --- |
| G0 | 공통 계약, 앱 골격, 실행 명령과 환경 인터페이스 | S0 |
| G1 | 실제 OpenAI 네 경로, 마이크 PCM/전사·보정, 구간·마감, 두 사용자 이벤트, 로컬 HTTPS/WSS | S1/S2/S3/S5 |
| G2 | 경험 → 초대 → 이미지 주제 → 대화 → 검토·상대 문장 수정 → 승인·개인 저장 → 다음 주제를 실제 연결로 완주 | 전원 |
| G3 | A01~A27, E01~E08의 전체 로컬 인수, 두 물리 기기, build 결과·API image·저장 재조회 | S0/S5 통합, 전원 수정 |

자동 검사 명령은 다음과 같다. 각 명령의 범위와 실행 결과를 기록하며, 실제 OpenAI smoke는 모델·음성 경로 변경이 없다면 이미 확보한 G1 결과를 재사용한다. 수동 실제 대화 검증을 smoke나 브라우저 fake audio로 대신하지 않는다.

```sh
pnpm typecheck
pnpm contracts:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm infra:synth
```

S5는 linux/amd64 API image도 로컬에서 빌드·기동한다. S1의 동일 migration을 적용하고, 앱 재시작 후 DB 기록과 파일을 다시 읽는다. `infra:synth`는 AWS 리소스 생성 없이 템플릿을 만드는 준비 단계다. 계정 lookup 없이 synth 가능하게 작성하고, 계정별 설정 검증은 배포 단계에서 수행한다.

**배포 시작 조건은 G3 로컬 검증 통과 기록이다.** S0/S5는 `docs/implementation/evidence/local-validation.md`에 검증 대상 commit, lockfile·모델 설정, 자동 검사, A01~A27/E01~E08 결과, 두 기기 증거와 미해결 결함을 기록한다. 필수 항목이 실패/미실행이면 해당 구현을 고친 뒤 관련 검사를 다시 수행한다. 기록은 실행 결과이지 별도 사용자 승인 절차가 아니다. 현재 문서 작성 단계에서는 증거 파일에 가짜 통과 결과를 채우지 않는다.

## 5. AWS에 넘기는 범위

G3가 통과하면 검증한 코드와 빌드 설정으로 [AWS 실행서](aws-deployment.md)를 수행한다. 이후 G4에서 CloudFront/ALB의 쿠키·WSS·캐시, IAM/Secrets 주입, RDS TLS/migration, S3 쓰기·서명 URL, 태스크 교체 후 영속성을 확인하고 같은 인수 흐름을 AWS URL에서 다시 실행한다. A28은 이때 판정하며 로컬 기록에는 ‘AWS 배포 후 확인’으로 남긴다.

로컬 파일 adapter의 성공을 S3/IAM 검증 결과로 취급하지 않는다. 로컬 테스트 데이터를 RDS/S3로 이관하는 작업도 기본 범위에 넣지 않는다. AWS에서는 별도 테스트 사용자·경험으로 확인한다.

이후 수정도 **로컬에서 변경 영향 검증 → build → 수정 배포 → 배포 확인** 순서를 따른다. 이미 통과한 전체 검사를 이유 없이 반복하지는 않되, 계약·음성·상태 전이가 바뀌면 관련 통합/실기기 검사를 포함한다. UI 확인만을 목적으로 매번 AWS부터 갱신하는 흐름은 사용하지 않는다.

## 6. 구현된 실행 인터페이스

2026-10-09에 아래 실행 도구를 추가했다. 실제 통과/미실행 판정은 [실행 증거](evidence/local-validation.md)에 따르며, 명령 제공 자체가 G3 통과를 뜻하지 않는다.

```sh
# 기존 .env.local과 PostgreSQL volume을 보존한다.
pnpm setup:local
pnpm dev:services
pnpm db:migrate:local
pnpm preflight --target=local

# LAN IP는 개발 호스트의 현재 값을 쓴다.
brew install mkcert
mkcert -install
pnpm setup:cert --host=172.24.100.52
```

인증서 생성 도구는 `.env.local`을 덮어쓰지 않는다. 출력된 `LOCAL_TLS_CERT`/`LOCAL_TLS_KEY` 절대 경로, `LOCAL_WEB_ORIGIN=https://<현재 LAN IP>:5173`, `SESSION_COOKIE_SECURE=true`를 설정하고 `pnpm preflight --target=lan`을 실행한다. preflight는 인증서 유효기간·SAN·키 일치를 확인한다. 두 기기의 OS/브라우저 신뢰와 마이크 권한은 각각 직접 확인해야 한다. macOS에서 `mkcert -install`이 관리자 인증을 요청하면 사용자가 해당 터미널에서 완료한다.

```sh
# root Dockerfile은 Linux amd64, Node 24, 동일 lockfile/migration으로 만든다.
pnpm build:api-image
pnpm services:local migrate
pnpm services:local api
# API image가 실행된 상태에서 build 결과를 LAN HTTPS로 제공한다.
pnpm build
pnpm preview:lan
# 완료된 스터디의 데이터·이미지를 재조회한다. volume 삭제를 하지 않는다.
pnpm services:local restart-api
pnpm services:local status
```

호스트 `pnpm dev`의 API와 production image의 기본 port 3000을 동시에 점유하지 않게 한다. 별도 검증 port를 쓸 때는 명시적 `PORT`·`WEB_PORT`·`LOCAL_WEB_ORIGIN` 값을 API와 Vite 양쪽에 동일하게 전달한다. `pnpm services:local stop`은 서비스만 중지하며 DB volume과 미디어 디렉터리를 보존한다.

일반 Playwright 검사는 port 4101/5174의 실제 API·PostgreSQL과 명시적 `AI_MODE=mock`으로 독립 사용자 두 명을 생성한다. 실제 OpenAI 호출은 `pnpm smoke:openai`, 실마이크와 두 물리 기기 확인은 E01~E08로 별도 기록한다. CI도 같은 구분을 유지하며 AWS를 배포하지 않는다.
