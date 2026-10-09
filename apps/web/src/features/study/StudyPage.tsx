import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { StudySnapshot, DomainEvent } from '@devday/contracts';
import { useSession } from '../../shared/session';
import { useUserEvent } from '../../shared/events';
import { useMicrophone } from '../../shared/audio';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorMessage,
  Field,
  Icon,
  JobStatus,
  LoadingSkeleton,
} from '../../shared/ui';
import { ChatPanel } from '../chat/ChatPanel';
import { ReviewPanel } from './ReviewPanel';
import { topicLabels } from './model';
import { useStudyCommand, useStudyCreation } from './useStudy';
import s from './StudyPage.module.css';

type Partial = Extract<DomainEvent, { type: 'transcript.partial' }>['payload'];
function LiveTranscript({ snapshot }: { snapshot: StudySnapshot }) {
  const [partials, setPartials] = useState<Record<string, Partial>>({});
  const newest = useRef<HTMLDivElement>(null);
  useEffect(() => setPartials({}), [snapshot.topic?.id]);
  useUserEvent((event) => {
    if (event.studyId === snapshot.study.id && event.type === 'transcript.partial')
      setPartials((old) => {
        const previous = old[event.payload.segmentId];
        if (previous && previous.partialRevision >= event.payload.partialRevision) return old;
        if (
          snapshot.segments.some(
            (item) => item.id === event.payload.segmentId && item.rawStatus === 'ready',
          )
        )
          return old;
        return { ...old, [event.payload.segmentId]: event.payload };
      });
  });
  const lines = [
    ...snapshot.segments.map((segment) => ({
      id: segment.id,
      speaker: segment.speakerUserId,
      order: segment.startOrder,
      raw:
        segment.rawStatus === 'ready'
          ? segment.rawText
          : (partials[segment.id]?.partialText ?? segment.rawText),
      corrected: segment.correctedText,
      status: segment.correctionStatus,
    })),
    ...Object.values(partials)
      .filter((partial) => !snapshot.segments.some((segment) => segment.id === partial.segmentId))
      .map((partial) => ({
        id: partial.segmentId,
        speaker: partial.speakerUserId,
        order: partial.startOrder,
        raw: partial.partialText,
        corrected: null,
        status: 'pending',
      })),
  ]
    .sort((a, b) => a.order - b.order)
    .slice(-3);
  useEffect(() => {
    newest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [lines.map((line) => (line.raw ?? '') + (line.corrected ?? '')).join('')]);
  return (
    <section className={s.lyrics} aria-label="실시간 원문과 인식 보정" aria-live="polite">
      <div className={s.lyricsHeader}>
        <span>
          <Icon name="subtitles" size={17} /> 우리의 이야기
        </span>
        <span>원문과 인식 보정을 함께 보여드려요</span>
      </div>
      {lines.length ? (
        lines.map((line, index) => (
          <div
            key={line.id}
            className={index === lines.length - 1 ? s.lyricActive : s.lyricEarlier}
          >
            <span className={s.lyricSpeaker}>
              {snapshot.study.members.find((member) => member.userId === line.speaker)
                ?.displayName ?? '참여자'}
            </span>
            <div>
              <p>
                <small>원문</small>
                {line.raw || '듣고 있어요…'}
              </p>
              <p className={s.lyricCorrection}>
                <small>인식 보정</small>
                {line.status === 'failed'
                  ? '인식 보정에 실패했어요'
                  : (line.corrected ?? '인식 보정 중…')}
              </p>
            </div>
          </div>
        ))
      ) : (
        <div className={s.lyricEmpty}>
          <Icon name="graphic_eq" size={25} />
          <p>
            편하게 이야기를 시작해 보세요.
            <br />
            <span>말한 내용이 여기에 한 줄씩 쌓여요.</span>
          </p>
        </div>
      )}
      <div ref={newest} />
    </section>
  );
}

export function StudyLobby({ onStudy }: { onStudy: (id: string) => void }) {
  const { open, setOpen, handles, setHandles, missing, setMissing, create } =
    useStudyCreation(onStudy);
  return (
    <div className={s.lobby}>
      <div className={s.lobbyIntro}>
        <Badge tone="brand">오늘도 한 걸음, 함께</Badge>
        <h1>
          어떤 이야기를
          <br />
          나누고 싶으세요?
        </h1>
        <p>
          친구를 초대하고, 우리 경험에서 시작하는
          <br />
          영어 대화를 함께 만들어 보세요.
        </p>
        <Button onClick={() => setOpen(true)}>
          <Icon name="add" size={20} />
          스터디 만들기
        </Button>
      </div>
      <div className={s.lobbyArt} aria-hidden="true">
        <div className={s.artCard}>
          <Icon name="forum" size={48} />
          <span>
            YOUR STORIES,
            <br />
            OUR CONVERSATION.
          </span>
          <div className={s.artPeople}>
            <span>나</span>
            <b>+</b>
            <span>친구</span>
          </div>
          <p>
            혼자 외운 영어에서
            <br />
            <strong>함께 나누는 영어로.</strong>
          </p>
        </div>
        <span className={s.artNote}>
          <Icon name="auto_awesome" size={17} />
          우리 이야기를 주제로
        </span>
      </div>
      <div className={s.lobbyHint}>
        <Icon name="lightbulb" size={20} />
        <p>
          처음이라면 <Link to="/experiences">나의 경험</Link>을 먼저 남겨주세요. 함께할 대화의 좋은
          시작점이 돼요.
        </p>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="함께 이야기할 친구를 초대해요"
        description="가입한 친구의 아이디를 입력해 주세요. 초대는 친구가 보고 있는 화면에 도착해요."
      >
        <form
          className={s.createForm}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field
            label="초대할 아이디"
            value={handles}
            onChange={(e) => {
              setHandles(e.target.value);
              setMissing([]);
            }}
            placeholder="예: minji, joon"
            hint="여러 명은 쉼표로 구분해 주세요."
            required
            error={missing.length ? `${missing.join(', ')} 아이디를 확인해 주세요.` : undefined}
          />
          <ErrorMessage error={create.error} />
          <Button type="submit" loading={create.isPending} disabled={!handles.trim()}>
            초대하고 만들기
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

export function StudyPage({
  snapshot,
  error,
  onRefresh,
  onNewStudy,
}: {
  snapshot: StudySnapshot | null;
  error: unknown;
  onRefresh: () => void;
  onNewStudy: () => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const mic = useMicrophone();
  const { command, focus, setFocus } = useStudyCommand(snapshot, onRefresh);
  const [imageError, setImageError] = useState(false);
  useEffect(() => setImageError(false), [snapshot?.topic?.content?.imageMediaId]);
  if (error && !snapshot)
    return (
      <Card>
        <ErrorMessage error={error} />
        <Button onClick={onRefresh}>다시 불러오기</Button>
      </Card>
    );
  if (!snapshot)
    return (
      <div className={s.loading}>
        <LoadingSkeleton />
        <p>스터디를 불러오고 있어요.</p>
      </div>
    );
  const { study, topic } = snapshot;
  const content = topic?.content;
  const busy = command.isPending || topic?.state === 'generating' || topic?.state === 'closing';
  const recentJobs = snapshot.jobs
    .filter((job) => job.targetId === topic?.id || job.kind === 'topic.close')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const failedClose =
    topic?.state === 'closing' &&
    recentJobs.find((job) => job.kind === 'topic.close')?.status === 'failed';
  const latestJob = recentJobs.find(
    (job) => job.kind === 'topic.generate' || job.kind === 'topic.close',
  );
  const micMessage =
    typeof mic.state.error === 'string' ? mic.state.error : mic.state.error?.message;
  const ended = study.status === 'ended';
  return (
    <div className={s.layout}>
      <div className={s.mainColumn}>
        <header className={s.studyHeader}>
          <div>
            <span className={s.eyebrow}>OUR CONVERSATION</span>
            <h1>
              {ended
                ? '함께한 이야기가 배움으로 남았어요'
                : topic
                  ? `우리의 ${topic.ordinal}번째 이야기`
                  : '대화할 준비가 되었나요?'}
            </h1>
          </div>
          <Badge tone={ended ? 'confirm' : topic?.state === 'talking' ? 'brand' : 'neutral'}>
            {ended ? '스터디 완료' : topic ? topicLabels[topic.state] : '참여 기다리는 중'}
          </Badge>
        </header>
        <div className={s.participants} aria-label="스터디 참여자">
          {study.members.map((member) => (
            <div key={member.userId} className={s.participant}>
              <span className={member.userId === user?.id ? s.myAvatar : s.peerAvatar}>
                {member.displayName.slice(0, 1)}
              </span>
              <div>
                <strong>
                  {member.displayName}
                  {member.userId === user?.id ? ' (나)' : ''}
                </strong>
                <span>
                  @{member.handle} · {member.state === 'joined' ? '참여 중' : '초대 보냄'}
                </span>
              </div>
              {member.userId === user?.id && mic.enabled && <Icon name="mic" size={17} />}
            </div>
          ))}
        </div>
        <ErrorMessage error={error || command.error} />
        {command.error &&
          typeof command.error === 'object' &&
          'code' in command.error &&
          command.error.code === 'CONTEXT_REQUIRED' && (
            <Button variant="secondary" onClick={() => navigate('/experiences')}>
              나의 경험 입력하기
              <Icon name="arrow_forward" size={18} />
            </Button>
          )}
        {ended ? (
          <Card className={s.ended}>
            <Icon name="task_alt" size={44} />
            <h2>오늘의 대화, 수고했어요.</h2>
            <p>
              승인한 피드백은 각자 말한 사람의 학습 기록에 저장했어요.
              <br />
              새로운 대화에서 다시 꺼내 써보세요.
            </p>
            <div className={s.actions}>
              <Button onClick={() => navigate('/learning')}>나의 학습 보기</Button>
              <Button variant="secondary" onClick={onNewStudy}>
                새 스터디 만들기
              </Button>
            </div>
          </Card>
        ) : !topic ? (
          <Card className={s.waiting}>
            <div className={s.waitingIcon}>
              <Icon name="forum" size={42} />
            </div>
            <h2>
              경험을 나누면,
              <br />
              대화할 이야기가 생겨요.
            </h2>
            <p>
              저장해 둔 우리의 경험과 관심사를 바탕으로
              <br />첫 번째 대화 주제를 함께 준비할게요.
            </p>
            <label className={s.focusLabel}>
              누구의 이야기로 시작할까요?
              <select
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                aria-label="주제의 경험 참여자"
              >
                <option value="">함께한 모두의 경험</option>
                {study.members
                  .filter((member) => member.state === 'joined')
                  .map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName} (@{member.handle})
                    </option>
                  ))}
              </select>
            </label>
            <Button loading={command.isPending} onClick={() => command.mutate('study.start')}>
              <Icon name="play_arrow" size={20} />첫 주제 시작
            </Button>
            <p className={s.waitingFoot}>
              아직 경험이 없나요? <Link to="/experiences">나의 경험 남기기</Link>
            </p>
          </Card>
        ) : topic.state === 'generating' ? (
          <Card className={s.generating}>
            <LoadingSkeleton />
            <h2>우리에게 맞는 주제를 준비하고 있어요</h2>
            <p>저장한 경험을 꺼내, 함께 이야기할 장면을 만들어요.</p>
            <JobStatus job={latestJob} />
          </Card>
        ) : topic.state === 'failed' ? (
          <Card>
            <EmptyState
              title="이번 주제를 만들지 못했어요"
              description="아래 내용을 확인하고 다시 요청해 주세요."
              icon="error"
            />
            <JobStatus job={latestJob} />
            <Button loading={command.isPending} onClick={() => command.mutate('topic.advance')}>
              같은 주제 다시 생성
            </Button>
          </Card>
        ) : (
          <>
            {content && (
              <section
                className={`${s.topicCard} ${topic.state === 'review' || topic.state === 'approved' ? s.topicCompact : ''}`}
                aria-label="공통 대화 주제"
              >
                <div className={s.topicVisual}>
                  {content.kind === 'image' ? (
                    imageError ? (
                      <div className={s.imageMissing}>
                        <Icon name="broken_image" size={35} />
                        <p>주제 이미지를 불러오지 못했어요.</p>
                        <Button size="sm" variant="secondary" onClick={() => setImageError(false)}>
                          다시 보기
                        </Button>
                      </div>
                    ) : (
                      <img
                        src={`/api/v1/media/${content.imageMediaId}`}
                        alt={content.situationText}
                        onError={() => setImageError(true)}
                      />
                    )
                  ) : (
                    <div className={s.sentenceTopic}>
                      <Icon name="format_quote" size={40} />
                      <p>{content.sentence}</p>
                      <span>이 문장에서 우리 이야기를 시작해요</span>
                    </div>
                  )}
                  <span className={s.topicNumber}>
                    TOPIC {String(topic.ordinal).padStart(2, '0')}
                  </span>
                </div>
                <div className={s.topicCopy}>
                  <h2>{content.title}</h2>
                  <p>{content.situationText}</p>
                  <div className={s.instruction}>
                    <Icon name="chat_bubble" size={19} />
                    <div>
                      <strong>이렇게 대화해 보세요</strong>
                      <p>{content.conversationInstruction}</p>
                    </div>
                  </div>
                </div>
              </section>
            )}
            {topic.state === 'closing' && (
              <Card>
                <JobStatus job={latestJob} />
                <p>마지막 발화까지 담고, 문장별 피드백을 정리하고 있어요.</p>
                {failedClose && (
                  <Button onClick={() => command.mutate('topic.close')} loading={command.isPending}>
                    마무리 작업 다시 요청
                  </Button>
                )}
              </Card>
            )}
            {topic.state === 'review' || topic.state === 'approved' ? (
              <ReviewPanel snapshot={snapshot} onRefresh={onRefresh} />
            ) : (
              <LiveTranscript snapshot={snapshot} />
            )}
          </>
        )}
        {snapshot.sharedExpressions.length > 0 && (
          <Card className={s.shared}>
            <h3>
              <Icon name="group" size={19} />
              함께 쓰는 표현
            </h3>
            <div>
              {snapshot.sharedExpressions.map((item) => (
                <details key={item.id}>
                  <summary>{item.expression}</summary>
                  <p>{item.meaning}</p>
                  <p>{item.example}</p>
                </details>
              ))}
            </div>
          </Card>
        )}
        {!ended && (
          <footer className={s.controls}>
            <div className={s.micControl}>
              <Button
                variant={mic.enabled ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => void (mic.enabled ? mic.disable() : mic.enable())}
                disabled={!mic.enabled && topic?.state !== 'talking'}
                loading={
                  mic.state.status === 'requesting_permission' || mic.state.status === 'connecting'
                }
                aria-label={mic.enabled ? '마이크 끄기' : '마이크 켜기'}
              >
                <Icon name={mic.enabled ? 'mic' : 'mic_off'} size={20} />
                {mic.state.status === 'flushing'
                  ? '마지막 음성 전송 중'
                  : mic.enabled
                    ? topic?.state === 'talking'
                      ? '마이크 켜짐'
                      : '마이크 대기 중'
                    : '마이크 켜기'}
              </Button>
              <span>
                {mic.enabled
                  ? topic?.state === 'talking'
                    ? '내 목소리만 기록하고 있어요'
                    : '검토 중에는 음성을 보내지 않아요'
                  : '대화 시작 후 마이크를 허용해 주세요'}
              </span>
            </div>
            <div className={s.actions}>
              {topic?.state === 'talking' ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => command.mutate('study.finish')}
                    disabled={busy}
                  >
                    스터디 종료 요청
                  </Button>
                  <Button onClick={() => command.mutate('topic.close')} disabled={busy}>
                    주제 종료
                    <Icon name="check" size={18} />
                  </Button>
                </>
              ) : topic?.state === 'review' ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => command.mutate('study.finish')}
                    disabled={busy}
                  >
                    승인하고 스터디 종료
                  </Button>
                  <Button
                    onClick={() => command.mutate('topic.advance')}
                    loading={command.isPending}
                  >
                    승인하고 다음 주제
                    <Icon name="arrow_forward" size={18} />
                  </Button>
                </>
              ) : !topic || topic.state === 'failed' ? (
                <Button
                  variant="ghost"
                  onClick={() => command.mutate('study.finish')}
                  disabled={command.isPending}
                >
                  스터디 종료
                </Button>
              ) : null}
            </div>
          </footer>
        )}
        {micMessage && <ErrorMessage error={micMessage} />}
      </div>
      <ChatPanel studyId={study.id} ended={ended} />
    </div>
  );
}
