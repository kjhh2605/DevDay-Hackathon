# MVP 구현·배포 문서

작성일: 2026-10-09. MVP 구현 기준과 작업 문서다. 제품 구현, 의존성 설치, OpenAI 유료 호출, AWS 리소스 생성·배포는 실행하지 않았다. 추가 준비 확인에서 서버용 `.env.local`과 git 제외 규칙을 준비했으며, 계정·모델의 실제 호출은 아직 검증하지 않았다.

기능 범위의 기준은 [PRD](prd.md)다. PRD에 남아 있는 ‘인터뷰 진행 중’ 문구와 관계없이, 이번 사용자 요청에 따라 완료된 기능 기준으로 취급한다. 원본 PRD와 `design/`는 수정하지 않았다.

## 읽는 순서

| 문서 | 목적 |
| --- | --- |
| [시작 전 준비·환경변수](implementation/prerequisites.md) | 사용자 준비 항목, 현재 호스트 상태, 환경변수 예제와 사전 점검 |
| [아키텍처·기술 스택](architecture/mvp-architecture.md) | 구성 선정, 대안 비교, OpenAI 모델, MCP 판단, 디자인 적용 |
| [공유 계약](implementation/shared-contracts.md) | 데이터·HTTP·WebSocket·음성·AI 도구 계약과 UI 독립 수정 범위 |
| [구현 계획](implementation/work-plan.md) | 작업 순서, 의존 관계, 병렬 진행과 통합 기준 |
| [로컬 구현·검증 실행서](implementation/local-validation.md) | 로컬 DB·파일 저장·두 노트북 HTTPS와 배포 전 통과 조건 |
| [AWS 배포 실행서](implementation/aws-deployment.md) | 인프라 구성, 준비 사항, 배포·검증·수정 배포 절차 |
| [PRD 추적·인수 기준](implementation/acceptance.md) | 필수 기능 누락 확인과 실제 두 기기 검증 |
| [세션 시작 안내](sessions/README.md) | 6개 작업 세션의 소유권과 바로 전달할 지시 문서 |

## 선정 결과

React + TypeScript + Vite, SEED Design React 컴포넌트와 프로젝트 디자인 토큰을 사용한다. Node.js + Fastify 단일 서버가 HTTP, WebSocket, OpenAI 호출을 담당한다. PostgreSQL에 진행 상태·개인 기록을, S3에 생성 이미지와 전사 보정용 오디오를 저장한다. AWS에는 CloudFront, S3, 내부 ALB, ECS Fargate 1개 앱 태스크, RDS PostgreSQL로 배포한다.

챗봇은 OpenAI Responses API의 함수 호출로 서버의 제품 기능을 실행한다. 버튼과 챗봇은 같은 명령을 사용한다. 실행 결과를 저장한 뒤 사용자 또는 스터디 범위의 이벤트를 전달한다. 제품 런타임 MCP 서버는 도입하지 않는다. 근거와 제한은 아키텍처 문서에 있다.

## 이번 대화에서 추가로 확인된 기본값

사용자가 2026-10-09 대화에서 다음 두 기본값을 승인했다. PRD의 기능을 축소하는 변경이 아니라 미정 경계 상황의 처리다.

1. 경험·관심사와 학습 표현이 모두 없는 첫 스터디에서는 경험 입력을 안내한다. 근거 없는 일반 주제를 자동으로 생성하지 않는다.
2. “다음 주제로 넘어갈게”와 “다음 주제 만들어줘”는 현재 피드백 승인·발화자별 저장·다음 주제 생성까지 수행하는 동일한 명령으로 연결한다. 대화 중에는 먼저 주제 종료와 피드백 검토가 필요하다.

## 실행의 출발점

[S0 공통 기반·계약](sessions/s0-foundation.md)을 먼저 시작한다. 계약과 앱 골격을 인계한 G0 이후 S1~S5가 병렬 진행한다. **로컬 구현 → 실제 OpenAI·두 노트북·전체 기능 로컬 검증(G3) → AWS 배포 → 배포 환경 최종 검증(G4)** 순서다. S5는 로컬 환경과 인프라 코드를 병렬로 준비하지만 AWS 리소스 생성은 G3 통과 뒤에 시작한다.

시작 전에 [준비 사항](implementation/prerequisites.md)을 확인한다. 문서용 [로컬 환경 예제](implementation/env/local.env.example)와 [배포 CLI 예제](implementation/env/deploy.env.example)를 제공한다. 현재 root `.env.local`은 준비되어 있으며 구현 세션은 이를 보존하고 root `.env.example`·초기화 script를 만든다. OpenAI 호출 권한은 G1 전에, AWS 계정/profile은 G3 이후 배포 준비에서 확인한다.

날짜나 실제 팀 규모는 정해지지 않았으므로 일수 대신 완료 기준으로 순서를 정했다. OpenAI 모델 접근은 로컬 G1에서, AWS 계정·권한은 배포 준비 단계에서 후속 세션이 확인한다. 로컬 DB와 파일 저장소의 구성은 [로컬 실행서](implementation/local-validation.md)를 따른다.
