#!/usr/bin/env python3
"""Import passive REST directory metadata from a checked-out, pinned Public APIs repo.

Usage: python scripts/import-public-apis.py /path/to/public-apis
No requests, installation, credentials, or tool permissions are involved.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

source = Path(sys.argv[1]).resolve()
target = Path(__file__).resolve().parents[1] / 'packages/web/src/catalog/publicApis.json'
commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
    raise SystemExit('Import from a clean checkout so the recorded commit identifies the content.')


def plain(text):
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return re.sub(r'<[^>]+>', '', text).replace('`', '').replace('\\|', '|').strip()


entries = {}
category, rest_table = '', False
skipped = []
for number, line in enumerate((source / 'README.md').read_text().splitlines(), 1):
    if line.startswith('### '):
        category, rest_table = plain(line[4:]), False
    if '|' not in line:
        continue
    cells = [cell.strip() for cell in re.split(r'(?<!\\)\|', line.strip().strip('|'))]
    # MCP and sponsored tables have a different schema and are never REST entries.
    if cells == ['API', 'Description', 'Auth', 'HTTPS', 'CORS']:
        rest_table = True
        continue
    if not line.startswith('|') or not rest_table or not cells[0].startswith('['):
        continue
    while len(cells) > 5 and not cells[-1]:
        cells.pop()
    match = re.fullmatch(r'\[([^\]]+)\]\(\s*(https?://\S+)\s*\)', cells[0])
    if len(cells) != 5 or not match:
        skipped.append(number)
        continue
    name, url = plain(match[1]), match[2]
    parsed = urlsplit(url)
    if not parsed.hostname or parsed.username or parsed.password:
        skipped.append(number)
        continue
    identity = hashlib.sha256((name + '\n' + url).encode()).hexdigest()[:12]
    if identity in entries:
        if category not in entries[identity]['categories']:
            entries[identity]['categories'].append(category)
        continue
    entries[identity] = dict(id=identity, name=name, url=url, description=plain(cells[1]),
                             sourceAuth=plain(cells[2]), https=plain(cells[3]),
                             cors=plain(cells[4]), categories=[category])

payload = dict(repository='https://github.com/chrisfbaileycb-arch/public-apis', commit=commit,
               license='MIT', skippedLines=skipped,
               entries=sorted(entries.values(), key=lambda entry: (entry['name'].casefold(), entry['url'])))
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
notice = target.parents[2] / 'public/licenses/public-apis-MIT.txt'
notice.parent.mkdir(parents=True, exist_ok=True)
notice.write_text((source / 'LICENSE').read_text())
print(json.dumps(dict(entries=len(entries), categories=len({c for e in entries.values() for c in e['categories']}),
                     noAuth=sum(e['sourceAuth'].casefold() == 'no' for e in entries.values()),
                     skippedLines=skipped, commit=commit)))
