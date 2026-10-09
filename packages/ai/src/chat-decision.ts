import type { ToolName } from '@devday/contracts';

export const CHAT_CHOICES = [
  { value: 'get_study_context', description: '현재 스터디 상태, 참여자, 주제 조회' },
  { value: 'start_study', description: '대기 중인 스터디 시작. 특정 참여자의 경험으로 시작 포함' },
  { value: 'close_topic', description: '현재 주제 대화를 마무리하고 문장별 리뷰 준비' },
  { value: 'advance_topic', description: '리뷰를 승인·저장하고 다음 주제 생성' },
  { value: 'finish_study', description: '스터디 전체 종료 절차 진행' },
  { value: 'explain_word', description: '단어 뜻과 예문 설명 및 개인 학습 기록 저장' },
  { value: 'learn_expression', description: '영어 표현 제안, 개인 저장 및 공유 제안 생성' },
  { value: 'list_my_learning', description: '본인의 학습 기록 조회 또는 검색' },
  { value: 'request_sentence_feedback', description: '특정 발화의 최신 보정문에 대한 피드백 요청' },
  { value: 'accept_expression_share', description: '직전의 표현 공유 제안을 명시적으로 수락' },
  { value: 'decline_expression_share', description: '직전의 표현 공유 제안을 명시적으로 거절' },
  { value: 'general_chat', description: '서비스 실행 요청 없이 일반 대화 또는 설명' },
  {
    value: 'clarify_intent',
    description: '의도 불명확, 복합 요청, 대상 불명확 또는 현재 불가능한 기능 요청',
  },
] as const;
export type ChatChoice = (typeof CHAT_CHOICES)[number]['value'];
export interface ChatDecision {
  choice: ChatChoice;
  confidence: number;
}
export interface ChatDecisionInput {
  text: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  context: unknown;
  allowedChoices: ChatChoice[];
  pendingSharing: { id: string; expression: string } | null;
}
export const CHAT_DECISION_CONFIDENCE = 0.5;
export function chatChoices(allowedActions: ToolName[], canShare: boolean): ChatChoice[] {
  return [
    ...allowedActions,
    ...(canShare ? (['accept_expression_share', 'decline_expression_share'] as const) : []),
    'general_chat',
    'clarify_intent',
  ];
}
