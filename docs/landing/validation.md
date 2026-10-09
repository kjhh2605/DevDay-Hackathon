# 랜딩페이지 검증

검증일: 2026-10-09.

## 브라우저와 서비스 경로

실제 PostgreSQL·HTTP API·이벤트 WebSocket과 기존 mock AI E2E 환경에서 다음 항목을 확인했다. 서비스 기존 시나리오 4개와 새 랜딩 시나리오 6개가 통과했다. 서버 기능의 품질을 mock AI 결과로 주장하지 않는다.

- `/`는 API 요청을 차단한 상태에서도 표시된다. 랜딩에서 서비스 API 요청·서비스 WebSocket 연결이 발생하지 않는다.
- `말모아 시작하기`는 `/study`로 연결된다. 미가입자는 가입 화면을, 기존 세션은 해당 사용자의 스터디 화면을 본다.
- 기존 가입·초대·경험 저장·공유 상태·음성 검토·학습 기록 시나리오가 유지된다.
- 390px 모바일에서 모든 섹션에 가로 넘침이 없다.
- 동작 줄이기 설정에서는 6개 영상 모두 자동재생하지 않는다.
- 동작 줄이기 상태에서도 사용자가 재생 → 정지 → 재생할 수 있다.
- 네이티브 영상 제어로 정지한 뒤 화면 밖으로 나갔다 돌아와도 정지 상태를 유지한다.

테스트: [landing.spec.ts](../../tests/e2e/landing.spec.ts). 로그는 `.local/landing-test-e2e.log`, `.local/landing-test-media-controls.log`에 있다.

## 실제 미디어와 화면

실제 브라우저에서 모든 영상의 HTTP 응답, 디코딩된 1600×900 규격, 유효한 길이와 재생 시간 증가를 확인했다. 6개 MP4·JPG·VTT의 로딩 실패와 페이지 JavaScript 오류는 없었다. 추가 OpenAI Decisions 흐름도 390px에서 넘침 없이 표시된다.

- [데스크톱 상단](previews/desktop.png)
- [모바일 상단](previews/mobile.png)
- [승인 표현 → 다음 이미지 주제](previews/learning-loop.png)
- [OpenAI Decisions와 STT 기술 소개](previews/technology.png)

영상별 원본 근거·코덱·길이·전체 디코딩·자막 검증은 [제작 문서](video-production.md)에 기록했다. 사용된 실제 서비스 화면의 AI 결과는 시연용 live 환경에서 만들었으며, 합성 음성 입력을 사용했다.

## 자연어 기능 조작 시연

실제 live 시연에서는 사이드바에 “현재 주제 대화를 마무리하고 문장별 리뷰를 준비해줘.”를 입력했다. `commandResults.outcome=applied`, 같은 주제의 `talking → review`, 3개 문장·피드백의 `ready` 상태를 확인했다. 이 실제 녹화를 `assistant.mp4`와 상단 소개 영상에 사용했다. 앞의 mock AI 브라우저 회귀 테스트와 별도로 확인한 결과다.

## 빌드

`pnpm --filter @devday/web build`와 웹·도구 TypeScript 검사를 통과했다. 녹화·렌더링 스크립트의 JavaScript 문법 검사와 변경 파일의 whitespace 검사를 통과했다.

공개 랜딩은 별도 코드 경로이며 서비스 코드는 지연 로드된다. 최종 MP4·JPG·VTT 18개가 공개 원본과 빌드 산출물에서 바이트 단위로 일치함을 확인했다. 결과물은 `apps/web/dist`에 생성되며, 이 검증 기록은 AWS 배포 완료를 뜻하지 않는다.
