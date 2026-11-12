/**
 * services.js
 * ------------------------------------------------------------------
 * Tłumaczy definicję "usługi" (service) z data.json na odpowiedź
 * TAK/NIE dla konkretnej daty. To jest bezpośredni odpowiednik
 * calendar.txt + calendar_dates.txt z formatu GTFS — celowo, żeby
 * import danych PKS (które i tak są w GTFS) mapował się na ten sam
 * model bez żadnego tłumaczenia semantyki.
 *
 * Typy usług (service.type):
 *
 *  "weekly"            — wzorzec dni tygodnia (days: [pon..niedz] 0/1)
 *                         w podanym zakresie dat, opcjonalnie z
 *                         wykluczeniem świąt ustawowych.
 *  "school_days"        — dni nauki szkolnej (dzień roboczy, rok szkolny
 *                         trwa, nie wakacje/ferie/przerwa, nie święto).
 *  "school_break_daily" — codziennie (także w weekendy) w okresie
 *                         wakacji / ferii / przerw świątecznych.
 *  "sunday_or_holiday"  — niedziele oraz święta ustawowo wolne od pracy,
 *                         niezależnie od dnia tygodnia.
 *
 * Każda usługa może dodatkowo mieć:
 *  removeSpecial: ["holySaturday", "dec31"] — wyklucza konkretne,
 *      corocznie przeliczane daty specjalne (patrz SPECIAL_DATES niżej).
 *  exceptions: { add: ["YYYY-MM-DD", ...], remove: ["YYYY-MM-DD", ...] }
 *      — jawne, ręcznie wpisane wyjątki dla tej usługi. "remove" zawsze
 *      wygrywa na końcu (nawet nad "add"), żeby dało się bezpiecznie
 *      wyłączyć jeden konkretny dzień niezależnie od reguły.
 * ------------------------------------------------------------------
 */

const Services = (() => {

  // Lekka kopia liczenia Wielkanocy, żeby nie eksponować wewnętrznej
  // funkcji Calendar. Ten sam algorytm Meeusa/Jonesa/Butchera.
  function easterOf(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return Calendar.toISO(new Date(Date.UTC(year, month - 1, day)));
  }

  function resolveSpecial(iso, key) {
    const year = Number(iso.slice(0, 4));
    const easter = easterOf(year);
    switch (key) {
      case 'goodFriday': return Calendar.toISO(Calendar.addDays(Calendar.fromISO(easter), -2));
      case 'holySaturday': return Calendar.toISO(Calendar.addDays(Calendar.fromISO(easter), -1));
      case 'easterSunday': return easter;
      case 'easterMonday': return Calendar.toISO(Calendar.addDays(Calendar.fromISO(easter), 1));
      case 'dec24': return `${year}-12-24`;
      case 'dec25': return `${year}-12-25`;
      case 'dec31': return `${year}-12-31`;
      case 'jan1': return `${year}-01-01`;
      default: return null;
    }
  }

  function matchesSpecial(iso, key) {
    return resolveSpecial(iso, key) === iso;
  }

  function baseRuns(service, iso) {
    switch (service.type) {
      case 'weekly': {
        const wd = Calendar.weekdayOf(iso); // 1..7
        if (service.startDate && iso < service.startDate) return false;
        if (service.endDate && iso > service.endDate) return false;
        if (!service.days[wd - 1]) return false;
        if (service.excludeHolidays && Calendar.isPublicHoliday(iso)) return false;
        return true;
      }
      case 'school_break_workdays':
        return Calendar.weekdayOf(iso) <= 5 && !Calendar.isPublicHoliday(iso) && !Calendar.isSchoolDay(iso);
      case 'school_days':
        return Calendar.isSchoolDay(iso);
      case 'school_break_daily':
        return Calendar.isSchoolBreakDaily(iso);
      case 'sunday_or_holiday':
        return Calendar.weekdayOf(iso) === 7 || Calendar.isPublicHoliday(iso);
      default:
        console.warn('Nieznany typ usługi:', service.type);
        return false;
    }
  }

  function serviceRunsOnDate(service, iso) {
    let runs = baseRuns(service, iso);
    if ((service.startDate && iso < service.startDate) || (service.endDate && iso > service.endDate)) runs = false;
    if (runs && service.excludeSummer && Calendar.isSummerBreak(iso)) runs = false;

    if (runs && Array.isArray(service.removeSpecial)) {
      if (service.removeSpecial.some(key => matchesSpecial(iso, key))) runs = false;
    }

    if (service.exceptions) {
      if (!runs && service.exceptions.add && service.exceptions.add.includes(iso)) runs = true;
      if (service.exceptions.remove && service.exceptions.remove.includes(iso)) runs = false;
    }

    return runs;
  }

  // Kurs jedzie, jeśli JAKAKOLWIEK z jego usług (OR) mówi "tak".
  // To odwzorowuje łączone oznaczenia typu "DH" na tabliczkach.
  function tripRunsOnDate(trip, services, iso) {
    if (trip.calendarOverride) return serviceRunsOnDate(trip.calendarOverride, iso);
    return trip.serviceIds.some(id => {
      const svc = services[id];
      if (!svc) {
        console.warn('Brak definicji usługi:', id);
        return false;
      }
      return serviceRunsOnDate(svc, iso);
    });
  }

  // Buduje czytelną etykietę ograniczenia kursu (np. "dni nauki szkolnej"),
  // łącząc etykiety wszystkich usług OR'owanych w danym kursie.
  // Usługi typu "weekly" bez ograniczeń (7/7, brak wykluczeń) są pomijane —
  // nie ma sensu informować o czymś, co i tak zawsze obowiązuje.
  function tripLabel(trip, services) {
    if (trip.calendarOverride) return trip.calendarOverride.label || '';
    const labels = trip.serviceIds
      .map(id => services[id])
      .filter(Boolean)
      .filter(svc => !(svc.type === 'weekly' && svc.days.every(Boolean) && !svc.excludeHolidays))
      .map(svc => svc.label)
      .filter(Boolean);
    // usuń duplikaty, zachowaj kolejność
    return [...new Set(labels)].join(' lub ');
  }

  return { serviceRunsOnDate, tripRunsOnDate, tripLabel, easterOf, resolveSpecial };
})();
