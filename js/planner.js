/** One departure list. Only the two connections verified on the PKS website. */
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
  function activeLegs(data, iso) {
    const result = [];
    [-1, 0].forEach(offset => {
      const serviceDate = Calendar.toISO(Calendar.addDays(Calendar.fromISO(iso), offset));
      data.trips.forEach(trip => {
        if (!Services.tripRunsOnDate(trip, data.services, serviceDate)) return;
        const departureMinute = minutes(trip.time) + offset * 1440;
        if (departureMinute < 0 || departureMinute >= 1440) return;
        const arrivalMinute = trip.arrivalTime ? minutes(trip.arrivalTime) + offset * 1440 : null;
        result.push(Object.assign({}, trip, { departureMinute, arrivalMinute, serviceDate }));
      });
    });
    return result;
  }
  function find(data, iso, from, to) {
    if (from === 'glogow' && to === 'ranizow') return [];
    const legs = activeLegs(data, iso);
    const journeys = legs.filter(t => t.fromCity === from && t.toCity === to).map(t => ({
      id: `${t.id}-${t.serviceDate}`, kind: 'direct', legs: [t],
      departureMinute: t.departureMinute, arrivalMinute: t.arrivalMinute,
    }));
    if (from === 'ranizow' && to === 'rzeszow') {
      (data.connections || []).forEach(connection => {
        const a = legs.find(t => t.id === connection.firstTripId);
        const second = connection.secondLeg;
        if (!a || !second || !Services.tripRunsOnDate(second, data.services, a.serviceDate)) return;
        const offset = a.serviceDate === iso ? 0 : -1440;
        const b = Object.assign({}, second, { serviceDate: a.serviceDate,
          departureMinute: minutes(second.time) + offset, arrivalMinute: minutes(second.arrivalTime) + offset });
        if (a.toStop !== b.fromStop || a.arrivalMinute === null || b.departureMinute < a.arrivalMinute || b.arrivalMinute < b.departureMinute) return;
        journeys.push({ id: connection.id + '-' + a.serviceDate, kind: 'transfer', legs: [a, b],
          departureMinute: a.departureMinute, arrivalMinute: b.arrivalMinute,
          transferMinutes: b.departureMinute - a.arrivalMinute });
      });
    }
    return journeys.sort((a, b) => a.departureMinute - b.departureMinute);
  }
  return { minutes, clock, find };
})();
