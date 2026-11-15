export const DEFAULT_CERTIFICATION = 'cis-df';

export const certifications = Object.freeze([
  { id: 'cis-df', label: 'CIS-DF', name: 'Data Foundations', examSize: 75,
    files: ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json'],
    memoryAids: 'memory-aids.json' },
  { id: 'cis-em', label: 'CIS-EM', name: 'Event Management', examSize: 30,
    files: ['data/cis-em/questions.json'], memoryAids: 'data/cis-em/memory-aids.json',
    blueprint: { updated: 'janeiro de 2026', verified: '2026-11-14', durationMinutes: 60,
      url: 'https://learning.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0011604',
      domains: [['Event Management Overview', 7], ['Architecture and Discovery', 10], ['Event Configuration and Use', 27],
        ['Alerts and Tasks', 30], ['Event Sources', 16], ['Metric Intelligence', 10]] } },
  { id: 'cis-cad', label: 'CAD', name: 'Application Developer', examSize: 60,
    files: ['data/cis-cad/questions.json'], memoryAids: 'data/cis-cad/memory-aids.json',
    blueprint: { updated: 'janeiro de 2026', verified: '2026-11-14', durationMinutes: 90,
      url: 'https://learning.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0011498',
      domains: [['Designing and Creating an Application', 20], ['Application User Interface', 20], ['Security and Restricting Access', 20],
        ['Application Automation', 20], ['Working with External Data', 10], ['Managing Applications', 10]] } }
]);

export function getCertification(id = DEFAULT_CERTIFICATION) {
  const certification = certifications.find(item => item.id === id);
  if (!certification) throw new Error('Certificação não encontrada.');
  return certification;
}

export function certificationStorageKey(feature, certificationId = DEFAULT_CERTIFICATION, userId) {
  getCertification(certificationId);
  return `${certificationId}-${feature}${userId ? `-${userId}` : ''}`;
}

// Results saved before certification selection belonged to CIS-DF.
export function getRecordCertification(record) {
  return record?.state?.certification ?? DEFAULT_CERTIFICATION;
}

export async function loadQuestionBank(certificationId = DEFAULT_CERTIFICATION, fetcher = fetch) {
  const certification = getCertification(certificationId);
  const sets = await Promise.all(certification.files.map(async file => {
    const response = await fetcher(new URL(file, import.meta.url));
    if (!response.ok) throw new Error(`Não foi possível carregar as questões de ${certification.label}.`);
    const set = await response.json();
    if (!Array.isArray(set)) throw new Error('O banco de questões está em um formato inválido.');
    return set;
  }));
  const questions = sets.flatMap((set, fileIndex) => set.map((question, index) => ({
    ...question,
    id: certificationId === DEFAULT_CERTIFICATION ? `${fileIndex + 1}-${index + 1}` : question.id,
    certification: certificationId
  })));
  const ids = new Set();
  for (const question of questions) {
    if (typeof question.id !== 'string' || !question.id || ids.has(question.id) ||
        typeof question.pergunta !== 'string' || !question.pergunta.trim() ||
        !Array.isArray(question.alternativas) || question.alternativas.length < (question.tipo === 'matching' ? 1 : 2) ||
        !question.alternativas.some(option => option.correta === true) ||
        question.alternativas.some(option => typeof option.texto !== 'string' || !option.texto.trim() || typeof option.correta !== 'boolean')) {
      throw new Error(`Questão inválida no banco de ${certification.label}: ${question.id || 'sem identificação'}.`);
    }
    ids.add(question.id);
  }
  if (!questions.length) throw new Error(`Ainda não há questões para ${certification.label}.`);
  return questions;
}
