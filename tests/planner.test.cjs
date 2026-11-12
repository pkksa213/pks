const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ console, Intl, Date });
for (const name of ['calendar', 'services', 'planner']) vm.runInContext(fs.readFileSync(`js/${name}.js`, 'utf8'), ctx);
const api = vm.runInContext('({ Calendar, Services, Planner })', ctx);
const data = JSON.parse(fs.readFileSync('tests/fixtures/schedule-2026-11-12.json'));

test('real GTFS: feasible outbound shuttle connects at the exact hub', () => {
  const trips = api.Planner.find(data, '2026-11-12', 'ranizow', 'rzeszow', { mode: 'transfer' });
  assert.equal(trips.length, 1);
  assert.deepEqual(Array.from(trips, j => api.Planner.clock(j.departureMinute)), ['08:42']);
  for (const j of trips) {
    assert.equal(j.legs[0].toStop, j.legs[1].fromStop);
    assert.notEqual(j.legs[0].gtfsTripId, j.legs[1].gtfsTripId);
    assert.ok(j.transferMinutes >= 5 && j.transferMinutes <= 45);
    assert.ok(j.arrivalMinute > j.departureMinute);
  }
});
test('owner correction: no Głogów → Raniżów or return transfers', () => {
  assert.equal(api.Planner.find(data, '2026-11-12', 'glogow', 'ranizow').length, 0);
  assert.equal(api.Planner.find(data, '2026-11-12', 'rzeszow', 'ranizow', { mode: 'transfer' }).length, 0);
  assert.ok(api.Planner.find(data, '2026-11-12', 'rzeszow', 'ranizow', { mode: 'direct' }).length > 0);
});
test('direct buses remain available; Głogów is a separate destination', () => {
  assert.ok(api.Planner.find(data, '2026-11-12', 'ranizow', 'rzeszow', { mode: 'direct' }).length > 10);
  const hub = api.Planner.find(data, '2026-11-12', 'ranizow', 'glogow', { mode: 'direct' });
  assert.ok(hub.some(j => api.Planner.clock(j.departureMinute) === '08:42'));
  assert.ok(hub.every(j => j.legs.length === 1));
});
test('withdrawn Ekspres Bus 18:05 is absent', () => {
  assert.equal(data.trips.filter(t => t.carrier === 'ekspresbus' && t.time === '18:05').length, 0);
});
test('expired GTFS is not presented as running', () => {
  assert.equal(api.Planner.find(data, '2027-01-12', 'ranizow', 'rzeszow').filter(j => j.legs.some(t => t.carrier === 'pks')).length, 0);
});
test('higher transfer minimum excludes infeasible changes', () => {
  const trips = api.Planner.find(data, '2026-11-12', 'ranizow', 'rzeszow', { mode: 'transfer', minTransfer: 15 });
  assert.ok(trips.every(t => t.transferMinutes >= 15));
});
function sample(aStop = 'hub', bStop = 'hub', wait = 5, ends = true) {
  return { services: { day: { type: 'weekly', days: [1,1,1,1,1,1,1] } }, trips: [
    { id:'a', gtfsTripId:'a', fromCity:'ranizow', toCity:'glogow', time:'09:00', arrivalTime:'09:30', fromStop:'rz',toStop:aStop,serviceIds:['day'] },
    { id:'b', gtfsTripId:'b', fromCity:'glogow', toCity:'rzeszow',time:`09:${30+wait}`,arrivalTime:'10:20',fromStop:bStop,toStop:'ran',terminatesInRanizow:ends,serviceIds:['day'] }
  ] };
}
test('reject wrong transfer stops and insufficient time', () => {
  for (const d of [sample('hub1','hub2'),sample('hub','hub',4)])
    assert.equal(api.Planner.find(d, '2026-11-12', 'ranizow','rzeszow',{mode:'transfer'}).length,0);
  assert.equal(api.Planner.find(sample(), '2026-11-12','ranizow','rzeszow',{mode:'transfer'}).length,1);
});
test('both legs must run on the service day, including exceptions', () => {
  const d=sample(); d.services.removed={type:'weekly',days:[1,1,1,1,1,1,1],exceptions:{remove:['2026-11-12']}};
  d.trips[1].serviceIds=['removed'];
  assert.equal(api.Planner.find(d,'2026-11-12','ranizow','rzeszow',{mode:'transfer'}).length,0);
});
test('GTFS 24+ hours preserve the service day and can connect over midnight', () => {
  const d=sample(); d.trips[0].time='23:40'; d.trips[0].arrivalTime='24:05';
  d.trips[1].time='00:15';d.trips[1].arrivalTime='00:40';
  const trips=api.Planner.find(d,'2026-11-12','ranizow','rzeszow',{mode:'transfer'});
  assert.equal(trips.length,1);assert.equal(trips[0].arrivalMinute,1480);
  assert.equal(trips[0].legs[1].serviceDate,'2026-11-13');
  d.trips[1].time='24:15';d.trips[1].arrivalTime='24:40';
  const early=api.Planner.find(d,'2026-11-13','glogow','rzeszow',{mode:'direct'});
  assert.equal(early[0].departureMinute,15);assert.equal(early[0].legs[0].serviceDate,'2026-11-12');
});

test('long waits are shown only when explicitly allowed', () => {
  const trips = api.Planner.find(data, '2026-11-12', 'ranizow', 'rzeszow', { mode: 'transfer', maxTransfer: 90 });
  assert.equal(trips.length, 2);
  assert.equal(trips[1].transferMinutes, 75);
});

test('current data respects owner exclusions and has complete references', () => {
  const current = JSON.parse(fs.readFileSync('data.json'));
  assert.equal(current.meta.schemaVersion, 2);
  for (const t of current.trips) {
    assert.notEqual(t.direction, 'glogow_ranizow');
    assert.ok(!(t.carrier === 'ekspresbus' && t.time === '18:05'));
    assert.ok(current.stops[t.fromStop] && current.stops[t.toStop]);
    assert.ok(t.serviceIds.every(id => current.services[id]));
  }
});
