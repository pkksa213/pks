/** Routing over verified GTFS segments. Times are minutes on the departure date. */
const Planner = (() => {
  function minutes(time) {
    if (!time) return null;
    const parts = time.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  }
  function clock(value) {
    const day = Math.floor(value / 1440);
    const n = ((value % 1440) + 1440) % 1440;
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}${day > 0 ? ` (+${day} dzień)` : ''}`;
  }
  function activeLegs(data, iso, includeNextDay) {
    const result = [];
    const offsets = includeNextDay ? [-1, 0, 1] : [-1, 0];
    offsets.forEach(offset => {
      const serviceDate = Calendar.toISO(Calendar.addDays(Calendar.fromISO(iso), offset));
      data.trips.forEach(trip => {
        if (!Services.tripRunsOnDate(trip, data.services, serviceDate)) return;
        const departureMinute = minutes(trip.time) + offset * 1440;
        if (departureMinute < 0 || departureMinute >= (includeNextDay ? 2880 : 1440)) return;
        const arrivalMinute = trip.arrivalTime ? minutes(trip.arrivalTime) + offset * 1440 : null;
        result.push(Object.assign({}, trip, { departureMinute, arrivalMinute, serviceDate }));
      });
    });
    return result;
  }
  function find(data, iso, from, to, options) {
    const opts = Object.assign({ mode: 'all', minTransfer: 5, maxTransfer: 45 }, options);
    const legs = activeLegs(data, iso, true);
    if (from === 'glogow' && to === 'ranizow') return [];
    const departures = legs.filter(t => t.fromCity === from && t.departureMinute < 1440);
    const direct = departures.filter(t => t.toCity === to).map(t => ({
      id: `${t.id}-${t.serviceDate}`, kind: 'direct', legs: [t],
      departureMinute: t.departureMinute, arrivalMinute: t.arrivalMinute,
    }));
    let transfers = [];
    if (from === 'ranizow' && to === 'rzeszow') {
      const firstLegs = departures.filter(t => t.toCity === 'glogow' && t.arrivalMinute !== null);
      const secondLegs = legs.filter(t => t.fromCity === 'glogow' && t.toCity === to);
      firstLegs.forEach(a => {
        // Do not recommend getting off a bus that already goes to the destination.
        if (direct.some(j => j.legs[0].gtfsTripId === a.gtfsTripId && a.gtfsTripId)) return;
        const candidates = secondLegs.filter(b => {
          const wait = b.departureMinute - a.arrivalMinute;
          return a.toStop === b.fromStop && a.gtfsTripId !== b.gtfsTripId &&
            b.arrivalMinute !== null && wait >= opts.minTransfer && wait <= opts.maxTransfer;
        }).sort((a, b) => a.arrivalMinute - b.arrivalMinute || a.departureMinute - b.departureMinute);
        if (candidates.length) {
          const b = candidates[0];
          transfers.push({ id: `${a.id}-${b.id}-${a.serviceDate}`, kind: 'transfer', legs: [a, b],
            departureMinute: a.departureMinute, arrivalMinute: b.arrivalMinute,
            transferMinutes: b.departureMinute - a.arrivalMinute });
        }
      });

    }
    return (opts.mode === 'direct' ? direct : opts.mode === 'transfer' ? transfers : direct.concat(transfers))
      .sort((a, b) => a.departureMinute - b.departureMinute || (a.arrivalMinute || Infinity) - (b.arrivalMinute || Infinity));
  }
  return { minutes, clock, find };
})();
