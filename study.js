import { shuffle, isCorrect } from './quiz.js';

export function createStudy(questions, userId) {
  if (!questions.length) throw new Error('Não há questões disponíveis.');
  const chosen = shuffle(questions);
  return {
    id: crypto.randomUUID(), user_id: userId, started_at: new Date().toISOString(),
    finished_at: null, score: null, total: chosen.length,
    state: { mode: 'study', ids: chosen.map(q => q.id),
      orders: Object.fromEntries(chosen.map(q => [q.id, shuffle(q.alternativas.map((_, i) => i))])),
      answers: {}, confirmed: {}, cursor: 0 }
  };
}

export function confirmStudyAnswer(attempt, question, selected) {
  if (attempt.finished_at || attempt.state.confirmed[question.id]) return false;
  const required = question.alternativas.filter(a => a.correta).length;
  if (selected.length !== required || new Set(selected).size !== required ||
      selected.some(i => !Number.isInteger(i) || !question.alternativas[i])) {
    throw new Error(`Selecione ${required} alternativa(s) antes de confirmar.`);
  }
  attempt.state.answers[question.id] = [...selected];
  attempt.state.confirmed[question.id] = true;
  return true;
}

export function studyProgress(attempt, byId) {
  const ids = attempt.state.ids.filter(id => attempt.state.confirmed[id]);
  const correct = ids.filter(id => isCorrect(byId[id], attempt.state.answers[id])).length;
  return { answered: ids.length, correct, wrong: ids.length - correct,
    remaining: attempt.total - ids.length,
    accuracy: ids.length ? Math.round(correct / ids.length * 100) : 0 };
}
