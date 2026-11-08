const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderQuestionContext(question) {
  const context = question.contexto;
  if (!context) return '';
  const table = context.tabela;
  return `<div class="question-context" lang="en">${context.introducao ? `<p>${esc(context.introducao)}</p>` : ''}${table ? `<table><caption>${esc(table.titulo)}</caption><thead><tr>${table.colunas.map(column => `<th scope="col">${esc(column)}</th>`).join('')}</tr></thead><tbody>${table.linhas.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}${(context.paragrafos || []).map(paragraph => `<p>${esc(paragraph)}</p>`).join('')}</div>`;
}

export function questionPlainText(question) {
  const context = question.contexto;
  if (!context) return question.pergunta;
  const table = context.tabela;
  const tableText = table ? [table.titulo, ...table.linhas.map(row => row.map((cell, i) => `${table.colunas[i]}: ${cell}`).join('; ') + '.')].filter(Boolean).join('\n') : '';
  return [context.introducao, tableText, ...(context.paragrafos || []), question.pergunta].filter(Boolean).join('\n\n');
}

export function questionAudioPath(question) {
  const revision = question.audio_version ? `?v=${encodeURIComponent(question.audio_version)}` : '';
  return `audio/${encodeURIComponent(question.id)}.mp3${revision}`;
}
