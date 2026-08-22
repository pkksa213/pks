/**
 * calendar.js
 * ------------------------------------------------------------------
 * Silnik kalendarza dla rozkładu Raniżów ⇄ Rzeszów.
 *
 * Odpowiada wyłącznie za pytanie: "czy data X jest dniem roboczym /
 * dniem nauki szkolnej / dniem wakacji-ferii-przerwy świątecznej?".
 * Nie wie nic o konkretnych kursach ani przewoźnikach — to celowe,
 * żeby ta sama logika kalendarzowa obsługiwała PKS i Ekspres Bus
 * identycznie.
 *
 * WAŻNE — TO TRZEBA AKTUALIZOWA�Ć RAZ W ROKU:
 * Sekcja SCHOOL_YEARS i SUMMER_BREAKS zawiera oficjalne terminy
 * ogłaszane przez MEN. Gdy tylko MEN ogłosi terminy na kolejny rok
 * szkolny (zwykle w maju), trzeba dopisać kolejny obiekt do tych list.
 * Jeśli wybrana data wykracza poza to, co tu wpisano, dni "S" (nauka
 * szkolna) po prostu nie zostaną uznane za dni szkolne — więc trzeba
 * pamiętać o rocznej aktualizacji.
 * ------------------------------------------------------------------
 */

const Calendar = (() => {

  // ---- Pomocnicze operacje na datach (zawsze w UTC, żeby uniknąć
  // niespodzianek ze strefami czasowymi i czasem letnim/zimowym) ----

  function toISO(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }

  function isoInRange(iso, startIso, endIso) {
    return iso >= startIso && iso <= endIso;
  }

  function weekdayOf(iso) {
    // 1 = poniedziałek ... 7 = niedziela (ISO-8601)
    const js = fromISO(iso).getUTCDay(); // 0 = niedziela ... 6 = sobota
    return js === 0 ? 7 : js;
  }

  // ---------------- Święta ----------------

  // Niedziela Wielkanocna wg algorytmu Meeusa/Jonesa/Butchera (kalendarz gregoriański)
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzec, 4 = kwiecień
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const FIXED_HOLIDAYS = [
    [1, 1, 'Nowy Rok'],
    [1, 6, 'Trzech Króli'],
    [5, 1, 'Święto Pracy'],
    [5, 3, 'Święto Konstytucji 3 Maja'],
    [8, 15, 'Wniebowzięcie NMP'],
    [11, 1, 'Wszystkich Świętych'],
    [11, 11, 'Święto Niepodległości'],
    [12, 25, 'Boże Narodzenie (1. dzień)'],
    [12, 26, 'Boże Narodzenie (2. dzień)'],
  ];

  const holidayCache = new Map();

  function holidaysForYear(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);
    const set = new Set();
    FIXED_HOLIDAYS.forEach(([m, d]) => {
      set.add(toISO(new Date(Date.UTC(year, m - 1, d))));
    });
    const easter = easterSunday(year);
    set.add(toISO(easter));                       // Wielkanoc (niedziela)
    set.add(toISO(addDays(easter, 1)));            // Poniedziałek Wielkanocny
    set.add(toISO(addDays(easter, 49)));           // Zielone Świątki
    set.add(toISO(addDays(easter, 60)));           // Boże Ciało
    holidayCache.set(year, set);
    return set;
  }

  function isPublicHoliday(iso) {
    const year = Number(iso.slice(0, 4));
    return holidaysForYear(year).has(iso);
  }

  function isWeekend(iso) {
    const w = weekdayOf(iso);
    return w === 6 || w === 7;
  }

  // ---------------- Kalendarz roku szkolnego ----------------
  // Źródła: komunikaty MEN dot. organizacji roku szkolnego 2026/2027
  // (start/koniec zajęć, przerwy świąteczne) oraz terminy ferii zimowych
  // dla województwa podkarpackiego. Sprawdzone sierpień 2026.

  const SCHOOL_YEARS = [
    {
      label: '2026/2027',
      start: '2026-09-01',
      end: '2027-06-25',
      breaks: [
        { label: 'Zimowa przerwa świąteczna', start: '2026-12-23', end: '2026-12-31' },
        { label: 'Ferie zimowe (woj. podkarpackie)', start: '2027-01-18', end: '2027-01-31' },
        { label: 'Wiosenna przerwa świąteczna', start: '2027-03-25', end: '2027-03-30' },
      ],
    },
  ];

  // Wakacje letnie — obowiązują "codziennie", niezależnie od dnia tygodnia.
  // Druga pozycja (2027) wynika wprost z ogłoszonej daty zakończenia roku
  // szkolnego 2026/2027 (25.06.2027) + ustawowej reguły "wakacje trwają do
  // 31 sierpnia".
  const SUMMER_BREAKS = [
    { label: 'Wakacje letnie 2026', start: '2026-06-27', end: '2026-08-31' },
    { label: 'Wakacje letnie 2027', start: '2027-06-26', end: '2027-08-31' },
  ];

  function knownRangeEnd() {
    // Najdalsza data, dla której mamy pewne dane kalendarza szkolnego.
    const ends = [...SCHOOL_YEARS.map(s => s.end), ...SUMMER_BREAKS.map(s => s.end)];
    return ends.sort().pop();
  }

  function isSchoolDay(iso) {
    for (const sy of SCHOOL_YEARS) {
      if (isoInRange(iso, sy.start, sy.end)) {
        if (isWeekend(iso)) return false;
        if (isPublicHoliday(iso)) return false;
        if (sy.breaks.some(b => isoInRange(iso, b.start, b.end))) return false;
        return true;
      }
    }
    return false;
  }

  function isSchoolBreakDaily(iso) {
    if (SUMMER_BREAKS.some(b => isoInRange(iso, b.start, b.end))) return true;
    for (const sy of SCHOOL_YEARS) {
      if (sy.breaks.some(b => isoInRange(iso, b.start, b.end))) return true;
    }
    return false;
  }

  // Krótka etykieta wyjaśniająca "co jest dziś" — używana w drobnych
  // notatkach w UI (opcjonalnie), np. do debugowania.
  function describe(iso) {
    if (isPublicHoliday(iso)) return 'święto';
    for (const sy of SCHOOL_YEARS) {
      const b = sy.breaks.find(b => isoInRange(iso, b.start, b.end));
      if (b) return b.label.toLowerCase();
    }
    const sb = SUMMER_BREAKS.find(b => isoInRange(iso, b.start, b.end));
    if (sb) return 'wakacje letnie';
    if (isSchoolDay(iso)) return 'dzień nauki szkolnej';
    if (isWeekend(iso)) return weekdayOf(iso) === 6 ? 'sobota' : 'niedziela';
    return 'dzień roboczy (poza rokiem szkolnym)';
  }

  return {
    toISO, fromISO, addDays, weekdayOf, isoInRange,
    isPublicHoliday, isWeekend, isSchoolDay, isSchoolBreakDaily,
    knownRangeEnd, describe,
  };
})();
