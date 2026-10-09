# S3 — 디자인·앱 셸·스터디·개인 챗봇 UI

## 작업 목적

사람 간 대화를 방해하지 않는 스터디 화면을 만들고, 사용자가 UI/UX를 자주 수정할 수 있도록 화면 구현과 서버 계약을 분리한다. React + TypeScript와 실제 SEED Design 에셋을 사용한다.

## 참고 자료

- [PRD](../prd.md), [공유 계약](../implementation/shared-contracts.md).
- [디자인 시스템 HTML](../../design/design-system.html), [토큰 CSS](../../design/tokens.css), [디자인 적용 결정](../architecture/mvp-architecture.md).
- [SEED Vite 설치](https://seed-design.io/react/getting-started/installation/vite), [컴포넌트](https://seed-design.io/components).
- [인수 기준](../implementation/acceptance.md), [로컬 실행서](../implementation/local-validation.md).
- [환경변수 계약](../implementation/prerequisites.md): Vite 공개 값·TLS 경로·port와 비밀 분리.

## 소유권

소유: `apps/web/src/app`, `features/auth`, `features/study`, `features/chat`, `shared`, `apps/web/seed-design`, web entry/style/Vite 설정의 G0 이후 변경과 해당 UI 테스트.

S4의 experiences/learning feature 파일, S2의 audio-client, S0의 공통 client/계약/lockfile은 수정하지 않는다. 다른 세션도 같은 코드베이스에서 작업하므로 타인의 변경을 되돌리지 않고 공개 export를 조립한다.

## 수행 순서

1. G0 client/fixture로 앱 셸과 세 주요 경로를 만든다. 사용자 세션·QueryClient·전역 이벤트 연결·초대 모달은 앱 루트에 둔다.
2. SEED Action Button/Dialog/Text Field/Accordion/Tabs/Badge/Skeleton 또는 Progress Circle/Snackbar를 실제로 통합한다. 필요한 스니펫을 소유 경로에 두고 shared/ui 래퍼를 S4에 제공한다.
3. local tokens와 SEED 스타일을 매핑한다. 라이트 고정, Pretendard, 제한된 Montserrat, Material Symbols를 적용한다. design HTML을 제품 전체 레이아웃이나 기능 목록으로 복제하지 않는다.
4. 가입·아이디 중복 오류·스터디 생성·초대 모달·참여하기 흐름을 만든다. 다른 주요 화면에서도 초대를 볼 수 있어야 한다.
5. 주제 이미지/문장/대화 지시, 참여자 상태, 개인 사이드 챗봇, 하단 가사 방식 raw/보정 표시를 만든다. 동기화된 상태만 공통 영역에 반영한다.
6. 주제 종료 후 문장별 원문·편집 보정·피드백 요약 토글·상세·재요청을 구현한다. 상대 발화도 편집할 수 있다.
7. 챗봇 답변·도구 실행 상태·단어/표현 저장 결과·공유 yes/no를 연결한다. 생성 중/완료/실패와 stale feedback을 구분한다.
8. S2 capture controller를 연결하고 mic permission·recording·failure·flush 상태를 반영한다. 입력을 직접 구현하거나 PCM 프로토콜을 화면에 넣지 않는다.
9. 로컬의 실제 S1/S2 서버로 전환하고 두 사용자 G2/G3 흐름을 검증한다. S5의 인증서·실행 절차를 받아 Vite dev/preview의 HTTPS·API/WS proxy를 구성하고 두 물리 노트북에서도 확인한다. 사용자 피드백에 따른 UI 수정은 로컬에서 확인한 뒤 배포한다.
10. dev/preview는 WEB_PORT와 LOCAL_WEB_ORIGIN을 맞추고 strictPort를 적용한다. API·WS·이미지는 같은 origin의 상대 경로를 사용한다. Vite에 필요한 값만 전달하고 서버의 OpenAI/DB 비밀 또는 전체 process.env를 브라우저 번들에 넣지 않는다.

## 지켜야 할 UI 의미

- raw/보정/학습 표현의 세 단계를 시각적으로 구분한다. 보정이 아직 없으면 생성 중 상태를 보여주며 학습용 영어를 보정처럼 표시하지 않는다.
- 전사는 대화 중 하단에서 순차적으로 넘어간다. 종료 후 전체 문장은 검토 영역에서 읽을 수 있다.
- 학습 피드백은 한 문장에 묶고 summary를 토글 제목으로 쓴다. 없는 피드백은 빈 설명을 꾸며내지 않는다.
- 수정 이후 해당 문장 옆 재요청 액션을 제공한다. 최신 revision에 대한 결과인지 확인한다.
- next/finish의 저장·승인은 서버 결과를 기다린다. 버튼 비활성은 보조이며 서버 중복 방지를 대신하지 않는다.
- 개인 챗봇과 미동의 표현을 상대 화면에 표시하지 않는다. yes/no는 proposalId를 명시적으로 전달한다.
- 주제 제어는 참여자 누구나 가능하다. 호스트 전용 버튼이나 전원 승인 UI를 만들지 않는다.
- 대화 중 마이크는 계속 확보하되 검토/생성 중 오디오 전송 여부는 S2 controller의 topic 상태를 따른다. 마이크 권한을 얻기 위한 사용자 gesture 경로를 둔다.

## UI 독립 변경과 공용 export

화면 컴포넌트는 feature hook/view model을 거쳐 typed client를 사용한다. 서버 enum을 CSS class나 DOM selector 이름으로 만들지 않는다. chatbot 실행 결과는 ID와 상태로 렌더링한다.

S4에 Button, Field, Dialog, Card, EmptyState, JobStatus, 기본 typography/spacing 규칙을 제공한다. S4는 이 컴포넌트를 소비하고 직접 전역 CSS를 바꾸지 않는다. S3는 S4가 export하는 ExperiencePage/LearningPage를 라우터에 등록한다.

패널 위치·폭, 카드/리스트, 버튼 수, 문구, 애니메이션, summary 토글 방식은 계약 안에서 자유롭게 수정한다. 데이터 소유자·동의·진행 의미를 바꾸는 요청은 S0에 계약 변경으로 전달한다.

## 검증·완료 조건

실제 SEED 컴포넌트 사용과 로컬 디자인 매핑을 화면으로 확인한다. 노트북 화면에서 주제·하단 전사·챗봇·검토 UI가 가려지지 않아야 한다. 키보드 focus·Dialog 닫기·입력 label 등 기본 상호작용도 확인한다.

두 사용자에서 초대, 첫 주제, 실시간 raw/보정, 상대 문장 편집, 문장별 재요청, 챗봇 진행, 공유 yes/no, 마지막 종료까지 실제로 수행한다. mock 상태와 실제 실패 표시를 모두 확인하고 완료 증거를 S5에 인계한다.
