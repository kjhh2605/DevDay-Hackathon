import { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { useSession } from '../../shared/session';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Icon,
  JobStatus,
  TextArea,
} from '../../shared/ui';
import { useExperienceEditor } from './useExperienceEditor';
import styles from './ExperiencePage.module.css';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(value));

export function ExperiencePage() {
  const { user } = useSession();
  return user ? <ExperienceWorkspace key={user.id} userId={user.id} /> : null;
}

function ExperienceWorkspace({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const editorElement = useRef<HTMLDivElement>(null);
  const experiences = useQuery({
    queryKey: ['experiences', userId],
    queryFn: ({ signal }) => api.request('experiences', { signal }),
    retry: false,
  });
  const form = useExperienceEditor(userId, () => {
    void queryClient.invalidateQueries({ queryKey: ['experiences', userId] });
  });
  const records = (experiences.data ?? [])
    .filter((item) => item.ownerUserId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const disabled = form.busy !== null;
  const reviewing = form.step === 'review';

  function newExperience() {
    form.reset();
    editorElement.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <Icon name="auto_stories" size={17} /> 나의 이야기
          </p>
          <h1 className={styles.heading}>경험과 관심사</h1>
          <p className={styles.description}>
            일상의 이야기가 다음 영어 대화의 시작이 돼요.
            <br />
            기억에 남는 경험을 편하게 남겨 주세요.
          </p>
        </div>
        {(reviewing || form.step === 'questions') && (
          <Button type="button" variant="secondary" disabled={disabled} onClick={newExperience}>
            <Icon name="add" size={18} /> 새 경험 쓰기
          </Button>
        )}
      </header>

      {form.saved && (
        <div className={styles.success} role="status">
          <Icon name="check_circle" size={19} /> 경험을 저장했어요. 다음 스터디 주제를 만들 때
          활용할게요.
        </div>
      )}

      <div ref={editorElement}>
        <Card className={styles.editor}>
          <div className={styles.editorIntro}>
            <span className={styles.editorIcon}>
              <Icon name={reviewing ? 'edit_note' : 'stylus_note'} size={23} />
            </span>
            <div>
              <h2 className={styles.editorHeading}>
                {reviewing
                  ? form.editingId
                    ? '저장된 경험 수정'
                    : '정리한 이야기 확인'
                  : '어떤 일이 있었나요?'}
              </h2>
              <p className={styles.caption}>
                {reviewing
                  ? '내가 말한 내용과 맞는지 확인하고, 원하는 대로 수정해 주세요.'
                  : '짧은 메모도 좋아요. 필요한 내용은 함께 정리할게요.'}
              </p>
            </div>
          </div>

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void (reviewing ? form.save() : form.prepare(form.step === 'questions'));
            }}
          >
            {reviewing ? (
              <>
                <div className={styles.comparison}>
                  <TextArea
                    label="경험 원문"
                    value={form.editor.originalText}
                    onChange={(event) => form.change('originalText', event.target.value)}
                    rows={7}
                    disabled={disabled}
                    required
                    hint="처음 적은 이야기예요. 원문도 수정할 수 있어요."
                  />
                  <TextArea
                    label="정리된 경험"
                    value={form.editor.summary}
                    onChange={(event) => form.change('summary', event.target.value)}
                    rows={7}
                    disabled={disabled}
                    required
                    hint="원문에 없는 사건이 추가되지 않았는지 확인해 주세요."
                  />
                </div>
                {form.editor.answers.length > 0 && (
                  <div className={styles.questionList}>
                    <p className={styles.sectionLabel}>추가로 남긴 이야기</p>
                    {form.editor.answers.map((answer, index) => (
                      <TextArea
                        key={`${answer.question}-${index}`}
                        label={answer.question}
                        value={answer.answer}
                        rows={2}
                        disabled={disabled}
                        onChange={(event) =>
                          form.change(
                            'answers',
                            form.editor.answers.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, answer: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
                <hr className={styles.divider} />
                <Field
                  label="관심사"
                  hint="쉼표로 구분해 적어 주세요. 예: 여행, 음식, 산책"
                  value={form.editor.interests}
                  onChange={(event) => form.change('interests', event.target.value)}
                  disabled={disabled}
                />
                <div className={styles.context}>
                  <Field
                    label="장소"
                    placeholder="알고 있는 내용만 적어 주세요"
                    value={form.editor.place}
                    onChange={(event) => form.change('place', event.target.value)}
                    disabled={disabled}
                  />
                  <Field
                    label="함께한 사람"
                    hint="여러 명이면 쉼표로 구분해 주세요"
                    value={form.editor.people}
                    onChange={(event) => form.change('people', event.target.value)}
                    disabled={disabled}
                  />
                  <Field
                    label="기억에 남는 일"
                    value={form.editor.event}
                    onChange={(event) => form.change('event', event.target.value)}
                    disabled={disabled}
                  />
                  <Field
                    label="했던 행동"
                    hint="여러 가지면 쉼표로 구분해 주세요"
                    value={form.editor.actions}
                    onChange={(event) => form.change('actions', event.target.value)}
                    disabled={disabled}
                  />
                </div>
              </>
            ) : (
              <TextArea
                label="나의 경험"
                hint="어디서, 누구와, 어떤 일이 있었나요?"
                placeholder="예: 주말에 친구와 부산에 다녀왔어요."
                value={form.editor.originalText}
                onChange={(event) => form.change('originalText', event.target.value)}
                rows={6}
                disabled={disabled}
                required
              />
            )}

            {form.step === 'questions' && (
              <section className={styles.questionList} aria-label="선택 보충 질문">
                <div>
                  <h3 className={styles.questionHeading}>조금 더 들려주실래요?</h3>
                  <p className={styles.caption}>
                    답변은 선택이에요. 생각나지 않으면 건너뛰어도 괜찮아요.
                  </p>
                </div>
                {form.draft?.questions.map((question, index) => (
                  <TextArea
                    key={`${question}-${index}`}
                    label={question}
                    value={form.questionValues[question] ?? ''}
                    onChange={(event) =>
                      form.setQuestionValues((previous) => ({
                        ...previous,
                        [question]: event.target.value,
                      }))
                    }
                    rows={2}
                    disabled={disabled}
                    placeholder="자유롭게 적어 주세요 (선택)"
                  />
                ))}
              </section>
            )}

            {form.busy === 'preparing' && (
              <div role="status">
                <JobStatus job={form.job} status="running" />
                <p className={styles.caption}>작성한 내용을 바탕으로 경험을 정리하고 있어요.</p>
              </div>
            )}
            {form.error != null && <ErrorMessage error={form.error} />}

            <div className={styles.row}>
              <span className={styles.privateNote}>
                <Icon name="lock" size={15} /> 원문은 나만 볼 수 있어요
              </span>
              <div className={styles.buttons}>
                {form.step === 'questions' && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      void form.prepare(true);
                    }}
                  >
                    {Object.values(form.questionValues).some((value) => value.trim())
                      ? '남은 질문 건너뛰기'
                      : '답변 없이 계속하기'}
                  </Button>
                )}
                {reviewing && (
                  <Button type="button" variant="ghost" disabled={disabled} onClick={newExperience}>
                    닫기
                  </Button>
                )}
                <Button
                  type="submit"
                  loading={disabled}
                  disabled={
                    disabled ||
                    !form.editor.originalText.trim() ||
                    (reviewing && !form.editor.summary.trim())
                  }
                >
                  {form.busy === 'saving'
                    ? '저장 중…'
                    : form.busy === 'preparing'
                      ? '정리 중…'
                      : reviewing
                        ? '확인하고 저장'
                        : form.step === 'questions'
                          ? '답변으로 정리하기'
                          : '경험 정리하기'}
                  {!disabled && <Icon name={reviewing ? 'check' : 'arrow_forward'} size={18} />}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </div>

      <section className={styles.savedSection} aria-labelledby="saved-experiences-heading">
        <div className={styles.row}>
          <h2 id="saved-experiences-heading" className={styles.sectionHeading}>
            저장한 이야기 <span className={styles.count}>{records.length}개</span>
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void experiences.refetch();
            }}
            disabled={experiences.isFetching}
          >
            <Icon name="refresh" size={16} /> 새로고침
          </Button>
        </div>
        {experiences.isPending ? (
          <p className={styles.loading} role="status">
            저장한 경험을 불러오고 있어요.
          </p>
        ) : experiences.isError ? (
          <ErrorMessage error={experiences.error} />
        ) : records.length === 0 ? (
          <EmptyState
            icon="auto_stories"
            title="아직 저장한 이야기가 없어요"
            description="위에서 첫 경험을 정리하고 저장해 보세요. 나에게 익숙한 상황으로 영어 대화를 시작할 수 있어요."
          />
        ) : (
          <div className={styles.cards}>
            {records.map((experience) => (
              <Card key={experience.id} className={styles.experienceCard}>
                <div className={styles.cardHeader}>
                  <time className={styles.date} dateTime={experience.updatedAt}>
                    {formatDate(experience.updatedAt)} 수정
                  </time>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={`${experience.summary.slice(0, 40)} 경험 수정`}
                    onClick={() => {
                      form.edit(experience);
                      editorElement.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    <Icon name="edit" size={16} /> 수정
                  </Button>
                </div>
                <p className={styles.summary}>{experience.summary}</p>
                {experience.interests.length > 0 && (
                  <div className={styles.tags}>
                    {experience.interests.map((interest, index) => (
                      <span className={styles.tag} key={`${interest}-${index}`}>
                        {interest}
                      </span>
                    ))}
                  </div>
                )}
                {(experience.context.place || experience.context.people.length > 0) && (
                  <div className={styles.contextPreview}>
                    <Icon name="location_on" size={16} />
                    <span>
                      {[experience.context.place, experience.context.people.join(', ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
                <details className={styles.original}>
                  <summary>경험 원문 보기</summary>
                  <p>{experience.originalText}</p>
                </details>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
