"""Generate neural English recordings. Install: pip install -r requirements-audio.txt."""
import argparse
import asyncio
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILES = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json']
CERTIFICATIONS = ('cis-df', 'cis-em', 'cis-cad', 'cis-csm')
VOICE = 'en-US-AndrewMultilingualNeural'


def narration(question):
    answers = [a['texto'] for a in question['alternativas'] if a['correta']]
    context = question.get('contexto') or {}
    parts = [context.get('introducao', '')]
    table = context.get('tabela') or {}
    if table:
        parts.append(table.get('titulo', ''))
        for row in table.get('linhas', []):
            parts.append('. '.join(f'{column}: {value}' for column, value in zip(table.get('colunas', []), row)) + '.')
    parts.extend(context.get('paragrafos', []))
    parts.append(question['pergunta'])
    text = '\n\n'.join(part.strip() for part in parts if part.strip())
    text = re.sub(r'(?<=[a-z])\.(?=[A-Z])', '. ', text)
    if text[-1:] not in '.?!':
        text += '.'
    label = 'The correct answer is' if len(answers) == 1 else 'The correct answers are'
    text += f'\n\n{label}: ' + '. '.join(a.strip().rstrip('.') for a in answers) + '.'
    # Spell technical initialisms consistently rather than reading them as words.
    for acronym in ['CMDB', 'CSDM', 'IRE', 'ITOM', 'ITSM', 'CI', 'CIs']:
        spoken = ' '.join(acronym.rstrip('s')) + ('s' if acronym.endswith('s') else '')
        text = re.sub(r'\b' + acronym + r'\b', spoken, text)
    return text


def question_bank(certification):
    if certification == 'cis-df':
        return [(f'{f}-{i}', question)
                for f, filename in enumerate(FILES, 1)
                for i, question in enumerate(json.loads((ROOT / filename).read_text(encoding='utf-8')), 1)]
    source = ROOT / 'data' / certification / 'questions.json'
    questions = json.loads(source.read_text(encoding='utf-8'))
    if not isinstance(questions, list):
        raise ValueError(f'Question bank must be an array: {source}')
    identifiers = [question.get('id') for question in questions]
    if (any(not isinstance(identifier, str) or not identifier or identifier in ('.', '..') or
            '/' in identifier or '\\' in identifier for identifier in identifiers) or
            len(identifiers) != len(set(identifiers))):
        raise ValueError(f'Question bank needs unique, stable IDs: {source}')
    if any(question.get('certification', certification) != certification for question in questions):
        raise ValueError(f'Question bank contains another certification: {source}')
    return [(identifier, question) for identifier, question in zip(identifiers, questions)
            if question.get('audio_disponivel', True) is not False]


async def main(certification='cis-df', concurrency=16, refresh_ids=()):
    import edge_tts

    if concurrency < 1:
        raise ValueError('Concurrency must be at least 1.')
    selected_banks = [(selected, question_bank(selected))
                      for selected in CERTIFICATIONS if certification == 'all' or selected == certification]
    refresh_ids = set(refresh_ids)
    available_ids = {identifier for _, bank in selected_banks for identifier, _ in bank}
    if refresh_ids - available_ids:
        raise ValueError('Refresh IDs do not belong to the selected certification.')
    semaphore = asyncio.Semaphore(concurrency)
    async def generate(folder, identifier, question):
        async with semaphore:
            target = folder / f'{identifier}.mp3'
            if target.exists() and target.stat().st_size > 1000 and identifier not in refresh_ids:
                return
            temporary = target.with_suffix('.mp3.part')
            for attempt in range(4):
                try:
                    await edge_tts.Communicate(narration(question), VOICE, rate='-5%').save(str(temporary))
                    if temporary.stat().st_size < 1000:
                        raise ValueError(f'Empty recording: {identifier}')
                    temporary.replace(target)
                    print(f'Generated {identifier}', flush=True)
                    return
                except Exception:
                    temporary.unlink(missing_ok=True)
                    if attempt == 3:
                        raise
                    await asyncio.sleep(2 ** (attempt + 1))
    tasks = []
    for selected, bank in selected_banks:
        folder = ROOT / 'audio' if selected == 'cis-df' else ROOT / 'audio' / selected
        folder.mkdir(parents=True, exist_ok=True)
        if not bank:
            print(f'{selected}: awaiting questions; no recordings generated.', flush=True)
        tasks.extend(generate(folder, identifier, question) for identifier, question in bank)
    results = await asyncio.gather(*tasks, return_exceptions=True)
    failures = [result for result in results if isinstance(result, Exception)]
    if failures:
        raise RuntimeError(f'{len(failures)} recording(s) failed; run again to retry missing files.') from failures[0]
    print(f'Complete: {len(tasks)} neural recordings, voice {VOICE}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generate neural English recordings for a certification.')
    parser.add_argument('--certification', choices=(*CERTIFICATIONS, 'all'), default='cis-df')
    parser.add_argument('--concurrency', type=int, default=16, help='Maximum simultaneous voice requests; reduce after service errors.')
    parser.add_argument('--refresh-id', action='append', default=[], help='Regenerate an existing recording by its stable question ID; may be repeated.')
    args = parser.parse_args()
    asyncio.run(main(args.certification, args.concurrency, args.refresh_id))
