import { useState } from 'react';
import type { User } from '@devday/contracts';
import { useRegistration } from './useRegistration';
import { Button, Field, ErrorMessage, Icon, Badge } from '../../shared/ui';
import s from './AuthPage.module.css';

export function AuthPage({ onRegistered }: { onRegistered: (user: User) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const registration = useRegistration(displayName, handle, onRegistered);
  return (
    <main className={s.page}>
      <section className={s.story}>
        <a className={s.brand} href="/" aria-label="말모아 홈">
          <span className={s.mark}>
            <Icon name="forum" />
          </span>
          말모아<span className={s.brandEnglish}>MALMOA</span>
        </a>
        <div className={s.storyBody}>
          <Badge tone="brand">우리의 이야기로 배우는 영어</Badge>
          <h1>
            잘 말하는 것보다,
            <br />
            함께 말하는 것부터.
          </h1>
          <p>
            어제의 경험이 오늘의 대화가 되고,
            <br />
            오늘의 대화가 나만의 영어가 돼요.
          </p>
          <div className={s.conversation} aria-hidden="true">
            <div className={s.prompt}>
              <span className={s.avatar}>나</span>
              <div>
                어제 있었던 일, 영어로 말해볼까?<small>우리가 아는 이야기에서 시작해요.</small>
              </div>
            </div>
            <div className={s.answer}>
              <Icon name="auto_awesome" />
              <div>
                조금 서툴러도 괜찮아요.
                <br />
                <strong>대화는 이어가고, 배움은 남겨요.</strong>
              </div>
            </div>
            <div className={s.word}>
              <Icon name="bookmark" size={18} />
              <span>
                내 경험 <b>→</b> 우리 대화 <b>→</b> 나의 표현
              </span>
            </div>
          </div>
        </div>
        <p className={s.footer}>같은 공간, 각자의 화면, 하나의 대화.</p>
      </section>
      <section className={s.formArea}>
        <div className={s.formWrap}>
          <span className={s.eyebrow}>LET’S TALK TOGETHER</span>
          <h2>
            반가워요.
            <br />
            어떤 이름으로 불러드릴까요?
          </h2>
          <p>이름과 아이디만 있으면 바로 시작할 수 있어요.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              registration.mutate();
            }}
            className={s.form}
          >
            <Field
              label="이름"
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="함께 부를 이름"
              required
              maxLength={100}
              autoComplete="name"
            />
            <Field
              label="아이디"
              name="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="예: minji"
              required
              maxLength={64}
              autoComplete="username"
              hint="친구가 이 아이디로 스터디에 초대할 수 있어요."
            />
            <ErrorMessage error={registration.error} />
            <Button
              type="submit"
              loading={registration.isPending}
              disabled={!displayName.trim() || !handle.trim()}
            >
              시작하기 <Icon name="arrow_forward" size={20} />
            </Button>
          </form>
          <div className={s.note}>
            <Icon name="person" size={18} />
            <p>
              이 브라우저에서 내 경험과 학습 기록을 이어서 볼 수 있어요. 이미 사용 중인 아이디로는
              가입할 수 없어요.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
