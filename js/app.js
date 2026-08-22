/**
 * app.js — spina Calendar + Services z danymi (data.json) i UI.
 */
(() => {
  const state = {
    data: null,
    date: Calendar.toISO(new Date()),
    direction: 'ranizow_rzeszow',
  };

  const els = {};

  function qs(id) { return document.getElementById(id); }

  async function loadData() {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Nie udało się wczytać data.json');
    return res.json();
  }

  const DOW_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const MONTH_NAMES = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
    'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

  function formatHuman(iso) {
    const d = Calendar.fromISO(iso);
    const dow = DOW_NAMES[d.getUTCDay()];
    return `${dow.charAt(0).toUpperCase()}${dow.slice(1)}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  function setDate(iso) {
    state.date = iso;
    els.datePicker.value = iso;
    els.dateLabel.textContent = formatHuman(iso);
    els.todayBtn.classList.toggle('is-current', iso === Calendar.toISO(new Date()));
    render();
  }

  function shiftDate(days) {
    setDate(Calendar.toISO(Calendar.addDays(Calendar.fromISO(state.date), days)));
  }

  function setDirection(dir) {
    state.direction = dir;
    els.dirButtons.forEach(btn => btn.classList.toggle('is-active', btn.dataset.direction === dir));
    render();
  }

  function carrierBadge(carrierId, line) {
    const c = state.data.carriers[carrierId];
    const badge = document.createElement('span');
    badge.className = `badge badge--${carrierId}`;
    const icon = document.createElement('span');
    icon.className = 'badge__icon';
    icon.innerHTML = c.icon === 'loop'
      ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M17 3v4h-4M7 21v-4h4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="7.5" cy="17.5" r="1.6" fill="currentColor"/><circle cx="16.5" cy="17.5" r="1.6" fill="currentColor"/><path d="M3 10.5h18" stroke="currentColor" stroke-width="2.2"/></svg>';
    const label = document.createElement('span');
    label.textContent = line ? `${c.name} ${line}` : c.name;
    badge.append(icon, label);
    return badge;
  }

  function render() {
    const { data, date, direction } = state;
    const trips = data.trips
      .filter(t => t.direction === direction)
      .filter(t => Services.tripRunsOnDate(t, data.services, date))
      .sort((a, b) => a.time.localeCompare(b.time));

    els.list.innerHTML = '';

    const hasPlaceholder = trips.some(t => t.placeholder);
    els.placeholderNote.hidden = !(hasPlaceholder && data.meta.pksDataStatus === 'placeholder');

    if (trips.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Tego dnia nie ma żadnego kursu na tej trasie.';
      els.list.appendChild(empty);
      return;
    }

    for (const trip of trips) {
      const item = document.createElement('li');
      item.className = 'trip';

      const time = document.createElement('span');
      time.className = 'trip__time';
      time.textContent = trip.time;

      const main = document.createElement('div');
      main.className = 'trip__main';

      const row = document.createElement('div');
      row.className = 'trip__row';
      row.appendChild(carrierBadge(trip.carrier, trip.line));

      const dest = document.createElement('span');
      dest.className = 'trip__dest';
      dest.textContent = data.stops[trip.toStop].name;
      row.appendChild(dest);

      main.appendChild(row);

      const label = Services.tripLabel(trip, data.services);
      if (label) {
        const note = document.createElement('span');
        note.className = 'trip__note';
        note.textContent = label;
        main.appendChild(note);
      }

      item.append(time, main);
      els.list.appendChild(item);
    }
  }

  function directionTitle(dir) {
    const [a, b] = dir === 'ranizow_rzeszow'
      ? ['Raniżów, Rynek', 'Rzeszów']
      : ['Rzeszów', 'Raniżów, Rynek'];
    return `${a} → ${b}`;
  }

  async function init() {
    els.dateLabel = qs('date-label');
    els.datePicker = qs('date-picker');
    els.prevBtn = qs('prev-day');
    els.nextBtn = qs('next-day');
    els.todayBtn = qs('today-btn');
    els.dirButtons = Array.from(document.querySelectorAll('.dir-btn'));
    els.list = qs('trip-list');
    els.placeholderNote = qs('placeholder-note');
    els.loadError = qs('load-error');

    els.prevBtn.addEventListener('click', () => shiftDate(-1));
    els.nextBtn.addEventListener('click', () => shiftDate(1));
    els.todayBtn.addEventListener('click', () => setDate(Calendar.toISO(new Date())));
    els.datePicker.addEventListener('change', e => { if (e.target.value) setDate(e.target.value); });
    els.dirButtons.forEach(btn => {
      btn.textContent = directionTitle(btn.dataset.direction);
      btn.addEventListener('click', () => setDirection(btn.dataset.direction));
    });

    try {
      state.data = await loadData();
    } catch (err) {
      els.loadError.hidden = false;
      console.error(err);
      return;
    }

    setDirection(state.direction);
    setDate(state.date);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
