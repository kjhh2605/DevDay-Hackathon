# 말모아 랜딩 영상 — 모션 참고 검토

검토일: 2026-10-09. 원본 MP4 5개, 해당 프롬프트, HTML 타임라인, 메타데이터와 배포 안내를 내려받아 확인했다. 각 MP4의 1초 간격 콘택트시트를 실제로 열어 장면 흐름을 검토했다. 이 문서는 **참고 기법과 편집 제안**이며 말모아 영상의 최종 제작 결과는 별도 제작 문서에 기록한다.

## 자료와 사용 범위

- 공식 페이지: [Career Hacker Alex — 따라 만드는 모션그래픽 160](https://www.careerhackeralex.com/sharings/cha-motion-kit). 현재 페이지는 160개, 2026-10-03 업데이트로 표시된다. 검색 인덱스에 남아 있는 “72”는 이전 표시다.
- [편집 소스 ZIP](https://www.careerhackeralex.com/sharings/cha-motion-kit/downloads/immersive-61-source.zip)은 [reference/immersive-61-source.zip](reference/immersive-61-source.zip)에 원본 그대로 보관했다. 전체 61개 소스와 렌더러·폰트·런타임을 포함한다.
- 선택 예제의 HTML·프롬프트·메타데이터는 [reference/selected-source/scripts/motion-kit/pieces/](reference/selected-source/scripts/motion-kit/pieces/)에 추출했다. 이 추출본은 검토용이다. 실행에 필요한 전체 런타임은 ZIP에 있다.
- 페이지 하단의 사용 안내는 “영상과 프롬프트는 개인 학습·제작에 자유롭게 쓰세요”이다. 원본 자료 저작권은 Career Hacker Alex에게 있으며, ZIP은 원본 자료를 별도 오픈소스 라이선스로 재허가하지 않는다. 본 작업은 허용된 제작 목적에 맞게 기법을 참고하고 말모아의 화면·문구·색으로 다시 구성한다.
- 샘플 화면은 설명용 재연이다. **말모아 완성 영상에는 직접 녹화한 말모아 화면을 사용한다.** 참고 MP4의 가상 제품 화면·알렉스 브랜딩을 말모아 동작으로 사용하지 않는다.
- 원본에 든 Pretendard·Geist는 SIL OFL 1.1, GSAP 3.14.2는 별도 Standard License다. [배포 안내](reference/selected-source/READ-ME.md), [제삼자 고지](reference/selected-source/THIRD-PARTY-NOTICES.md), [라이선스 원문](reference/selected-source/licenses/)을 보존했다. FFmpeg로 자체 합성한 영상에는 원본 GSAP 런타임을 배포할 필요가 없다.
- 참고 자료는 `docs/landing/reference/`에 보관하며 앱의 공개 정적 에셋으로 사용하지 않는다. 효과음은 원본에 포함되지 않았고 모든 예제는 무음이다.

## 선택 예제와 관찰

| 예제 | 실제 MP4 / 검토 이미지 | 확인한 움직임 | 말모아 적용 |
| --- | --- | --- | --- |
| 녹화 화면을 따라 세 곳으로 | [원본](https://www.careerhackeralex.com/sharings/cha-motion-kit/record-camera-tour.mp4) · [콘택트시트](reference/record-camera-tour-contact-sheet.jpg) | 하나의 녹화가 계속 재생되는 동안 입력→실행→결과를 차례로 확대하고 전체 화면으로 복귀한다. | 히어로에서 경험 입력, 공유 주제, 학습 결과를 연결하는 카메라 동작. |
| 중요한 순간만 가까이 | [원본](https://www.careerhackeralex.com/sharings/cha-motion-kit/record-punch-hold-return.mp4) · [콘택트시트](reference/record-punch-hold-return-contact-sheet.jpg) | 짧게 확대하고 결과를 읽도록 유지한 뒤 전체로 돌아온다. 라벨은 주목 구간에만 나타난다. | 경험 정리 결과·이미지 주제·저장 완료를 강조하는 주력 기법. |
| 전체 맥락과 디테일을 동시에 | [원본](https://www.careerhackeralex.com/sharings/cha-motion-kit/record-linked-loupe.mp4) · [콘택트시트](reference/record-linked-loupe-contact-sheet.jpg) | 전체 화면과 같은 재생 시점의 확대 창을 연결선으로 묶는다. | 스터디 중 개인 챗봇 또는 원문·보정문 중 하나를 확대할 때 후보. 복잡한 UI를 가리면 사용하지 않는다. |
| 먼저 짚고 재생하기 | [원본](https://www.careerhackeralex.com/sharings/cha-motion-kit/record-detail-freeze-callout.mp4) · [콘택트시트](reference/record-detail-freeze-callout-contact-sheet.jpg) | 첫 프레임을 2초 유지하면서 대상 영역을 표시한 다음 녹화를 처음부터 재생한다. | 피드백 승인→나의 학습의 인과관계를 설명할 때 유용하다. 원본 행동 속도를 설명 없는 정지 화면으로 오해하지 않게 적용한다. |
| 말소리를 읽을 수 있는 문장으로 | [원본](https://www.careerhackeralex.com/sharings/cha-motion-kit/create-audio-wave-to-captions.mp4) · [콘택트시트](reference/create-audio-wave-to-captions-contact-sheet.jpg) | 파형 구간이 줄어들며 단어가 나타나고 완성된 문장 아래에 선이 그어진다. | 실시간 전사 화면 위의 짧은 자막 등장·밑줄 기법만 참고한다. 예제 파형을 말모아 음성 분석 결과로 대체하지 않는다. |

모든 `record-*` 선택 예제는 1080×830, 30fps, 7.4초 H.264다. 파형 예제는 같은 크기·프레임 속도의 6.8초 영상이다. 상세 파일 규격·SHA-256·원본 URL은 [provenance.json](reference/provenance.json)에 기록했다.

## 소스에서 확인한 타이밍

시간은 원본 예제 시작점 기준이며, 최종 편집에서는 **실제 결과가 화면에 나타나는 시점**에 맞춰 이동한다. 원본의 강조색은 말모아의 브랜드색으로 치환한다. 화면 좌표는 편집자가 지정하며 자동 커서 추적으로 표현하지 않는다.

### Camera tour

소스: [record-camera-tour/index.html](reference/selected-source/scripts/motion-kit/pieces/record-camera-tour/index.html)

| 시간 | 소스 카메라 |
| --- | --- |
| 0.70–1.35초 | 정규화 좌표 `(0.40, 0.242)`로 1.55배 확대 |
| 2.60–3.30초 | `(0.90, 0.242)`로 팬 |
| 4.15–4.90초 | `(0.57, 0.54)`로 팬 |
| 6.05–6.85초 | 위치·배율을 원본 전체 화면으로 복귀 |

네 이동 모두 `power3.inOut`. 이동 종료 후 녹화는 계속 재생된다. 0.40–0.80초에 단계 라벨이 15px 아래에서 나타난다. 소스 좌표는 샘플 제품에 맞춰졌으므로 말모아에는 그대로 쓰지 않는다.

### Punch / hold / return

소스: [record-punch-hold-return/index.html](reference/selected-source/scripts/motion-kit/pieces/record-punch-hold-return/index.html)

| 시간 | 소스 동작 |
| --- | --- |
| 1.30–1.54초 | `(0.57, 0.54)`를 중심으로 1.7배, `power3.out` |
| 1.60–1.95초 | 주목 라벨 등장, 불투명도 0→1·세로 이동 12→0px |
| 1.95–5.35초 | 결과 읽기 구간. **화면 확대를 유지하며 녹화는 계속 재생** |
| 5.35–5.60초 | 라벨 퇴장 |
| 5.80–6.60초 | 전체 화면으로 복귀, `power3.inOut` |

원본의 1.7배는 긴 한글 피드백을 잘라낼 수 있다. 말모아에서는 1.10–1.25배를 우선 사용하고, 더 큰 확대가 필요하면 전체 문장과 버튼이 프레임에 남는지 검토한다.

### 기타 확인값

- Loupe: 1.20–1.80초에 확대 창이 scale 0.8→1, opacity 0→1, y25→0으로 등장한다(`power3.out`). 연결선은 1.60–1.90초 등장. 두 영상의 소스 시간은 동일하다.
- Freeze callout: 실제 첫 프레임 포스터를 0–2.00초 표시. 강조 테두리는 0.25–0.65초 등장하고 1.75–2.00초 사라진다. 그 뒤 소스 0초부터 녹화가 시작한다.
- 파형/자막: 0.60–3.05초 재생선 이동. 1.35초부터 0.75초 간격으로 단어가 0.55초 동안 등장. 3.75–4.55초 문장을 위로 정리하고 4.10–4.85초 밑줄을 펼친다.

## 말모아용 편집 제안

다음은 참고 예제의 기법을 적용한 말모아 전용 구성이다. 원본 예제의 화면·광고 문구를 그대로 사용하지 않는다. 각 구간은 녹화된 실제 동작을 기준으로 길이를 조정한다.

| 출력 | 타임라인 제안 | 오버레이 문구 |
| --- | --- | --- |
| 상단 소개, 약 38초 | 0–2초 서비스명·전체 화면 → 2–8초 경험 입력·정리 → 8–15초 공유 주제·대화 화면 → 15–22초 챗봇의 자연어 기능 조작 → 22–29초 피드백 검토·저장 → 29–35초 승인한 표현이 반영된 다음 이미지 주제 → 35–38초 전체 화면·엔드카드. 각 결과에서 작은 punch-in 후 읽기 시간을 확보한다. | “우리의 경험으로 시작해” → “함께 영어로 이야기하고” → “말로 스터디를 조작하고” → “내가 말한 영어를 배움으로” → “배운 표현은 다음 대화로” |
| 나의 경험, 10–12초 | 전체 화면 1초 → 실제 입력 3초 → 결과가 생기면 0.3초 확대 → 원문·정리본 확인 3초 → 저장·전체 복귀 2초. | “내 경험이 다음 대화의 소재가 됩니다” |
| 공유 주제, 9–11초 | 주제 생성 결과 전체 1.5초 → 이미지와 상황 설명 순서로 짧은 팬 → 대화 안내 3초 → 전체 복귀. | “모두의 경험에서, 함께 나눌 주제로” |
| 챗봇 기능 조작, 10–12초 | 스터디 전체 맥락 1초 → 사이드바에 주제 종료 요청 입력 → 요청과 실행 결과로 팬 → 실제 주제가 닫히고 문장별 검토로 전환되는 화면을 유지. | “채팅 한마디로, 스터디를 이어가세요” |
| 피드백·나의 학습, 12–14초 | 원문과 피드백 2초 → 수정·검토 3초 → 승인 버튼 실제 동작 → 나의 학습 이동 → 저장된 기록 3초 유지. | “검토하고 승인한 표현이 나의 학습에 쌓입니다” |
| 다음 이미지 주제, 12–14초 | 이전 주제 피드백에서 승인·저장한 부산 여행 표현을 보여 주기 → 해당 표현이 반영된 실제 TOPIC 02 녹화로 전환 → TOPIC 02의 이미지·대화 안내 4초 → 같은 표현에 0.3초 punch-in 후 2초 유지. 저장된 학습 표현을 앞 장면에서 같은 문구로 연결한다. | “We’re planning a trip to Busan.” → “승인한 표현을 다음 이미지 주제에서 다시 연습해요” |

총 6개 출력(상단 소개 1개·기능 5개)을 제안한다. 다음 주제 장면의 실제 성공 근거는 [학습 기록](../presentation/evidence/learning-result.json)의 `approved_feedback` 표현 “We’re planning a trip to Busan.”과 [다음 주제 결과](../presentation/evidence/next-result.json)의 같은 `learningExpressionIds` 및 대화 안내다. 해당 출력은 `kind: image`, TOPIC 02 “A Weekend in Busan”이며 [실제 화면 텍스트](../presentation/evidence/14-next-topic.txt)에서도 이 표현을 확인했다. 2026-10-09에 presentation DB의 저장된 생성 입력도 읽기 전용으로 확인했으며 같은 승인 표현이 전달되어 있었다. 이 장면은 **선택된 표현을 다음 이미지 주제에서 다시 연습하는 흐름**을 보여 준다. 모든 승인 표현을 매번 선택하거나 표현 원문을 이미지 자체에 글자로 넣는다는 의미로 설명하지 않는다.

동시에 움직이는 강조는 한 곳으로 제한한다. 주요 결과는 최소 1.5초 이상 읽게 두고, 라벨은 앱의 버튼·문장을 가리지 않는 바깥 여백에 배치한다. 무음 자동 재생에서도 흐름이 이해되도록 짧은 한글 자막을 사용한다. 마이크·AI 처리·전사 정확도·소요 시간은 화면에 실제로 확인된 범위로 설명한다.

## FFmpeg 구현에 전달한 이징과 좌표

원본 HTML이 지정한 `power3`는 GSAP의 quartic 곡선이다. 정규화 시간 `p = clamp((t-start)/duration, 0, 1)`을 사용한다.

```text
power3.out(p)   = 1 - (1 - p)^4
power3.inOut(p) = p < 0.5 ? 8*p^4 : 1 - 8*(1-p)^4
value(p)       = startValue + (endValue-startValue)*ease(p)
```

원본 viewport는 972×570이고, 녹화는 `contain`으로 맞춘다. 실제 소스 종횡비로 맞춘 사각형을 `F=(x,y,w,h)`, 중심 타깃을 `(u,v)`, 배율을 `s`라 하면 카메라 이동은 `x=486-(F.x+u*F.w)*s`, `y=285-(F.y+v*F.h)*s`다. Camera tour는 프레임 바깥 빈 영역이 보이지 않도록 추가로 좌표를 제한한다. 이 계산은 최종 16:9 영상의 viewport 중심과 크기로 치환해야 한다.

원본에는 `IMM.life(tl)`이 추가하는 작은 카메라 움직임도 있으므로 위 타이밍은 작품의 주 타임라인이다. 말모아에서는 FFmpeg의 결정적인 프레임 식으로 이 주 동작을 새로 구성한다.
