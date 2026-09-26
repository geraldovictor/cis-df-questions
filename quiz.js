export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createAttempt(questions, userId) {
  if (questions.length < 75) throw new Error('São necessárias pelo menos 75 questões.');
  const chosen = shuffle(questions).slice(0, 75);
  return {
    id: crypto.randomUUID(), user_id: userId, started_at: new Date().toISOString(),
    finished_at: null, score: null, total: 75,
    state: { ids: chosen.map(q => q.id), orders: Object.fromEntries(chosen.map(q => [q.id, shuffle(q.alternativas.map((_, i) => i))])), answers: {}, cursor: 0 }
  };
}

export function isCorrect(question, selected = []) {
  const expected = question.alternativas.flatMap((a, i) => a.correta ? [i] : []);
  return selected.length === expected.length && expected.every(i => selected.includes(i));
}

export function scoreAttempt(attempt, byId) {
  return attempt.state.ids.reduce((sum, id) => sum + Number(isCorrect(byId[id], attempt.state.answers[id])), 0);
}
