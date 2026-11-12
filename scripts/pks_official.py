"""Supplement GTFS with the operator's published service codes and dwell times.
The PKS website distinguishes D/S/+ and has departure times missing in GTFS.
"""
import copy
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urljoin
from urllib.request import Request, urlopen

BASE_URL = 'https://pks.rzeszow.pl/'
BOARDS = {
    'ranizow': ('tabliczki-przystankowe,203', '13150475'),
    'rzeszow': ('tablice-dworcowe,202', '13150019'),
    'glogow': ('tablice-dworcowe,202', '13990498'),
}
CONNECTIONS = [('4207', '08:42', '7755', '09:06'), ('4209', '10:35', '7711', '11:00')]


class BoardParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.records = []
        self.depth = 0
        self.record = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div' and 'odjazd' in attrs.get('class', '').split():
            self.record = {'text': []}
            self.depth = 0
        if self.record is not None:
            if tag == 'div':
                self.depth += 1
            if tag == 'a' and 'pkurs=' in attrs.get('data-src', ''):
                self.record['url'] = attrs['data-src']
                parts = parse_qs(urlparse(attrs['data-src']).query)['pkurs'][0].split(';')
                self.record.update({'operator': parts[0], 'line': parts[1], 'trip_id': parts[2]})

    def handle_data(self, text):
        if self.record is not None and text.strip():
            self.record['text'].append(text.strip().replace('\xa0', ' '))

    def handle_endtag(self, tag):
        if self.record is not None and tag == 'div':
            self.depth -= 1
            if self.depth == 0:
                if self.record.get('operator') == '1315':
                    self.records.append(self.record)
                self.record = None


class RowsParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        if tag == 'td' and self.row is not None:
            self.cell = ''

    def handle_data(self, text):
        if self.cell is not None:
            self.cell += text

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(' '.join(self.cell.split()))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None


def validity(html):
    match = re.search(r'obowiązuje od.*?(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})', html, re.S)
    if not match:
        raise ValueError('Brak okresu ważności na stronie PKS — zachowano poprzednie dane.')
    return match.groups()


def operating_rule(record, start, end):
    text = record['text']
    common = {'startDate': start, 'endDate': end, 'source': BASE_URL}
    if 'kursuje od poniedziałku do piątku oprócz świąt' in text:
        rule = {'type': 'weekly', 'days': [1, 1, 1, 1, 1, 0, 0], 'excludeHolidays': True, 'label': 'Poniedziałek–piątek, bez świąt'}
    elif 'kursuje w dni nauki szkolnej' in text:
        rule = {'type': 'school_days', 'label': 'Dni nauki szkolnej'}
    elif 'kursuje w soboty (nie kursuje w święta ustawowo wolne)' in text:
        rule = {'type': 'weekly', 'days': [0, 0, 0, 0, 0, 1, 0], 'excludeHolidays': True, 'label': 'Soboty, bez świąt'}
    elif 'kursuje w dni wolne od pracy (niedziele i święta)' in text:
        rule = {'type': 'sunday_or_holiday', 'label': 'Niedziele i święta'}
    elif any('w dni robocze wolne od nauki szkolnej' in t for t in text):
        rule = {'type': 'school_break_workdays', 'label': 'Dni robocze wolne od nauki szkolnej'}
    else:
        raise ValueError(f"Nieznane oznaczenie kursowania PKS {record['trip_id']} — zachowano poprzednie dane.")
    remove = []
    for line in text:
        if line == 'nie kursuje w okresie ferii letnich':
            rule['excludeSummer'] = True
            rule['label'] += ', poza wakacjami letnimi'
        elif line == 'nie kursuje w dniu 31.XII':
            remove.append('dec31')
        elif line == 'nie kursuje w Wielką Sobotę':
            remove.append('holySaturday')
        elif line == 'nie kursuje w dniu 1.I, w pierwszy dzień Świąt Wielkanocnych i w dniu 25.XII':
            remove.extend(['jan1', 'easterSunday', 'dec25'])
        elif line.startswith('nie kursuje'):
            raise ValueError(f'Nieznany wyjątek PKS: {line}')
    rule.update(common)
    if remove:
        rule['removeSpecial'] = remove
    return rule


def read_html(url, cache_dir=None, cache_name=None, data=None):
    if cache_dir:
        return (Path(cache_dir) / cache_name).read_text(encoding='utf-8')
    body = urlencode(data).encode() if data else None
    req = Request(url, data=body, headers={'User-Agent': 'ranizow-rozklad/1.0'})
    with urlopen(req, timeout=30) as response:
        return response.read().decode('utf-8')


def apply_official(data, cache_dir=None):
    data = copy.deepcopy(data)
    boards, records = {}, {}
    for city, (path, code) in BOARDS.items():
        html = read_html(BASE_URL + path, cache_dir, 'pks-' + city + '.html', {'kod': code})
        start, end = validity(html)
        parser = BoardParser()
        parser.feed(html)
        boards[city] = {r['trip_id']: r for r in parser.records}
        for record in parser.records:
            records[record['trip_id']] = (record, start, end)
    # Only rules for trips displayed by the app are interpreted; route annotations
    # remain descriptive and must not become calendar rules.
    required_ids = {t['gtfsTripId'] for t in data['trips'] if t.get('carrier') == 'pks' and
                    (t.get('fromCity') == 'ranizow' or t.get('toCity') == 'ranizow')}
    required_ids.update(c[2] for c in CONNECTIONS)
    missing = required_ids - set(records)
    if missing:
        raise ValueError(f'Brak oznaczeń PKS dla kursów {sorted(missing)} — zachowano poprzednie dane.')
    rules = {tid: operating_rule(*records[tid]) for tid in required_ids}
    for trip in data['trips']:
        if trip.get('gtfsTripId') in rules:
            trip['calendarOverride'] = rules[trip['gtfsTripId']]
    connections = []
    for first_id, departure, second_id, transfer_departure in CONNECTIONS:
        first = next((t for t in data['trips'] if t.get('gtfsTripId') == first_id and
                      t.get('direction') == 'ranizow_glogow' and t['time'] == departure), None)
        if first is None:
            raise ValueError(f'Brak pierwszego odcinka {departure} — nie zmieniono danych.')
        record = boards['glogow'][second_id]
        html = read_html(urljoin(BASE_URL, record['url']), cache_dir, 'pks-trip-' + second_id + '.html')
        parser = RowsParser()
        parser.feed(html)
        hub = next((r for r in parser.rows if len(r) >= 4 and 'CENT.PRZESIADKOWE' in r[1]), None)
        destination = next((r for r in reversed(parser.rows) if len(r) >= 4 and 'RZESZÓW' in r[1] and 'D.A.' in r[1]), None)
        if not hub or not destination or hub[3] != transfer_departure:
            raise ValueError(f'Zmieniony drugi odcinek {second_id} — wymaga sprawdzenia.')
        arrival = destination[2]
        if not re.fullmatch(r'\d{2}:\d{2}', arrival):
            raise ValueError('Brak godziny przyjazdu do Rzeszowa na stronie PKS.')
        source_key = 'pks_official_' + second_id
        data['services'][source_key] = rules[second_id]
        second = {'id': source_key, 'gtfsTripId': second_id, 'carrier': 'pks', 'line': record['line'],
                  'fromCity': 'glogow', 'toCity': 'rzeszow', 'fromStop': first['toStop'], 'toStop': 'rzeszow_da',
                  'time': transfer_departure, 'arrivalTime': arrival, 'serviceIds': [source_key],
                  'calendarOverride': rules[second_id], 'source': urljoin(BASE_URL, record['url'])}
        connections.append({'id': first_id + '_' + second_id, 'firstTripId': first['id'], 'secondLeg': second})
    data['connections'] = connections
    start, end = records['4207'][1:]
    data['meta'].update({'pksOfficialSource': BASE_URL, 'pksOfficialValidFrom': start, 'pksOfficialValidUntil': end,
                         'pksValidFrom': max(data['meta']['pksValidFrom'], start),
                         'pksValidUntil': min(data['meta']['pksValidUntil'], end),
                         'pksNote': 'GTFS uzupełniony oficjalnymi oznaczeniami kursowania i czasami postojów PKS.'})
    return data
