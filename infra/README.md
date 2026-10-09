# AWS CDK 준비

현재 운영 구성은 [AWS 인프라 다이어그램](../docs/architecture/aws-deployed-architecture.md), 실제 배포·검증 상태는 [G4 릴리스 기록](../docs/implementation/evidence/release.md)에 있다.

G3 이전에는 코드 검증과 synth만 실행한다. bootstrap, 배포, ECR 게시, 웹 업로드는 G3 실제 검증 기록 통과 후 [AWS 실행서](../docs/implementation/aws-deployment.md)를 따른다.

```sh
pnpm --filter @devday/infra typecheck
pnpm --filter @devday/infra test
pnpm infra:synth
```

`infra:synth`는 `.env.local`과 `.env.deploy.local`을 읽지 않으며 AWS account lookup을 하지 않는다. AWS 자격증명과 Docker daemon이 없어도 CloudFormation 및 image asset 명세를 생성한다. `infra/cdk.out/`의 Docker asset은 빌드나 ECR 게시 결과가 아니다. 실제 image 빌드 검증은 별도 로컬 검사다.

| Stack                | 소유 리소스                                                                                             | 후속 배포 입력                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| StudyFoundationStack | 2 AZ VPC, NAT 0, public/isolated subnet, ALB/task/DB SG, PostgreSQL 17, Web/Media S3, DB/OpenAI secrets | `CloudFrontPrefixListId`, 필요 시 `PostgresVersion` minor              |
| StudyApiStack        | 내부 ALB, ECS cluster, Linux AMD64 Fargate 0.5 vCPU/1GiB, 앱 1개, image asset, IAM, Logs                | 최초 migration 전 `AppDesiredCount=0`, 이후 `1`; 검증한 모델 parameter |
| StudyEdgeStack       | CloudFront VPC origin, 웹 OAC와 bucket policy, default 전용 SPA rewrite, API/WS behavior                | 없음                                                                   |

`CloudFrontPrefixListId`는 `com.amazonaws.global.cloudfront.origin-facing`의 서울 리전 managed prefix list ID다. G3 이후 계정에서 확인해 CloudFormation parameter로 전달한다. synth용 가짜 ID나 account lookup을 사용하지 않는다. `PostgresVersion` 기본값 `17`은 RDS의 기본 minor를 선택하며, 실제 배포 전 서울에서 지원하는 minor/인스턴스 조합을 확인한다.

`OpenAiTextModel`, `OpenAiLiveTranscribeModel`, `OpenAiCorrectionModel`, `OpenAiImageModel`의 기본값은 환경변수 계약의 모델 ID다. 배포 wrapper는 G3 통과 기록의 다섯 모델 값을 이 parameter에 전달해야 한다. 키 값과 달리 모델 ID는 비밀이 아니며 template와 task 환경에 들어간다.

VPC AZ는 계정에서 확인한 `ap-northeast-2a`·`ap-northeast-2c`로 고정한다. `deploy:foundation`은 해당 두 영역의 사용 가능 상태를 먼저 조회한다. `Fn::GetAZs`는 기본 서브넷이 있는 영역만 반환할 수 있어 사용하지 않는다. API task는 public subnet의 public IP/IGW로 외부에 연결하고 ALB에서 오는 3000번 요청만 받는다. 내부 ALB/RDS는 isolated subnet에 있다. 서비스 교체 설정은 minimumHealthyPercent 0 / maximumPercent 100이며, 실패한 배포는 circuit breaker로 중단하고 자동 rollback은 하지 않는다.

Foundation의 DB, bucket과 secret은 RETAIN이며 termination protection을 설정한다. Web bucket policy는 Edge에 두어 CloudFront distribution ARN의 역참조를 피한다. 이 정책은 OAC의 해당 distribution에만 읽기를 허용하고 TLS를 강제한다. API task role의 S3 권한은 Media bucket object의 Get/Put/Delete뿐이며, Delete는 metadata 저장 실패 시 생성 파일 정리에 필요하다. DB 비밀번호와 OpenAI key는 ECS secret 참조로만 전달한다.

`/api/*`, `/ws/*`는 동일한 ALB VPC origin, CachingDisabled, AllViewer 정책을 사용한다. 경로는 변경하지 않는다. default behavior만 알려진 SPA 경로를 `index.html`로 바꾸며, API 오류에 적용되는 전역 fallback은 없다. 정적 cache의 minimum TTL은 0이므로 웹 업로드 시 설정하는 `index.html`의 no-cache가 존중된다.

Template/실행 테스트는 네트워크 구분, SG 유입 제한, 데이터 보존, 단일 task 교체, image architecture, secret/env, ALB health check, 캐시·OAC·SPA 경계 및 단방향 stack 의존성을 확인한다. IAM/실제 RDS TLS/CloudFront WSS 통과는 G4의 별도 검증 대상이다.

API 확인 기준: [CDK VPC origin](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins.VpcOrigin.html), [VPC origin 요구 사항](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html), [S3 OAC origin](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins.S3BucketOrigin.html).

배포 명령은 root `package.json`과 `scripts/deploy/cli.ts`에 구현되어 있다. `deploy:api:stage` → `db:migrate:aws` → `deploy:api:start` 순서를 따른다. G3 증거의 `models`에는 `OPENAI_DECISION_MODEL`까지 포함하고, `runtime`에는 두 Decisions timeout 및 confidence를 기록한다. 상세 명령은 [AWS 실행서](../docs/implementation/aws-deployment.md#8-구현된-실행-명령)를 참고한다.
