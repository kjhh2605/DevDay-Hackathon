# 말모아 문서 안내

말모아는 사람끼리 진행하는 영어 스터디를 AI가 지원하는 서비스입니다. 서비스 소개와 실행 명령은 [저장소 README](../README.md)에서 시작하세요.

## 현재 서비스와 검증

| 문서 | 내용 |
| --- | --- |
| [랜딩과 시연 영상](landing/README.md) | 공개 랜딩 경로, 영상 구성과 제작 근거 |
| [실제 AWS 아키텍처](architecture/aws-deployed-architecture.md) | 배포된 요청·데이터 경로와 리소스 |
| [AWS 배포 실행 기록](implementation/evidence/release.md) | 배포 버전, 서비스 자동 검증, 남은 인수 범위 |
| [로컬 검증 기록](implementation/evidence/local-validation.md) | 실제 OpenAI·브라우저·물리 기기 검사 결과와 범위 |
| [챗봇 Decisions 처리](implementation/chat-decisions.md) | 행동 분류, 인자 추출, 서버 실행 규칙 |
| [발표 지시서](presentation/slide-guide.md) · [발표 근거](presentation/evidence-audit.md) | 10분 발표 구성과 당시 실행 증거 |

배포 기록은 실제 서비스의 시점별 결과이며, 발표 자료의 캡처와 챗봇 판단 기준은 제작 당시의 스냅샷입니다. 현재 소스·배포 상태는 각 문서의 기준 시점을 확인하세요.

## 설계와 운영 절차

| 문서 | 내용 |
| --- | --- |
| [제품 요구사항](prd.md) | 사용자 흐름과 기능 범위 |
| [MVP 아키텍처](architecture/mvp-architecture.md) | 초기 구성 선정과 기술 판단 |
| [공유 계약](implementation/shared-contracts.md) | 데이터·HTTP·WebSocket·음성 계약 |
| [구현 계획](implementation/work-plan.md) | 개발 순서와 통합 기준을 남긴 계획 문서 |
| [로컬 실행서](implementation/local-validation.md) | 로컬 DB·파일 저장·HTTPS와 검증 절차 |
| [AWS 배포 실행서](implementation/aws-deployment.md) | CDK 배포·검증·수정 배포 절차 |
| [인수 기준](implementation/acceptance.md) | 기능별 완료 조건 |
| [세션별 작업 문서](sessions/README.md) | 개발 단계별 작업 범위와 인수인계 기록 |

계획 문서는 작성 당시의 작업 지시를 보존합니다. 현재 구현과 실행 결과는 코드와 위 검증 기록을 기준으로 확인하세요.
