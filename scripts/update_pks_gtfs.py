#!/usr/bin/env python3
"""Import oficjalnego GTFS PKS: Raniżów Rynek, Głogów Kolejowa i Rzeszów D.A.
Zachowuje usługi ręczne i Ekspres Bus poza wycofanym kursem 18:05.
Generuje odcinki z czasem przyjazdu, prawdziwymi przystankami i końcem trasy.
Nie zapisuje niepełnego importu; kalendarze i wyjątki pochodzą z GTFS.
"""

import argparse
import copy
import hashlib
import csv
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request

# ============================== KONFIGURACJA ==============================

GTFS_URL = "https://www.mpkrzeszow.pl/gtfs-pks/latest.zip"
DATA_JSON_PATH = Path(__file__).resolve().parent.parent / "data.json"

WEEKDAY_FIELDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_LABELS_PL = ["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."]

# ============================================================================


def fetch_gtfs_zip(url: str) -> zipfile.ZipFile:
    req = Request(url, headers={"User-Agent": "ranizow-rzeszow-rozklad/1.0"})
    with urlopen(req, timeout=60) as resp:
        raw = resp.read()
    return zipfile.ZipFile(io.BytesIO(raw))


def read_csv(zf: zipfile.ZipFile, filename: str) -> list[dict]:
    with zf.open(filename) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def norm_time(hms: str) -> str:
    """Keep GTFS service-day hours >=24 instead of moving a trip to the wrong day."""
    h, m, *_ = hms.strip().split(":")
    if not (0 <= int(h) <= 47 and 0 <= int(m) <= 59):
        raise ValueError(f"Niepoprawna godzina GTFS: {hms}")
    return f"{int(h):02d}:{int(m):02d}"


def weekday_label(row: dict) -> str:
    active = [WEEKDAY_LABELS_PL[i] for i, f in enumerate(WEEKDAY_FIELDS) if row.get(f) == "1"]
    if len(active) == 7:
        return "codziennie"
    if active == WEEKDAY_LABELS_PL[0:5]:
        return "dni robocze (pon.–pt.)"
    if active == ["sob."]:
        return "soboty"
    if active == ["niedz."]:
        return "niedziele"
    return ", ".join(active) if active else "brak kursowania wg wzorca tygodnia"


def build_services(zf: zipfile.ZipFile, used_service_ids: set[str]) -> dict:
    """Buduje obiekty usług w naszym formacie na podstawie calendar.txt
    (wzorzec tygodnia) i calendar_dates.txt (wyjątki: dodane/usunięte dni)."""
    services = {}

    try:
        calendar_rows = read_csv(zf, "calendar.txt")
    except KeyError:
        calendar_rows = []

    for row in calendar_rows:
        sid = row["service_id"]
        if sid not in used_service_ids:
            continue
        days = [1 if row.get(f) == "1" else 0 for f in WEEKDAY_FIELDS]
        services[f"pks_gtfs_{sid}"] = {
            "label": f"PKS wg rozkładu GTFS — {weekday_label(row)}",
            "type": "weekly",
            "days": days,
            "startDate": f"{row['start_date'][0:4]}-{row['start_date'][4:6]}-{row['start_date'][6:8]}",
            "endDate": f"{row['end_date'][0:4]}-{row['end_date'][4:6]}-{row['end_date'][6:8]}",
            "excludeHolidays": False,  # GTFS calendar_dates już zawiera realne wyjątki — nie dublujemy
            "exceptions": {"add": [], "remove": []},
        }

    try:
        cd_rows = read_csv(zf, "calendar_dates.txt")
    except KeyError:
        cd_rows = []

    for row in cd_rows:
        sid = row["service_id"]
        key = f"pks_gtfs_{sid}"
        if key not in services:
            if sid not in used_service_ids:
                continue
            # service_id obecny tylko w calendar_dates.txt (bez wpisu w calendar.txt)
            # — traktujemy jako usługę "same wyjątki", domyślnie nigdy nieaktywną z reguły.
            services[key] = {
                "label": "PKS wg rozkładu GTFS — wyjątki",
                "type": "weekly",
                "days": [0, 0, 0, 0, 0, 0, 0],
                "startDate": "2000-01-01",
                "endDate": "2100-01-01",
                "excludeHolidays": False,
                "exceptions": {"add": [], "remove": []},
            }
        date_iso = f"{row['date'][0:4]}-{row['date'][4:6]}-{row['date'][6:8]}"
        if row["exception_type"] == "1":
            services[key]["exceptions"]["add"].append(date_iso)
        elif row["exception_type"] == "2":
            services[key]["exceptions"]["remove"].append(date_iso)

    return services


# The transfer uses the exact same GTFS stop, not a city-wide approximation.
HUB_STOP_ID = "597"  # Kolejowa I Centrum Przesiadkowe 01
RANIZOW_STOP_IDS = {"776", "777"}  # Rynek, both directions


def city_for_stop(stop):
    if stop["stop_id"] in RANIZOW_STOP_IDS:
        return "ranizow"
    if stop["stop_id"] == HUB_STOP_ID:
        return "glogow"
    if stop.get("stop_name", "").startswith("Rzeszów D.A."):
        return "rzeszow"
    return None


def import_feed(zf, data):
    data = copy.deepcopy(data)
    routes = {r["route_id"]: r for r in read_csv(zf, "routes.txt")}
    stops = {r["stop_id"]: r for r in read_csv(zf, "stops.txt")}
    trips = {r["trip_id"]: r for r in read_csv(zf, "trips.txt")}
    by_trip = {}
    for row in read_csv(zf, "stop_times.txt"):
        by_trip.setdefault(row["trip_id"], []).append(row)
    generated, used_services, imported_stops = [], set(), {}
    for tid, rows in by_trip.items():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
        trip = trips[tid]
        hits = [(i, r, city_for_stop(stops[r["stop_id"]])) for i, r in enumerate(rows)
                if city_for_stop(stops[r["stop_id"]])]
        for pos, (i, a, from_city) in enumerate(hits):
            for j, b, to_city in hits[pos + 1:]:
                if from_city == to_city or (from_city == "glogow" and to_city == "ranizow"):
                    continue
                # Include all lines between the interchange and Rzeszów, and all
                # feeds serving Raniżów Rynek. Never invent a transfer stop.
                from_key, to_key = "pks_stop_" + a["stop_id"], "pks_stop_" + b["stop_id"]
                for row, key, city in [(a, from_key, from_city), (b, to_key, to_city)]:
                    stop = stops[row["stop_id"]]
                    imported_stops[key] = {"name": stop["stop_name"], "city": city,
                        "lat": float(stop["stop_lat"]), "lon": float(stop["stop_lon"])}
                dep = norm_time(a.get("departure_time") or a["arrival_time"])
                arr = norm_time(b.get("arrival_time") or b["departure_time"])
                if tuple(map(int, arr.split(":"))) < tuple(map(int, dep.split(":"))):
                    raise ValueError(f"Przyjazd przed odjazdem: {tid}")
                used_services.add(trip["service_id"])
                generated.append({
                    "id": f"pks_gtfs_{tid}_{a['stop_id']}_{b['stop_id']}",
                    "gtfsTripId": tid, "carrier": "pks",
                    "line": routes[trip["route_id"]]["route_short_name"],
                    "direction": f"{from_city}_{to_city}", "time": dep, "arrivalTime": arr,
                    "fromStop": from_key, "toStop": to_key,
                    "fromCity": from_city, "toCity": to_city,
                    "terminalName": stops[rows[-1]["stop_id"]]["stop_name"],
                    "terminatesInRanizow": rows[-1]["stop_id"] in RANIZOW_STOP_IDS,
                    "serviceIds": ["pks_gtfs_" + trip["service_id"]],
                })
    if not generated:
        raise ValueError("Brak kursów — zachowano poprzednie dane.")
    directions = {t["direction"] for t in generated}
    required = {"ranizow_glogow", "glogow_rzeszow", "rzeszow_glogow",
                "ranizow_rzeszow", "rzeszow_ranizow"}
    if not required <= directions:
        raise ValueError(f"Niepełny rozkład — brakuje {required - directions}; zachowano poprzednie dane.")
    new_services = build_services(zf, used_services)
    if any(sid not in new_services for t in generated for sid in t["serviceIds"]):
        raise ValueError("Brak kalendarza dla części kursów — zachowano poprzednie dane.")
    data["trips"] = [t for t in data["trips"] if t.get("carrier") != "pks"] + generated
    data["services"] = {k: v for k, v in data["services"].items() if not k.startswith("pks_gtfs_")}
    data["services"].update(new_services)
    data["stops"] = {k: v for k, v in data["stops"].items() if not k.startswith("pks_stop_")}
    data["stops"].update(imported_stops)
    for key, city in [("ranizow_rynek", "ranizow"), ("rzeszow_da", "rzeszow"), ("rzeszow_lokalny", "rzeszow")]:
        if key in data["stops"]:
            data["stops"][key]["city"] = city
    for t in data["trips"]:
        t["fromCity"] = data["stops"][t["fromStop"]]["city"]
        t["toCity"] = data["stops"][t["toStop"]]["city"]
    # Explicit manual withdrawal: future GTFS imports must not bring it back.
    data["trips"] = [t for t in data["trips"] if not (
        t.get("carrier") == "ekspresbus" and t.get("time") == "18:05")]
    dates = [d for svc in new_services.values() for d in svc.get("exceptions", {}).get("add", [])]
    starts = [s["startDate"] for s in new_services.values() if any(s["days"])]
    ends = [s["endDate"] for s in new_services.values() if any(s["days"])]
    if not dates and not starts:
        raise ValueError("Pusty kalendarz kursowania.")
    data["meta"].update({"schemaVersion": 2, "route": "Raniżów ↔ Rzeszów · Głogów Małopolski",
        "pksDataStatus": "live", "pksSource": GTFS_URL,
        "pksLastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pksValidFrom": min(dates + starts), "pksValidUntil": max(dates + ends),
        "transferStop": "pks_stop_" + HUB_STOP_ID,
        "disabledDirections": ["glogow_ranizow"],
        "routeCorrection": "Według korekty właściciela nie oferujemy Głogów → Raniżów ani powrotów z taką przesiadką.",
        "pksNote": "Oficjalny GTFS PKS. Przesiadki wyliczane z godzin; nie są gwarantowane przez przewoźnika.",
        "ekspresBusWithdrawn": ["18:05"],
    })
    return data


def main():
    parser = argparse.ArgumentParser(description="Importuj PKS i odcinki do przesiadek w Głogowie.")
    parser.add_argument("--gtfs-file", type=Path, help="Lokalny plik ZIP zamiast pobierania")
    parser.add_argument("--output", type=Path, default=DATA_JSON_PATH)
    args = parser.parse_args()
    raw = args.gtfs_file.read_bytes() if args.gtfs_file else None
    zf = zipfile.ZipFile(io.BytesIO(raw)) if raw else fetch_gtfs_zip(GTFS_URL)
    data = json.loads(args.output.read_text(encoding="utf-8"))
    data = import_feed(zf, data)
    data["meta"]["pksFeedSha256"] = hashlib.sha256(zf.fp.getvalue()).hexdigest()
    # Replace only after a successful complete import.
    tmp = args.output.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(args.output)
    print(f"Zapisano {len(data['trips'])} odcinków; GTFS ważny do {data['meta']['pksValidUntil']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
