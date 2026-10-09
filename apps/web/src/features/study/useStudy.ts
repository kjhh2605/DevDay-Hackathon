import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { StudyCommand, StudySnapshot, Utterance } from '@devday/contracts';
import { api } from '../../shared/api';

export function useStudyCreation(onStudy: (id: string) => void) {
  const [open, setOpen] = useState(false);
  const [handles, setHandles] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: async () => {
      const participantHandles = [
        ...new Set(
          handles
            .split(/[\s,]+/)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (!participantHandles.length) throw new Error('초대할 친구의 아이디를 입력해 주세요.');
      const result = await api.request('resolveUsers', { body: { handles: participantHandles } });
      setMissing(result.missingHandles);
      if (result.missingHandles.length)
        throw new Error(`아이디를 찾지 못했어요: ${result.missingHandles.join(', ')}`);
      return api.request('createStudy', {
        body: { participantHandles, commandId: crypto.randomUUID() },
      });
    },
    onSuccess: (study) => {
      setOpen(false);
      onStudy(study.id);
    },
  });
  return { open, setOpen, handles, setHandles, missing, setMissing, create };
}

export function useStudyCommand(snapshot: StudySnapshot | null, onRefresh: () => void) {
  const [focus, setFocus] = useState('');
  const command = useMutation({
    mutationFn: (type: StudyCommand['type']) => {
      if (!snapshot) throw new Error('스터디 정보를 불러오고 있어요.');
      const common = {
        commandId: crypto.randomUUID(),
        expectedTransitionVersion: snapshot.study.transitionVersion,
      };
      const body: StudyCommand =
        type === 'study.start'
          ? { ...common, type, expectedTopicId: null, focusUserId: focus || null }
          : type === 'topic.advance'
            ? { ...common, type, expectedTopicId: snapshot.topic!.id, focusUserId: focus || null }
            : type === 'topic.close'
              ? { ...common, type, expectedTopicId: snapshot.topic!.id }
              : { ...common, type, expectedTopicId: snapshot.topic?.id ?? null };
      return api.request('studyCommand', { params: { studyId: snapshot.study.id }, body });
    },
    onSuccess: onRefresh,
    onError: onRefresh,
  });
  return { command, focus, setFocus };
}

export function useSentenceActions(
  utterance: Utterance,
  text: string,
  onSaved: () => void,
  onRefresh: () => void,
) {
  const correction = useMutation({
    mutationFn: () =>
      api.request('updateCorrection', {
        params: { id: utterance.id },
        body: { text, commandId: crypto.randomUUID() },
      }),
    onSuccess: () => {
      onSaved();
      onRefresh();
    },
  });
  const request = useMutation({
    mutationFn: () =>
      api.request('requestFeedback', {
        params: { id: utterance.id },
        body: { correctionRevision: utterance.correctionRevision, commandId: crypto.randomUUID() },
      }),
    onSuccess: onRefresh,
  });
  return { correction, request };
}
