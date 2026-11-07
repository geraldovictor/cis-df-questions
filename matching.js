const matchingQuestions = new WeakMap();

function parsePairs(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const pairs = lines.map(line => /^([A-Z])\.\s*(.*?)\s*(?:->|→)\s*(\d+)\.\s*(.*)$/.exec(line));
  if (pairs.length < 2 || pairs.some(pair => !pair)) return null;
  return pairs.map(pair => ({item: pair[1], target: pair[3]}));
}

function parseMatchingQuestion(question) {
  const correct = question.alternativas?.filter(option => option.correta) ?? [];
  if (correct.length !== 1) return null;
  const pairs = parsePairs(correct[0].texto);
  if (!pairs) return null;

  const text = String(question.pergunta ?? '');
  const itemStart = text.search(/A\.\s*/);
  const targetOffset = itemStart < 0 ? -1 : text.slice(itemStart).search(/1\.\s*/);
  if (targetOffset < 0) return null;
  const targetStart = itemStart + targetOffset;
  const items = [...text.slice(itemStart, targetStart).matchAll(/([A-Z])\.\s*([\s\S]*?)(?=[A-Z]\.\s*|$)/g)]
    .map(match => ({id: match[1], text: match[2].trim()}));
  const targets = [...text.slice(targetStart).matchAll(/(\d+)\.\s*([\s\S]*?)(?=\d+\.\s*|$)/g)]
    .map(match => ({id: match[1], text: match[2].trim()}));
  if (items.length < 2 || targets.length < 2 || items.some(item => !item.text) || targets.some(target => !target.text) ||
      new Set(items.map(item => item.id)).size !== items.length || new Set(targets.map(target => target.id)).size !== targets.length ||
      pairs.length !== targets.length || new Set(pairs.map(pair => pair.target)).size !== targets.length ||
      new Set(pairs.map(pair => pair.item)).size !== pairs.length ||
      pairs.some(pair => !items.some(item => item.id === pair.item) || !targets.some(target => target.id === pair.target))) return null;
  return {prompt: text.slice(0, itemStart).trim() || 'Match each item to its description.', items, targets,
    solution: Object.fromEntries(pairs.map(pair => [pair.target, pair.item]))};
}

export function getMatchingQuestion(question) {
  if (!question || typeof question !== 'object') return null;
  if (!matchingQuestions.has(question)) matchingQuestions.set(question, parseMatchingQuestion(question));
  return matchingQuestions.get(question);
}

function answerPairs(question, selected) {
  if (!Array.isArray(selected)) return null;
  if (selected.length === 1 && Number.isInteger(selected[0])) {
    const option = question.alternativas?.[selected[0]];
    return option ? parsePairs(option.texto) : null;
  }
  const pairs = selected.map(token => typeof token === 'string' ? /^match:(\d+):([A-Z])$/.exec(token) : null);
  if (pairs.some(pair => !pair)) return null;
  return pairs.map(pair => ({target: pair[1], item: pair[2]}));
}

export function getMatchingAssignments(question, selected = []) {
  const matching = getMatchingQuestion(question);
  if (!matching) return {};
  const pairs = answerPairs(question, selected);
  if (!pairs) return {};
  return Object.fromEntries(pairs.filter(pair => matching.targets.some(target => target.id === pair.target) &&
    matching.items.some(item => item.id === pair.item)).map(pair => [pair.target, pair.item]));
}

export function isMatchingComplete(question, selected = []) {
  const matching = getMatchingQuestion(question);
  if (!matching) return false;
  const pairs = answerPairs(question, selected);
  return Boolean(pairs && pairs.length === matching.targets.length &&
    new Set(pairs.map(pair => pair.target)).size === pairs.length &&
    new Set(pairs.map(pair => pair.item)).size === pairs.length &&
    pairs.every(pair => matching.targets.some(target => target.id === pair.target) && matching.items.some(item => item.id === pair.item)));
}
