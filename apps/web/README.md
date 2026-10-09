# 말모아 웹

React + Vite + 실제 SEED Design v3로 구현한 라이트 전용 웹 앱입니다. `design/tokens.css`가 제품 색상/서체 원본이며, `src/shared/seed-theme.css`에서 설치된 SEED v3 CSS 토큰을 매핑합니다. 화면 스타일은 CSS Modules, UI/혼용 문장은 Pretendard, 제한된 영문 제목은 Montserrat, 아이콘은 Material Symbols Rounded를 사용합니다.

## 실행

저장소 루트에서 `pnpm dev` 또는 `pnpm dev:lan`을 사용합니다. 웹만 시작하려면 `pnpm --filter @devday/web dev`를 사용합니다. `pnpm --filter @devday/web build`가 타입 검사와 프로덕션 빌드를 수행합니다.

Vite는 루트 `.env.local`의 `WEB_PORT`, `PORT`, `LOCAL_WEB_ORIGIN`, `LOCAL_TLS_CERT`, `LOCAL_TLS_KEY`만 서버 설정에 사용합니다. `dev:lan`과 `preview:lan`은 신뢰된 인증서가 필요합니다. API/이미지/이벤트/음성은 상대 경로의 동일 origin 프록시를 사용하며 OpenAI/DB 설정을 클라이언트에 전달하지 않습니다. 포트 충돌이나 origin 포트 불일치는 실행 오류로 보고합니다.

## 구성

- `src/app/App.tsx`: `/`에서는 공개 랜딩페이지를 표시하고, 서비스 진입 시 `ServiceApp.tsx`를 지연 로드합니다. 랜딩에서는 인증 API·이벤트 WebSocket·마이크 연결을 시작하지 않습니다.
- `src/app/ServiceApp.tsx`: 세션, 전역 초대/이벤트, 서비스 경로. 진입 주소는 `/study`이며 `/study/:studyId`, `/experiences`, `/learning`도 유지합니다. 세션이 없으면 가입 화면을 보여줍니다.
- `src/features/landing`: 서비스 소개·필요성·좌우 교차 기능 영상·핵심 기술. 영상은 `public/media/landing/`에서 제공하며 화면에 보일 때 재생하고, 동작 줄이기 설정에서는 자동재생하지 않습니다. [랜딩과 영상 안내](../../docs/landing/README.md).
- `src/features/auth`, `study`, `chat`: feature hooks가 typed client를 사용하고 화면은 hook 결과를 렌더링합니다. 진행/편집/공유는 서버 응답을 기다립니다.
- `src/shared/audio.tsx`: `@devday/audio-client` 캡처 컨트롤러를 연결합니다. 사용자 클릭으로 권한을 얻고, 종료 이벤트에서 마지막 오디오를 flush합니다. 검토 중 마이크 장치는 유지하지만 음성 전송은 멈춥니다.
- `seed-design/ui`와 `src/shared/ui`: 공식 SEED Action Button, Dialog, Text Field, Accordion, Tabs, Badge, Skeleton/Progress Circle, Snackbar를 제품 토큰에 맞춰 조합합니다.

TanStack queries/mutations는 모두 `retry:false`이며 웹소켓은 자동 재접속하지 않습니다. 실패는 화면에 표시하고 사용자의 새 요청으로 진행합니다. 공유 표현 제안은 개인 조회와 이벤트로만 받으며, 명시적인 proposalId/accepted를 제출한 이후에만 공동 영역에 나타납니다.

## 검증

`src/features/study/model.test.ts`는 오래된 피드백, 이벤트 뒤 늦은 snapshot, terminal job 오류 유지, 개인 job 비노출을 확인합니다. 브라우저 통합은 저장소의 `tests/e2e`에서 실제 API/DB와 표시된 mock AI로 수행합니다. 실제 OpenAI·물리 마이크·두 노트북 확인은 별도 G3 증거이며 자동 UI 검사로 대체하지 않습니다.
