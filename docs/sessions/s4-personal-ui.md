# S4 — 개인 경험·관심사와 학습 기록 UI

## 작업 목적

개인의 경험을 원문 근거로 정리·저장하고, 승인 피드백과 개인 챗봇에서 저장한 단어·표현을 다시 조회하는 두 주요 화면을 구현한다.

## 참고 자료

- [PRD](../prd.md)의 주요 화면 및 개인별 경험·관심사 기록.
- [공유 계약](../implementation/shared-contracts.md)의 Experience/Draft/LearningItem과 개인 API.
- [디자인 시스템](../../design/design-system.html), [토큰](../../design/tokens.css).
- [작업 계획](../implementation/work-plan.md), [인수 기준](../implementation/acceptance.md), [로컬 실행서](../implementation/local-validation.md).
- [준비 사항·환경변수](../implementation/prerequisites.md): feature 화면에 별도 서버 키나 base URL을 만들지 않고 공통 client 사용.

## 소유권

소유: `apps/web/src/features/experiences`, `apps/web/src/features/learning`과 해당 feature 테스트. 페이지 export를 S3에게 제공한다.

전역 라우터·앱 셸·공용 UI·theme·SEED 스니펫은 S3, API client/계약은 S0, 저장 API는 S1, 경험 AI는 S2 소유다. 다른 세션도 같은 코드베이스에서 작업하므로 타인의 변경을 되돌리지 않고 제공된 인터페이스를 사용한다.

## 수행 순서

1. G0의 fixture/client와 S3의 공용 UI 계약으로 두 화면을 만든다. UI 래퍼가 아직 완성되지 않으면 정해진 export를 임시 소비하고 별도 디자인 시스템을 만들지 않는다.
2. 처음에는 자유 입력창 하나와 “어디서, 누구와, 어떤 일이 있었나요?” 힌트를 제공한다.
3. 정리를 요청하면 AI prepare를 실행한다. 부족한 상황에서만 보충 질문을 보여주고, 답변 없이 계속하기도 동일하게 제공한다. 충분한 원문은 바로 정리 결과로 이어진다.
4. 원문과 정리본·관심사/상황 정보를 확인하고 수정한 뒤 명시적으로 저장한다. draft 성공만으로 저장 완료라고 표시하지 않는다.
5. 저장된 경험 카드를 실제 GET 결과로 보여준다. 새 경험 추가·기존 경험 수정과 재조회가 동작하게 한다.
6. 개인 학습 기록은 approved_feedback와 chat 출처를 구분해 표시한다. 발화자와 수정한 사람이 다를 수 있으므로 서버 ownerUserId를 기준으로 한다.
7. 빈 상태·생성 중·실패·저장 중·저장 완료를 처리하고 S3의 전역 user 이벤트로 목록이 갱신되게 한다.
8. 로컬 실제 API·DB·OpenAI로 전환해 경험이 다음 주제의 입력으로 사용되고 학습 기록이 사용자별로 조회되는지 G2/G3에서 통합 검증한다. AWS 배포 전에 두 물리 노트북과 앱 재시작 후 재조회를 확인한다.

## 지켜야 할 계약

- query cache key에는 현재 사용자 ID를 포함한다. 세션 전환/초기화 시 다른 사용자 목록이 남지 않게 한다.
- draft의 질문·요약은 개인 범위다. 공통 스터디 snapshot에 붙이지 않는다.
- 미응답 질문을 required validation으로 막지 않는다. skipQuestions=true를 사용해 정리를 계속한다.
- 사용자가 원문/정리본을 수정하면 저장 payload에 그 확인된 값을 보낸다. AI가 만든 최초 텍스트로 다시 덮어쓰지 않는다.
- 카드 수정은 기존 Experience ID를 사용한다. 저장마다 새 경험을 중복 생성하지 않는다.
- 단어·표현 기록은 localStorage를 영속 저장소로 쓰지 않는다. 새로고침/다시 접속해도 서버에서 조회한다.
- 자동 복습 주기·수준 진단·학습 통계·단어 삭제 정책 등 PRD에 없는 기능은 추가하지 않는다.

## S3와 맞출 UI 경계

ExperiencePage, LearningPage 및 필요한 feature hook을 export한다. 내비게이션, 세션 provider, 초대 모달, 공통 오류 알림, 전역 디자인은 S3가 조립한다. 화면 내부 레이아웃·문구·카드 구성을 바꿀 때 API 변경은 요구하지 않는다.

## 검증·완료 조건

“부산에 다녀왔어요” 같은 짧은 입력에서 보충 질문이 나오고 답변 생략도 저장까지 이어져야 한다. 충분한 입력은 불필요한 필수 질문 없이 정리된다. 원문에 없는 사건을 사용자가 말한 경험처럼 덧붙이지 않는 실제 AI 결과를 확인한다.

경험 저장·수정·재조회, 첫 주제 근거 없음 안내에서 이 화면으로 이동, 승인 피드백/챗봇 출처 학습 목록, A/B 개인 목록 분리, 새로고침 후 조회를 검증한다. 완료 시 페이지 exports, 사용 API, 실제 수행 검사, 미연결 부분을 S0/S3/S5에 인계한다.
