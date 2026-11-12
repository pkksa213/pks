const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ console, Intl, Date });
for (const name of ['calendar', 'services', 'planner']) vm.runInContext(fs.readFileSync(`js/${name}.js`, 'utf8'), ctx);
const { Calendar, Services, Planner } = vm.runInContext('({ Calendar, Services, Planner })', ctx);
const data = JSON.parse(fs.readFileSync('tests/fixtures/schedule-2026-11-12.json'));
const find = (date, from='ranizow', to='rzeszow') => Planner.find(data, date, from, to);
const transfers = date => find(date).filter(j => j.kind === 'transfer');

test('only the two requested PKS connections appear in the single departure list', () => {
  const trips = transfers('2026-11-12');
  assert.equal(trips.length, 2);
  assert.deepEqual(Array.from(trips, j => j.legs.map(t => t.time).join(' → ')), ['08:42 → 09:06', '10:35 → 11:00']);
  assert.deepEqual(Array.from(trips, j => j.legs[1].line), ['310', '313']);
  assert.deepEqual(Array.from(trips, j => Planner.clock(j.arrivalMinute)), ['09:34', '11:28']);
  assert.deepEqual(Array.from(trips, j => j.transferMinutes), [1, 2]);
  for (const j of trips) assert.equal(j.legs[0].toStop, j.legs[1].fromStop);
  const all=find('2026-11-12');
  assert.ok(all.some(j=>j.kind==='direct'));
  assert.ok(all.every((j,i)=>!i || j.departureMinute>=all[i-1].departureMinute));
  assert.equal(trips.some(j=>j.legs[1].time==='09:44' || j.legs[1].time==='12:13'),false);
});
test('no transfers on Saturdays, Sundays or public holidays', () => {
  for (const date of ['2026-11-11','2026-11-14','2026-11-15','2026-12-24','2026-12-25','2026-12-26']) assert.equal(transfers(date).length,0,date);
});
test('holiday service follows the PKS +b code rather than a weekday GTFS bucket', () => {
  for (const date of ['2026-11-11','2026-12-24','2026-12-26']) {
    const pks=find(date).filter(j=>j.legs[0].carrier==='pks');
    assert.ok(pks.length>0,date);
    assert.ok(pks.every(j=>j.legs[0].calendarOverride.type==='sunday_or_holiday'),date);
  }
  assert.equal(find('2026-12-25').filter(j=>j.legs[0].carrier==='pks').length,0);
});
test('Christmas Eve is a public holiday from 2025, including a weekday in 2026', () => {
  assert.equal(Calendar.isPublicHoliday('2026-12-24'),true);
  assert.equal(Calendar.isPublicHoliday('2024-12-24'),false);
});
test('school courses do not run during the Christmas school break', () => {
  const school=j=>j.legs[0].calendarOverride && j.legs[0].calendarOverride.type==='school_days';
  assert.ok(find('2026-11-12').some(school));
  assert.equal(find('2026-12-28').filter(school).length,0);
});
test('10:35 excludes summer holidays; 08:42 does not', () => {
  const rules=data.connections.map(c=>data.trips.find(t=>t.id===c.firstTripId).calendarOverride);
  const extend=r=>Object.assign({},r,{startDate:'2027-01-01',endDate:'2027-12-31'});
  assert.equal(Services.serviceRunsOnDate(extend(rules[0]),'2027-07-12'),true);
  assert.equal(Services.serviceRunsOnDate(extend(rules[1]),'2027-07-12'),false);
});
test('the Dl exclusion removes the 19:29 bus on New Year’s Eve', () => {
  assert.ok(find('2026-12-30').some(j=>j.legs[0].carrier==='pks' && j.legs[0].time==='19:29'));
  assert.equal(find('2026-12-31').some(j=>j.legs[0].carrier==='pks' && j.legs[0].time==='19:29'),false);
});
test('both connection legs must run; no automatic replacement is invented', () => {
  const d=JSON.parse(JSON.stringify(data));
  d.connections[0].secondLeg.calendarOverride.exceptions={remove:['2026-11-12']};
  assert.equal(Planner.find(d,'2026-11-12','ranizow','rzeszow').filter(j=>j.kind==='transfer').length,1);
  d.connections[1].secondLeg.fromStop='wrong-stop';
  assert.equal(Planner.find(d,'2026-11-12','ranizow','rzeszow').filter(j=>j.kind==='transfer').length,0);
});
test('return route stays direct and Głogów → Raniżów is excluded', () => {
  assert.equal(find('2026-11-12','glogow','ranizow').length,0);
  const back=find('2026-11-12','rzeszow','ranizow');
  assert.ok(back.length>0);assert.ok(back.every(j=>j.kind==='direct'));
  assert.ok(find('2026-11-12','ranizow','glogow').some(j=>j.legs[0].time==='08:42'));
});
test('expired GTFS and operator rules never extend to unconfirmed dates', () => {
  assert.equal(find('2027-01-12').filter(j=>j.legs.some(t=>t.carrier==='pks')).length,0);
});
test('GTFS 24+ hours preserve the service date for direct buses', () => {
  const d={services:{daily:{type:'weekly',days:[1,1,1,1,1,1,1]}},trips:[{id:'late',fromCity:'ranizow',toCity:'rzeszow',time:'24:15',arrivalTime:'24:40',serviceIds:['daily']}]};
  const j=Planner.find(d,'2026-11-13','ranizow','rzeszow')[0];
  assert.equal(j.departureMinute,15);assert.equal(j.legs[0].serviceDate,'2026-11-12');
});
test('current data keeps exactly two connections and all manual withdrawals', () => {
  const d=JSON.parse(fs.readFileSync('data.json'));
  assert.equal(d.connections.length,2);
  for (const t of d.trips) {
    assert.notEqual(t.direction,'glogow_ranizow');
    assert.ok(!(t.carrier==='ekspresbus' && t.time==='18:05'));
    assert.ok(d.stops[t.fromStop] && d.stops[t.toStop]);
    assert.ok(t.serviceIds.every(id=>d.services[id]));
  }
});
