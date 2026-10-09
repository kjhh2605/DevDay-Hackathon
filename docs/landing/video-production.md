# 말모아 랜딩 영상 제작 결과

제작일: 2026-10-09. 현재 구현된 말모아를 Chromium에서 직접 조작해 새로 녹화하고, 녹화 위에 한국어 제목·단계·커서 강조와 카메라 모션을 합성했다. 화면 목업, API 응답 치환, 스크린샷 슬라이드로 서비스 동작을 대체하지 않았다.

## 배포 파일

경로는 `apps/web/public/media/landing/`. 같은 이름의 `.jpg` 포스터와 `.vtt` 한국어 자막을 모두 제공한다. 영상 안에도 한국어 안내가 표시된다.

| 파일 | 길이 | MP4 크기 | 실제 화면에서 보여주는 행동 |
| --- | ---: | ---: | --- |
| `overview.mp4` | 39.2초 | 2,421,793 bytes | 경험 입력·정리 → 공유 이미지 주제와 전사 → 채팅을 통한 주제 마무리 실행 → 문장 검토 → 승인했던 표현을 반영한 다음 이미지 주제 |
| `experience.mp4` | 11.8초 | 344,563 bytes | 경험 입력, 실제 AI 정리 요청, 원문·정리본 확인, 확인하고 저장 |
| `conversation.mp4` | 12초 | 688,417 bytes | TOPIC 02 이미지·대화 안내, 앱 마이크 켜기, 실제 원문·인식 보정 표시 |
| `assistant.mp4` | 12초 | 594,710 bytes | 자연어 명령 입력·전송, 실제 기능 실행 완료, 같은 주제의 문장별 검토 화면 전환 |
| `review.mp4` | 11.8초 | 473,868 bytes | 원문·보정문 비교, 실제 피드백 아코디언 펼치기, 보정문 수정 편집기 열기·취소 |
| `reuse.mp4` | 13초 | 796,804 bytes | 이전 주제의 스터디 피드백 학습 카드 → 그 표현을 사용한 실제 TOPIC 02 이미지와 대화 안내 |

MP4 합계는 **5,320,155 bytes(약 5.32 MB)**. 모두 **1600×900, 16:9, H.264, yuv420p, 30fps, faststart, 무음**이다. 원본 녹화 viewport는 1440×720이며 최종 화면의 `(80, 106)` 위치에 같은 크기로 배치했다. 제목과 캡션은 앱 화면 밖의 여백에 있다. 웹에서는 16:9 비율을 유지해야 바깥 제목이 잘리지 않는다.

## 실제 녹화와 원본

- 녹화 도구: Playwright `browser.newContext({ recordVideo: { size: { width: 1440, height: 720 } } })`. 실제 탭의 키 입력, 버튼 클릭, 스크롤, 펼침 동작을 녹화했다.
- 서비스: `http://127.0.0.1:5185`, 실제 API `127.0.0.1:4215`, live AI 모드. 민지·지훈이라는 발표용 샘플 계정을 재사용했다. 실제 사용자의 계정·대화는 쓰지 않았다.
- 경험: 저장된 부산 여행 샘플을 다시 입력하여 live 경험 정리 결과를 받은 뒤 확인·저장했다. 처리 대기 구간은 편집에서 생략했다. 새 경험과 기존 경험의 입력 내용이 같아 최종 저장 화면에 두 개의 카드가 보인다.
- 음성: 기존 발표용 합성 WAV(24kHz mono, 약 5.88초)에 무음 구간을 붙이고 Chromium의 file microphone으로 제공했다. **실제 앱의 마이크 버튼 → 오디오 클라이언트 → WebSocket → live 전사·보정** 경로를 이용했다. 물리 마이크 녹음이나 사람 간 음성 통화 검증으로 주장하지 않는다. 합성 음성 자체는 완성 영상의 오디오 트랙에 포함하지 않았다.
- 챗봇 기능 조작: TOPIC 03에 샘플 발화를 기록한 뒤, 사이드바에서 **“현재 주제 대화를 마무리하고 문장별 리뷰를 준비해줘.”**를 실제 입력·전송했다. 실제 `commandResults.outcome=applied`와 같은 주제의 `talking → review`, 3문장·피드백 3개 `ready`를 확인한 뒤 완료 배지와 검토 화면을 녹화했다. 주제 종료 버튼은 이 실행에 사용하지 않았다. 모델 답변의 내부 작업 UUID 두 줄만 후반 편집으로 흐림 처리했고, 답변 내용·실행 상태·제품 화면을 성공처럼 치환하지 않았다. 기능 조작 원본은 `.local/landing/command.json`, 실행 증거는 `.local/landing/command-evidence.json`에 있다.
- 별도 `assistant`라는 원본 파일은 기존 표현 저장·공유 결과 화면의 녹화다. 최종 `assistant.mp4`는 새 `command` 원본을 사용한다. 기존 원본은 필수 재사용 사례의 TOPIC 02 이미지·안내 화면 부분에만 계속 사용한다.
- 검토: 새로 녹음한 현재 주제를 실제 `주제 종료` 버튼으로 마감해 문장 피드백을 생성했다. 편집기를 열었지만 이 영상의 수정 동작은 취소로 끝난다. 저장 성공으로 설명하지 않는다.
- 원본은 `.local/landing/raw/`, 타임 마커·클릭 좌표는 `.local/landing/{experience,conversation,assistant,command,review,learning}.json`에 있다. 세션 쿠키 파일은 기존 `.local/presentation/a.json`을 읽기만 했으며 공개 정적 에셋에 넣지 않았다.

원본 WebM의 무결성 값:

| 원본 단계 / UTC 녹화 시작 | SHA-256 |
| --- | --- |
| experience / 06:55:49 | `12b369ce793358ddaae8a33de2dc78a51c73bef549e1ac925cdd1a1a330387f4` |
| conversation / 06:56:40 | `cbbcffd6ace2f3ed8f3940100e71fb6169189174fd2276af248f94ea1ca4850f` |
| assistant / 06:55:54 | `7005ed9e23120351970d4dc19d5eefadc2540d20f233cadf2a919b2724110f55` |
| review / 06:57:20 | `7db23b650202fd808bf105a39cb47d8fbffc35879f65514605e4352c849761f0` |
| command / 07:10:03 | `274f1205a737885b3f6f9d2f35b077f30768976b296fbc664cb8d75b0597aa6c` |
| learning / 06:57:52 | `9fdbfee9c4068b4df8ad3357d1602ef5b088b00433e57de41c54b7c907f8ce94` |

## 필수 사례: 승인한 표현 → 다음 이미지 주제

`reuse.mp4`와 `overview.mp4`의 마지막 단계는 **첫 번째 주제에서 승인한 표현이 두 번째 이미지 주제에 반영된 실제 성공 사례**다. 전후 화면의 촬영 순서를 재구성했지만, 아래 저장 데이터로 같은 표현의 연결을 검증했다. 두 번째 주제에서 세 번째 주제로 넘어간 장면을 이 사례에 섞지 않았다.

| 연결 지점 | 검증된 값 |
| --- | --- |
| 학습 표현 | **We’re planning a trip to Busan.** |
| 의미 | 우리는 부산 여행을 계획하고 있어요. |
| 학습 출처 | `approved_feedback` |
| 학습 항목 ID | `4d294a2f-c918-4044-902b-4a037108db4b` |
| 원래 주제 ID | `2d191a40-2112-457f-b276-e64b38990cd5` (첫 번째 주제) |
| 원래 발화 ID | `50159506-efd6-4ca9-90e5-781e2ac16a3e` |
| 저장 시각 | `2026-10-09T06:43:02.409Z` |
| 다음 주제 ID | `92e4d587-1642-42bf-9ae4-0a665342e1ca`, ordinal 2 |
| 다음 주제 입력 | DB `topics.generation_input.learningExpressions`에 동일 ID·표현·`approved_feedback` 포함 |
| 생성 결과 | `kind: image`, 제목 **A Weekend in Busan**, `learningExpressionIds`에 동일 ID 포함 |
| 실제 생성 이미지 | `imageMediaId: 840ae1d5-54e4-4a8b-abf7-a0ff2729ebcd` |
| 생성 작업 ID | `fdb2c4f4-be00-411d-8814-5e920990d40a` |
| 실제 화면의 대화 안내 | `Use “I like taking travel photos” and “We’re planning a trip to Busan” to talk about travel photos and future travel plans.` |

기존 증거는 [학습 결과](../presentation/evidence/learning-result.json), [다음 주제 결과](../presentation/evidence/next-result.json), [실제 다음 주제 화면 텍스트](../presentation/evidence/14-next-topic.txt)에 보관돼 있다. 이번 제작에서 기존 DB를 읽기 전용으로 다시 조회하여 `generation_input`에도 같은 항목이 있음을 확인했으며, 조회 결과는 `.local/landing/approved-reuse-provenance.json`에 보관했다.

제품은 `topic.advance`에서 피드백을 승인해 저장하고, 같은 트랜잭션에서 직전 주제의 승인된 학습 표현을 다음 생성 입력에 넣는다. 그 후 모델이 경험과 연결되는 표현을 선택해 이미지 주제를 만든다. 관련 구현은 [commands.ts](../../apps/api/src/domain/commands.ts), [prompts.ts](../../packages/ai/src/prompts.ts), [jobs.ts](../../packages/ai/src/jobs.ts)에 있다.

이 사례의 이미지 생성 API에 전달한 **정확한 `imagePrompt` 문자열은 당시 저장하지 않았다**. `jobs.ts`는 이를 이미지 생성에 사용한 뒤 공개 주제 데이터에서 제거한다. 따라서 확인 가능한 주장은 “승인한 표현이 다음 이미지 주제의 입력과 선택 결과에 포함됐고, 실제 생성 이미지의 대화 안내에 반영됐다”이다. 모든 학습 표현이 선택되거나 표현 문장이 이미지 픽셀·이미지 프롬프트에 그대로 들어간다고 주장하지 않는다.

촬영 중 새로 시험한 **두 번째→세 번째 주제**는 `learningExpressionIds: []`로, 개인 챗봇에서 공유한 표현만 선택했다. 이 실험의 승인 버튼·생성 결과는 **승인 표현 재사용 사례에서 제외했다**. TOPIC 03 화면은 이후 별도로 촬영한 채팅 기능 조작의 현재 상태로만 등장한다. 그 화면을 승인 표현이 재사용된 성공 사례로 설명하지 않는다. 기록은 `.local/landing/reuse-evidence.json` 및 `.local/landing-audit/topic-generation.jsonl`에 남겨 성공 사례와 구분했다.

`reuse.mp4`의 구체적인 편집은 다음과 같다.

- 0–5.2초: 실제 개인 학습 기록과 `스터디 피드백` 필터 클릭. “이전 주제에서 저장한 표현: ‘We’re planning a trip to Busan.’”을 표시한다.
- 5.2–8.4초: 실제 TOPIC 02 이미지 화면 녹화로 전환한다.
- 8.4–13초: 같은 TOPIC 02의 이미지와 대화 안내를 확대해 읽게 한다. “그 표현이 반영된 다음 이미지 주제”로 캡션을 바꾼다.
- overview에서는 31.2–34.2초에 학습 카드, 34.2–39.2초에 다음 이미지·대화 안내가 나온다.

## 참고 모션 적용

[Career Hacker Alex — 따라 만드는 모션그래픽 160](https://www.careerhackeralex.com/sharings/cha-motion-kit)의 실제 예제 MP4·프롬프트·HTML 타임라인을 검토했다. 전체 검토·출처·라이선스는 [motion-reference.md](motion-reference.md)에 있다.

최종 편집에는 다음 두 예제의 **동작 방식**을 실제 말모아 녹화에 맞춰 새로 구현했다. 원본 예제의 가상 제품 화면·카피·브랜딩을 사용하지 않았다.

| 참고 예제 | 최종 적용 |
| --- | --- |
| `record-camera-tour` | 전체 화면 → 관심 영역 확대 → 입력/결과 위치로 팬 → 전체 복귀. assistant에서는 오른쪽 명령 입력·실행 완료에서 왼쪽 문장 검토로, reuse에서는 학습 카드에서 다음 이미지·대화 안내로 이동한다. |
| `record-punch-hold-return` | 결과가 보인 시점의 짧은 punch-in, 읽기용 hold, 부드러운 복귀. experience의 원문·정리본, review의 피드백 표현을 강조한다. |

소스의 `power3.out = 1 − (1 − p)^4`, `power3.inOut = p < .5 ? 8p^4 : 1 − 8(1 − p)^4`를 FFmpeg의 결정적인 식으로 옮겼다. 녹화 화면은 확대 중에도 계속 재생된다. 화면별 좌표·구간은 `render.mjs`의 `camera()`에 명시했다. 원본의 7.4초 타임라인을 각 8–13초 편집에 맞춰 조절했다. GSAP 런타임은 완성 영상에 배포하지 않는다.

추가로 실제 클릭 마커의 좌표에 커서·보라색 강조를 합성하고, 상단 01–05 번호와 누적 단계 표시를 넣었다. 제목은 0.35초에 걸쳐 투명도만 변하며 위치는 고정이다. 하단 한국어 캡션은 앱 영역을 가리지 않는다. 폰트는 참고 소스에 포함된 OFL Pretendard를 로컬에서 래스터화했으며, 저작권·OFL 고지는 [참고 자료](reference/selected-source/THIRD-PARTY-NOTICES.md)에 보존했다.

## 재현

관련 스크립트:

- [capture.mjs](../../scripts/landing/capture.mjs): 실제 UI 조작·Playwright video 녹화·타임 마커 기록.
- [render.mjs](../../scripts/landing/render.mjs): 컷 편집·카메라 곡선·커서·한국어 그래픽 합성, MP4/JPG/VTT 생성.
- [verify.mjs](../../scripts/landing/verify.mjs): 코덱·규격·길이·faststart·전체 디코딩·자막 구간 검증 및 QA 프레임 추출.

이미 보관된 원본으로 완성본을 다시 만드는 명령:

```sh
pnpm exec node scripts/landing/render.mjs
pnpm exec node scripts/landing/verify.mjs
```

특정 파일만 렌더링할 수 있다.

```sh
pnpm exec node scripts/landing/render.mjs reuse overview
```

필수 입력은 `.local/landing`의 원본·마커 JSON과 참고 ZIP이다. FFmpeg/ffprobe 기본 경로는 `/opt/homebrew/bin/`; 다른 환경에서는 `FFMPEG`, `FFPROBE` 환경 변수를 지정한다. 폰트는 `docs/landing/reference/immersive-61-source.zip`에서 `.local/landing/graphics`로 추출한다. 인코딩은 순차 실행하고 필터 스레드를 2로 제한한다.

새 녹화는 준비된 **시연 전용 live 세션**에서 수행한다. API 상태를 앞으로 진행시키므로 과거 원본을 다시 만들기 위해 운영 계정이나 이미 끝난 스터디를 사용하지 않는다. 재촬영 시에는 대상 계정·현재 주제를 확인하고 `LANDING_ORIGIN`, `LANDING_SESSION`, `LANDING_STATE`로 경로를 지정할 수 있다. 기본 상태 파일의 `studyId`, `experienceInput`을 사용한다. 다음 명령은 각 단계의 실제 상태가 준비된 경우에만 실행한다.

```sh
pnpm exec node scripts/landing/capture.mjs experience
pnpm exec node scripts/landing/capture.mjs assistant
pnpm exec node scripts/landing/capture.mjs conversation
pnpm exec node scripts/landing/capture.mjs review
pnpm exec node scripts/landing/capture.mjs learning
```

`capture.mjs command`는 대화 중인 주제에 샘플 발화를 기록하고 실제 자연어 마무리 명령을 실행한다. 이미 검토 중인 주제에서는 실행하지 않는다. 녹화 후 `render.mjs assistant overview`로 기능 조작 영상만 갱신할 수 있다.

`capture.mjs reuse`는 검토 중인 주제를 실제 승인해 다음 주제를 만드는 **추가 실험**이다. 결과가 필수 사례를 충족하는지는 저장된 `learningExpressionIds`와 출처를 별도로 검증해야 한다. 최종 `render.mjs`는 이 실험 녹화를 사용하지 않는다. 승인 표현 재사용의 성공 사례는 위에서 검증한 learning/conversation/assistant 녹화를 연결한다.

## 검수

2026-10-09 검수 결과, 6개 전체 디코딩 오류가 없고 요구한 규격·길이·faststart 조건을 통과했다. 각 영상 10%·50%·90% 프레임과 최종 포스터를 확인했다. 제목의 실제 픽셀은 위에서 약 33px 아래에 있으며, 하단 캡션은 영상 경계 안에 있다. 원문·보정문, 채팅 명령·완료 배지·검토 화면, 학습 카드의 부산 표현, 다음 이미지의 대화 안내가 실제로 표시되는 프레임을 검토했다. 내부 작업 UUID는 영상에서 읽히지 않도록 두 줄의 코드 영역만 흐림 처리했다. VTT 구간은 서로 겹치지 않고 영상 길이를 넘지 않는다.

검증 JSON은 `.local/landing/qa/verification.json`, 검수 프레임은 같은 디렉터리에 있다. 원본·개인 세션·중간 PNG·편집 필터 파일은 `.local`에 두고, 사이트에는 완성 MP4/JPG/VTT만 배포한다.
