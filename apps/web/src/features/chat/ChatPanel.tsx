import { useEffect, useRef } from 'react';
import type { CommandResult } from '@devday/contracts';
import { Badge, Button, ErrorMessage, Icon, TextArea, JobStatus } from '../../shared/ui';
import { usePrivateChat, useCommandExecution } from './useChat';
import s from './ChatPanel.module.css';

function CommandExecution({ result }: { result: CommandResult }) {
  const job = useCommandExecution(result);
  if (!result.jobId)
    return (
      <p className={s.result}>
        <Icon name="check_circle" size={15} />
        요청한 기능이 반영되었어요.
      </p>
    );
  return (
    <div className={s.result}>
      <JobStatus job={job.data} status={job.data ? undefined : 'running'} />
      <ErrorMessage error={job.error} />
    </div>
  );
}

export function ChatPanel({ studyId, ended }: { studyId: string; ended: boolean }) {
  const {
    messages,
    proposalQuery,
    text,
    setText,
    proposals,
    eventError,
    setEventError,
    send,
    decide,
    sorted,
  } = usePrivateChat(studyId);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.data, send.isPending, proposalQuery.data]);
  return (
    <aside className={s.panel} aria-label="개인 챗봇">
      <header className={s.header}>
        <div className={s.assistantMark}>
          <Icon name="auto_awesome" size={22} />
        </div>
        <div>
          <h2>나만의 도우미</h2>
          <p>
            <Icon name="lock" size={12} /> 나에게만 보이는 대화
          </p>
        </div>
      </header>
      <div className={s.messages}>
        <div className={s.welcome}>
          <p>
            대화에 집중하세요.
            <br />
            <strong>필요한 건 저에게 맡겨요.</strong>
          </p>
          <span>
            단어를 묻거나, 표현을 배우거나,
            <br />
            다음 주제를 요청할 수 있어요.
          </span>
        </div>
        {!sorted.length && (
          <div className={s.suggestions}>
            {['이 표현 영어로 어떻게 말해?', '다음 주제 만들어줘'].map((value) => (
              <button key={value} type="button" onClick={() => setText(value)} disabled={ended}>
                {value}
                <Icon name="north_west" size={14} />
              </button>
            ))}
          </div>
        )}
        {messages.isPending && <p className={s.note}>개인 대화를 불러오고 있어요.</p>}
        <ErrorMessage error={messages.error || proposalQuery.error} />
        {sorted.map((message) => {
          const proposal = message.shareProposalId ? proposals[message.shareProposalId] : undefined;
          const decision = proposal?.status;
          return (
            <article
              key={message.id}
              className={message.role === 'user' ? s.userMessage : s.assistantMessage}
            >
              <div className={s.messageLabel}>
                {message.role === 'user' ? '나' : '말모아 도우미'}
              </div>
              <div className={s.bubble}>{message.text || '요청을 살펴보고 있어요…'}</div>
              {message.status === 'running' && <Badge tone="brand">답변 · 기능 실행 중</Badge>}
              {message.status === 'failed' && (
                <Badge tone="error">요청 실패 · 새로 요청해 주세요</Badge>
              )}
              {message.commandResults.map((result) => (
                <CommandExecution key={result.commandId} result={result} />
              ))}
              {message.learningItemIds.length > 0 && (
                <p className={s.saved}>
                  <Icon name="bookmark_added" size={15} />
                  나의 학습에 {message.learningItemIds.length}개 저장됨
                </p>
              )}
              {message.shareProposalId && (
                <div className={s.proposal}>
                  <strong>{proposal?.expression ?? '이 표현'}</strong>
                  <p>함께 쓰는 표현으로 공유할까요?</p>
                  {decision === 'accepted' ? (
                    <Badge tone="confirm">공유했어요</Badge>
                  ) : decision === 'declined' ? (
                    <span className={s.note}>나의 학습에만 보관해요.</span>
                  ) : (
                    <div className={s.proposalActions}>
                      <Button
                        size="sm"
                        loading={decide.isPending}
                        disabled={ended || !proposal}
                        onClick={() =>
                          decide.mutate({ id: message.shareProposalId!, accepted: true })
                        }
                      >
                        Yes, 공유하기
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={decide.isPending || ended || !proposal}
                        onClick={() =>
                          decide.mutate({ id: message.shareProposalId!, accepted: false })
                        }
                      >
                        No, 나만 보기
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {send.isPending && <p className={s.note}>요청을 보내고 있어요…</p>}
        <ErrorMessage error={send.error || decide.error || eventError} />
        <div ref={bottom} />
      </div>
      <form
        className={s.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) {
            setEventError(null);
            send.mutate(text);
          }
        }}
      >
        <TextArea
          label="개인 챗봇에게 요청"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ended ? '스터디가 종료되었어요' : '궁금한 표현이나 필요한 기능을 말해요'}
          rows={2}
          disabled={ended}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (text.trim() && !send.isPending) {
                setEventError(null);
                send.mutate(text);
              }
            }
          }}
        />
        <div className={s.composerFooter}>
          <span>Enter로 전송 · Shift+Enter 줄바꿈</span>
          <Button
            type="submit"
            size="sm"
            aria-label="보내기"
            disabled={!text.trim() || ended}
            loading={send.isPending}
          >
            <Icon name="arrow_upward" size={18} />
          </Button>
        </div>
      </form>
    </aside>
  );
}
