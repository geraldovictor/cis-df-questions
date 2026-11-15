import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { publicationWindow, catalogMetadata, questionPage, compareQuestion, communityEntries, scanSources, reportMarkdown } from '../scripts/question-source-watch.mjs';

test('search uses twelve calendar months and handles leap-day boundaries', () => {
  assert.deepEqual(publicationWindow('2026-11-15'), { from: '2025-11-15', through: '2026-11-15' });
  assert.deepEqual(publicationWindow('2024-02-29'), { from: '2023-02-28', through: '2024-02-29' });
  assert.throws(() => publicationWindow('2026-02-30'));
});

test('catalog claims remain separate from individual question publication and exam verification', () => {
  assert.deepEqual(catalogMetadata('<title>CAD Actual Free Exam Questions</title><p>Exam Questions: 219</p><p>Last Updated: Nov,13 2026</p>'), {
    declaredQuestions: 219, sourceUpdatedAt: '2026-11-13', publisherClaimsActual: true
  });
  assert.equal(catalogMetadata('Practice questions based on the blueprint').publisherClaimsActual, false);
});

const page = '<p>Page: 1 / 1</p><div class="examsPage__question" id="qqq1"><div>Question #6 (Topic: Single Topic)</div><div class="examsPage__question-body">A known stem?<div class="examsPage__question-answers">A. Yes B. No</div></div></div>';
test('question comparison ignores formatting but retains image and scenario ambiguities for review', () => {
  assert.deepEqual(questionPage(page), { pages: 1, questions: [{ number: 6, anchor: 'qqq1', prompt: 'A known stem?', hasImage: false }] });
  const known = [{ id: 'old', pergunta: 'A known stem?' }];
  assert.equal(compareQuestion({ prompt: 'A KNOWN stem!', hasImage: false }, known).status, 'already_present');
  assert.equal(compareQuestion({ prompt: 'A known stem?', hasImage: true }, known).status, 'needs_scenario_review');
  assert.equal(compareQuestion({ prompt: 'Entirely different topic?', hasImage: false }, known).status, 'possibly_missing');
  assert.throws(() => questionPage('<h1>Please sign in</h1>'), /unavailable/);
});

test('Community discovery excludes old, future and off-domain links without asserting exam authenticity', () => {
  const item = (date, link = 'https://www.servicenow.com/community/test') => `<item><title>CAD exam</title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[I passed my CAD exam.]]></description></item>`;
  const entries = communityEntries('<rss>' + item('13 May 2025 10:00:00 GMT') + item('12 Nov 2026 10:00:00 GMT') + item('16 Nov 2026 10:00:00 GMT') + item('12 Nov 2026 10:00:00 GMT', 'https://example.com/') + '</rss>', publicationWindow('2026-11-15'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].publishedAt, '2026-11-12');
  assert.equal(entries[0].examExperienceClaim, true);
  assert.equal(entries[0].actualExamUseVerified, false);
});

test('failed requests produce a partial report and discovery never changes banks or republishes question text', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const paths = ['data/cis-cad/questions.json', 'data/cis-em/questions.json'].map(path => new URL('../' + path, import.meta.url));
  const before = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  const fetcher = async url => {
    if (url.includes('/info/')) return new Response('<title>Actual Exam Questions</title><p>Last Updated: Nov,13 2026</p>');
    if (url.includes('/rss/')) return new Response('Forbidden', { status: 403 });
    return new Response(page);
  };
  const report = await scanSources({ today: '2026-11-15', root, fetcher });
  assert.equal(report.status, 'partial');
  assert.equal(report.errors.length, 3);
  assert.equal(report.importedQuestions, 0);
  assert.equal(report.policy.importsEnabled, false);
  assert.equal(report.exams[0].candidates[0].questionPublishedAt, null);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('A known stem?'), false);
  assert.ok(reportMarkdown(report).includes('Falhas de acesso'));
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path, 'utf8'))), before);
});
