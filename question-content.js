import { DEFAULT_CERTIFICATION } from './certification.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderQuestionContext(question) {
  const note = question.observacao ? `<details class="notice" lang="pt-BR"><summary>Observação do material enviado</summary><p>${esc(question.observacao)}</p></details>` : '';
  const context = question.contexto;
  if (!context) return note;
  const table = context.tabela;
  const images = (context.imagens || []).filter(item => /^data\/cis-(em|cad)\/images\/[a-zA-Z0-9_.-]+\.(png|jpg|webp)$/.test(item.src));
  return `${note}<div class="question-context" lang="en">${context.introducao ? `<p>${esc(context.introducao)}</p>` : ''}${table ? `<table><caption>${esc(table.titulo)}</caption><thead><tr>${table.colunas.map(column => `<th scope="col">${esc(column)}</th>`).join('')}</tr></thead><tbody>${table.linhas.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}${(context.paragrafos || []).map(paragraph => `<p>${esc(paragraph)}</p>`).join('')}${images.map(item => `<figure class="question-image"><img src="${esc(item.src)}" alt="${esc(item.alt)}" loading="lazy"><figcaption>${esc(item.alt)}</figcaption></figure>`).join('')}</div>`;
}

export function questionPlainText(question) {
  const context = question.contexto;
  if (!context) return question.pergunta;
  const table = context.tabela;
  const tableText = table ? [table.titulo, ...table.linhas.map(row => row.map((cell, i) => `${table.colunas[i]}: ${cell}`).join('; ') + '.')].filter(Boolean).join('\n') : '';
  return [context.introducao, tableText, ...(context.paragrafos || []), question.pergunta].filter(Boolean).join('\n\n');
}

export function renderAnswerImages(question) {
  const paths = (question.fonte?.imagens_resposta || []).filter(path => /^data\/cis-(em|cad)\/images\/[a-zA-Z0-9_.-]+\.(png|jpg|webp)$/.test(path));
  if (!paths.length) return '';
  return `<details class="question-answer-image"><summary>Ver imagem do gabarito original</summary>${paths.map(path => `<figure class="question-image"><img src="${esc(path)}" alt="Gabarito da questão no material enviado" loading="lazy"></figure>`).join('')}</details>`;
}

export function questionAudioPath(question) {
  const revision = question.audio_version ? `?v=${encodeURIComponent(question.audio_version)}` : '';
  const certificationId = question.certification || DEFAULT_CERTIFICATION;
  const folder = certificationId === DEFAULT_CERTIFICATION ? 'audio' : `audio/${encodeURIComponent(certificationId)}`;
  return `${folder}/${encodeURIComponent(question.id)}.mp3${revision}`;
}
