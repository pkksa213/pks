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
  const state = { data: null, date: today(), pair: 'ranizow_rzeszow', reverse: false, updateState: 'loading' };
  const $ = id => document.getElementById(id);
  function node(tag, cls, text) {
    const el = document.createElement(tag); if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function validData(data) {
    return data && data.meta && data.meta.schemaVersion === 2 && Array.isArray(data.trips) && Array.isArray(data.connections) && data.stops && data.services && data.carriers &&
      data.trips.every(t => data.stops[t.fromStop] && data.stops[t.toStop] && Array.isArray(t.serviceIds) && t.serviceIds.every(s => data.services[s]));
  }
  function cachedData() { try { const d = JSON.parse(read('schedule-v3')); return validData(d) ? d : null; } catch (_) { return null; } }
  function updateMessage() {
    if (navigator.onLine === false) return 'Brak internetu. Wyświetlamy zapisany rozkład.';
    if (state.updateState === 'unavailable') return 'Nie udało się zaktualizować rozkładu. Wyświetlamy zapisane dane — spróbuj ponownie później.';
    return '';
  }
  async function requestData(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const type = response.headers.get('content-type') || '';
      if (type.includes('text/html')) throw new Error('Serwer zwrócił stronę zamiast rozkładu');
      const d = await response.json();
      if (!validData(d)) throw new Error('Nieobsługiwany format rozkładu');
      return d;
    } finally { clearTimeout(timeout); }
  }
  let loadSequence = 0;
  async function loadData() {
    const sequence = ++loadSequence;
    $('refresh-btn').disabled = true;
    $('load-error').hidden = true;
    state.updateState = 'loading';
    const native = window.Capacitor && window.Capacitor.isNativePlatform();
    const remote = window.APP_DATA_URL || '';
    let initial = state.data || cachedData();
    if (!initial && native) {
      try { initial = await requestData('data.json'); } catch (_) { /* Retry below. */ }
    }
    if (sequence !== loadSequence) return;
    state.data = initial;
    if (state.data) render();
    try {
      const latest = await requestData(native && remote ? remote : 'data.json');
      if (sequence !== loadSequence) return;
      state.data = latest;
      state.updateState = 'updated';
      save('schedule-v3', JSON.stringify(latest));
    } catch (_) {
      if (sequence !== loadSequence) return;
      let fallback = state.data || cachedData();
      if (!fallback) {
        try { fallback = await requestData('data.json'); } catch (_) { /* Show retry below. */ }
      }
      if (sequence !== loadSequence) return;
      state.data = fallback;
      state.updateState = 'unavailable';
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
  function persist() { save('route-settings', JSON.stringify({ pair: state.pair, reverse: state.reverse })); }
  function route() { const cities = state.pair.split('_'); return state.reverse && state.pair !== 'ranizow_glogow' ? cities.reverse() : cities; }
  function tripCard(journey) {
    const first = journey.legs[0];
    const item = node('li', 'trip' + (journey.kind === 'transfer' ? ' trip--transfer' : ''));
    item.appendChild(node('div', 'trip__time', Planner.clock(journey.departureMinute)));
    const body = node('div', 'trip__body');
    if (journey.kind === 'transfer') {
      body.appendChild(node('span', 'transfer-label', 'Z przesiadką w Głogowie'));
      const route = node('div', 'transfer-route');
      route.appendChild(node('p', '', `${Planner.clock(first.departureMinute)} Raniżów → Głogów`));
      route.appendChild(node('p', '', `${Planner.clock(journey.legs[1].departureMinute)} Głogów → Rzeszów ${Planner.clock(journey.arrivalMinute)}`));
      body.appendChild(route);
    } else {
      const carrier = state.data.carriers[first.carrier];
      body.appendChild(node('div', 'trip__carrier', carrier.name + (first.line ? ` · ${first.line}` : '')));
      body.appendChild(node('div', 'trip__dest', state.data.stops[first.toStop].name));
      if (journey.arrivalMinute !== null) body.appendChild(node('div', 'trip__arrival', `Przyjazd ${Planner.clock(journey.arrivalMinute)}`));
    }
    const details = node('details');
    details.appendChild(node('summary', '', 'Szczegóły'));
    details.appendChild(node('p', '', `Odjazd: ${state.data.stops[first.fromStop].name}`));
    if (journey.kind === 'transfer') {
      details.appendChild(node('p', '', `Pierwszy autobus: PKS ${first.line}. Przyjazd do Głogowa ${Planner.clock(first.arrivalMinute)}.`));
      details.appendChild(node('p', '', `Dalej: PKS ${journey.legs[1].line}, ${journey.transferMinutes} min na przesiadkę. Godziny potwierdzone na stronie PKS.`));
    }
    const label = Services.tripLabel(first, state.data.services);
    if (label && !label.includes('GTFS')) details.appendChild(node('p', '', label));
    body.appendChild(details);
    item.appendChild(body);
    return item;
  }
  function render() {
    if (!state.data) return;
    if (state.pair === 'ranizow_glogow') state.reverse = false;
    const pair = state.pair.split('_');
    $('inbound').hidden = state.pair === 'ranizow_glogow';
    $('outbound').parentElement.classList.toggle('one-way', state.pair === 'ranizow_glogow');
    $('outbound').textContent = state.pair === 'ranizow_glogow' ? 'Do Głogowa' : 'Do Rzeszowa';
    $('inbound').textContent = 'Do Raniżowa';
    ['outbound', 'inbound'].forEach((id, i) => { const active = state.reverse === !!i; $(id).classList.toggle('is-active', active); $(id).setAttribute('aria-pressed', String(active)); });
    $('date-picker').value = state.date;
    $('date-label').textContent = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(Calendar.fromISO(state.date));
    $('today-btn').classList.toggle('is-current', state.date === today());
    $('day-type').textContent = Calendar.describe(state.date);
    const [from, to] = route();
    const journeys = Planner.find(state.data, state.date, from, to);
    $('trip-list').textContent = '';
    journeys.forEach(j => $('trip-list').appendChild(tripCard(j)));
    if (!journeys.length) $('trip-list').appendChild(node('li', 'empty-state', 'Brak kursów w tym dniu. Wybierz inną datę.'));
    const countForms = { one: 'połączenie', few: 'połączenia', many: 'połączeń', other: 'połączenia' };
    $('result-count').textContent = `${journeys.length} ${countForms[new Intl.PluralRules('pl').select(journeys.length)]}`;
    $('results-title').textContent = cityNames[from] + ' → ' + cityNames[to];
    const message = updateMessage();
    $('connection-status').hidden = !message;
    $('connection-status').textContent = message;
    const meta = state.data.meta;
    const outside = state.date < meta.pksValidFrom || state.date > meta.pksValidUntil;
    const schoolOutside = state.date > Calendar.knownRangeEnd();
    $('validity-note').hidden = !outside && !schoolOutside;
    $('validity-note').textContent = outside ? `Dla tego dnia nie mamy potwierdzonego rozkładu PKS. Dostępny GTFS obejmuje ${meta.pksValidFrom} – ${meta.pksValidUntil}. Widoczne mogą być wyłącznie ręczne wpisy Ekspres Bus.` : 'Dla tej daty kalendarz szkolny wymaga aktualizacji. Kursy szkolne mogą być niepełne.';
    $('data-status').textContent = `Aktualizacja: ${(meta.pksLastUpdated || "").slice(0, 10)} · rozkład ważny do ${meta.pksValidUntil}.`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const s = JSON.parse(read('route-settings'));
      if (s && ['ranizow_rzeszow', 'ranizow_glogow'].includes(s.pair)) state.pair = s.pair;
      if (s && typeof s.reverse === 'boolean') state.reverse = s.reverse;
    } catch (_) { /* Defaults are ready. */ }
    $('route-picker').value = state.pair;
    $('route-picker').onchange = e => { state.pair = e.target.value; state.reverse = false; persist(); render(); };
    $('outbound').onclick = () => { state.reverse = false; persist(); render(); };
    $('inbound').onclick = () => { state.reverse = true; persist(); render(); };
    $('prev-day').onclick = () => setDate(Calendar.toISO(Calendar.addDays(Calendar.fromISO(state.date), -1)));
    $('next-day').onclick = () => setDate(Calendar.toISO(Calendar.addDays(Calendar.fromISO(state.date), 1)));
    $('date-picker').onchange = e => setDate(e.target.value);
    $('today-btn').onclick = () => setDate(today());
    $('refresh-btn').onclick = loadData; $('retry-btn').onclick = loadData;
    const closeInfo = () => { $('info-panel').hidden = true; $('info-btn').focus(); };
    const showInfo = () => { $('info-panel').hidden = false; $('close-info').focus(); };
    $('info-btn').onclick = showInfo;
    $('about-btn').onclick = showInfo;
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
    $('info-btn').hidden = !!native || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('download-apk').hidden = isIOS;
    $('android-help').hidden = isIOS;

    let installPrompt;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('install-btn').hidden = false; });
    $('install-btn').onclick = async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; $('install-btn').hidden = true; } };
    window.addEventListener('online', loadData);
    window.addEventListener('offline', () => { if (state.data) render(); });
    if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('sw.js').catch(() => { /* HTTP/non-support: online mode still works. */ });
    loadData();
  });
})();
