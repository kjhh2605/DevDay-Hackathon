import { useEffect, useRef, useState } from 'react';
import type { Experience, ExperienceDraft, Job } from '@devday/contracts';
import { api } from '../../shared/api';
import {
  answeredQuestions,
  emptyEditor,
  reviewedFields,
  toEditor,
  type ExperienceEditor,
} from './model';

export function useExperienceEditor(userId: string, onSaved: () => void) {
  const [editor, setEditor] = useState<ExperienceEditor>(emptyEditor);
  const [draft, setDraft] = useState<ExperienceDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [questionValues, setQuestionValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'writing' | 'questions' | 'review'>('writing');
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<'preparing' | 'saving' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const operation = useRef(0);
  const inFlight = useRef(false);
  const saveIntent = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const prepareIntent = useRef<{ fingerprint: string; commandId: string } | null>(null);

  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );

  function change<K extends keyof ExperienceEditor>(key: K, value: ExperienceEditor[K]) {
    setEditor((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
  }

  function reset() {
    if (inFlight.current) return;
    operation.current += 1;
    setEditor(emptyEditor());
    setDraft(null);
    setEditingId(null);
    setQuestionValues({});
    setStep('writing');
    setJob(null);
    setError(null);
    setSaved(false);
    saveIntent.current = null;
    prepareIntent.current = null;
  }

  function edit(experience: Experience) {
    if (inFlight.current || experience.ownerUserId !== userId) return;
    reset();
    setEditor(toEditor(experience));
    setEditingId(experience.id);
    setStep('review');
  }

  async function prepare(skipQuestions: boolean) {
    if (inFlight.current || !editor.originalText.trim()) return;
    inFlight.current = true;
    const current = ++operation.current;
    setBusy('preparing');
    setError(null);
    setSaved(false);
    setJob(null);
    const answers =
      step === 'questions'
        ? answeredQuestions(draft?.questions ?? [], questionValues)
        : editor.answers;
    const input = { originalText: editor.originalText, answers, skipQuestions };
    const fingerprint = JSON.stringify(input);
    if (prepareIntent.current?.fingerprint !== fingerprint) {
      prepareIntent.current = { fingerprint, commandId: crypto.randomUUID() };
    }
    try {
      let result = await api.request('prepareExperience', {
        body: { ...input, commandId: prepareIntent.current.commandId },
      });
      while (current === operation.current) {
        if (result.kind !== 'experience.prepare' || result.ownerUserId !== userId)
          throw new Error('경험 정리 결과를 확인할 수 없어요. 다시 시도해 주세요.');
        setJob(result);
        if (result.status === 'failed') {
          prepareIntent.current = null;
          throw new Error(result.error?.message ?? '경험을 정리하지 못했어요. 다시 시도해 주세요.');
        }
        if (result.status === 'succeeded') {
          const next = result.result?.draft;
          if (!next || next.ownerUserId !== userId)
            throw new Error('정리된 경험을 불러오지 못했어요.');
          setDraft(next);
          setEditor(toEditor(next));
          setQuestionValues(
            Object.fromEntries(next.answers.map((answer) => [answer.question, answer.answer])),
          );
          // Providers may return a provisional summary alongside optional questions.
          setStep(next.questions.length > 0 ? 'questions' : 'review');
          prepareIntent.current = null;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (current !== operation.current) return;
        result = await api.request('job', { params: { id: result.id } });
      }
    } catch (cause) {
      if (current === operation.current) setError(cause);
    } finally {
      if (current === operation.current) {
        setBusy(null);
        inFlight.current = false;
      }
    }
  }

  async function save() {
    if (
      inFlight.current ||
      !editor.originalText.trim() ||
      !editor.summary.trim() ||
      (!editingId && !draft)
    )
      return;
    inFlight.current = true;
    const current = ++operation.current;
    setBusy('saving');
    setError(null);
    setSaved(false);
    const fields = reviewedFields(editor);
    const fingerprint = JSON.stringify({ fields, editingId, draftId: draft?.id });
    if (saveIntent.current?.fingerprint !== fingerprint)
      saveIntent.current = { fingerprint, commandId: crypto.randomUUID() };
    try {
      const commandId = saveIntent.current.commandId;
      const result = editingId
        ? await api.request('updateExperience', {
            params: { id: editingId },
            body: { ...fields, commandId },
          })
        : await api.request('createExperience', {
            body: { ...fields, draftId: draft!.id, commandId },
          });
      if (current !== operation.current) return;
      if (result.ownerUserId !== userId)
        throw new Error('저장된 경험의 사용자를 확인할 수 없어요.');
      // Keep the saved ID when the user makes another edit to this form.
      setEditingId(result.id);
      setEditor(toEditor(result));
      setDraft(null);
      setJob(null);
      setSaved(true);
      saveIntent.current = null;
      onSaved();
    } catch (cause) {
      if (current === operation.current) setError(cause);
    } finally {
      if (current === operation.current) {
        setBusy(null);
        inFlight.current = false;
      }
    }
  }

  return {
    editor,
    change,
    draft,
    editingId,
    questionValues,
    setQuestionValues,
    step,
    job,
    busy,
    error,
    saved,
    reset,
    edit,
    prepare,
    save,
  };
}
