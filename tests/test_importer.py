import copy
import csv
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('importer', Path(__file__).resolve().parents[1] / 'scripts/update_pks_gtfs.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def feed():
    files = {
        'stops.txt': ['stop_id,stop_name,stop_lat,stop_lon', '776,Raniżów Rynek 01,50,22', '777,Raniżów Rynek 02,50,22', '597,Głogów Młp. Kolejowa I Centrum Przesiadkowe 01,50,22', '57,Rzeszów D.A. 10,50,22'],
        'routes.txt': ['route_id,route_short_name', '1,311', '2,312'],
        'trips.txt': ['trip_id,route_id,service_id','a,1,PS','b,1,PS','c,2,PS'],
        'stop_times.txt': ['trip_id,stop_id,stop_sequence,arrival_time,departure_time',
            'a,776,1,08:00:00,08:00:00','a,597,2,08:23:00,08:23:00','a,57,3,09:00:00,09:00:00',
            'b,57,1,09:00:00,09:00:00','b,597,2,09:23:00,09:23:00','b,777,3,10:00:00,10:00:00',
            'c,597,1,08:30:00,08:30:00','c,57,2,09:10:00,09:10:00'],
        'calendar_dates.txt':['service_id,date,exception_type','PS,20261112,1','PS,20261113,2']}
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, 'w') as z:
        for name, lines in files.items(): z.writestr(name, '\n'.join(lines))
    raw.seek(0)
    return zipfile.ZipFile(raw)


class ImporterTests(unittest.TestCase):
    def data(self):
        return {'meta':{}, 'stops':{'ranizow_rynek':{'name':'Raniżów'},'rzeszow_lokalny':{'name':'Lokalny'}},
            'services':{'eb_D':{'type':'weekly'}}, 'trips':[
              {'id':'keep','carrier':'ekspresbus','time':'17:05','fromStop':'ranizow_rynek','toStop':'rzeszow_lokalny','serviceIds':['eb_D']},
              {'id':'withdraw','carrier':'ekspresbus','time':'18:05','fromStop':'ranizow_rynek','toStop':'rzeszow_lokalny','serviceIds':['eb_D']} ]}
    def test_segments_and_calendar(self):
        data = module.import_feed(feed(),self.data())
        self.assertEqual(data['meta']['pksValidUntil'],'2026-11-12')
        self.assertEqual(data['meta']['schemaVersion'],2)
        self.assertEqual(len([t for t in data['trips'] if t.get('line')=='312']),1)
        self.assertFalse(any(t.get('direction') == 'glogow_ranizow' for t in data['trips']))
        self.assertEqual(data['services']['pks_gtfs_PS']['exceptions']['remove'],['2026-11-13'])
        self.assertEqual([t['id'] for t in data['trips'] if t['carrier']=='ekspresbus'],['keep'])
    def test_repeatable(self):
        data=module.import_feed(feed(), self.data())
        again=module.import_feed(feed(),copy.deepcopy(data))
        self.assertEqual(data['trips'], again['trips'])
        self.assertEqual(data['services'], again['services'])
    def test_gtfs_hours(self):
        self.assertEqual(module.norm_time('24:15:00'),'24:15')
        with self.assertRaises(ValueError):module.norm_time('13:90:00')
    def test_incomplete_feed_is_rejected_without_mutating_data(self):
        data=self.data(); before=copy.deepcopy(data)
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as z:
            for name in ['stops.txt','routes.txt','trips.txt','stop_times.txt']:z.writestr(name,'stop_id\n')
        raw.seek(0)
        with self.assertRaises(ValueError):module.import_feed(zipfile.ZipFile(raw),data)
        self.assertEqual(data,before)
