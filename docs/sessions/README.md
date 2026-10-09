# 병렬 구현 세션 시작 안내

다음 지시서는 후속 구현·배포 작업을 요청할 때 각 세션에 전달한다. 현재 문서 작성 작업에서 제품 코드를 구현하거나 배포를 실행하지는 않았다.

## 세션 구성

| 세션 | 맡길 문서 | 소유 범위 | 시작 가능 시점 |
| --- | --- | --- | --- |
| S0 | [공통 기반·계약·통합](s0-foundation.md) | root 설정, 계약, typed client, fixture, 내부 포트 | 즉시 |
| S1 | [백엔드 도메인·데이터·동기화](s1-backend.md) | DB, 제품 명령, HTTP, 사용자/스터디 이벤트, 서버 조립 | G0 |
| S2 | [OpenAI·음성·개인 챗봇](s2-ai-audio.md) | AI provider, 프롬프트, 캡처 패키지, AI job/plugin | G0 |
| S3 | [디자인·앱 셸·스터디 UI](s3-study-ui.md) | 공용 UI, 가입·초대·스터디·챗봇 화면 | G0 |
| S4 | [경험·개인 학습 UI](s4-personal-ui.md) | 경험 기록·카드, 개인 학습 목록 | G0 |
| S5 | [로컬 검증·AWS 배포·인수](s5-aws-acceptance.md) | 로컬 환경, CDK, Docker/배포 스크립트, E2E, 실기기 증거 | G0; 첫 AWS 배포는 G3 통과 후 |

S0를 먼저 시작한다. G0 인계 후 S1~S5를 병렬로 시작한다. S5는 초기에 **로컬** HTTPS/WSS·DB·파일 저장 환경과 CDK 코드를 준비한다. 전원이 로컬 전체 기능 검증 G3를 통과한 다음 AWS 리소스 생성·배포·G4 인수를 진행한다. S0는 기반 인계 뒤에도 계약 변경과 통합 담당으로 남는다.

모든 세션은 [준비 사항·환경변수](../implementation/prerequisites.md)를 확인한다. OpenAI 키는 서버 환경파일에만 두며, 통합 환경의 port·compose·migration 실행을 조율한다. S0가 통합 worktree를 지정하고 S5가 실행 환경을 관리한다.

## 세션에 전달하는 방법

각 세션에 아래 한 문장과 해당 지시서 경로를 전달하면 된다.

> `/Users/gnar/orca/projects/DevDay-Hackathon`에서 `docs/sessions/sN-….md`를 읽고 해당 세션의 구현 작업을 수행해 주세요. 공통 기준은 `docs/prd.md`, `docs/architecture/mvp-architecture.md`, `docs/implementation/shared-contracts.md`, `docs/implementation/prerequisites.md`, `docs/implementation/local-validation.md`입니다. 로컬 전체 검증 G3 통과 후 AWS에 배포합니다. 다른 세션도 같은 코드베이스에서 작업하므로 본인 소유 파일만 변경하고 타인의 변경을 되돌리지 마세요.

S5에 실제 AWS 배포까지 맡길 때는 사용할 계정/profile을 함께 지정한다. G0 이전에 S1~S5를 시작한다면 자료 검토·인터페이스 검토까지만 진행하고 독자적인 계약을 만들지 않는다.

## 공통 작업 규칙

1. PRD의 기능을 제외하거나 제외된 운영 정책을 추가하지 않는다. 마이크별 본인 음성 전제를 유지한다.
2. root 설정·lockfile·계약·공용 fixture 변경은 S0가 통합한다. 타 세션 소유 파일이 필요하면 변경 내용을 요청하고 export/포트로 연결한다.
3. 가능한 경우 세션별 branch/worktree를 사용한다. 한 worktree를 공유하면 경로 소유권을 엄격히 지킨다. 서로의 변경을 reset/revert하지 않는다.
4. fixture로 개발한 화면은 실제 서버와 OpenAI 검증을 거쳐야 완료다. mock 통과와 live 통과를 구분한다.
5. 구현과 맞지 않는 계약을 발견하면 S0에 항목·이유·영향을 전달한다. 화면 이름을 API에 추가하는 식으로 임시 우회하지 않는다.
6. 세션 종료 시 변경 경로, export/endpoint, 수행한 검사, 미실행/실패, 선행 작업 대기를 인계한다. 준비되지 않은 의존 기능을 완료로 표시하지 않는다.
7. G0~G3는 로컬에서 구현·검증한다. 인프라 코드·Docker·synth는 병렬로 준비하되 AWS bootstrap·리소스 생성·배포는 G3 통과 기록 이후다. 수정 배포도 관련 로컬 검증을 먼저 통과한다.
8. 환경변수 계약·예제 변경은 S0에게 전달한다. 사용자에게 DB 비밀번호·bucket ARN처럼 자동 생성할 값을 미리 요구하지 않는다. 필요한 외부 입력은 OpenAI 프로젝트/키·호출 권한, 실기기, 배포 account/profile로 구분해 인계한다.

## 공통 인계 양식

```text
세션 / 작업 ID:
변경 경로 / commit:
제공하는 인터페이스:
소비 세션이 해야 할 연결:
실제 수행한 검증과 결과:
로컬/AWS 환경과 mock/live 실행 구분:
미완료·실패·필요한 계약 변경:
```

기능 매핑과 완료 기준은 [작업 계획](../implementation/work-plan.md), [인수 기준](../implementation/acceptance.md)을 따른다. 개인 세션의 완료와 최종 MVP의 완료를 구분한다.
