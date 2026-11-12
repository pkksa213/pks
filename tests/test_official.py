import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from pks_official import apply_official, operating_rule, BoardParser
FIXTURE=Path(__file__).parent/'fixtures'

class OfficialTests(unittest.TestCase):
    def test_operator_tables_supply_exact_connections_and_rules(self):
        data=json.loads((FIXTURE/'schedule-2026-11-12.json').read_text())
        result=apply_official(data,FIXTURE/'official')
        self.assertEqual(len(result['connections']),2)
        self.assertEqual([c['secondLeg']['time'] for c in result['connections']],['09:06','11:00'])
        self.assertEqual([c['secondLeg']['arrivalTime'] for c in result['connections']],['09:34','11:28'])
        first=next(t for t in result['trips'] if t['id']==result['connections'][1]['firstTripId'])
        self.assertTrue(first['calendarOverride']['excludeSummer'])
        again=apply_official(result,FIXTURE/'official')
        self.assertEqual(result,again)
    def test_missing_first_leg_fails_without_mutating_input(self):
        data=json.loads((FIXTURE/'schedule-2026-11-12.json').read_text())
        data['trips']=[t for t in data['trips'] if t.get('gtfsTripId')!='4207']
        original=copy.deepcopy(data)
        with self.assertRaises(ValueError):apply_official(data,FIXTURE/'official')
        self.assertEqual(data,original)
    def test_unknown_operating_code_and_exception_are_rejected(self):
        with self.assertRaises(ValueError):operating_rule({'trip_id':'x','text':['nowy kod']},'2026-11-07','2026-12-31')
        with self.assertRaises(ValueError):operating_rule({'trip_id':'x','text':['kursuje od poniedziałku do piątku oprócz świąt','nie kursuje w nieznane dni']},'2026-11-07','2026-12-31')
    def test_foreign_operator_and_unrelated_markup_are_not_imported(self):
        parser=BoardParser()
        parser.feed('<div class="odjazd "><a data-src="x?pkurs=9999;311;4207;0">08:42</a></div>')
        self.assertEqual(parser.records,[])
