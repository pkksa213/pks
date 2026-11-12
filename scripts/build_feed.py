"""Prepare ONLY the already-public timetable for an app-compatible static host."""
import argparse
import json
from pathlib import Path


def build_feed(source, output):
    data = json.loads(Path(source).read_text(encoding='utf-8'))
    expected = {'meta', 'stops', 'carriers', 'services', 'trips', 'connections'}
    if set(data) != expected or data['meta'].get('schemaVersion') != 2:
        raise ValueError('Nieprawidłowy format publicznego rozkładu')
    if not isinstance(data['trips'], list) or not isinstance(data['connections'], list):
        raise ValueError('Brak kursów lub połączeń')
    for trip in data['trips']:
        if trip['fromStop'] not in data['stops'] or trip['toStop'] not in data['stops']:
            raise ValueError('Nieprawidłowy przystanek')
        if not all(s in data['services'] for s in trip['serviceIds']):
            raise ValueError('Nieprawidłowy kalendarz')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    # Deliberately do not copy the checkout, APK, PHP, source files or credentials.
    (output / 'data.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    (output / 'index.html').write_text('<!doctype html><html lang="pl"><meta charset="utf-8"><title>Publiczny rozkład Raniżów</title><p>Publiczne dane rozkładu dla aplikacji Raniżów.</p><a href="data.json">Rozkład JSON</a></html>\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='data.json')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    build_feed(args.source, args.output)
    print('Przygotowano wyłącznie publiczny rozkład i stronę informacyjną.')
