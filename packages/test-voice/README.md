# 테스트 음성 생성·재생 (macOS)

영어 스터디 서비스의 마이크를 사람이 말하지 않고 테스트하는 독립 패키지입니다. **모든 샘플은 OpenAI가 만든 합성 음성**입니다. 서비스 코드를 변경하지 않습니다. Node 24와 macOS 기본 `afplay`만 사용하며 런타임 npm 의존성은 없습니다.

```text
OpenAI TTS → .wav 파일 → 별도 CLI/afplay → macOS 출력 BlackHole 2ch
  → 브라우저 마이크 입력 BlackHole 2ch → 기존 getUserMedia/AudioWorklet
  → 모노 합성·24 kHz 리샘플링 → PCM16 Base64 → 기존 서비스
```

WAV는 저장·재생용입니다. WAV 헤더를 서비스 PCM 청크에 보내거나 서비스의 마이크 처리를 우회하지 않습니다.

## 1. 음성 생성

저장소 루트에서 실행합니다. 루트 `.env.local`의 `OPENAI_API_KEY`를 자동으로 읽으며 같은 이름의 셸 환경변수가 우선합니다. 키를 소스 코드·브라우저·생성 메타데이터에 넣지 않습니다.

```sh
pnpm --filter @devday/test-voice list
pnpm --filter @devday/test-voice generate
pnpm --filter @devday/test-voice verify
```

`generate`는 유료 OpenAI API 호출입니다. 기본 모델은 `gpt-4o-mini-tts`, 음색은 `coral`입니다. `response_format: pcm`으로 받은 24 kHz signed 16-bit little-endian 모노 PCM에 WAV 헤더를 붙입니다. MP3를 중간에 사용하거나 다른 샘플레이트의 데이터를 헤더만 바꿔 저장하지 않습니다. [OpenAI TTS 형식 문서](https://developers.openai.com/api/docs/guides/text-to-speech#supported-output-formats)를 기준으로 합니다.

기본 결과는 저장소 **`.local/test-voice/`**에 저장합니다. 각 `.wav` 옆의 `.json`에는 원문, 언어, 목적, 합성 음성 표시, 모델·음색, 생성 시각, SHA-256, 규격·길이·peak·RMS, 단어별 시작·끝 샘플 위치와 무음 길이가 있습니다. `.local/`은 Git 제외 경로이므로 다른 컴퓨터에서는 다시 생성하거나 폴더를 복사합니다. 기존 파일과 원문·설정·해시가 일치하면 API를 재호출하지 않습니다.

**기본적으로 모든 공백 구분 단어·어절 사이에 1~10초의 무작위 무음을 삽입합니다.** 영어는 단어, 한국어는 공백으로 나뉜 어절이 기준입니다. 각각을 별도로 TTS 합성해 원문 순서로 연결하므로, 긴 한국어 표현도 내부 공백에서 멈춥니다. 문장 전체를 자연스럽게 읽는 음성과는 억양이 다릅니다. 무음은 1ms 단위로 균등 추첨하며 파일 안에 저장되므로 재생할 때마다 바뀌지 않습니다. 원래 음성의 조용한 앞뒤 여백을 잘라낸 뒤 10ms 여유를 남기므로 실제로 들리는 쉼에는 작은 발음 여백이 더해질 수 있습니다. `verify`는 메타데이터와 모든 삽입 구간이 정확히 0인 PCM인지 검사합니다.

첫 생성은 단어별 유료 API 호출이 발생합니다. 성공한 단어는 `.word-cache/`에 저장하고 재사용합니다. `--force`는 이 캐시를 재사용하면서 간격을 다시 추첨하고 최종 WAV를 덮어씁니다. 캐시에 없는 단어만 API를 호출합니다. TTS가 무음을 반환한 단어는 최대 두 번만 다시 합성하고, HTTP 오류는 자동 재시도하지 않습니다. 단어 자체를 새로 합성하려면 별도의 `--out` 경로를 사용하세요.

| 샘플 ID                    | 언어        | 용도                                                                       |
| -------------------------- | ----------- | -------------------------------------------------------------------------- |
| `ko-experience`            | 한국어      | 주말 경험 소개, 여러 문장 전사                                             |
| `ko-question`              | 한국어      | 학습 습관, 숫자 표현, 질문                                                 |
| `en-experience`            | 영어        | 주말 경험 소개와 후속 질문                                                 |
| `en-correction`            | 영어        | `Yesterday I go`, `we enjoy`, `want try` 등 의도적 문법 오류와 피드백 비교 |
| `mixed-missing-word`       | 영어·한국어 | 영어 문장에서 모르는 `예약`, `품절`을 한국어로 대체                        |
| `mixed-missing-expression` | 영어·한국어 | `눈치가 보여서 말을 못 했어요`, `미뤘어요`를 한국어로 설명                 |

```sh
# 특정 샘플만 생성 / 명시적으로 다시 생성
pnpm --filter @devday/test-voice generate --sample en-correction
pnpm --filter @devday/test-voice generate --sample en-correction --force

# 사용자 지정 출력 경로: generate/verify/play에 같은 경로 지정
pnpm --filter @devday/test-voice generate --out /tmp/devday-test-voice
```

정확한 발화 원문은 `list`와 `src/samples.mjs`에서 확인합니다. 서비스의 전사·보정 결과는 확률적이므로 원문과 의미·핵심 표현을 비교하고, 구두점이나 문장 분할이 항상 같다고 가정하지 않습니다. 한국어는 입력 경로·한국어 전사 확인용이며 영어 학습 피드백과 구분합니다.

## 2. 가상 마이크 설치 및 장치 선택

1. [BlackHole 공식 설치 안내](https://github.com/ExistentialAudio/BlackHole#installation-instructions)에 따라 **BlackHole 2ch**를 설치합니다. Homebrew를 쓰면 `brew install blackhole-2ch`를 실행합니다. 설치 프로그램의 관리자 인증·재시작 안내를 따릅니다.
2. **오디오 MIDI 설정**을 열어 `BlackHole 2ch`가 나타나는지 확인합니다. 장치 형식은 **48,000 Hz**로 설정해도 됩니다. 재생 시 CoreAudio가 장치 레이트로 변환하고, 서비스 worklet이 실제 AudioContext 레이트에서 24,000 Hz로 다시 변환합니다. WAV 파일 규격은 계속 24,000 Hz입니다.
3. **시스템 설정 → 사운드 → 출력**에서 `BlackHole 2ch`를 선택합니다. CLI는 `afplay`로 macOS의 기본 출력 장치에 재생합니다. 별도 `--device` 옵션은 없습니다.
4. **시스템 설정 → 사운드 → 입력**에서도 `BlackHole 2ch`를 선택합니다.
5. Chrome에서는 `chrome://settings/content/microphone`을 열고 마이크 목록에서 `BlackHole 2ch`를 선택합니다. 사용 중인 브라우저에 별도 입력 장치 선택이 있으면 그 설정도 맞춥니다. Safari처럼 시스템 기본 입력을 따르는 환경에서는 macOS 입력을 선택하고 브라우저를 다시 엽니다.
6. 서비스 페이지를 새로고침합니다. 장치를 바꾸기 전에 시작한 캡처가 있다면 먼저 마이크를 끄고 다시 시작합니다. 현재 `getUserMedia`에는 `deviceId` 지정이 없어서 열린 스트림이 자동으로 새 장치를 따라간다고 가정하면 안 됩니다.

BlackHole만 출력으로 선택하면 스피커에서는 소리가 들리지 않는 것이 정상입니다. 듣기도 원하면 오디오 MIDI 설정에서 **다중 출력 기기**를 만들고 헤드폰과 BlackHole을 함께 선택합니다. 두 장치의 레이트를 맞추고 헤드폰을 클록 소스로, BlackHole에 드리프트 보정을 설정합니다. macOS 출력은 다중 출력, **브라우저 입력은 BlackHole**로 유지합니다. [공식 다중 출력 안내](https://github.com/ExistentialAudio/BlackHole/wiki/Getting-Started%3A-Creating-a-Multi-Output-Device)를 참고하세요.

시스템 출력 전체가 입력되므로 테스트 동안 음악·알림·서비스의 녹음 재생을 멈춥니다. 마이크를 켠 상태에서 서비스의 저장 음성을 재생하면 다시 입력될 수 있습니다.

## 3. 서비스 마이크 시작 → 테스트 음성 재생

1. 루트 README의 로컬 실행 절차로 서비스를 실행합니다. `localhost` 또는 HTTPS로 접속합니다.
2. 로그인하고 스터디에 입장한 뒤 주제를 선택해 **대화를 시작**합니다. 화면에서 **마이크 켜기**를 누르고 브라우저 마이크 권한을 허용합니다. macOS가 브라우저의 마이크 접근을 묻는 경우에도 허용합니다.
3. 서비스가 **마이크 켜짐** 상태인지 확인합니다. 장치 변경 후 오류가 나면 **마이크 다시 연결**을 누르거나 페이지를 새로고침합니다.
4. 아래 명령으로 영어 샘플 하나를 재생합니다. 3초 준비 시간 후 음성이 재생되고 끝에 2초의 무음 대기가 있어 기존 VAD가 발화 종료를 처리할 시간을 줍니다.

```sh
pnpm --filter @devday/test-voice play --sample en-experience

# 혼용 샘플 재생 (파일 내부의 단어 간격도 기본 1~10초)
pnpm --filter @devday/test-voice play --sample mixed-missing-word

# 전체 6개를 차례로 재생 (한국어 2개 → 영어 2개 → 혼용 2개)
pnpm --filter @devday/test-voice play

# 시작 대기 5초, 샘플 사이/끝 무음 3초, 전체 목록 2회 반복
pnpm --filter @devday/test-voice play --delay 5 --gap 3 --repeat 2 --volume 0.8
```

`Ctrl+C`는 대기와 실행 중인 `afplay`를 중지합니다. `--volume` 범위는 0~1, 반복은 1~100회입니다. `play`와 `verify`는 API 키가 필요하지 않습니다. 모든 파일의 규격을 재생 전에 검사하여 누락·손상된 목록을 부분 재생하지 않습니다.

`play --gap`은 **파일 사이와 마지막 파일 뒤**의 대기이며 파일 내부의 1~10초 단어 간격과 별개입니다. 단어 간 무음 때문에 각 샘플은 수 분이 걸립니다. 서비스의 VAD가 단어마다 발화를 나눌 수 있고, 문맥이 끊겨 짧은 단어의 전사 품질이 떨어질 수 있습니다. 수집·재연결·긴 무음 처리 테스트와 자연스러운 연속 회화 정확도 테스트를 구분하세요.

5. 화면에 발화자의 전사와 보정문이 도착하는지 확인합니다. 전사 지연이 있으면 잠시 기다립니다. 샘플 파일 하나가 반드시 서비스 세그먼트 하나가 되는 것은 아닙니다.
6. 마이크를 끄고 주제를 종료한 뒤 문장별 피드백을 확인합니다. `en-correction`의 의도적 오류를 원문·학습 피드백과 비교합니다.
7. 끝나면 macOS 입력을 내장 마이크, 출력을 기존 스피커·헤드폰으로 복원하고 브라우저 입력 설정도 복원합니다.

## 문제 해결 및 검증 범위

- **음성이 입력되지 않음:** 출력과 입력 모두 BlackHole인지 확인하고, 재생 중 macOS 사운드 입력 레벨이 움직이는지 봅니다. 움직이지 않으면 출력 경로·볼륨 문제, 움직이는데 서비스가 조용하면 브라우저 입력·권한·기존 스트림 재시작을 확인합니다.
- **마이크 허용 창이 없음/오류:** 사이트 마이크 권한과 시스템 설정의 개인정보 보호 및 보안 → 마이크에서 브라우저 접근을 확인합니다. LAN HTTP에서는 캡처할 수 없습니다.
- **첫 부분이 빠짐:** 서비스가 캡처 상태에 들어간 다음 재생하고 `--delay 5` 이상을 사용합니다.
- **작은 소리/전사가 없음:** `--volume 1`로 재생하고 장치 볼륨을 확인합니다. 기존 캡처의 echo cancellation/noise suppression/auto gain은 계속 적용됩니다. 실제 루프백 경로의 파형은 원본과 비트 단위로 같지 않습니다.
- **마지막 문장이 늦음:** `--gap 3` 이상으로 늘리고 마이크 종료 후 서버 처리를 기다립니다.
- **API 401/429 등:** 키 권한·사용 한도·잔액을 확인한 뒤 재실행합니다. HTTP 오류는 자동 재시도하지 않습니다. 무음 TTS 응답만 단어별 최대 두 번 추가 호출합니다.

```sh
# 자격증명이나 소리 출력 없이 자동 검사
pnpm --filter @devday/test-voice test

# 생성 파일의 포맷·길이·신호 확인
pnpm --filter @devday/test-voice verify

# 선택 사항: 독립 디코더로 실제 파일 확인 (ffmpeg 설치 환경)
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bits_per_sample \
  -of json .local/test-voice/en-experience.wav
```

자동 검사는 PCM 부호·엔디언·길이, 잘못된 WAV 거부, 생성 재사용·오류 처리, API 요청, 재생 순서·간격을 확인합니다. 가상 마이크에서 브라우저와 서비스까지의 종단 간 검사는 위 2~3절의 실제 장치 설정 후 별도로 수행해야 합니다.

### 실제 BlackHole 테스트 자동 실행

저장소의 개발 의존성, 설치된 Chrome, Swift 컴파일러(Xcode Command Line Tools), 로컬 live 서비스, OpenAI 키와 인식된 BlackHole 장치가 필요합니다. 다음 명령은 **유료 실제 서비스 호출**을 수행하며 테스트 사용자·경험·스터디를 정상 HTTP API로 생성합니다. 원래 사용자 데이터는 수정하지 않습니다. 생성한 테스트 기록은 검사할 수 있도록 남깁니다.

```sh
pnpm --filter @devday/test-voice test:blackhole --run \
  --sample=mixed-missing-word --sample=mixed-missing-expression
```

`.env.local`의 `LOCAL_WEB_ORIGIN`을 사용하며 `TEST_VOICE_ORIGIN`으로 바꿀 수 있습니다. 테스트 동안 기본 입력·출력을 BlackHole로 설정하고 종료 시 복원합니다. 실제 Chrome을 열고 기존 서비스 UI의 마이크 버튼을 누른 후 `afplay`로 재생합니다. 가짜 마이크나 파일을 직접 WebSocket에 넣는 방식은 사용하지 않습니다.

결과는 `.local/test-voice/blackhole-<시각>.json`과 화면 PNG입니다. 장치 라벨, 캡처 레이트, 전송 규격, PCM 청크·발화 응답 수, 서비스 전사, 오류와 원래 장치 복원 결과를 기록합니다. 혼용 샘플의 한국어 핵심 표현이 누락되면 전송 성공과 별도로 `recognitionStatus: needs-review`를 남깁니다. 핵심 표현 존재 검사만으로 전체 전사 정확도를 보장하지는 않습니다. 테스트 시간에는 파일 내부의 긴 무음이 모두 포함됩니다.

### 생성 파일 검증 (2026-10-09)

6개 파일 모두 실제 OpenAI API로 생성했고 `verify` 및 `ffprobe`에서 WAV / `pcm_s16le` / 24,000 Hz / 모노 / 16비트를 확인했습니다. 단어 간 무음의 길이·0 PCM 검증, 재실행 시 API 호출 없는 재사용, 자동 테스트 11개를 통과했습니다.

| 파일                           | 단어·어절 수 | 길이(초) | 실제 삽입 무음 범위(초) |
| ------------------------------ | -----------: | -------: | ----------------------- |
| `ko-experience.wav`            |           19 |   132.99 | 1.502~9.976             |
| `ko-question.wav`              |           21 |   138.99 | 1.660~9.737             |
| `en-experience.wav`            |           32 |   215.95 | 1.150~9.832             |
| `en-correction.wav`            |           31 |   203.71 | 1.336~9.872             |
| `mixed-missing-word.wav`       |           30 |   197.08 | 1.018~9.844             |
| `mixed-missing-expression.wav` |           34 |   244.02 | 1.069~9.899             |

실제 BlackHole 입력·전사 결과와 발견한 인식 오류는 [검증 기록](VALIDATION.md)에 구분해 기록합니다.
