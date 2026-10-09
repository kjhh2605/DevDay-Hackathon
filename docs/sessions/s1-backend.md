# S1 — 백엔드 도메인·데이터·실시간 동기화

## 작업 목적

사용자와 스터디 상태를 서버에서 일관되게 관리하고, 두 기기에 실제로 동기화한다. 최종 승인·개인 저장·다음 주제 예약을 하나의 트랜잭션으로 연결한다.

## 참고 자료

- [PRD](../prd.md), [아키텍처](../architecture/mvp-architecture.md).
- [공유 계약](../implementation/shared-contracts.md), 특히 2~6·9~11절.
- [인수 기준](../implementation/acceptance.md), [AWS 실행서](../implementation/aws-deployment.md).
- [로컬 실행서](../implementation/local-validation.md): 로컬 PostgreSQL·미디어 adapter·배포 전 검증.
- [환경변수 계약](../implementation/prerequisites.md): 서버 config·DB TLS·쿠키 조건과 preflight 연계.

## 소유권

소유: `apps/api/src/domain`, `db`, `http`, `realtime`, `storage`, `app.ts`와 서버 기동/config, 도메인 통합 테스트. DB schema와 migration은 S1만 수정한다.

S2의 `apps/api/src/features/ai`, `packages/ai`, 오디오 캡처를 직접 수정하지 않는다. 계약/포트는 S0에 요청한다. 다른 세션도 같은 코드베이스에서 작업하므로 그들의 변경을 되돌리지 않고 export와 인터페이스에 맞춰 연결한다.

## 수행 순서

1. S0 G0 계약·포트를 받아 PostgreSQL schema와 migration을 작성하고 로컬 Docker PostgreSQL에 적용한다. 로컬/배포에 같은 schema를 사용하며 in-memory/SQLite로 통합 검증을 대체하지 않는다.
2. 이름+중복 없는 handle 가입, 불투명 cookie 세션, `/me`를 만든다. 다른 사용자 소유 데이터 조회를 차단한다.
3. 아이디 조회·스터디 생성·초대·입장을 구현한다. 생성자는 joined, 대상자는 invited다. 사용자의 전역 WS로 초대를 보내고 목록 조회로 기존 초대도 표시할 수 있게 한다.
4. 사용자별/스터디별 이벤트 연결 목록과 snapshot 구독을 구현한다. 정상 연결의 초기 구독 race를 처리하고 개인 데이터는 user scope에만 publish한다.
5. study.start/close/advance/finish 명령과 상태 검증을 구현한다. 실제 AI 이전에는 S0 fake로 동작을 확인한다.
6. 원문·보정·피드백 저장 포트를 S2에 제공한다. 사람의 보정 편집은 모두에게 반영하며 원문은 변경하지 않는다.
7. 최신 revision 검사, 승인→발화자별 학습 저장→새 주제 예약을 트랜잭션으로 묶는다. UI 클릭과 챗봇 실행이 같은 도메인 코드에 들어오게 한다.
8. 경험 CRUD·개인 기록 조회·ShareProposal 결정·SharedExpression을 구현한다. `MediaStore.put/resolveImage`에 `LocalFilesystemMediaStore`와 `S3MediaStore`를 연결한다. 로컬에서는 실제 bytes를 영속 경로에 저장하고 이미지 endpoint로 읽으며, 기동에 AWS 자격증명이 필요하지 않게 한다.
9. S2 AI plugin을 app.ts에 주입한다. `/healthz`(process), `/readyz`(DB/migration), migration 전용 entrypoint를 제공한다. 로컬 실제 데이터로 S3/S4와 통합하고 S5에 Docker/runtime 계약을 인계한다. `APP_ENV=aws`는 S3/live/Secure 쿠키를 강제하고 로컬 설정으로 대체하지 않는다.
10. 환경 schema와 부작용 없는 parser를 export해 API·migration·S5 preflight가 재사용하게 한다. bool/port/enum과 환경별 필수값을 검사하고 오류에는 변수명만 남긴다. `DB_SSL_MODE=verify-full`은 RDS CA와 서버 이름 검증으로 연결하며 인증서 검증을 끄지 않는다. parser를 import하는 것만으로 DB/OpenAI 연결이 시작되면 안 된다.

## 필수 불변 조건

- actor는 cookie에서, speaker는 인증된 음성 입력에서 정한다. 모델이나 request body가 지정한 actor를 믿지 않는다.
- 진행 명령은 joined 참여자 누구나 실행한다. 호스트/전원 승인 기능을 만들지 않는다.
- 다른 사람의 보정문을 편집할 수 있지만 자동 학습 저장 대상은 원래 speakerUserId다.
- 두 사용자가 동시에 next를 눌러도 다음 ordinal과 활성 생성 job이 하나다. commandId만으로 서로 다른 사용자의 중복을 막을 수 없으므로 Study lock과 원본 Topic/version을 검사한다.
- 승인·개인 기록·다음 Topic 예약은 원자적이다. OpenAI 호출 중 DB lock을 잡아두지 않는다.
- 공유 yes 이전의 개인 표현은 공통 snapshot·event·주제 입력에 들어가지 않는다.
- 저장 완료 후 이벤트를 보낸다. 개인 챗봇 원문을 스터디 snapshot에 포함하지 않는다.
- 자동 재시도·복구·수정 이력·다중 앱 프로세스 지원은 구현하지 않는다.

## S2와 맞출 계약

S1이 `StudyCommands`, `SpeechStore`, `FeedbackStore`, `TopicContextReader`, `LearningStore`, `SharingStore`, `EventPublisher`, `MediaStore`를 제공한다. S2는 결과 생성 후 이 포트로 저장한다. S1은 S2의 `AiJobs`를 주입받아 예약한 작업을 실행한다.

`close_topic`은 아직 들어오지 않은 마지막 전사를 포함해야 한다. S2의 flush 완료 및 문장별 작업 종료를 받은 뒤 review로 전이한다. 피드백이 실패한 문장은 review에서 실패로 보이지만 다음/종료 승인은 차단한다. 초기 job 실패 후 사용자의 새 요청은 재실행할 수 있고 자동으로 재실행하지 않는다.

## 검증·완료 조건

의미 있는 DB 통합 테스트로 다음을 확인한다.

1. handle 동시 가입 중복, 타인의 개인 기록 조회 거절.
2. 서로 다른 actor/commandId의 동시 next에서 생성 슬롯·학습 항목 중복 없음.
3. 다른 화자의 문장 편집 후 원래 화자에게 학습 기록 저장.
4. 오래된 피드백이 최신 revision을 덮어쓰지 않음.
5. no/미응답 공유의 공통 데이터 비노출, yes 중복 클릭의 단일 공유.
6. final finish에서도 마지막 학습 저장, 새 앱 프로세스에서 개인 기록 재조회.
7. 로컬 API 재시작 후 이미지 파일 재조회와 미디어 접근 권한. AWS adapter의 입력/오류 처리는 별도 검사하되 실제 S3/IAM 검증은 G4에서 수행.

S2 실제 호출 및 로컬 두 사용자 연동이 끝나야 기능 완료다. G3 두 물리 노트북 검사에도 참여하며, AWS 배포를 로컬 통합의 선행 조건으로 두지 않는다. 인계에는 migration 명령, endpoint/포트, unique 제약, 이벤트 범위, 실행 검사와 남은 실제 연동 항목을 기록한다.
