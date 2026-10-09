# Decisions 기반 발화 묶음 구현 검증

- 날짜: 2026-10-09
- 계획: [decisions-speech-plan.md](../decisions-speech-plan.md)
- 구현 및 자동 검사 완료. 실제 사람의 마이크 발화 품질 평가는 미실행.

## 반영 사항

- 전송 구간과 `SpeechGroup`을 분리했다. 원문은 segment에 유지하고, 보정문은 group에만 저장한다. 그룹 생성·확정·재시도는 revision을 검사하는 트랜잭션이며, 같은 화자·주제의 열린 묶음은 DB unique index로 제한한다.
- 마지막 유효 음성 샘플을 commit에 전달한다. 서버의 단조 시계로 1초 후 분류하고, 마지막 발화 후 10초에 묶음 경계를 확정한다. VAD의 700ms trailing silence는 이 대기 시간에서 차감한다. 분류·원문·보정 응답을 기다리느라 경계를 늦추지 않는다.
- 새 발화가 시작되면 이전 판정과 타이머를 무효화한다. 원문이 모두 준비된 revision에만 분류를 요청하며, 같은 revision을 반복 호출하지 않는다. 그룹 PCM은 최대 60초이며 20초 전송 구간을 안전하게 수용할 수 있는 경계에서 나눈다.
- 서버 전용 Decisions HTTP 어댑터는 choice/confidence를 검증한다. 기본 모델은 `gpt-6-luna`, 요청 제한은 2초, 완료 신뢰도 기준은 0.85다. 오류·거절·잘못된 응답은 uncertain으로 처리한다. 최대 침묵 10초는 환경 변수로 늘릴 수 없다.
- 정상 빈 전사와 실패를 구분한다. 무발화는 보정·피드백을 생략하며, 처리 오류는 `audio.processing_error`로 격리한다. 묶음 재시도는 저장한 오디오에서 수행한다. 미확정 상태로 연결이 끊긴 PCM도 실패로 저장하고 재시도할 수 있다.
- 마이크 사용자 설정과 캡처 상태를 분리했다. 연결 재시도는 1·2·4초 간격으로 진행하며, 동일한 스트림 소유권을 이어받는다. 서버의 저장 확인 전까지 PCM을 제한된 버퍼에 보관하고, segment ID·sequence·해시로 재전송 중복을 검사한다. 서버의 재개 보관 시간은 15초다. 재개가 만료되면 성공으로 간주하지 않고 오류를 표시한다.
- 유휴 provider 연결은 55분에 교체한다. 발화 중이면 안전한 구간 경계까지 기다리며, 새 구간과 연결 교체가 readiness barrier를 공유한다. 완료 PCM은 메모리에서 해제하고, 최근 재전송 확인 정보만 제한적으로 보관한다.
- 새 출처 v2는 원문 segment 범위, 보정 group 범위, 순서 있는 오디오 segment 목록을 구분한다. 기존 기록의 구형 출처는 유지한다. 가상 구분자는 결정적으로 구성하며, 기존 규칙대로 공백을 제외한 모든 문자에 대해 누락·중복·순서 검증을 유지한다.
- 리뷰에서 인증된 원본 오디오 재생을 제공한다. 빈 행은 최근 표시 개수를 적용하기 전에 제거하고, 실패한 발화에는 개별 재시도를 제공한다. 대기 안내와 실제 캡처 상태를 구분한다.
- 진단 로그에는 단계·ID·revision·판정·확정 이유·지연 및 정제한 오류 코드만 기록한다. 발화 전문·PCM·API 키는 포함하지 않는다.

## 자동 검사

| 명령 | 결과 |
| --- | --- |
| `pnpm contracts:check` | 39개 통과 |
| `pnpm typecheck` | 통과 |
| `pnpm test:unit` | 277개 통과 |
| `pnpm test:integration` | 17개 통과 |
| `pnpm test:e2e tests/e2e/review-audio.spec.ts` | 1개 통과. 실제 API/PostgreSQL, mock AI, 두 참여자 원문·리뷰·수정·피드백·승인·오디오 조회 |
| `pnpm test:audio-browser` | 통과. Chromium의 생성 마이크 입력과 minified bundle, 지연된 구간 확인, 다음 주제 재개, 장치 해제 |
| `pnpm build` | 통과. 기존 웹 번들 크기 안내는 남아 있음 |
| `git diff --check` | 통과 |

타이머 테스트는 fake clock을 사용한다. 5분 침묵, 정확한 10초 경계, 9초 후 재개, 진행 중 판정 무효화, 늦은 원문, 역순 원문 완료, 3개 조각의 단일 보정, 빈 전사, 비치명적 보정 실패 후 후속 발화, 중복 PCM 재전송, 미확정 구간의 연결 단절, 60초 PCM 상한을 검사했다.

DB 통합 검사에서는 동시 revision 갱신 중 하나만 성공하는지, terminal 결과를 덮어쓰지 않는지, segment 원문과 group 보정문이 별도로 보존되는지, 잘못된 출처가 거절되는지, 빈 전사가 주제 종료를 막지 않는지 검증했다.

`0002_speech_groups.sql`은 테스트 DB와 로컬 `127.0.0.1/devday_study`에 적용했다. 기존 스터디·전사 데이터를 초기화하지 않았다. 배포 및 서버 재시작은 수행하지 않았다.

## 실제 Decisions API 텍스트 예제

공식 계약 확인: [Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create), [가이드](https://developers.openai.com/api/docs/guides/decisions).

2초 제한시간으로 각 예제를 한 번씩 요청한 결과다. 실제 음성 인식 품질 평가가 아니다.

| 입력 | 결과 | 신뢰도 | 경과시간 |
| --- | --- | --- | --- |
| `I participated in` | uncertain / 제한시간 fallback | 0 | 2,006ms |
| `I participated in a hackathon last weekend.` | complete | 0.93 | 371ms |
| `Yes.` | complete | 0.91 | 240ms |
| `어제 마라톤에 갔어요. I participate in marathon.` | complete | 0.96 | 226ms |

작은 표본이므로 0.85 기준이나 2초 제한시간을 조정하지 않았다. 분류 실패 시에도 10초 fallback을 유지하는 경로는 자동 검사로 검증했다.

## 남은 실제 음성 평가

- 실제 마이크로 5분 무발화 후 재개, 작은 목소리, 키보드 소음, 1·3·9초 멈춤, 한국어·영어 혼용을 평가하지 않았다. 생성한 톤을 사용한 브라우저 검사는 캡처·전송 검증에 해당한다.
- 실제 발화에 대한 조기 분리율·지연 분포·fallback 비율은 추가 측정이 필요하다.
- `I participate in marathon.` 내용 누락 사례는 텍스트 완료 판정 예제에는 포함했지만, 실제 녹음의 보정 전사 회귀 평가는 남아 있다. 음성 기반 보정은 유지한다. 이후 사용자 확인에 따라 원문과 보정문의 언어 구성 비교 및 빈 보정문 검증을 제거했다. 원문 인식 오류 때문에 올바른 보정 결과가 실패 처리되지 않도록 최초 처리와 재시도 모두 모델 출력을 그대로 저장한다. 묶음 처리만으로 모든 전사 품질 문제가 해결됐다고 판단하지 않는다.
