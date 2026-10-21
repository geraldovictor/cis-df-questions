"""Generate neural English recordings. Install: pip install -r requirements-audio.txt."""
import asyncio
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
FILES = ['questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json']
VOICE = 'en-US-AndrewMultilingualNeural'


def narration(question):
    answers = [a['texto'] for a in question['alternativas'] if a['correta']]
    text = question['pergunta'].strip()
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


async def main():
    folder = ROOT / 'audio'
    folder.mkdir(exist_ok=True)
    semaphore = asyncio.Semaphore(16)
    async def generate(identifier, question):
        async with semaphore:
            target = folder / f'{identifier}.mp3'
            if target.exists() and target.stat().st_size > 1000:
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
    for f, filename in enumerate(FILES, 1):
        for i, question in enumerate(json.loads((ROOT / filename).read_text(encoding='utf-8')), 1):
            tasks.append(generate(f'{f}-{i}', question))
    await asyncio.gather(*tasks)
    print(f'Complete: {len(tasks)} neural recordings, voice {VOICE}', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
