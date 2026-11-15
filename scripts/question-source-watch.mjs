import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function plainText(value) {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return number <= 0x10ffff ? String.fromCodePoint(number) : '';
    }).replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo);/g, (_, name) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' })[name])
    .replace(/\s+/g, ' ').trim();
}

export const normalize = text => plainText(text).replace(/\/\/IMG\/\//gi, '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function publicationWindow(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || new Date(today).toISOString().slice(0, 10) !== today) throw new Error('Invalid date');
  const [year, month, day] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return { from: `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`, through: today };
}

function dateOnly(value) {
  const date = new Date(value.replace(/([A-Za-z]+),\s*(\d{1,2})\s+(\d{4})/, '$1 $2, $3'));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function catalogMetadata(html) {
  const text = plainText(html);
  return { declaredQuestions: Number(/Exam Questions\s*:\s*(\d+)/i.exec(text)?.[1]) || null,
    sourceUpdatedAt: dateOnly(/Last Updated\s*:\s*([A-Za-z]+,?\s*\d{1,2}\s+\d{4})/i.exec(text)?.[1] || ''),
    publisherClaimsActual: /actual\s+(?:free\s+)?exam\s+questions/i.test(text) };
}

export function questionPage(html) {
  const text = plainText(html), pagination = /Page:\s*(\d+)\s*\/\s*(\d+)/i.exec(text);
  const questions = [];
  for (const block of html.split(/<div\s+class="examsPage__question"\s+id="qqq/).slice(1)) {
    const anchor = /^(\d+)"/.exec(block)?.[1];
    const number = /Question\s*#(\d+)/i.exec(block)?.[1];
    const prompt = /class="examsPage__question-body"[^>]*>([\s\S]*?)<div\s+class="examsPage__question-answers"/.exec(block)?.[1];
    if (!number || !anchor || !prompt) throw new Error('Question page layout changed; comparison stopped');
    questions.push({ number: Number(number), anchor: `qqq${anchor}`, prompt: plainText(prompt), hasImage: /<img\b/i.test(prompt) });
  }
  if (!pagination || !questions.length) throw new Error('Question page unavailable or layout changed');
  return { pages: Number(pagination[2]), questions };
}

export function compareQuestion(item, known) {
  const key = normalize(item.prompt), exact = known.find(question => normalize(question.pergunta) === key);
  const fingerprint = createHash('sha256').update(key).digest('hex');
  if (exact && !item.hasImage) return { status: 'already_present', existingId: exact.id, fingerprint };
  const tokens = new Set(key.split(' '));
  let closest, similarity = 0;
  for (const question of known) {
    const other = new Set(normalize(question.pergunta).split(' '));
    const intersection = [...tokens].filter(token => other.has(token)).length;
    const score = intersection / (tokens.size + other.size - intersection || 1);
    if (score > similarity) { similarity = score; closest = question.id; }
  }
  return { status: item.hasImage || similarity >= 0.8 ? 'needs_scenario_review' : 'possibly_missing',
    fingerprint, closestKnownId: closest, similarity: Math.round(similarity * 1000) / 1000 };
}

export function communityEntries(xml, window) {
  if (!/<rss\b/i.test(xml)) throw new Error('Community response is not an RSS feed');
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].flatMap(([, block]) => {
    const field = name => plainText(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(block)?.[1] || '');
    const publishedAt = dateOnly(field('pubDate')), url = field('link');
    if (!publishedAt || publishedAt < window.from || publishedAt > window.through || !/^https:\/\/www\.servicenow\.com\/community\//.test(url)) return [];
    const body = field('description'), title = field('title');
    return [{ title: title.slice(0, 240), url, publishedAt,
      examExperienceClaim: /(?:I\s+(?:took|passed|sat)|actual exam|real exam|appeared.{0,30}exam)/i.test(body),
      actualExamUseVerified: false }];
  });
}

export async function scanSources({ today, root, fetcher = fetch, maxPages = 60 }) {
  const window = publicationWindow(today), requests = [];
  const get = async url => {
    const response = await fetcher(url, { headers: { 'User-Agent': 'StudySourceWatch/1.0', Accept: 'text/html,application/rss+xml,text/xml' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error('Source response exceeds limit');
    return text;
  };
  const report = { checkedAt: today, publicationWindow: window, timezone: 'America/Sao_Paulo',
    policy: { sourceClaimsAccepted: true, generatedQuestions: false, catalogDateIsQuestionPublicationDate: false,
      importsEnabled: false, reason: 'Discovery and link comparison only. Republishing third-party question banks requires a permitted reuse source. Item dates remain unknown when only a catalog update is supplied.' }, exams: [], community: [], errors: [] };
  for (const exam of ['CAD', 'CIS-EM']) {
    const folder = exam === 'CAD' ? 'cis-cad' : 'cis-em';
    const known = JSON.parse(await readFile(resolve(root, `data/${folder}/questions.json`), 'utf8'));
    const base = `https://www.itexams.com/exam/${exam}`;
    const result = { exam, knownQuestions: known.length, catalogUrl: `https://www.itexams.com/info/${exam}`, checkedPages: 0, comparedQuestions: 0, alreadyPresent: 0, candidates: [], complete: false };
    report.exams.push(result);
    try {
      Object.assign(result, catalogMetadata(await get(result.catalogUrl)));
      result.catalogUpdateWithinWindow = Boolean(result.sourceUpdatedAt && result.sourceUpdatedAt >= window.from && result.sourceUpdatedAt <= window.through);
      for (let page = 1, pages = 1; page <= Math.min(pages, maxPages); page++) {
        const url = page === 1 ? base : `${base}/${page}`;
        const parsed = questionPage(await get(url));
        pages = parsed.pages; result.totalPages = pages; result.checkedPages++;
        for (const item of parsed.questions) {
          const comparison = compareQuestion(item, known);
          result.comparedQuestions++;
          if (comparison.status === 'already_present') result.alreadyPresent++;
          else result.candidates.push({ number: item.number, url: `${url}#${item.anchor}`, ...comparison,
            questionPublishedAt: null, actualExamUseVerified: false, sourceClaimsActual: result.publisherClaimsActual });
        }
      }
      result.complete = result.checkedPages === result.totalPages;
      if (!result.complete) report.errors.push({ url: base, error: 'Page limit reached; scan is incomplete' });
    } catch (error) { report.errors.push({ url: base, error: error.message }); }
  }
  for (const query of ['CAD exam', 'CIS-EM', 'Event Management exam']) {
    const url = `https://www.servicenow.com/community/s/cgfwn76974/rss/search?q=${encodeURIComponent(query)}&sort_by=-topicPostDate`;
    requests.push((async () => {
      try {
        const entries = communityEntries(await get(url), window);
        report.community.push({ query, url, entries, complete: true });
      } catch (error) { report.community.push({ query, url, entries: [], complete: false }); report.errors.push({ url, error: error.message }); }
    })());
  }
  await Promise.all(requests);
  report.community.sort((a, b) => a.query.localeCompare(b.query));
  report.status = report.errors.length ? 'partial' : 'complete';
  report.importedQuestions = 0;
  return report;
}

export function reportMarkdown(report) {
  const lines = ['# Busca diária CAD / CIS-EM', '', `Consulta: ${report.checkedAt}. Janela de publicação: ${report.publicationWindow.from} a ${report.publicationWindow.through}.`, '',
    'As fontes podem declarar questões reais. Uma atualização do catálogo não comprova a data individual da questão. O relatório contém links e impressões digitais, sem republicar enunciados.', '',
    '| Prova | Banco atual | Comparadas | Já presentes | Candidatas/revisão | Páginas |', '|---|---:|---:|---:|---:|---:|'];
  for (const exam of report.exams) lines.push(`| ${exam.exam} | ${exam.knownQuestions} | ${exam.comparedQuestions} | ${exam.alreadyPresent} | ${exam.candidates.length} | ${exam.checkedPages}/${exam.totalPages || '?'} |`);
  lines.push('', '**Questões importadas: 0.** A publicação automática de cópias depende de uma fonte que permita republicação. O monitor não escreve nos bancos de questões.', '', '## Community');
  for (const group of report.community) for (const entry of group.entries) lines.push(`- ${entry.publishedAt}: [${entry.title.replace(/[\[\]<>|\r\n]/g, ' ')}](${entry.url}) — uso em prova não verificado.`);
  if (report.errors.length) { lines.push('', '## Falhas de acesso'); for (const error of report.errors) lines.push(`- ${error.url}: ${error.error}`); }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const today = process.argv[2] || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const report = await scanSources({ today, root });
  const output = resolve(root, 'test-results/question-search');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const markdown = reportMarkdown(report);
  await writeFile(resolve(output, 'report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(JSON.stringify({ status: report.status, exams: report.exams.map(exam => ({ exam: exam.exam, compared: exam.comparedQuestions, candidates: exam.candidates.length })), errors: report.errors.length, imported: 0 }));
  if (report.exams.every(exam => !exam.comparedQuestions) && report.community.every(group => !group.complete)) process.exitCode = 1;
}
