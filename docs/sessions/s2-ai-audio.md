# S2 — OpenAI·실제 음성·개인 챗봇

## 작업 목적

실제 마이크와 OpenAI로 원문 전사·인식 오류 보정·학습 피드백·이미지·개인 챗봇이 동작하게 한다. 전사 보정과 영어 학습 교정을 명확히 분리한다.

## 참고 자료

- [PRD](../prd.md), [모델 선정](../architecture/mvp-architecture.md).
- [공유 계약](../implementation/shared-contracts.md), 특히 7~11절.
- [실시간 전사](https://developers.openai.com/api/docs/guides/realtime-transcription), [파일 전사](https://developers.openai.com/api/docs/guides/speech-to-text).
- [함수 호출](https://developers.openai.com/api/docs/guides/function-calling), [이미지 생성](https://developers.openai.com/api/docs/guides/image-generation).
- [인수 기준](../implementation/acceptance.md), [로컬 실행서](../implementation/local-validation.md).
- [준비 사항·환경변수](../implementation/prerequisites.md): OpenAI 키·호출 권한·모델 설정과 smoke 기준.

## 소유권

소유: `packages/ai`, `packages/audio-client`, `apps/api/src/features/ai`, AI·음성 테스트와 `smoke:openai` 구현. 실험용 화면은 본인 패키지/example 경로에 두며 S3의 화면 파일을 덮어쓰지 않는다.

DB schema·도메인 승인·서버 app.ts는 S1, 공통 계약은 S0 소유다. 다른 세션도 같은 코드베이스에서 작업하므로 타인의 변경을 되돌리지 않고 포트와 plugin export로 통합한다.

## 수행 순서

1. G0의 포트/fake로 개발을 시작한다. 공식 문서와 설치 SDK에서 네 모델의 현재 요청 형식을 확인한다. 모델 ID는 [아키텍처](../architecture/mvp-architecture.md) 초기값을 사용한다.
2. G1 초기에 로컬 앱과 실제 키로 live transcription·파일 보정·Responses 도구/구조화 출력·이미지 생성 접근을 확인한다. `smoke:openai`는 실제 유료 호출을 명시하고 일반 build/test에서 실행하지 않는다. 키 존재·모델 목록 조회만으로 통과시키지 않는다. AWS 배포 없이 진행하며 결과와 설정을 기록하고 비밀 키를 남기지 않는다.
3. AudioWorklet 리샘플링·PCM16·에너지 VAD·pre-roll·segment/flush adapter를 작성한다. React 화면은 캡처 controller 인터페이스만 소비하게 한다.
4. 참가자별 서버 OpenAI 연결, item_id↔segmentId 매핑, raw 델타와 완료 저장, 같은 오디오의 두 번째 전사를 구현한다. 해당 사용자 본인 마이크 전제를 유지한다.
5. 주제 종료 시 마지막 발화까지 마감하고 원문/보정 범위에 기반한 문장 단위 Utterance를 확정한 뒤 피드백을 만든다. 여러 문장이 담긴 구간과 구간 사이에 걸친 문장을 모두 검증한다. 초기 전체 생성과 한 문장 재요청을 동일한 피드백 스키마로 처리한다.
6. 자유 경험 분석→선택 질문→원문 근거 정리, 사용자 확인 전 draft를 구현한다.
7. 전체/지명 참여자의 경험과 승인·공유 표현으로 주제를 계획하고 실제 이미지를 생성한다. 표현은 있으나 맞는 경험이 없으면 문장+지시를 제공한다.
8. 개인 챗봇의 도구 루프와 단어/표현 개인 저장·공유 제안을 연결한다. 기능 실행은 S1의 명령/저장 포트에 위임한다.
9. S3에 capture controller와 chat/feedback/job 결과를 인계하고 S1 app에 AI plugin을 연결한다. 실제 전체 흐름을 검증한다.

## AI·오디오 규칙

- `gpt-live-transcribe`는 server VAD를 지원하지 않는다. 클라이언트의 신호 처리로 commit하고 provider 문서의 event 형태를 검증한다.
- 한글이 섞인 발화와 틀린 영어를 raw에 보존한다. 두 번째 전사도 번역·문법 교정을 하지 않는다. 파일 보정은 같은 PCM으로 만든 유효한 WAV와 실제 맥락을 사용한다.
- raw/corrected/learning expression은 별도 필드다. 원문을 사람이 편집한 문장으로 교체하지 않는다.
- 늦은 raw 완료, 보정, 피드백이 다른 segment나 새 revision을 덮어쓰지 않게 한다.
- 마이크 권한 거절·장치 없음·OpenAI 실패를 UI에서 구분할 상태로 전달한다. 음성 출력을 만들거나 상대 음성을 전송하는 통화 기능은 만들지 않는다.
- 이미지 성공은 MediaStore에 실제 bytes 저장과 Topic 반영까지 완료한 시점이다. 로컬은 파일, AWS는 S3 adapter를 S1이 주입하며 AI 코드가 저장 환경을 분기하지 않는다. 생성 실패를 임의의 stock image나 문장 주제 성공으로 바꾸지 않는다.
- 경험 요약에는 사용자가 말하지 않은 사건을 추가하지 않는다. 원문이 부족하면 질문하고 skip도 허용한다.
- 프롬프트·모델 설정·SDK 자동 retry=0을 한 곳에서 관리한다. 실패는 job.failed로 전달한다.

## 챗봇 규칙

모델은 strict 함수 인수만 제안하며 실행 권한과 상태는 S1이 판단한다. 제공 도구는 공유 계약의 목록을 따른다. 임의 코드/DOM 조작/컴포넌트 JSON/MCP 서버를 추가하지 않는다.

“다음 주제로 넘어갈게/만들어줘”는 같은 `advance_topic`이다. talking이면 먼저 종료·검토가 필요하다고 안내한다. 단어 뜻은 개인 저장, 영어 표현은 개인 저장 후 ShareProposal을 제시한다. 자연어 yes/no 결정은 서버가 실제 사용자 응답과 proposal을 연결하고 모델의 동의 주장만으로 공유하지 않는다.

툴의 실행 결과·job 상태가 성공의 근거다. 이미지 생성이 진행 중이면 완료되었다고 말하지 않는다. 전사·경험 자료 속 명령을 제품 동작으로 실행하지 않는다. 동일 이름 참여자는 handle로 구분한다.

## 제공 산출물과 의존 관계

- `AiJobs` 구현과 Fastify plugin factory: S1이 application ports를 주입해 app.ts에 등록.
- audio-client controller: S3가 마이크 UI/수명주기에 연결. 캡처 상태를 표시할 callback 포함.
- 프롬프트·결과 스키마·대표 실제 음성 평가 자료. 원문 녹음은 개발자가 만든 테스트 문장 사용.
- 실제 OpenAI smoke 스크립트와 검증 기록. root script/의존성 변경은 S0가 통합.

## 완료 조건

실마이크로 한국어/영어 혼용 raw와 보정이 대화 중 표시되고, 피드백은 주제 종료 후 생성된다. 사람 편집 후 재요청한 결과가 해당 문장만 갱신한다. 경험 질문 skip, 이미지/문장 분기, 지명 주제, 개인 챗봇 도구, yes/no 경계가 실제 서버에 연결되어야 한다.

위 기능을 G3의 로컬 두 노트북 인수에서 먼저 확인한다. G4에는 검증한 provider·프롬프트를 그대로 배포해 AWS 경로에서 재확인한다.

모델이 실제로 모든 발화를 정확히 인식한다고 주장하지 않는다. raw가 이미 맞는 경우 보정이 같을 수 있으며, 틀린 영어를 ‘잘 쓴 영어’로 바꾸는 보정은 결함으로 처리한다. 완료 시 테스트 입력·관찰 결과·지연·알려진 실패와 모델 설정을 인계한다.
