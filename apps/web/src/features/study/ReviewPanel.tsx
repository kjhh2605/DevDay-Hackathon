import { api } from '../../shared/api';
import { useState } from 'react';
import type { Feedback, StudySnapshot, Utterance } from '@devday/contracts';
import { useSentenceActions } from './useStudy';
import { Badge, Button, ErrorMessage, FeedbackAccordion, Icon, TextArea } from '../../shared/ui';
import s from './StudyPage.module.css';

function SentenceReview({
  utterance,
  feedback,
  speaker,
  onRefresh,
  editable,
}: {
  utterance: Utterance;
  feedback?: Feedback;
  speaker: string;
  onRefresh: () => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(utterance.correctedText);
  const { correction, request } = useSentenceActions(
    utterance,
    text,
    () => setEditing(false),
    onRefresh,
  );
  const stale =
    feedback?.status === 'stale' ||
    (feedback && feedback.inputCorrectionRevision !== utterance.correctionRevision);
  const ready = feedback?.status === 'ready' && !stale;
  return (
    <article className={s.sentence}>
      <div className={s.sentenceHeader}>
        <span className={s.speaker}>{speaker}</span>
        <span className={s.sentenceNumber}>문장 {utterance.sentenceIndex + 1}</span>
        {utterance.correctedBy === 'human' && <Badge tone="confirm">직접 수정됨</Badge>}
      </div>
      <div className={s.transcriptRow}>
        <span>원문</span>
        <p>{utterance.rawText}</p>
      </div>
      {editing ? (
        <div className={s.editor}>
          <TextArea
            label="인식 보정문 수정"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <div className={s.actions}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={correction.isPending}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => correction.mutate()}
              disabled={!text.trim()}
              loading={correction.isPending}
            >
              보정문 저장
            </Button>
          </div>
        </div>
      ) : (
        <div className={`${s.transcriptRow} ${s.corrected}`}>
          <span>인식 보정</span>
          <p>{utterance.correctedText}</p>
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${speaker} 문장 보정문 수정`}
              onClick={() => {
                setText(utterance.correctedText);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={18} />
            </Button>
          )}
        </div>
      )}
      <details>
        <summary>원본 음성 듣기</summary>
        {[
          ...new Set(
            utterance.sourceRanges.flatMap((range) =>
              'version' in range ? range.audioSegmentIds : [range.segmentId],
            ),
          ),
        ].map((id, index) => (
          <audio
            key={id}
            controls
            preload="none"
            aria-label={`원본 음성 ${index + 1}`}
            src={api.audioUrl(id)}
          />
        ))}
      </details>
      <ErrorMessage error={correction.error || request.error} />
      <div className={s.feedback}>
        <div className={s.feedbackHeader}>
          <span>
            <Icon name="auto_awesome" size={17} /> 학습 피드백
          </span>
          {stale ? (
            <Badge tone="warning">수정됨 · 재요청 필요</Badge>
          ) : feedback?.status === 'failed' ? (
            <Badge tone="error">생성 실패</Badge>
          ) : !ready ? (
            <Badge tone="brand">생성 중</Badge>
          ) : (
            <Badge tone="confirm">최신 보정문 기준</Badge>
          )}
        </div>
        {ready && feedback.items.length === 0 && (
          <p className={s.noFeedback}>이 문장은 추가 학습 피드백이 없어요.</p>
        )}
        {ready &&
          feedback.items.map((item) => (
            <FeedbackAccordion key={item.id} title={item.summary}>
              <p>{item.explanation}</p>
              <div className={s.expression}>
                <strong>{item.expression}</strong>
                <span>{item.meaning}</span>
                <p>{item.example}</p>
              </div>
            </FeedbackAccordion>
          ))}
        {stale && (
          <p className={s.noFeedback}>보정문이 바뀌었어요. 이 문장의 피드백을 다시 받아주세요.</p>
        )}
        {feedback?.status === 'failed' && (
          <ErrorMessage error={feedback.error?.message || '피드백 생성에 실패했어요.'} />
        )}
        {editable && (stale || feedback?.status === 'failed' || ready) && (
          <Button
            variant="ghost"
            size="sm"
            loading={request.isPending}
            onClick={() => request.mutate()}
          >
            <Icon name="refresh" size={17} />이 문장 피드백 재요청
          </Button>
        )}
      </div>
    </article>
  );
}
export function ReviewPanel({
  snapshot,
  onRefresh,
}: {
  snapshot: StudySnapshot;
  onRefresh: () => void;
}) {
  const sentences = [...snapshot.utterances].sort(
    (a, b) => a.startOrder - b.startOrder || a.sentenceIndex - b.sentenceIndex,
  );
  return (
    <section className={s.review} aria-label="문장별 대화 검토">
      <div className={s.sectionTitle}>
        <div>
          <span className={s.eyebrow}>REVIEW TOGETHER</span>
          <h2>우리의 대화를 돌아봐요</h2>
        </div>
        <Badge tone="neutral">{sentences.length}문장</Badge>
      </div>
      <p className={s.reviewIntro}>
        들린 말과 인식 보정을 비교해 주세요. 서로의 문장을 수정하고, 학습할 표현을 확인할 수 있어요.
      </p>
      {sentences.length ? (
        sentences.map((utterance) => (
          <SentenceReview
            key={utterance.id}
            utterance={utterance}
            feedback={snapshot.feedback.find((item) => item.utteranceId === utterance.id)}
            speaker={
              snapshot.study.members.find((member) => member.userId === utterance.speakerUserId)
                ?.displayName ?? '참여자'
            }
            onRefresh={onRefresh}
            editable={snapshot.topic?.state === 'review'}
          />
        ))
      ) : (
        <p className={s.noFeedback}>이번 주제에 기록된 문장이 없어요.</p>
      )}
    </section>
  );
}
