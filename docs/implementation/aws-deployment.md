# AWS 배포 실행서

대상: 후속 S5 배포 세션. **이번 문서 작성 작업에서는 아래 명령이나 AWS 변경을 실행하지 않았다.** 실제 제품 코드와 검증 결과가 준비된 후 사용한다.

**첫 AWS 리소스 생성·배포는 G3 로컬 전체 검증 통과 후에 시작한다.** `docs/implementation/evidence/local-validation.md`의 검증 대상과 결과를 확인한다. 그 전에는 Docker 빌드·CDK 코드 작성·리소스를 만들지 않는 synth까지 준비한다. G1의 음성/연결 검증을 위해 조기 배포하지 않는다. [로컬 실행서](local-validation.md)

## 1. 선택한 리소스

| 리소스 | 초기 설정 | 역할 |
| --- | --- | --- |
| 리전 | ap-northeast-2 | 앱·DB·S3·Secrets |
| VPC | 2 AZ, 각 public/private isolated subnet, IGW, NAT 0 | ALB/RDS의 두 AZ subnet 요구 충족 |
| S3 Web | private, Block Public Access, CloudFront OAC | Vite build 결과 |
| S3 Media | private, 앱 task role로 읽기/쓰기 | 생성 이미지와 발화 WAV |
| CloudFront | 기본 AWS 도메인, HTTPS, 웹 S3 + ALB VPC origin | 동일 origin FE/API/WS |
| ALB | internal, private subnet, HTTP 80 → target 3000 | CloudFront의 private origin |
| ECS/Fargate | Linux x86_64, 앱 1 task, 0.5 vCPU/1GiB 시작 | Fastify·AI job 실행·음성 릴레이 |
| RDS PostgreSQL | 17의 배포 시 지원 minor, Single-AZ, db.t4g.micro 시작, gp3 20GiB | 학습 데이터 영속 저장 |
| ECR | CDK Docker image asset 저장소 | 고정 image digest 배포 |
| Secrets Manager | OpenAI key, RDS 생성 자격증명 | 프론트에 비밀 노출 방지 |
| CloudWatch Logs | 서버 표준 로그 | request/job/command ID와 실패 이유 확인 |

사양은 부하 검증 전의 시작값이다. S5가 계정에서 RDS 엔진·인스턴스 조합의 주문 가능 여부와 Fargate quota를 확인한다. Single-AZ여도 RDS subnet group에는 두 AZ의 subnet이 필요하다. [RDS 네트워크](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)

별도 Route 53·ACM 사용자 도메인·NAT Gateway·Redis·SQS·Step Functions·EKS는 만들지 않는다. 브라우저에서 CloudFront까지 HTTPS/WSS, CloudFront에서 ALB까지 VPC origin의 private 경로, 서버에서 OpenAI까지 HTTPS/WSS를 사용한다.

## 2. CloudFront·네트워크 계약

| Behavior | Origin | Cache / 전달 |
| --- | --- | --- |
| default `*` | S3 Web REST origin + OAC | hashed assets 캐시, SPA 진입 경로만 index.html로 rewrite |
| `/api/*` | 내부 ALB VPC origin | CachingDisabled, 필요한 모든 method, 쿠키·Origin·query 전달 |
| `/ws/*` | 내부 ALB VPC origin | CachingDisabled, AllViewer origin request policy, WebSocket handshake 전달 |

API와 WS 경로를 제거하거나 덧붙이지 않는다. 백엔드는 `/api/v1/...`, `/ws/events`, `/ws/audio`를 그대로 받는다. SPA rewrite는 default behavior에만 적용한다. API 오류를 index.html 200 응답으로 바꾸는 전역 403/404 fallback을 만들지 않는다.

쿠키나 개인 응답은 CDN 캐시에 넣지 않는다. 웹 bucket에는 쿠키를 전달하지 않는다. `/api/v1/media/:id`의 이미지 redirect 응답도 no-store이며 서버의 membership 검사 후 S3 서명 URL을 발급한다.

VPC origin은 IGW와 private subnet의 빈 IPv4 주소가 필요하다. 내부 ALB 보안 그룹에 CloudFront managed prefix list에서 80번 ingress를 허용한다. AWS가 만드는 `CloudFront-VPCOrigins-Service-SG` 이름을 직접 만들지 않는다. prefix list가 차지하는 SG quota도 확인한다. CDK의 `VpcOrigin.withApplicationLoadBalancer`를 사용하고 ALB listener 생성 의존성을 명시한다. [VPC origin 요구](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html), [CDK VpcOrigin](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins.VpcOrigin.html)

Fargate는 public subnet에 `assignPublicIp=true`, IGW default route를 사용해 OpenAI·ECR·Secrets·S3에 접근한다. public IP가 있어도 앱의 inbound는 ALB SG의 3000번만 허용한다. RDS는 public access=false, 5432번을 앱/동일 migration task SG에서만 받는다. private subnet에 NAT 없이 앱을 두고 OpenAI 연결이 되기를 기대하지 않는다.

ALB target type은 `ip`, health check는 `/healthz`, idle timeout은 120초로 시작한다. 앱은 20초마다 WS heartbeat를 보낸다. Fargate 앱은 `0.0.0.0:3000`으로 바인딩한다. 배포 origin에서 API CORS는 필요 없으며 WS의 Origin을 검증한다. CloudFront가 전달한 Host와 Origin의 동일 origin 여부를 확인하면 Edge URL을 API stack에 역참조하지 않아도 된다. 로컬 개발은 Vite의 HTTP/WS proxy를 사용한다.

## 3. 단일 프로세스 제약

앱 task의 desiredCount는 1, 자동 확장은 끈다. 서비스 배포 설정은 minimumHealthyPercent=0, maximumPercent=100으로 고정해 두 앱 프로세스가 동시에 연결을 나눠 받지 않게 한다. PM2 cluster나 Node worker로 앱 프로세스를 늘리지 않는다.

배포는 진행 중 스터디가 없을 때 한다. 잠깐의 서비스 중단과 기존 WS 종료를 허용한다. 무중단 배포·Redis 연결 공유·중단된 스터디 복구는 범위 밖이다. migration 전용 일회성 task는 HTTP/WS 서버를 띄우지 않으므로 앱 프로세스 중복에 해당하지 않는다.

OpenAI 작업은 요청을 받은 앱에서 실행하되 DB의 Job 상태를 갱신한다. 재시작 시 이전 running job은 실패로 표시한다. AWS에서는 컨테이너 내부 파일에 영구 기록을 보관하지 않는다. RDS/S3는 앱 배포와 분리해 유지한다. 로컬 검증의 파일 adapter는 호스트의 영속 경로를 사용한다.

## 4. 코드·환경 준비

S5는 CDK stack을 다음처럼 나눈다.

1. `StudyFoundationStack`: VPC, subnet/SG 기본, RDS, S3 두 개, Secrets. 데이터 리소스는 RETAIN. 별도 백업·복구 정책 작업은 만들지 않는다.
2. `StudyApiStack`: ECS cluster/service/task, Docker image asset, IAM roles, 내부 ALB/listener/target group, Logs. foundation 출력 참조.
3. `StudyEdgeStack`: S3 OAC와 CloudFront, API stack의 ALB VPC origin, behavior와 SPA rewrite.

역방향 참조를 만들지 않는다. Edge 도메인을 API env에 넣어 순환시키지 않고 동일 origin 검사를 사용한다. 변경 전에 `cdk diff`로 RDS·bucket 교체 여부를 확인한다.

변수의 단일 기준과 profile 로딩은 [환경변수 계약](prerequisites.md)을 따른다. [배포 CLI 예제](env/deploy.env.example)는 `.env.deploy.local`용이며 ECS task 환경파일이 아니다. API/migration에는 아래 런타임 값만 CDK와 secret으로 주입한다.

| 변수 | 출처 / 소비 |
| --- | --- |
| `NODE_ENV=production`, `APP_ENV=aws`, `API_HOST=0.0.0.0`, `PORT=3000`, `AWS_REGION` | CDK → API |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | RDS 출력 → API/migration |
| `DB_USER`, `DB_PASSWORD` | RDS secret의 JSON 필드 → API/migration |
| `DB_SSL_MODE=verify-full`, `DB_SSL_CA_PATH` | RDS CA bundle을 image에 포함하고 경로 지정 → API/migration |
| `MEDIA_DRIVER=s3`, `MEDIA_BUCKET` | S3 출력 → API. AWS에서 filesystem은 기동 실패 |
| `OPENAI_API_KEY` | Secrets Manager → API |
| `OPENAI_TEXT_MODEL` | `gpt-6-luna` |
| `OPENAI_LIVE_TRANSCRIBE_MODEL` | `gpt-live-transcribe` |
| `OPENAI_CORRECTION_MODEL` | `gpt-transcribe` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare-2026-09-08` |
| `AI_MODE=live` | 배포는 live 강제. mock이면 기동 실패 |
| `SESSION_COOKIE_SECURE=true` | CloudFront HTTPS 세션 쿠키. AWS에서 false는 기동 실패 |
| `VITE_API_BASE=/api/v1` | FE의 공개 경로. 비밀 키 없음 |

FE WS URL은 현재 location의 host와 protocol로 `/ws/events`, `/ws/audio`를 만든다. 번들에 AWS 자격증명, DB 비밀, OpenAI 키를 넣지 않는다. OpenAI/DB 원문 비밀을 로그에 출력하지 않는다. `APP_ENV=local`에서 쓰던 파일 adapter·LAN origin·인증서 설정을 AWS에 전달하지 않는다.

Docker image는 Node 24와 잠긴 pnpm 버전으로 build하고 linux/amd64를 명시한다. macOS ARM에서 만든 호스트 바이너리를 그대로 복사하지 않는다. RDS 연결에는 TLS를 사용하고 PostgreSQL 드라이버가 RDS CA·호스트 이름을 검증하도록 이미지/설정에 CA를 준비한다. `.dockerignore`에 `.env`·`.env.local`·`.env.deploy.local`, git, `.local/`, 로컬 인증서·개인키·녹음·증거 파일을 제외한다.

task execution role은 ECR pull, 로그 기록, 지정 secret 읽기를 가진다. task role은 Media bucket의 필요한 object 읽기/쓰기만 가진다. 로컬 AWS 키를 컨테이너 환경변수로 넣지 않는다.

## 5. 배포 전 확인

첫 항목은 배포 시작 조건이고, 나머지는 실제 배포 세션에서 확인할 입력이다. 현재 계정 접근 여부는 확인하지 않았다.

- G3 로컬 통과 기록: A01~A27/E01~E08, 자동 검사, 두 물리 노트북·실마이크·실제 OpenAI, build/image·저장 재조회. 필수 실패/미실행이 없어야 한다.
- 사용할 AWS profile/account와 서울 리전, CDK bootstrap 권한.
- OpenAI 프로젝트 키 및 네 모델의 실제 호출 권한. 이미지 모델의 조직 확인 요구가 있으면 해당 계정에서 해결.
- Docker 빌드 가능 환경, Node/pnpm, AWS CLI, CDK 의존성.
- 로컬에서 검증한 commit과 일치하는 배포 코드·lockfile·모델 설정. 이후 변경이 있으면 영향받는 로컬 검사를 다시 통과한 기록.
- 비용 예상: 선택 리전의 Fargate·ALB·RDS·IPv4·S3/CloudFront와 OpenAI 실제 요금으로 산출. 예상치를 검증 결과에 남긴다.

후속 사용자가 구현·배포를 지시한 세션에서 이 실행서를 사용한다. 이번 문서 작성 요청 자체는 유료 리소스 생성 승인으로 해석하지 않는다.

## 6. 실행 순서와 예정 명령

아래 pnpm script들은 S0/S5가 구현해야 할 인터페이스다. 현재 실행 가능한 명령이 있다고 가정하지 않는다. S5 wrapper는 root `.env.deploy.local`의 profile/account/region을 읽어 AWS CLI/CDK에 명시적으로 전달한다. `infra:synth`는 파일·자격증명 없이도 리소스 생성과 계정 lookup 없이 실행 가능해야 한다. `infra:diff`는 G3 이후 실행하며 첫 계정에서는 필요한 bootstrap을 먼저 완료한다.

```sh
pnpm preflight --target=aws
pnpm infra:synth
# 아래 실행 순서 2의 bootstrap 준비 후
pnpm infra:diff
```

1. G3 로컬 검증 기록과 대상 commit을 확인한다. 필요한 검증이 없으면 [로컬 실행서](local-validation.md)로 돌아가 완료하며 bootstrap/deploy는 실행하지 않는다. 유효한 기록이 있으면 동일 코드를 이유 없이 전부 재시험하지 않고 계정·diff·배포 설정을 확인한다.
2. 기존 bootstrap 상태를 확인하고 필요한 경우 지정 계정·리전에 bootstrap을 수행한다. profile/account/region을 문서에 남기되 자격증명 값은 남기지 않는다. 이후 `infra:diff`로 계획을 확인한다.
3. `StudyFoundationStack` 배포. OpenAI secret에 실제 키를 Secrets Manager 콘솔 또는 표준 입력 기반 스크립트로 넣는다. 명령행 인수/히스토리에 키를 넣지 않는다.
4. `StudyApiStack`을 초기 app desiredCount=0으로 배포. CDK가 Docker image asset을 ECR에 게시한다. 별도의 수동 latest push 흐름을 섞지 않는다.
5. `pnpm db:migrate:aws` 실행. 같은 image/task 환경으로 ECS 일회성 task를 띄우고 command를 migration 전용 entrypoint로 override한다. public subnet/public IP/task SG와 secrets를 동일하게 사용한다. exitCode=0을 기다리고 실패 시 앱을 열지 않는다. 로컬에서 private RDS에 직접 접속하려 하지 않는다.
6. `StudyApiStack`을 desiredCount=1로 갱신. `/healthz`와 target healthy를 확인한다. `/healthz`는 process liveness, `/readyz`는 DB/migration readiness를 확인하게 하고 traffic 허용 시 readiness도 확인한다. health check에서 OpenAI 유료 호출을 하지 않는다.
7. `StudyEdgeStack` 배포. VPC origin Deployed 및 distribution 배포 완료를 확인한다. CloudFront 기본 HTTPS URL을 기록한다.
8. `pnpm deploy:web`로 Vite dist의 hashed assets를 먼저 올리고 index.html을 마지막에 올린다. index.html은 no-cache, hashed assets는 long cache. index.html 관련 경로만 invalidation한다. S3 website hosting은 켜지 않는다.
9. HTTPS `/api/v1/me`가 미가입 상태에서 JSON 401을 반환하는지, `/ws/events`가 가입 후 101 upgrade되는지 확인한다. API 실패 응답이 HTML이면 behavior/rewrite 오류다.
10. 로컬에서 확인할 수 없었던 IAM/Secrets, RDS TLS/migration, S3 쓰기·서명 URL, CloudFront/ALB의 WSS·쿠키·캐시를 검증한다. [G4 인수](acceptance.md)를 AWS URL에서 두 노트북으로 실행하고 증거를 남긴다. 로컬 통과 기록과 AWS 통과 기록을 구분한다.

S5는 각 stack의 CloudFormation output으로 app URL, bucket 이름, ECS cluster/service/task ARN, RDS secret ARN, distribution ID를 내보낸다. 배포 스크립트는 이 output을 읽고 수작업 복사·하드코딩을 줄인다.

## 7. 수정 배포와 실패 처리

FE만 바뀌고 계약이 같으면 로컬 UI·변경 영향 검증 → build → 웹 S3 업로드 → index invalidation → 배포 화면 확인 순서다. API 이미지나 DB를 다시 배포할 필요가 없다. 이는 잦은 UI/UX 수정의 기본 경로다.

API 변경은 로컬 DB 통합·관련 기능 검증과 image build를 먼저 통과시킨다. 그 후 진행 중 스터디가 없는 상태에서 diff → 필요한 migration → 단일 태스크 교체 → 배포 확인 순으로 수행한다. 하위 호환 schema 변경을 우선한다. 이전 버전으로 돌릴 경우 이전 image digest와 해당 FE build를 사용한다. DB를 자동 역마이그레이션하거나 삭제하지 않는다. schema가 이미 달라졌으면 호환 수정 배포를 선택한다.

문제가 발생하면 실패한 단계와 requestId/jobId, CloudWatch 로그를 확인한다. task가 뜨지 않으면 image architecture, secret 읽기, ECR/인터넷 경로를 확인한다. WS가 실패하면 `/ws/*` behavior와 AllViewer/CachingDisabled, ALB target/timeout, Origin 검사 순으로 확인한다. 첫 페이지가 열리는 것만으로 배포 완료로 처리하지 않는다.

실제 키·개인 경험·전사 전체를 검증 보고서에 복사하지 않는다. 이 문서는 자동 리소스 삭제 절차를 포함하지 않는다. 비용 정리가 필요할 때 데이터 보존 의도를 확인한 뒤 별도 작업으로 수행한다.
