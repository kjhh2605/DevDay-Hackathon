# S5 — 로컬 검증 환경·AWS 배포·통합 인수

## 작업 목적

먼저 로컬 실행 환경을 마련하고, 두 물리 노트북·실마이크·실제 OpenAI·영속 저장 기준으로 MVP 전체를 검증한다. G3 통과 후 선정 아키텍처를 AWS에 재현 가능하게 배포하고 G4에서 배포 환경을 확인한다. 이 지시서는 후속 구현·배포를 요청받은 세션에서 실행한다.

## 참고 자료

- [아키텍처](../architecture/mvp-architecture.md), [AWS 실행서](../implementation/aws-deployment.md) 전체.
- [작업 계획](../implementation/work-plan.md), [공유 계약](../implementation/shared-contracts.md).
- [로컬 실행서](../implementation/local-validation.md) 전체: G3 통과 전 AWS 리소스 생성·배포 금지.
- [준비 사항·환경변수](../implementation/prerequisites.md), [로컬 예제](../implementation/env/local.env.example), [배포 CLI 예제](../implementation/env/deploy.env.example).
- [PRD 추적·인수 기준](../implementation/acceptance.md), [PRD](../prd.md).

## 소유권

소유: `infra/`, `scripts/local/`, `scripts/deploy/`, root Dockerfile/compose/.dockerignore/CI 파일 중 G0에서 지정한 경로, `tests/e2e/`, `docs/implementation/evidence/`, 실행서의 실제 실행 정보.

root package script/lockfile은 S0가 통합한다. 로컬 미디어 adapter와 API 설정은 S1, Vite HTTPS·proxy 설정은 S3가 구현한다. S5는 `setup:local`, preflight의 local/lan/aws 모드, 인증서 준비·서비스 실행·검증 절차를 제공한다. S1의 환경 parser를 재사용하고 S2의 유료 smoke를 preflight에서 자동 실행하지 않는다. 앱 기능 결함은 담당 세션에 재현 절차를 전달하고 타인의 파일을 임의로 덮어쓰지 않는다. 다른 세션도 같은 코드베이스에서 작업하므로 변경을 되돌리지 않고 진행 상황에 맞춰 연결한다.

## 시작과 의존 관계

G0 이후 로컬 PostgreSQL·영속 파일 경로·HTTPS, Docker·CDK 코드/synth와 E2E 틀을 병렬로 시작한다. S1의 기동/health/migration/저장 계약, S2의 모델·오디오 설정, S3의 정적 build·proxy를 소비한다. G1에서는 완성 UI를 기다리지 않고 **로컬** HTTPS/WSS 경로를 먼저 검증한다.

**G3 통과 기록 전에는 bootstrap, stack deploy, ECR 게시, 웹 업로드를 실행하지 않는다.** AWS 연결을 미리 확인하기 위한 임시 배포도 만들지 않는다. G3 필수 항목이 실패/미실행이면 로컬 수정과 재검증을 진행한다.

사용할 AWS profile/account는 후속 배포 요청에서 확인한다. 계정이 없어도 G3까지 로컬 구현·검증을 완료할 수 있어야 한다. G3 이후 계정이 준비되지 않았으면 배포에 필요한 외부 입력을 명확히 인계한다. 현재 문서 작성 요청을 실제 배포 지시로 오해하지 않는다.

## 수행 순서

1. 기존 환경파일을 보존하는 `setup:local`과 빠른 preflight를 먼저 제공한다. 로컬 PostgreSQL 17 compose와 영속 volume, 미디어 bind mount, linux/amd64 production image를 준비한다. compose wrapper가 DB 환경을 명시적으로 매핑하게 한다. `APP_ENV=local`로 AWS 자격증명 없이 기동하고 비밀·인증서·미디어가 image에 포함되지 않게 한다.
2. mkcert 인증서와 두 개발 노트북의 신뢰 설정 절차를 작성한다. S3에 Vite dev/preview HTTPS·API/WS proxy 설정을 인계하고 로컬 쿠키·마이크·WSS를 G1에서 확인한다.
3. build/typecheck/계약/핵심 테스트와 Playwright A/B context E2E를 마련한다. 실제 OpenAI 경로는 S2와 로컬에서 검증한다. 대규모 배포 파이프라인이나 운영 대시보드를 추가하지 않는다.
4. AWS 실행서의 세 stack, 네트워크, 단일 앱 태스크 제약을 CDK로 작성하고 계정 lookup 없이 synth한다. 기본 CloudFront HTTPS 도메인을 사용하도록 코드만 준비한다.
5. G2의 실제 로컬 전체 흐름을 연결하고, G3에서 두 물리 노트북으로 A01~A27/E01~E08을 검증한다. build 결과·API image·동일 migration·재시작 후 기록/파일 재조회까지 확인한다. 두 browser context는 실기기를 대체하지 않는다.
6. `evidence/local-validation.md`에 대상 commit·모델 설정·자동/수동 결과를 기록하고 S0와 누락·실패 여부를 확인한다. G3가 통과해야 다음 단계로 간다.
7. `.env.deploy.local`의 profile/account/region을 읽는 wrapper와 AWS preflight로 계정·리전·RDS orderable 옵션·Fargate quota·비용 예상과 배포 설정을 확인한다. STS 계정이 지정값과 다르면 중단한다. 검증한 commit/lockfile을 사용하며 후속 변경은 영향받는 로컬 검사부터 다시 통과시킨다.
8. AWS 실행서에 따라 bootstrap → foundation → API desired 0 → migration task → API 1 → Edge → 웹 정적 파일 순으로 배포한다. secrets는 서버에만 주입한다.
9. G4에서 CloudFront behavior·쿠키·WSS·heartbeat·API 오류 JSON, IAM/Secrets·RDS TLS·S3 저장/읽기를 확인한다. 두 물리 노트북으로 AWS 인수 흐름과 태스크 교체 후 재조회를 검증한다.
10. 배포 URL/commit/모델 설정/검증 결과와 제한을 `evidence/release.md`에 기록한다. 실패는 담당 세션에 입력·상태·기대·관찰·requestId로 전달한다. 수정은 관련 로컬 검사 → 수정 배포 → 배포 확인 순서로 진행한다.

## 인프라 필수 조건

- CloudFront + S3 프론트, VPC origin + 내부 ALB + Fargate 백엔드, RDS PostgreSQL. 서버리스 대안으로 독자 변경하지 않는다.
- Fargate 앱 1 task, 자동 확장 없음, minimumHealthyPercent=0/maximumPercent=100. 진행 중 스터디 없는 때 배포한다.
- public subnet 앱의 public IP는 outbound용이며 inbound는 ALB SG만 허용. RDS는 private.
- `/api/*`, `/ws/*` cache 비활성. 개인 응답·쿠키 캐시 금지, SPA fallback이 API 오류를 덮지 않음.
- RDS/S3 데이터를 컨테이너 재배포 때 삭제하지 않음. API migration은 일회성 task로 실행하고 exit code 확인.
- 실행되지 않은 테스트, unavailable 모델, 실패한 이미지 호출을 성공으로 기록하지 않음.

## 산출물·완료 조건

배포 전 산출물: 로컬 실행·HTTPS 절차, compose/volume, production image, CDK/synth, 핵심 E2E, 수동 두 기기 체크 결과, `docs/implementation/evidence/local-validation.md`. G3 통과까지 AWS가 없어도 재현 가능해야 한다.

배포 후 산출물: deploy script, 실제 동작하는 AWS HTTPS URL, G4 결과, `docs/implementation/evidence/release.md`. FE 단독 배포와 API 수정 배포 절차 모두 로컬 검증을 선행하며 실행서와 일치해야 한다.

전체 PRD 추적표가 통과하고, 두 실제 기기에서 공통 상태가 동기화되며, 실제 AI 결과와 개인 기록이 저장·재조회되어야 최종 완료다. 페이지가 열리거나 health check가 통과한 것만으로 완료 처리하지 않는다.
