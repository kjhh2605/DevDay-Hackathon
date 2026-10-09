export const samples = [
  {
    id: 'ko-experience',
    language: 'ko',
    purpose: '한국어 경험 소개와 여러 문장의 전사 확인',
    text: '지난 주말에는 친구와 한강 공원에 갔어요. 자전거를 타고 나서 작은 카페에서 커피를 마셨어요. 다음에는 다른 친구들도 함께 가면 좋겠어요.',
  },
  {
    id: 'ko-question',
    language: 'ko',
    purpose: '한국어 질문과 숫자 표현 확인',
    text: '저는 일주일에 세 번 영어 회화를 연습해요. 아직 영어로 질문하는 게 어렵지만 조금씩 자신감이 생기고 있어요. 여러분은 어떤 방법으로 영어를 공부하나요?',
  },
  {
    id: 'en-experience',
    language: 'en',
    purpose: '영어 경험 소개와 후속 질문 확인',
    text: 'Last weekend, I visited a riverside park with a friend. We rented bicycles and stopped at a small cafe for coffee. What do you usually do when you have a free afternoon?',
  },
  {
    id: 'en-correction',
    language: 'en',
    purpose: '의도적인 문법 오류를 원문에 보존하고 학습 피드백과 비교',
    text: 'Yesterday I go to a new restaurant with my friend. The food was very delicious, and we enjoy the evening. Next time, I want try cooking the same dish at home.',
  },
  {
    id: 'mixed-missing-word',
    language: 'en-ko',
    purpose: '영어로 말하다 모르는 단어를 한국어로 대체: 예약, 품절',
    text: 'Yesterday I called a restaurant to make a, 예약, for dinner. I wanted to order their special pasta, but it was, 품절. How can I say those words in English?',
  },
  {
    id: 'mixed-missing-expression',
    language: 'en-ko',
    purpose: '영어 문장 속 모르는 표현을 한국어로 설명: 눈치가 보이다, 미루다',
    text: 'I wanted to ask my manager for a day off, but, 눈치가 보여서 말을 못 했어요. So I just, 미뤘어요, until next week. I do not know how to express that feeling in English.',
  },
];

export function selectSamples(id = 'all') {
  const selected = id === 'all' ? samples : samples.filter((sample) => sample.id === id);
  if (!selected.length) throw new Error(`알 수 없는 sample: ${id}. list 명령으로 확인하세요.`);
  return selected;
}
