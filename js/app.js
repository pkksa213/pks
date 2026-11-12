/* Existing Calendar and Services power the web, Android and iOS interfaces. */
(() => {
  const cityNames = { ranizow: 'Raniżów', glogow: 'Głogów Młp.', rzeszow: 'Rzeszów' };
  function today() {
    // The timetable follows Polish local time, including near UTC midnight.
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function read(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* Private browsing/storage full: app still works. */ } }
  const state = { data: null, date: today(), pair: 'ranizow_rzeszow', reverse: false, mode: 'all', minTransfer: 5, maxTransfer: 45, offline: false };
  const $ = id => document.getElementById(id);
  function node(tag, cls, text) {
    const el = document.createElement(tag); if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function validData(data) {
    return data && data.meta && data.meta.schemaVersion === 2 && Array.isArray(data.trips) && data.stops && data.services && data.carriers &&
      data.trips.every(t => data.stops[t.fromStop] && data.stops[t.toStop] && Array.isArray(t.serviceIds) && t.serviceIds.every(s => data.services[s]));
  }
  function cachedData() { try { const d = JSON.parse(read('schedule-v2')); return validData(d) ? d : null; } catch (_) { return null; } }
  async function requestData(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const d = await response.json();
      if (!validData(d)) throw new Error('Nieobsługiwany format rozkładu');
      return d;
    } finally { clearTimeout(timeout); }
  }
  async function loadData() {
    $('refresh-btn').disabled = true;
    $('load-error').hidden = true;
    const native = window.Capacitor && window.Capacitor.isNativePlatform();
    const remote = window.APP_DATA_URL || '';
    try {
      state.data = await requestData(native && remote ? remote : 'data.json');
      state.offline = !navigator.onLine;
      save('schedule-v2', JSON.stringify(state.data));
    } catch (_) {
      state.data = cachedData();
      if (!state.data) {
        try { state.data = await requestData('data.json'); } catch (_) { /* Show retry below. */ }
      }
      state.offline = true;
    }
    $('refresh-btn').disabled = false;
    $('load-error').hidden = !!state.data;
    if (!state.data) { $('trip-list').textContent = ''; return; }
    render();
  }
  function setDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    state.date = iso; render();
  }
  function persist() { save('route-settings', JSON.stringify({ pair: state.pair, reverse: state.reverse, mode: state.mode, minTransfer: state.minTransfer, maxTransfer: state.maxTransfer })); }
  function route() { const cities = state.pair.split('_'); return state.reverse && state.pair !== 'ranizow_glogow' ? cities.reverse() : cities; }
  function badge(leg) { return node('span', 'badge badge--' + leg.carrier, state.data.carriers[leg.carrier].name + (leg.line ? ' · ' + leg.line : '')); }
  function tripCard(journey) {
    const item = node('li', 'trip ' + (journey.kind === 'transfer' ? 'trip--transfer' : ''));
    const heading = node('div', 'trip-heading');
    const time = node('div', 'trip-times');
    time.appendChild(node('strong', 'trip__time', Planner.clock(journey.departureMinute)));
    time.appendChild(node('span', 'time-arrow', '→'));
    time.appendChild(node('span', 'arrival', journey.arrivalMinute === null ? '—' : Planner.clock(journey.arrivalMinute)));
    heading.appendChild(time);
    heading.appendChild(node('span', 'journey-kind', journey.kind === 'transfer' ? '1 przesiadka' : 'Bezpośrednio'));
    item.appendChild(heading);
    if (journey.arrivalMinute === null) item.appendChild(node('p', 'trip__note', 'Przewoźnik nie podał godziny przyjazdu.'));
    journey.legs.forEach((leg, index) => {
      if (index) item.appendChild(node('p', 'transfer-wait', `${journey.transferMinutes} min na przesiadkę · ten sam przystanek`));
      const section = node('div', 'leg');
      section.appendChild(badge(leg));
      section.appendChild(node('div', 'trip__dest', state.data.stops[leg.fromStop].name + ' → ' + state.data.stops[leg.toStop].name));
      if (journey.kind === 'transfer') section.appendChild(node('p', 'leg-times', `${Planner.clock(leg.departureMinute)} → ${Planner.clock(leg.arrivalMinute)}`));
      const label = Services.tripLabel(leg, state.data.services);
      if (label) section.appendChild(node('p', 'trip__note', label));
      item.appendChild(section);
    });
    return item;
  }
  function render() {
    if (!state.data) return;
    if (state.pair === 'ranizow_glogow') state.reverse = false;
    const pair = state.pair.split('_');
    $('inbound').hidden = state.pair === 'ranizow_glogow';
    $('outbound').parentElement.classList.toggle('one-way', state.pair === 'ranizow_glogow');
    $('outbound').textContent = cityNames[pair[0]] + ' → ' + cityNames[pair[1]];
    $('inbound').textContent = cityNames[pair[1]] + ' → ' + cityNames[pair[0]];
    ['outbound', 'inbound'].forEach((id, i) => { const active = state.reverse === !!i; $(id).classList.toggle('is-active', active); $(id).setAttribute('aria-pressed', String(active)); });
    $('date-picker').value = state.date;
    $('date-label').textContent = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(Calendar.fromISO(state.date));
    $('today-btn').classList.toggle('is-current', state.date === today());
    const isMain = state.pair === 'ranizow_rzeszow' && !state.reverse;
    $('transfer-options').hidden = !isMain;
    $('transfer-note').hidden = !isMain || state.mode === 'direct';
    $('transfer-note').textContent = `Przesiadki: Kolejowa, Centrum Przesiadkowe w Głogowie. Maks. ${state.maxTransfer} min oczekiwania. Przewoźnik nie gwarantuje skomunikowania.`;
    const [from, to] = route();
    const journeys = Planner.find(state.data, state.date, from, to, { mode: isMain ? state.mode : 'direct', minTransfer: state.minTransfer, maxTransfer: state.maxTransfer });
    $('trip-list').textContent = '';
    journeys.forEach(j => $('trip-list').appendChild(tripCard(j)));
    if (!journeys.length) $('trip-list').appendChild(node('li', 'empty-state', 'Brak połączeń dla wybranego dnia i filtrów. Sprawdź inny dzień lub wybierz wszystkie połączenia.'));
    const countForms = { one: 'połączenie', few: 'połączenia', many: 'połączeń', other: 'połączenia' };
    $('result-count').textContent = `${journeys.length} ${countForms[new Intl.PluralRules('pl').select(journeys.length)]}`;
    $('results-title').textContent = cityNames[from] + ' → ' + cityNames[to];
    $('connection-status').textContent = state.offline || !navigator.onLine ? '● Korzystasz z zapisanego rozkładu' : '● Rozkład zapisany na tym urządzeniu';
    const meta = state.data.meta;
    const outside = state.date < meta.pksValidFrom || state.date > meta.pksValidUntil;
    const schoolOutside = state.date > Calendar.knownRangeEnd();
    $('validity-note').hidden = !outside && !schoolOutside;
    $('validity-note').textContent = outside ? `Dla tego dnia nie mamy potwierdzonego rozkładu PKS. Dostępny GTFS obejmuje ${meta.pksValidFrom} – ${meta.pksValidUntil}. Widoczne mogą być wyłącznie ręczne wpisy Ekspres Bus.` : 'Dla tej daty kalendarz szkolny wymaga aktualizacji. Kursy szkolne mogą być niepełne.';
    $('data-status').textContent = `PKS: aktualizacja ${(meta.pksLastUpdated || '').slice(0, 10)} · ważność do ${meta.pksValidUntil}. Ekspres Bus: tabliczka z ${meta.ekspresBusUpdated}, kurs 18:05 usunięty.`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const s = JSON.parse(read('route-settings'));
      if (s && ['ranizow_rzeszow', 'ranizow_glogow', 'glogow_rzeszow'].includes(s.pair)) state.pair = s.pair;
      if (s && typeof s.reverse === 'boolean') state.reverse = s.reverse;
      if (s && ['all', 'direct', 'transfer'].includes(s.mode)) state.mode = s.mode;
      if (s && [5, 10, 15].includes(s.minTransfer)) state.minTransfer = s.minTransfer;
      if (s && [30, 45, 90].includes(s.maxTransfer)) state.maxTransfer = s.maxTransfer;
    } catch (_) { /* Defaults are ready. */ }
    $('route-picker').value = state.pair; $('journey-mode').value = state.mode; $('transfer-min').value = String(state.minTransfer); $('transfer-max').value = String(state.maxTransfer);
    $('route-picker').onchange = e => { state.pair = e.target.value; state.reverse = false; persist(); render(); };
    $('outbound').onclick = () => { state.reverse = false; persist(); render(); };
    $('inbound').onclick = () => { state.reverse = true; persist(); render(); };
    $('journey-mode').onchange = e => { state.mode = e.target.value; persist(); render(); };
    $('transfer-min').onchange = e => { state.minTransfer = Number(e.target.value); persist(); render(); };
    $('transfer-max').onchange = e => { state.maxTransfer = Number(e.target.value); persist(); render(); };
    $('prev-day').onclick = () => setDate(Calendar.toISO(Calendar.addDays(Calendar.fromISO(state.date), -1)));
    $('next-day').onclick = () => setDate(Calendar.toISO(Calendar.addDays(Calendar.fromISO(state.date), 1)));
    $('date-picker').onchange = e => setDate(e.target.value);
    $('today-btn').onclick = () => setDate(today());
    $('refresh-btn').onclick = loadData; $('retry-btn').onclick = loadData;
    const closeInfo = () => { $('info-panel').hidden = true; $('info-btn').focus(); };
    $('info-btn').onclick = () => { $('info-panel').hidden = false; $('close-info').focus(); };
    $('close-info').onclick = closeInfo;
    $('info-panel').onclick = e => { if (e.target === $('info-panel')) closeInfo(); };
    document.addEventListener('keydown', e => {
      if ($('info-panel').hidden) return;
      if (e.key === 'Escape') closeInfo();
      if (e.key === 'Tab') {
        const focusable = Array.from($('info-panel').querySelectorAll('button, a')).filter(el => !el.hidden);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    const native = window.Capacitor && window.Capacitor.isNativePlatform();
    $('install-help').hidden = !!native;
    $('download-card').hidden = !!native || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('download-apk').hidden = isIOS;
    $('ios-install-btn').onclick = () => { $('info-panel').hidden = false; $('close-info').focus(); };

    let installPrompt;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('install-btn').hidden = false; });
    $('install-btn').onclick = async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; $('install-btn').hidden = true; } };
    window.addEventListener('online', () => { if (state.data) render(); });
    window.addEventListener('offline', () => { if (state.data) render(); });
    if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('sw.js').catch(() => { /* HTTP/non-support: online mode still works. */ });
    loadData();
  });
})();
