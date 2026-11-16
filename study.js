import { selectBlueprintQuestions, samplingSnapshot } from './sampling.js';
import { shuffle, isCorrect } from './quiz.js';
import { getMatchingQuestion, isMatchingComplete } from './matching.js';
import { DEFAULT_CERTIFICATION, getCertification } from './certification.js';

export function createStudy(questions, userId, certificationId = questions[0]?.certification || DEFAULT_CERTIFICATION) {
  if (!questions.length) throw new Error('Não há questões disponíveis.');
  const chosen = shuffle(questions);
  return {
    id: crypto.randomUUID(), user_id: userId, started_at: new Date().toISOString(),
    finished_at: null, score: null, total: chosen.length,
    state: { mode: 'study', certification: certificationId, ids: chosen.map(q => q.id),
      orders: Object.fromEntries(chosen.map(q => [q.id, shuffle(q.alternativas.map((_, i) => i))])),
      answers: {}, confirmed: {}, cursor: 0 }
  };
}

export function createPractice(questions, userId, certificationId = questions[0]?.certification || DEFAULT_CERTIFICATION) {
  const total = getCertification(certificationId).examSize;
  if (questions.length < total) throw new Error(`São necessárias pelo menos ${total} questões para iniciar o treino.`);
  if (new Set(questions.map(question => question.id)).size !== questions.length) {
    throw new Error('O banco de questões contém identificadores repetidos.');
  }
  const practice = createStudy(selectBlueprintQuestions(questions, total, certificationId), userId, certificationId);
  practice.state.variant = 'practice';
  Object.assign(practice.state,samplingSnapshot(practice.state.ids.map(id=>questions.find(q=>q.id===id)),certificationId));
  return practice;
}

export function isPracticeStudy(record) {
  return ['practice', 'practice60'].includes(record?.state?.variant);
}

export function confirmStudyAnswer(attempt, question, selected) {
  if (attempt.finished_at || attempt.state.confirmed[question.id]) return false;
  const matching = getMatchingQuestion(question);
  const required = question.alternativas.filter(a => a.correta).length;
  if (matching && !isMatchingComplete(question, selected)) {
    throw new Error('Complete todas as associações antes de confirmar.');
  }
  if (!matching && (selected.length !== required || new Set(selected).size !== required ||
      selected.some(i => !Number.isInteger(i) || !question.alternativas[i]))) {
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
