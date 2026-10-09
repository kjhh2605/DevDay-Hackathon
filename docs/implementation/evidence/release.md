# G4 AWS 릴리스 실행 기록

- 실행일: 2026-10-09 (Asia/Seoul)
- 상태: **AWS 배포·자동 검증 완료. AWS URL의 G4 두 실기기·실마이크 인수 결과는 미확인.**
- 서비스: **https://d31qyxseqz8321.cloudfront.net**
- [현재 인프라 다이어그램](../../architecture/aws-deployed-architecture.md): 요청 경로·네트워크·배포 흐름·실제 리소스.
- 대상: `default`, AWS `004376454721`, `ap-northeast-2` (사용자 지정).
- API 배포 기준: `35290d32715d4c2852c0c3f62aa12b1c3d726a79` + 검증 시점의 G4 배포 변경. 최초 검증 지문은 [이전 기록](reports/g3-before-web-redeployment.json)에 보존했다. 웹은 아래 [재배포 기록](#웹-재배포와-테스트-계정-2026-10-09)의 랜딩·힌트 변경을 추가로 반영했다.
- 모델: text/Decisions `gpt-6-luna`, live `gpt-live-transcribe`, correction `gpt-transcribe`, image `gpt-image-2.5-flare-2026-09-08`.
- Decisions 설정: speech 2000ms, chat 10000ms, confidence 0.85.
- G3: 사용자 확인과 이번 세션의 자동 검사. [근거](local-validation.md#g4-진입-확인-2026-10-09).

## 배포 전 확인

- 기존 bootstrap version 32, CloudFront prefix list `pl-22a6434b`, Fargate quota 30 vCPU, 기존 ECS cluster 없음.
- SG ingress quota 60, CloudFront prefix list weight 55를 수용한다.
- PostgreSQL `17.11` / `db.t4g.micro` / gp3 20GiB를 서울 계정에서 조회 확인.
- 타입 검사·단위 306·계약 39·통합 17·E2E 4·build·synth·image build·image restart persistence 통과.
- AZ 설정 수정 후 인프라 타입 검사·테스트 15개·synth를 재통과했다. 아래 AWS 자동 검증은 실제 배포 origin에 수행했다.

## AWS 실행 결과

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| Foundation / API / Edge | 세 스택 배포 완료. RDS 17.11, 앱 desired/running 1, ALB target healthy, CloudFront 서비스 응답 확인 | [실제 구성](../../architecture/aws-deployed-architecture.md#실제-배포-리소스) |
| Migration | 동일 API image의 일회성 task `777282f35c3f4cdfb13e1a08ada9e44a`, exit 0 | [task 조회](reports/aws-runtime-initial.json) |
| HTTPS·쿠키·캐시 | index 200/no-cache, 해시 JS immutable, 미인증 API JSON 401/no-store, Secure·HttpOnly·SameSite=Lax 세션 | [배포 검증](reports/aws-verification.json), [검증 코드](../../../scripts/deploy/verify.ts) |
| 두 사용자·WebSocket | 사용자별 세션 분리, 초대·입장·snapshot, `/ws/events`·`/ws/audio` upgrade | [배포 검증](reports/aws-verification.json) |
| 실제 OpenAI·RDS·S3 | 경험 저장, 이미지 주제, 챗봇·표현 저장, 개인 기록 분리, 스터디 종료, presigned 이미지 bytes | [배포 검증](reports/aws-verification.json) |
| ECS 교체·영속성 | task 교체 후 같은 세션·경험·학습 기록·종료된 스터디·동일 이미지 SHA 재조회 | [교체 요청](reports/aws-restart-start.json), [새 task](reports/aws-runtime-final.json), [재조회](reports/aws-restart.json) |
| 실제 배포 브라우저 | 등록·경험·학습 화면 확인, page error 0 | [결과](reports/aws-browser.json), [등록](screenshots/aws-register.png), [경험](screenshots/aws-experiences.png), [학습](screenshots/aws-learning.png) |
| 두 물리 노트북·실마이크 | **AWS URL에서는 결과 미확인**. 자동 소켓 연결 검사가 실제 음성 인수를 대신하지 않음 | 사용자에게 결과 요청, 아직 응답 없음 |

자동 서비스 검증: `2026-10-09T07:17:18.749Z`–`07:17:47.379Z`. 재시작 후 재조회: `07:22:05.605Z`–`07:22:06.499Z`. 브라우저 확인: `07:22:10.060Z`.

- 검증 스터디: `3f5373aa-86e9-416b-9ae9-78484aa714a7` (종료 완료).
- 생성 이미지: 1,794,370 bytes, SHA-256 `22fda0cb619b6fd54451bc214d7afc5d34b4114922cf833cfc7a86a6a87c5a45`.
- 최초 앱 task `1530b3c7ea3f4f76acc53eb01169e197` → 교체 task `bc860da64f5f4b2da55915ea97e9bf28`, `RUNNING` / `HEALTHY`, 동일 image digest.
- 검증 세션 쿠키는 git 제외된 `.local/deploy/` 파일에만 보관한다. 보고서에는 쿠키·비밀값을 넣지 않았다.

G4 완료를 위해 배포 URL에서 두 노트북으로 실제 발화·검토·다음 주제·종료·개인 기록을 확인해야 한다. 로컬 G3의 사용자 확인과 AWS G4 인수를 구분하며 T14/G4 전체를 완료로 표시하지 않는다.

## 비용 예상

2026-10-09 AWS Pricing API의 서울 On-Demand 단가, 730시간 가정, 세금·크레딧 제외.

| 항목 | 계산 | 월 USD |
| --- | --- | --- |
| Fargate 0.5 vCPU / 1GiB | (0.5 × 0.04656 + 0.00511) × 730 | 20.72 |
| RDS db.t4g.micro | 0.025 × 730 | 18.25 |
| RDS gp3 20GiB | 20 × 0.131 | 2.62 |
| ALB 기본 | 0.0225 × 730 | 16.43 |
| 앱 public IPv4 한 개 | 0.005 × 730 | 3.65 |
| 주요 고정 비용 합 | 반올림 전 계산 | 61.67 |

추가 ALB LCU는 0.008 USD/LCU-hour이다. S3 저장·요청, CloudFront 전송·요청, CloudWatch, ECR, Secrets Manager, RDS 초과 CPU/백업, migration 실행시간 및 OpenAI는 사용량에 따라 별도 과금된다. 총 청구액이나 상한으로 해석하지 않는다. OpenAI 실제 토큰·오디오·이미지 사용량은 아직 측정하지 않았다.

출처: [Fargate](https://aws.amazon.com/fargate/pricing/), [RDS](https://aws.amazon.com/rds/postgresql/pricing/), [ALB](https://aws.amazon.com/elasticloadbalancing/pricing/), [IPv4](https://aws.amazon.com/vpc/pricing/). 리전별 수치는 AWS Pricing API `GetProducts`로 조회했다.

## 최초 배포에서 수정한 문제

첫 Foundation 생성은 `Fn::GetAZs` 결과가 한 개여서 두 번째 subnet의 `Fn::Select(1)`이 실패했다. 해당 함수는 기본 subnet이 있는 AZ만 반환할 수 있다. [AWS 계약](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-getavailabilityzones.html)에 맞춰 실제 조회한 서울 `ap-northeast-2a`·`ap-northeast-2c`를 사용하고, 배포 wrapper가 사용 가능 여부를 확인하도록 수정했다. 수정 후 인프라 타입·template 테스트 15개·synth를 다시 통과했다.

실패한 신규 스택만 제거했고 기존 HSU 스택은 변경하지 않았다. 첫 실패에 남은 버킷 두 개는 버전까지 비어 있음을 확인해 제거했으며 미사용 secret 두 개는 7일 복구 기간으로 삭제 예약했다. 상세 리소스와 실행 결과는 `reports/aws-foundation-first-failure.json`, `reports/aws-foundation-first-cleanup.json`에 있다.

발표 자료를 작성 중인 별도 작업과 충돌하지 않도록 `docs/presentation/`·`prompts/`는 배포 이미지 및 G3 소스 지문에서 제외한다. 그 파일들은 수정하지 않았다.

## 배포 실행

- Foundation 재배포: 완료(약 417초). RDS 17.11, VPC 2 AZ, private DB와 버킷·Secrets 생성.
- OpenAI secret: 로컬 검증에 사용한 키를 Secrets Manager에 저장. macOS에서 AWS CLI의 `/dev/stdin` 재열기가 거절되어 0700 임시 디렉터리/0600 입력 파일을 사용하고 `finally`에서 삭제하도록 수정했다. 키 값은 인수·로그·보고서에 기록하지 않았다.
- API image ECR 게시: `sha256:c5490ea9ed6e40c85b520eb3af95bc8a0f1d44018b14d966701da491351152e1`.
- API stage 완료: task definition `StudyApiStackTask96185A21:1`, 앱 desired count 0.
- AWS migration 완료: 동일 image·RDS TLS·Secrets·task network로 실행, exit code 0 확인 후 앱 시작.
- API 시작 완료: desired/running 1, pending 0, ECS steady state, ALB target healthy.
- Edge 완료: CloudFront `E1UWQHZZY8UP44`, VPC origin `vo_Cj60rIGbAcQGI1HVJF3gEZ`. Edge 배포에 약 762초 소요.
- 웹 완료: 고정한 소스로 빌드, asset 우선·index 마지막 업로드, SPA 경로 invalidation 완료.

## 배포 버전 고정

API staging 중 다른 세션에서 `apps/web/src/app/ServiceApp.tsx`, E2E 및 landing 자료를 변경했다. 그 변경을 되돌리거나 검증 완료로 간주하지 않았다. ECR에 게시한 CDK asset context로 `/Users/gnar/orca/projects/DevDay-Hackathon-g4-release` detached worktree를 구성했다. 복원 후 소스 SHA-256이 기존 검증값 `51709040ccfc119051381927ced0b145aa4c111cbb1f74769f05eefd6c228c2d`와 정확히 일치했고 `requireG3`를 통과했다. 이후 migration·웹 build·AWS 검증은 이 workspace에서 수행했다.

lockfile SHA-256: `23c68c2eeae53f9dc0f4fd19734af0fe884b34227b21a73f3102e6bd403283c6`. CDK image asset: `33cb78dfccf8128c636023f0682339a0e146e05753c410039191289cead20d09`. 최초 배포 시 랜딩은 제외됐으며, 이후 웹만 재검증·재배포한 이력은 아래에 기록한다.


## 웹 재배포와 테스트 계정 (2026-10-09)

- 요청: 로컬 변경분 반영, 테스트 계정과 임의 경험 10개 생성, 스터디 생성 입력란에 테스트 아이디 힌트 추가.
- 소스: `8b755ac5b629232c568ccb8b9a1fb70c226239e3` + `StudyPage.tsx`의 한 줄 안내 변경. 랜딩·영상 commit `8343973`을 포함한다.
- 소스 SHA-256: `422738ea069d77423147ee3d799c4913d6a3b8f0a0c27ced2f7ed436fcce58c9`.
- 변경 안내: “여러 명은 쉼표로 구분해 주세요. 초대할 친구가 없다면 malmoa-demo를 입력해 보세요.” 입력값 자동 설정·초대 자동 수락·스터디 상태 변경 기능은 추가하지 않았다.
- 범위: `apps/api/src`와 `packages`는 실제 API 배포 worktree와 동일함을 파일 비교로 확인했다. API image, ECS task, DB schema, 네트워크 구성은 유지하고 S3의 웹 build만 갱신했다.
- 사전 검사: 전체 TypeScript 검사, 웹 production build, 기존 서비스 4개 + 랜딩 6개 E2E 총 10개(1.1분), offline CDK synth 통과. 과거 G3의 실기기 검사는 새로 수행한 것으로 기록하지 않았다.
- 게시: AWS MCP의 계정·stack output 조회로 `004376454721`과 대상 Web bucket을 확인한 뒤 presigned S3 PUT으로 23개 파일을 업로드했다. 해시 assets 우선, `index.html` 마지막. 기존 assets 유지. 배포 입력 목록·SHA·cache metadata는 [업로드 증거](reports/aws-web-redeployment.json)에 있다.
- CloudFront invalidation: `I58CWZW68FGKS9AK4T4JAX62LD`, SPA 경로와 `/media/landing/*`, 완료 상태 확인.
- 테스트 계정: **`malmoa-demo` / 말모아 체험 친구**, user ID `2af35067-d50b-4ae8-b47a-fd239fc5e46e`. 여행·커피·운동·캠핑·요리·봉사·독서·전시·자전거·영어 발표에 대한 가상 경험 10개를 실제 API로 저장하고 재조회했다. [계정·경험 증거](reports/aws-demo-account.json)
- 경험 준비 중 한 샘플이 `AI_FAILED`로 두 번 실패했다. 다른 가상 경험으로 교체한 뒤 저장을 완료했으며 실패 이력도 증거에 보존했다.
- 테스트 계정의 쿠키는 git 제외된 `.local/deploy/004376454721-ap-northeast-2/demo-account-session.json`에 0600 권한으로 보관한다. 현재 제품은 가입 세션 방식이며 아이디만으로 기존 계정에 로그인하는 기능은 없다. 이 계정도 일반 초대 수락 흐름을 사용한다.
- 실제 배포 검증: [브라우저·파일 확인 결과](reports/aws-web-redeployment-browser.json). 최종 결과는 검증 실행 후 이 보고서에 기록한다.
