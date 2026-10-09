# 말모아 서비스 랜딩페이지와 소개 영상

## 접속과 구성

- `/`: 로그인 없이 열리는 랜딩페이지. 소개 영상·시작 버튼 → 사용 이유 → 기능별 영상·설명 → 핵심 기술 순서다.
- `/study`: 기존 서비스 진입. 세션이 없으면 이름·아이디 가입 화면을 표시한다.
- `/study/:studyId`, `/experiences`, `/learning`: 기존 주소를 유지한다.

`apps/web/src/app/App.tsx`는 공개 랜딩을 먼저 표시하고 서비스 화면만 지연 로드한다. 공개 페이지에서는 사용자 조회 API, 서비스 이벤트 WebSocket, 마이크를 연결하지 않는다. CloudFront의 기존 SPA rewrite에도 위 경로가 있어 인프라 경로 변경은 필요하지 않다.

```sh
# 저장소 루트에서 기존 서비스와 함께 실행
pnpm dev

# 웹만 실행해도 랜딩페이지는 API 없이 표시된다.
pnpm --filter @devday/web dev

# 타입 검사와 배포용 정적 파일 생성
pnpm --filter @devday/web build
```

실제 웹 주소는 `.env.local`과 Vite 로그를 따른다. 새 환경 기본값은 `http://localhost:5173/`다. 서비스 기능은 기존 API·DB 설정이 필요하다.

## 페이지와 영상

페이지 구현은 [LandingPage.tsx](../../apps/web/src/features/landing/LandingPage.tsx), 반응형 스타일은 [LandingPage.module.css](../../apps/web/src/features/landing/LandingPage.module.css), 영상 제어는 [ScreenVideo.tsx](../../apps/web/src/features/landing/ScreenVideo.tsx)다.

| 공개 파일 | 내용 |
| --- | --- |
| [overview.mp4](../../apps/web/public/media/landing/overview.mp4) | 경험 → 대화 → 챗봇 기능 조작 → 피드백·학습 → 배운 표현의 다음 이미지 주제 활용 |
| [experience.mp4](../../apps/web/public/media/landing/experience.mp4) | 실제 경험 입력·정리·저장 |
| [conversation.mp4](../../apps/web/public/media/landing/conversation.mp4) | 공통 이미지 주제·발화자별 원문과 인식 보정 |
| [assistant.mp4](../../apps/web/public/media/landing/assistant.mp4) | 사이드바 챗봇의 자연어 요청 → 실제 주제 종료·검토 시작 |
| [review.mp4](../../apps/web/public/media/landing/review.mp4) | 문장별 피드백 검토와 학습 기록 |
| [reuse.mp4](../../apps/web/public/media/landing/reuse.mp4) | 이전 피드백에서 저장한 표현이 다음 이미지 주제에 반영된 실제 예시 |

각 영상은 같은 파일명의 `.jpg` 포스터와 `.vtt` 한국어 자막을 함께 제공한다. 공개 에셋은 `apps/web/public/media/landing/`에 있으며 Vite 빌드 시 `dist/media/landing/`에 복사된다. 외부 동영상 호스팅에 의존하지 않는다.

영상은 화면에 보일 때 무음으로 반복 재생되며 화면 밖이나 숨겨진 탭에서는 멈춘다. 사용자가 일시정지한 상태는 유지한다. `prefers-reduced-motion: reduce`에서는 자동재생을 하지 않고 사용자가 직접 재생할 수 있다. 네이티브 컨트롤로 탐색·전체화면·자막 선택이 가능하다.

## 반드시 포함한 학습 순환 예시

실제 시연 계정의 첫 번째 주제 피드백에서 **“We’re planning a trip to Busan.”**을 승인해 개인 학습으로 저장했다. 이 항목은 다음 TOPIC 02의 생성 입력, `learningExpressionIds`, 대화 안내에 연결되며 해당 주제는 실제 생성 이미지가 있는 `kind: image`다. 다섯 번째 기능과 상단 소개 영상에서 저장된 표현과 다음 이미지 주제를 이어 보여준다.

구현은 **직전 주제에서 승인한 피드백**을 다음 주제 맥락에 전달한다. 모든 과거 학습 항목이나 모든 표현을 매번 이미지에 포함한다고 약속하지 않는다. AI가 이미지·문장 주제 유형과 사용할 표현을 선택한다. 원문 음성 인식 보정과 영어 학습 피드백도 구분한다.

## OpenAI Decisions와 STT

핵심 기술 섹션은 `Realtime STT → OpenAI Decisions → 원본 음성 재전사 → 문장별 학습 피드백`을 별도 흐름으로 설명한다. Decisions API의 모델은 전사 내용, 대화 맥락, 침묵 시간을 입력받아 `complete`, `continue`, `uncertain` 중 하나와 신뢰도를 반환한다. 발화가 재개되면 이전 완료 판단을 무효화하고, 완료 신뢰도 기준 또는 최대 침묵 시간에 따라 발화 묶음을 확정한다. 문법 교정 모델로 소개하지 않는다.

구현 근거는 [`speech-boundary.ts`](../../packages/ai/src/speech-boundary.ts), [`provider.ts`](../../packages/ai/src/provider.ts), [`prompts.ts`](../../packages/ai/src/prompts.ts)다. 사이드바 챗봇은 요청 의도와 현재 가능한 동작을 판별한 뒤 [`chat.ts`](../../packages/ai/src/chat.ts)의 제품 도구를 실행한다. 기능 소개 영상은 실제 자연어 요청에 따른 주제 종료·검토 화면 전환을 보여준다.

## 제작과 근거

- [모션 참고 자료 검토](motion-reference.md): Career Hacker Alex의 실제 MP4·프롬프트·편집 소스 검토 및 적용 타이밍.
- [영상 제작·재현 안내](video-production.md): 실제 녹화 출처, 편집 스크립트, 영상별 규격, 학습 표현 연결 증거.
- [브라우저 회귀 테스트](../../tests/e2e/landing.spec.ts): API 독립성, 신규·기존 사용자 진입, 모바일 레이아웃, 동작 줄이기.

시연용 계정과 실제 서비스를 사용했다. 음성 입력은 합성 음성을 사용한 브라우저 시연이며 물리 마이크 수용 검사를 뜻하지 않는다. 쿠키·서버 키·원본 녹화 등 로컬 시연 파일은 `.local/` 아래에 두고 공개 에셋에 포함하지 않는다.
