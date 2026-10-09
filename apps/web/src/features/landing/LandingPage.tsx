import { Link } from 'react-router';
import { ScreenVideo } from './ScreenVideo';
import s from './LandingPage.module.css';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={diagonal ? s.diagonalArrow : undefined}
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Brand() {
  return (
    <a href="#top" className={s.brand} aria-label="말모아 처음으로">
      <span className={s.brandMark} aria-hidden="true">
        <svg width="25" height="25" viewBox="0 0 28 28" fill="none">
          <path
            d="M5 5.5h13a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6l-5 4v-4H5a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M23.5 10.5a3 3 0 0 1 2.5 3v6a3 3 0 0 1-3 3v3l-4-3h-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.5 10.5h8M7.5 14h5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      말모아<span className={s.brandEnglish}>MALMOA</span>
    </a>
  );
}

const features = [
  {
    id: 'experience',
    eyebrow: '경험 기반 대화 주제',
    heading: (
      <>
        어제의 이야기가,
        <br />
        오늘의 영어 주제로.
      </>
    ),
    description:
      '여행에서 만난 사람, 최근 도전한 일. 자유롭게 적은 경험을 AI와 함께 정리하세요. 직접 확인하고 저장한 이야기에서 이미지·문장 주제와 대화 안내를 준비해요.',
    detail: '나의 경험 → 맞춤 주제 → 함께 대화',
    videoTitle: '경험을 정리하고 맞춤 대화 주제를 만드는 화면',
  },
  {
    id: 'conversation',
    eyebrow: '발화자별 대화 기록',
    heading: (
      <>
        대화에 집중하세요.
        <br />
        기록은 곁에 둘게요.
      </>
    ),
    description:
      '각자의 마이크로 들어온 말을 누가 말했는지 구분해 기록해요. 원문 전사와 음성으로 다시 확인한 인식 보정문을 함께 보며 대화를 이어갈 수 있어요.',
    detail: '원문과 인식 보정문을 나란히',
    videoTitle: '화자별 원문 전사와 음성 기반 보정문을 확인하는 화면',
  },
  {
    id: 'assistant',
    eyebrow: '챗봇을 통한 기능 조작',
    heading: (
      <>
        채팅 한마디로,
        <br />
        스터디를 이어가세요.
      </>
    ),
    description:
      '스터디 시작, 주제 마무리, 검토 후 다음 주제 진행을 사이드바 챗봇에 요청하세요. 요청의 의미와 현재 스터디 상태를 확인한 뒤, 실제 기능을 실행해요.',
    detail: '자연어 요청 → 의도·상태 확인 → 기능 실행',
    videoTitle: '사이드바 챗봇에서 자연어로 요청해 스터디 기능을 조작하는 화면',
  },
  {
    id: 'review',
    eyebrow: '문장별 피드백과 나의 학습',
    heading: (
      <>
        오늘 나눈 대화를,
        <br />
        내일 쓸 표현으로.
      </>
    ),
    description:
      '주제를 마치면 내가 말한 문장의 피드백을 확인해요. 보정문을 직접 수정하고 피드백을 다시 받을 수도 있어요. 최종 승인한 단어와 표현은 말한 사람의 학습 기록으로 모입니다.',
    detail: '피드백 확인 → 직접 검토·승인 → 나의 학습',
    videoTitle: '문장별 피드백을 검토하고 개인 학습에 저장하는 화면',
  },
  {
    id: 'reuse',
    eyebrow: '배운 표현을 다음 이미지 주제에',
    heading: (
      <>
        한 번 배운 표현,
        <br />
        다음 장면에서 한 번 더.
      </>
    ),
    description:
      '직전 주제의 피드백에서 승인해 저장한 단어와 표현을 다음 주제를 만들 때 함께 활용해요. 배운 표현이 반영된 새로운 이미지 상황을 보며, 같은 표현을 다시 꺼내 말해 보세요.',
    detail: '승인한 학습 표현 → 다음 이미지 주제 → 다시 말하기',
    videoTitle: '피드백에서 저장한 학습 표현이 다음 이미지 주제에 반영되는 실제 예시',
  },
];

const technologies = [
  {
    number: '01',
    label: 'CONTEXT',
    name: '이야기에서 시작하는 AI',
    description:
      '경험과 학습 표현을 바탕으로 대화 주제·이미지·문장별 피드백을 만듭니다. 구조화된 결과를 검증해 서비스에 연결해요.',
    stack: 'OpenAI Responses · Images · Zod',
  },
  {
    number: '02',
    label: 'VOICE',
    name: 'STT의 문장 끝 판단을 보완',
    description:
      'OpenAI Decisions가 전사 내용과 대화 맥락, 침묵 시간을 보고 발화가 끝났는지 판단해요. 발화 묶음의 원본 음성을 다시 전사해 인식도 보정합니다.',
    stack: 'OpenAI Decisions · Realtime · Audio',
  },
  {
    number: '03',
    label: 'TOGETHER',
    name: '같은 주제, 같은 순간',
    description:
      '참여자의 화면에 대화 주제와 전사, 검토 상태를 함께 반영합니다. 대화가 진행되는 동안 서로의 맥락을 놓치지 않게 해요.',
    stack: 'React · Fastify · WebSocket',
  },
  {
    number: '04',
    label: 'YOUR RECORD',
    name: '내가 확인하고 남기는 배움',
    description:
      '개인 기록과 공통 스터디를 구분합니다. 공유 동의와 최신 피드백, 저장 권한을 서버에서 확인하고 발화자에게 기록을 남겨요.',
    stack: 'PostgreSQL · 서버 권한·버전 검사',
  },
];

export function LandingPage() {
  return (
    <div className={s.landing} id="top">
      <a className={s.skipLink} href="#main">
        본문으로 건너뛰기
      </a>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Brand />
          <nav className={s.navigation} aria-label="서비스 소개">
            <a href="#why">말모아가 필요한 순간</a>
            <a href="#features">주요 기능</a>
            <a href="#technology">핵심 기술</a>
          </nav>
          <Link className={s.headerCta} to="/study">
            말모아 시작하기 <Arrow diagonal />
          </Link>
        </div>
      </header>

      <main id="main">
        <section className={s.hero} aria-labelledby="hero-title">
          <div className={s.heroInner}>
            <div className={s.heroCopy}>
              <p className={s.eyebrow}>
                <span className={s.tinyStar}>✳</span> 함께 말하는 영어 스터디
              </p>
              <h1 id="hero-title">
                우리의 이야기가
                <br />
                <span className={s.heroAccent}>영어가 되는 곳.</span>
              </h1>
              <p className={s.heroDescription}>
                대화의 시작부터 나만의 복습까지.
                <br />
                경험을 나누고, 표현을 배우고,
                <br className={s.mobileBreak} /> 함께 나눈 영어를 내 것으로 모으세요.
              </p>
              <Link className={s.primaryCta} to="/study">
                말모아 시작하기 <Arrow />
              </Link>
              <p className={s.startNote}>이름과 아이디로 시작하세요.</p>
              <div className={s.heroSignature}>
                <span className={s.signatureLine} />
                <span>
                  Good conversations.
                  <br />
                  <em>Yours to keep.</em>
                </span>
              </div>
            </div>
            <div className={s.heroMedia}>
              <div className={s.stageTop}>
                <span className={s.livePill}>
                  <i /> 우리의 경험으로 시작하는 영어
                </span>
                <span className={s.stageEdition}>MALMOA / IN ACTION</span>
              </div>
              <ScreenVideo name="overview" title="말모아 서비스 동작 소개" priority />
              <div className={s.stageBottom}>
                <span>
                  이야기를 모으다.
                  <br />
                  <strong>나의 영어가 되다.</strong>
                </span>
                <span className={s.stageArrow} aria-hidden="true">
                  ↗
                </span>
              </div>
            </div>
          </div>
          <div className={s.heroFooter}>
            <span>사람과 나누는 대화, AI가 돕는 배움.</span>
            <a href="#features">
              말모아 둘러보기 <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>

        <section className={s.why} id="why" aria-labelledby="why-title">
          <div className={s.sectionTop}>
            <p className={s.sectionLabel}>WHY MALMOA</p>
            <span className={s.sectionNumber}>01 — 대화가 배움으로 이어지려면</span>
          </div>
          <div className={s.whyHeading}>
            <h2 id="why-title">
              좋은 대화가,
              <br />한 번으로 끝나지 않도록.
            </h2>
            <p>
              무슨 말을 할지 고민하던 시작,
              <br />
              표현이 떠오르지 않던 순간,
              <br />
              끝나면 흩어지던 배움까지. 말모아가 이어줄게요.
            </p>
          </div>
          <div className={s.reasons}>
            <article>
              <span className={s.reasonNumber}>01 / BEFORE</span>
              <h3>
                말할 거리는,
                <br />
                이미 우리 안에.
              </h3>
              <p>
                참여자가 남긴 경험과 관심사가 대화의 소재가 돼요. 익숙한 이야기로 첫 문장을
                시작하세요.
              </p>
              <span className={s.reasonBottom}>
                나의 경험에서 시작하는 주제 <Arrow />
              </span>
            </article>
            <article>
              <span className={s.reasonNumber}>02 / DURING</span>
              <h3>
                스터디 진행도,
                <br />
                채팅 한마디로.
              </h3>
              <p>
                스터디 시작부터 주제 마무리까지 말로 요청하세요. 사이드바 챗봇이 현재 상태를
                확인하고 필요한 기능을 실행해요.
              </p>
              <span className={s.reasonBottom}>
                자연어 요청으로 이어지는 스터디 <Arrow />
              </span>
            </article>
            <article>
              <span className={s.reasonNumber}>03 / AFTER</span>
              <h3>
                대화는 끝나도,
                <br />
                배움은 남도록.
              </h3>
              <p>
                직접 검토하고 승인한 피드백을 개인 기록에 모아요. 배운 표현은 다음 이미지 주제에
                다시 활용해요.
              </p>
              <span className={s.reasonBottom}>
                복습에서 다음 대화까지 <Arrow />
              </span>
            </article>
          </div>
        </section>

        <section className={s.features} id="features" aria-labelledby="features-title">
          <div className={s.featureIntro}>
            <p className={s.sectionLabel}>A CONVERSATION, A COLLECTION</p>
            <h2 id="features-title">
              시작은 우리 이야기.
              <br />
              남는 것은 나의 영어.
            </h2>
            <p>준비하고, 함께 말하고, 다시 꺼내 쓰는 다섯 장면.</p>
          </div>
          {features.map((feature, index) => (
            <article
              key={feature.id}
              className={`${s.feature} ${index % 2 ? s.reversed : ''}`}
              aria-labelledby={`${feature.id}-title`}
            >
              <div className={`${s.featureMedia} ${s[`tone${index + 1}`]}`}>
                <span className={s.featureFrameLabel}>
                  MALMOA / {String(index + 1).padStart(2, '0')}
                </span>
                <ScreenVideo name={feature.id} title={feature.videoTitle} />
              </div>
              <div className={s.featureCopy}>
                <p className={s.featureEyebrow}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {feature.eyebrow}
                </p>
                <h3 id={`${feature.id}-title`}>{feature.heading}</h3>
                <p className={s.featureDescription}>{feature.description}</p>
                {feature.id === 'reuse' && (
                  <div className={s.reuseExample}>
                    <span>실제 시연 예시</span>
                    <p lang="en">“We’re planning a trip to Busan.”</p>
                    <small>피드백에서 저장한 표현이 다음 부산 여행 이미지 주제로</small>
                  </div>
                )}
                <p className={s.featureDetail}>
                  <span aria-hidden="true">↳</span>
                  {feature.detail}
                </p>
              </div>
            </article>
          ))}
          <p className={s.demoNote}>
            영상은 시연용 계정으로 실제 서비스를 녹화했으며, 음성 전사 시연에는 합성 음성을
            사용했습니다.
          </p>
        </section>

        <section className={s.technology} id="technology" aria-labelledby="technology-title">
          <div className={s.technologyInner}>
            <div className={s.sectionTop}>
              <p className={s.sectionLabel}>BEHIND THE CONVERSATION</p>
              <span className={s.sectionNumber}>사람의 대화를 위한 기술</span>
            </div>
            <div className={s.technologyHeading}>
              <h2 id="technology-title">
                대화는 사람과.
                <br />
                <span>도움은 기술로.</span>
              </h2>
              <p>
                경험을 읽는 AI부터 함께 보는 대화 기록까지.
                <br />각 기술이 준비, 대화, 복습의 순간을 연결합니다.
              </p>
            </div>
            <div className={s.speechFlow}>
              <p className={s.speechFlowLabel}>OPENAI DECISIONS × STT</p>
              <h3>문장의 끝을 한 번 더 판단합니다.</h3>
              <p className={s.speechFlowDescription}>
                잠깐의 침묵이 꼭 문장의 끝은 아니니까. OpenAI Decisions가 STT 전사와 대화 맥락, 침묵
                시간을 함께 보고 발화가 완료됐는지 판단해요. 말이 이어지면 이전 종료 판단을
                취소하고, 이어지는 말을 기다립니다.
              </p>
              <ol className={s.speechSteps} aria-label="음성에서 피드백까지 처리 순서">
                <li>
                  <span>01 / LISTEN</span>
                  <strong>Realtime STT</strong>
                  <small>말을 실시간 텍스트로</small>
                </li>
                <li className={s.decisionStep}>
                  <span>02 / UNDERSTAND</span>
                  <strong>OpenAI Decisions</strong>
                  <small>발화 완료 · 계속 · 불확실 판단</small>
                </li>
                <li>
                  <span>03 / REFINE</span>
                  <strong>원본 음성 재전사</strong>
                  <small>묶인 발화의 인식 보정</small>
                </li>
                <li>
                  <span>04 / LEARN</span>
                  <strong>문장별 학습 피드백</strong>
                  <small>사람이 검토할 표현 생성</small>
                </li>
              </ol>
            </div>
            <div className={s.technologyGrid}>
              {technologies.map((technology) => (
                <article key={technology.number}>
                  <div className={s.techLabel}>
                    <span>{technology.number}</span>
                    {technology.label}
                  </div>
                  <h3>{technology.name}</h3>
                  <p>{technology.description}</p>
                  <span className={s.techStack}>{technology.stack}</span>
                </article>
              ))}
            </div>
            <div className={s.technologyNote}>
              <span className={s.noteMark}>✳</span>
              <p>
                AI가 제안하고, 우리가 확인하고.
                <br className={s.mobileBreak} /> 기록의 마지막 단계에는 사람의 검토와 승인이
                있습니다.
              </p>
            </div>
          </div>
        </section>

        <section className={s.closing} aria-labelledby="closing-title">
          <span className={s.closingStar} aria-hidden="true">
            ✳
          </span>
          <p className={s.sectionLabel}>YOUR NEXT CONVERSATION</p>
          <h2 id="closing-title">
            다음 스터디는,
            <br />
            우리 이야기로 시작해요.
          </h2>
          <Link className={s.primaryCta} to="/study">
            말모아 시작하기 <Arrow />
          </Link>
          <p>함께 말하고, 내 것으로.</p>
        </section>
      </main>
      <footer className={s.footer}>
        <Brand />
        <span>우리의 경험으로 대화하고, 나의 영어로 모으다.</span>
        <a href="#top">맨 위로 ↑</a>
      </footer>
    </div>
  );
}
