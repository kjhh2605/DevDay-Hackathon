import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, ShareProposal, CommandResult, Job } from '@devday/contracts';
import { api } from '../../shared/api';
import { useUserEvent } from '../../shared/events';
import { useSession } from '../../shared/session';
import { upsertRevision } from '../study/model';

export function useCommandExecution(result: CommandResult) {
  const { user } = useSession();
  const cache = useQueryClient();
  const key = ['job', user?.id, result.jobId];
  const job = useQuery({
    queryKey: key,
    queryFn: async () => {
      const incoming = await api.request('job', { params: { id: result.jobId! } });
      const old = cache.getQueryData<Job>(key);
      return old && old.revision > incoming.revision ? old : incoming;
    },
    enabled: !!result.jobId,
  });
  useUserEvent((event) => {
    if (event.type === 'job.updated' && event.payload.id === result.jobId)
      cache.setQueryData<Job>(key, (old) =>
        !old || old.revision < event.payload.revision ? event.payload : old,
      );
  });
  return job;
}

export function usePrivateChat(studyId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = ['chat', user?.id, studyId];
  const messages = useQuery({
    queryKey: key,
    queryFn: async () => {
      const incoming = await api.request('chatMessages', { params: { studyId } });
      return (queryClient.getQueryData<ChatMessage[]>(key) ?? []).reduce(
        (items, item) => upsertRevision(items, item, (value) => value.id),
        incoming,
      );
    },
  });
  const proposalKey = ['shareProposals', user?.id, studyId];
  const proposalQuery = useQuery({
    queryKey: proposalKey,
    queryFn: async () => {
      const incoming = await api.request('shareProposals', { params: { studyId } });
      return (queryClient.getQueryData<ShareProposal[]>(proposalKey) ?? []).reduce(
        (items, item) => upsertRevision(items, item, (value) => value.id),
        incoming,
      );
    },
  });
  const [text, setText] = useState('');
  const proposals = Object.fromEntries(
    (proposalQuery.data ?? []).map((proposal) => [proposal.id, proposal]),
  );
  const [eventError, setEventError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (input: string) =>
      api.request('sendChatMessage', {
        params: { studyId },
        body: { text: input, clientMessageId: crypto.randomUUID() },
      }),
    onSuccess: (result) => {
      setText('');
      queryClient.setQueryData<ChatMessage[]>(key, (old) =>
        upsertRevision(old ?? [], result.message, (item) => item.id),
      );
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      api.request('decideShareProposal', {
        params: { id },
        body: { accepted, commandId: crypto.randomUUID() },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData<ShareProposal[]>(proposalKey, (old) =>
        upsertRevision(old ?? [], result.proposal, (item) => item.id),
      );
    },
  });
  useUserEvent((event) => {
    if (event.studyId !== studyId) return;
    if (event.type === 'chat.message.updated' && event.payload.ownerUserId === user?.id)
      queryClient.setQueryData<ChatMessage[]>(key, (old) =>
        upsertRevision(old ?? [], event.payload, (item) => item.id),
      );
    if (event.type === 'share-proposal.updated' && event.payload.ownerUserId === user?.id)
      queryClient.setQueryData<ShareProposal[]>(proposalKey, (old) =>
        upsertRevision(old ?? [], event.payload, (item) => item.id),
      );
    if (
      event.type === 'job.updated' &&
      event.payload.kind === 'chat.respond' &&
      event.payload.ownerUserId === user?.id &&
      event.payload.status === 'failed'
    )
      setEventError(event.payload.error?.message ?? '요청을 완료하지 못했어요.');
  });
  const sorted = [...(messages.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
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
  };
}
