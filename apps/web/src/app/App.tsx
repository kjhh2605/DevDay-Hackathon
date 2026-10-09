import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { connectEvents, ApiError } from '@devday/client';
import type { EventConnectionStatus } from '@devday/client';
import type { Invitation, StudySnapshot } from '@devday/contracts';
import { api } from '../shared/api';
import { SessionContext } from '../shared/session';
import { UserEventsContext } from '../shared/events';
import type { EventListener } from '../shared/events';
import { MicrophoneProvider } from '../shared/audio';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorMessage,
  Icon,
  LoadingSkeleton,
  NavigationTabs,
  SnackbarProvider,
  useToast,
} from '../shared/ui';
import { AuthPage } from '../features/auth/AuthPage';
import { StudyLobby, StudyPage } from '../features/study/StudyPage';
import { applyStudyEvent, mergeSnapshot } from '../features/study/model';
import { ExperiencePage } from '../features/experiences';
import { LearningPage } from '../features/learning';
import s from './App.module.css';

function AppContent() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.request('me') });
  const user =
    me.error instanceof ApiError && me.error.code === 'UNIDENTIFIED' ? null : (me.data ?? null);
  const [activeStudyId, setActiveStudyId] = useState<string | null>(
    () => location.pathname.match(/^\/study\/([^/]+)$/)?.[1] ?? null,
  );
  const studyRef = useRef(activeStudyId);
  studyRef.current = activeStudyId;
  const listeners = useRef(new Set<EventListener>());
  const subscribe = useCallback((listener: EventListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const connection = useRef<ReturnType<typeof connectEvents> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<EventConnectionStatus>('connecting');
  const [connectionError, setConnectionError] = useState<unknown>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const joinedStudyIds = useRef(new Set<string>());
  const invitations = useQuery({
    queryKey: ['invitations', user?.id],
    queryFn: async ({ signal }) => {
      const before = new Set(
        (queryClient.getQueryData<Invitation[]>(['invitations', user?.id]) ?? []).map(
          (item) => item.studyId,
        ),
      );
      const incoming = await api.request('invitations', { signal });
      const arrivedDuringFetch = (
        queryClient.getQueryData<Invitation[]>(['invitations', user?.id]) ?? []
      ).filter((item) => !before.has(item.studyId));
      return [
        ...new Map(
          [...incoming, ...arrivedDuringFetch].map((item) => [item.studyId, item]),
        ).values(),
      ].filter((item) => !joinedStudyIds.current.has(item.studyId));
    },
    enabled: !!user,
  });
  const study = useQuery({
    queryKey: ['study', activeStudyId],
    queryFn: async () => {
      const incoming = await api.request('studySnapshot', { params: { studyId: activeStudyId! } });
      return mergeSnapshot(
        queryClient.getQueryData<StudySnapshot>(['study', activeStudyId]),
        incoming,
      );
    },
    enabled: !!user && !!activeStudyId,
  });
  const enterStudy = useCallback(
    (id: string) => {
      setActiveStudyId(id);
      navigate(`/study/${id}`);
    },
    [navigate],
  );
  const refresh = useCallback(() => {
    if (studyRef.current)
      void queryClient.invalidateQueries({ queryKey: ['study', studyRef.current] });
  }, [queryClient]);
  useEffect(() => {
    const id = location.pathname.match(/^\/study\/([^/]+)$/)?.[1];
    if (id) setActiveStudyId(id);
  }, [location.pathname]);
  useEffect(() => {
    if (!user) return;
    setConnectionError(null);
    let closed = false;
    const events = connectEvents({
      onStatus: (status) => {
        if (!closed) {
          setConnectionStatus(status);
          if (status === 'connected')
            void queryClient
              .cancelQueries({ queryKey: ['invitations', user.id] })
              .then(() => queryClient.invalidateQueries({ queryKey: ['invitations', user.id] }));
        }
      },
      onError: (error) => {
        if (!closed) setConnectionError(error);
      },
      onSnapshot: (snapshot) => {
        if (snapshot.study.id !== studyRef.current) return;
        queryClient.setQueryData<StudySnapshot>(['study', snapshot.study.id], (old) =>
          mergeSnapshot(old, snapshot),
        );
      },
      onEvent: (event) => {
        if (event.type === 'invitation.created')
          queryClient.setQueryData<Invitation[]>(['invitations', user.id], (old) =>
            old?.some((item) => item.studyId === event.payload.studyId)
              ? old
              : [...(old ?? []), event.payload],
          );
        if (event.type === 'learning-items.changed')
          void queryClient.invalidateQueries({ queryKey: ['learning', user.id] });
        if (event.studyId && event.scope === 'study')
          queryClient.setQueryData<StudySnapshot>(['study', event.studyId], (old) =>
            old ? applyStudyEvent(old, event) : old,
          );
        for (const listener of listeners.current) listener(event);
      },
    });
    connection.current = events;
    if (studyRef.current) events.subscribe(studyRef.current);
    return () => {
      closed = true;
      events.close();
      connection.current = null;
    };
  }, [user?.id, queryClient]);
  useEffect(() => {
    if (activeStudyId) connection.current?.subscribe(activeStudyId);
  }, [activeStudyId, user?.id]);
  const join = useMutation({
    mutationFn: (id: string) =>
      api.request('joinStudy', {
        params: { studyId: id },
        body: { commandId: crypto.randomUUID() },
      }),
    onSuccess: (snapshot) => {
      joinedStudyIds.current.add(snapshot.study.id);
      queryClient.setQueryData(['study', snapshot.study.id], snapshot);
      queryClient.setQueryData<Invitation[]>(['invitations', user?.id], (old) =>
        old?.filter((item) => item.studyId !== snapshot.study.id),
      );
      enterStudy(snapshot.study.id);
      toast('스터디에 참여했어요. 함께 이야기를 시작해 보세요.');
    },
  });
  const invitation = invitations.data?.find((item) => !dismissed.has(item.studyId));
  if (me.isPending)
    return (
      <div className={s.initial}>
        <LoadingSkeleton />
        <p>말모아를 준비하고 있어요.</p>
      </div>
    );
  if (!user) {
    if (me.error && !(me.error instanceof ApiError && me.error.code === 'UNIDENTIFIED'))
      return (
        <div className={s.initial}>
          <Card>
            <ErrorMessage error={me.error} />
            <Button onClick={() => void me.refetch()}>다시 연결하기</Button>
          </Card>
        </div>
      );
    return (
      <AuthPage
        onRegistered={(registered) => {
          queryClient.clear();
          setActiveStudyId(null);
          setDismissed(new Set());
          joinedStudyIds.current.clear();
          queryClient.setQueryData(['me'], registered);
          navigate('/study');
        }}
      />
    );
  }
  const route = location.pathname.startsWith('/experiences')
    ? 'experiences'
    : location.pathname.startsWith('/learning')
      ? 'learning'
      : 'study';
  return (
    <SessionContext.Provider value={{ user }}>
      <UserEventsContext.Provider value={subscribe}>
        <MicrophoneProvider
          key={`${user.id}:${activeStudyId ?? 'lobby'}`}
          snapshot={study.data ?? null}
        >
          <div className={s.app}>
            <header className={s.header}>
              <Link to={activeStudyId ? `/study/${activeStudyId}` : '/study'} className={s.brand}>
                <span className={s.brandMark}>
                  <Icon name="forum" size={23} />
                </span>
                <span>
                  말모아<small>MALMOA</small>
                </span>
              </Link>
              <div className={s.headerRight}>
                <span className={connectionStatus === 'connected' ? s.connected : s.disconnected}>
                  <i />
                  {connectionStatus === 'connected'
                    ? '실시간 연결됨'
                    : connectionStatus === 'connecting'
                      ? '연결 중'
                      : '연결 끊김'}
                </span>
                <button
                  type="button"
                  className={s.inviteButton}
                  onClick={() => setDismissed(new Set())}
                  aria-label="받은 초대 보기"
                >
                  <Icon name="notifications" size={20} />
                  {!!invitations.data?.length && <b>{invitations.data.length}</b>}
                </button>
                <div className={s.profile}>
                  <span>{user.displayName.slice(0, 1)}</span>
                  <div>
                    <strong>{user.displayName}</strong>
                    <small>@{user.handle}</small>
                  </div>
                </div>
              </div>
            </header>
            <NavigationTabs
              value={route}
              onValueChange={(value) =>
                navigate(
                  value === 'study'
                    ? activeStudyId
                      ? `/study/${activeStudyId}`
                      : '/study'
                    : `/${value}`,
                )
              }
              items={[
                { value: 'study', label: '스터디', icon: 'forum' },
                { value: 'experiences', label: '나의 경험', icon: 'edit_note' },
                { value: 'learning', label: '나의 학습', icon: 'book_2' },
              ]}
              className={s.navigation}
              listClassName={s.navList}
              panelClassName={s.navPanel}
            >
              <div className={s.content}>
                <ErrorMessage error={invitations.error} />
                {(connectionError ||
                  connectionStatus === 'closed' ||
                  connectionStatus === 'failed') && (
                  <div className={s.connectionNotice}>
                    <ErrorMessage
                      error={
                        connectionError ||
                        '실시간 연결이 끊겼어요. 변경 사항을 받으려면 페이지를 새로고침해 주세요.'
                      }
                    />
                    <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                      새로고침
                    </Button>
                  </div>
                )}
                <Routes>
                  <Route
                    path="/study"
                    element={
                      activeStudyId ? (
                        <Navigate to={`/study/${activeStudyId}`} replace />
                      ) : (
                        <StudyLobby onStudy={enterStudy} />
                      )
                    }
                  />
                  <Route
                    path="/study/:studyId"
                    element={
                      <StudyPage
                        snapshot={study.data ?? null}
                        error={study.error}
                        onRefresh={refresh}
                        onNewStudy={() => {
                          setActiveStudyId(null);
                          navigate('/study');
                        }}
                      />
                    }
                  />
                  <Route path="/experiences" element={<ExperiencePage />} />
                  <Route path="/learning" element={<LearningPage />} />
                  <Route path="*" element={<Navigate to="/study" replace />} />
                </Routes>
              </div>
            </NavigationTabs>
            <Dialog
              open={!!invitation}
              onOpenChange={(open) => {
                if (!open && invitation)
                  setDismissed((old) => new Set([...old, invitation.studyId]));
              }}
              title="스터디 초대가 도착했어요"
              description={
                invitation
                  ? `${invitation.inviter.displayName} (@${invitation.inviter.handle}) 님이 함께 이야기하고 싶어 해요.`
                  : undefined
              }
            >
              <div className={s.invitation}>
                <span className={s.invitationIcon}>
                  <Icon name="waving_hand" size={36} />
                </span>
                <p>우리의 경험으로 영어 대화를 시작해 볼까요?</p>
                <ErrorMessage error={join.error} />
                <Button
                  onClick={() => invitation && join.mutate(invitation.studyId)}
                  loading={join.isPending}
                >
                  참여하기
                  <Icon name="arrow_forward" size={18} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    invitation && setDismissed((old) => new Set([...old, invitation.studyId]))
                  }
                >
                  나중에 참여
                </Button>
              </div>
            </Dialog>
          </div>
        </MicrophoneProvider>
      </UserEventsContext.Provider>
    </SessionContext.Provider>
  );
}
export function App() {
  return (
    <SnackbarProvider>
      <AppContent />
    </SnackbarProvider>
  );
}
