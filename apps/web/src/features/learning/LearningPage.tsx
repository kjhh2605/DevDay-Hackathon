import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LearningItem } from '@devday/contracts';
import { api } from '../../shared/api';
import { useSession } from '../../shared/session';
import { Button, Card, EmptyState, ErrorMessage, Icon } from '../../shared/ui';
import styles from './LearningPage.module.css';

type SourceFilter = 'all' | LearningItem['source'];
const filters: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'approved_feedback', label: '스터디 피드백' },
  { value: 'chat', label: '개인 챗봇' },
];
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(value),
  );

export function LearningPage() {
  const { user } = useSession();
  return user ? <LearningWorkspace key={user.id} userId={user.id} /> : null;
}

function LearningWorkspace({ userId }: { userId: string }) {
  const [source, setSource] = useState<SourceFilter>('all');
  const learning = useQuery({
    queryKey: ['learning', userId],
    queryFn: ({ signal }) => api.request('learningItems', { signal }),
    retry: false,
  });
  // Ownership comes from the server DTO, never from the feedback editor.
  const items = (learning.data ?? [])
    .filter((item) => item.ownerUserId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = source === 'all' ? items : items.filter((item) => item.source === source);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <Icon name="bookmark" size={17} /> 나의 표현 모음
          </p>
          <h1 className={styles.heading}>개인 학습 기록</h1>
          <p className={styles.description}>
            대화에서 배운 단어와 표현을 다시 만나 보세요.
            <br />
            최종 승인한 스터디 피드백과 개인 챗봇에서 저장한 기록이에요.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={learning.isFetching}
          onClick={() => {
            void learning.refetch();
          }}
        >
          <Icon name="refresh" size={18} /> 새로고침
        </Button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="학습 기록 출처">
          {filters.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              variant={source === filter.value ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={source === filter.value}
              onClick={() => setSource(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <span className={styles.count} aria-live="polite">
          {visible.length}개의 단어와 표현
        </span>
      </div>

      {learning.isPending ? (
        <p className={styles.loading} role="status">
          학습 기록을 불러오고 있어요.
        </p>
      ) : learning.isError ? (
        <ErrorMessage error={learning.error} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="bookmark_add"
          title={items.length === 0 ? '첫 표현을 기다리고 있어요' : '이 출처의 기록은 아직 없어요'}
          description={
            source === 'chat'
              ? '스터디의 개인 챗봇에 단어의 뜻이나 영어 표현을 물어보세요. 답변과 함께 내 학습 기록에 저장돼요.'
              : source === 'approved_feedback'
                ? '대화를 마치고 피드백을 최종 승인하면, 내가 말한 문장에서 배운 표현이 여기에 저장돼요.'
                : '스터디 피드백을 최종 승인하거나 개인 챗봇에 표현을 물어보면, 나만의 학습 기록이 차곡차곡 쌓여요.'
          }
        />
      ) : (
        <section className={styles.list} aria-label="저장된 학습 표현">
          {visible.map((item) => (
            <Card className={styles.card} key={item.id}>
              <div className={styles.cardHeader}>
                <span
                  className={`${styles.source} ${item.source === 'approved_feedback' ? styles.feedback : ''}`}
                >
                  <Icon
                    name={item.source === 'approved_feedback' ? 'forum' : 'chat_bubble'}
                    size={14}
                  />
                  {item.source === 'approved_feedback' ? '스터디 피드백' : '개인 챗봇'}
                </span>
                <span className={styles.kind}>{item.kind === 'word' ? '단어' : '표현'}</span>
              </div>
              <div>
                <h2 className={styles.expression}>{item.expression}</h2>
                <p className={styles.meaning}>{item.meaning}</p>
              </div>
              <blockquote className={styles.example}>
                <span className={styles.exampleLabel}>예문</span>
                {item.example}
              </blockquote>
              <div className={styles.footer}>
                <span>학습용 영어 표현</span>
                <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
              </div>
            </Card>
          ))}
        </section>
      )}
      <p className={styles.note}>
        <Icon name="lock" size={16} />
        <span>
          이 기록은 나에게만 보여요. 학습용 표현은 대화의 원문 전사·인식 오류 보정문과 별도로
          저장돼요.
        </span>
      </p>
    </main>
  );
}
