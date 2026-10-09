import type {
  Experience,
  ExperienceAnswer,
  ExperienceDraft,
  UpdateExperienceInput,
} from '@devday/contracts';

export type ExperienceEditor = {
  originalText: string;
  summary: string;
  interests: string;
  place: string;
  people: string;
  event: string;
  actions: string;
  answers: ExperienceAnswer[];
};

export const emptyEditor = (): ExperienceEditor => ({
  originalText: '',
  summary: '',
  interests: '',
  place: '',
  people: '',
  event: '',
  actions: '',
  answers: [],
});

export function toEditor(experience: Experience | ExperienceDraft): ExperienceEditor {
  return {
    originalText: experience.originalText,
    summary: experience.summary ?? '',
    interests: experience.interests.join(', '),
    place: experience.context.place ?? '',
    people: experience.context.people.join(', '),
    event: experience.context.event ?? '',
    actions: experience.context.actions.join(', '),
    answers: experience.answers.map((answer) => ({ ...answer })),
  };
}

function list(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

// The reviewed form is the save source, including changes to the original text.
export function reviewedFields(editor: ExperienceEditor): Omit<UpdateExperienceInput, 'commandId'> {
  return {
    originalText: editor.originalText,
    summary: editor.summary,
    answers: editor.answers.map((answer) => ({ ...answer })),
    interests: list(editor.interests),
    context: {
      place: editor.place.trim() || null,
      people: list(editor.people),
      event: editor.event.trim() || null,
      actions: list(editor.actions),
    },
  };
}

export function answeredQuestions(
  questions: string[],
  values: Record<string, string>,
): ExperienceAnswer[] {
  return questions
    .filter((question) => values[question]?.trim())
    .map((question) => ({ question, answer: values[question]! }));
}
