#!/usr/bin/env python3
"""
update_pks_gtfs.py
--------------------------------------------------------------------
Pobiera oficjalny plik GTFS PKS (linie ZGPKS Rzeszów, w tym MKS)
z mpkrzeszow.pl, wyciąga z niego WYŁĄCZNIE linie 311 i 314 w zakresie
przystanków Raniżów, Rynek <-> Rzeszów D.A., i podmienia sekcję danych
PKS w pliku data.json na dokładne dane z tego pliku.

Nie dotyka danych Ekspres Bus (carrier "ekspresbus") ani ręcznie
zdefiniowanych usług (eb_*, pks_D, pks_6s, pks_plus...) — te zostają
bez zmian. Ten skrypt zarządza tylko:
  - kursami z "carrier": "pks",
  - usługami o id zaczynającym się od "pks_gtfs_" (wygenerowanymi
    automatycznie z calendar.txt / calendar_dates.txt).

Uruchamiane przez .github/workflows/update-pks.yml — automatycznie
(harmonogram) i ręcznie (przycisk "Run workflow" w GitHub = odpowiednik
"odśwież teraz").

Jeśli nazwy przystanków lub numer linii w realnym pliku GTFS różnią się
od tego, co tu założono, dopasuj stałe w sekcji KONFIGURACJA niżej —
reszta skryptu nie wymaga zmian.
--------------------------------------------------------------------
"""

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

# Numery linii, które nas interesują (route_short_name w GTFS).
TARGET_LINES = {"311", "314"}

# Dopasowanie przystanków po fragmencie nazwy (wielkość liter nieistotna,
# polskie znaki jak w GTFS). Jeśli w realnym pliku stop_name wygląda
# inaczej niż zakładamy, popraw tu.
STOP_MATCHERS = {
    "ranizow_rynek": lambda name: "RANIŻÓW" in name.upper() and "RYNEK" in name.upper(),
    "rzeszow_da": lambda name: "RZESZÓW" in name.upper() and ("D.A" in name.upper() or "DWORZEC" in name.upper()),
}

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
    """GTFS pozwala na godziny >=24:00:00 (kurs po północy). Dla naszej
    trasy to się nie zdarza, ale na wszelki wypadek normalizujemy do 0-23."""
    h, m, _s = hms.strip().split(":")
    h = int(h) % 24
    return f"{h:02d}:{m}"


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


def main() -> int:
    print(f"Pobieram GTFS PKS z {GTFS_URL} ...")
    zf = fetch_gtfs_zip(GTFS_URL)

    routes = read_csv(zf, "routes.txt")
    stops = read_csv(zf, "stops.txt")
    trips = read_csv(zf, "trips.txt")
    stop_times = read_csv(zf, "stop_times.txt")

    target_route_ids = {r["route_id"]: r.get("route_short_name", "") for r in routes if r.get("route_short_name") in TARGET_LINES}
    print(f"Znalezione linie: {sorted(set(target_route_ids.values()))} ({len(target_route_ids)} route_id)")
    if not target_route_ids:
        print("UWAGA: nie znaleziono linii 311/314 w routes.txt — sprawdź TARGET_LINES / route_short_name.", file=sys.stderr)

    stop_role = {}  # stop_id -> "ranizow_rynek" | "rzeszow_da"
    for s in stops:
        for role, matcher in STOP_MATCHERS.items():
            if matcher(s.get("stop_name", "")):
                stop_role[s["stop_id"]] = role
    print(f"Dopasowane przystanki: {len(stop_role)} (oczekiwane role: {set(STOP_MATCHERS)})")
    if set(stop_role.values()) != set(STOP_MATCHERS):
        print("UWAGA: nie znaleziono obu wymaganych przystanków — sprawdź STOP_MATCHERS.", file=sys.stderr)

    target_trip_ids = {t["trip_id"]: t for t in trips if t["route_id"] in target_route_ids}

    # stop_times pogrupowane wg trip_id, tylko dla interesujących nas przejazdów
    st_by_trip: dict[str, list[dict]] = {}
    for row in stop_times:
        tid = row["trip_id"]
        if tid in target_trip_ids:
            st_by_trip.setdefault(tid, []).append(row)

    new_trips = []
    used_service_ids = set()
    counter = 0

    for tid, rows in st_by_trip.items():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
        hits = [(r, stop_role[r["stop_id"]]) for r in rows if r["stop_id"] in stop_role]
        if len(hits) < 2:
            continue  # ten konkretny kurs nie obsługuje obu naszych przystanków

        (row_a, role_a), (row_b, role_b) = hits[0], hits[-1]
        if role_a == role_b:
            continue  # coś dziwnego — pomijamy bezpiecznie

        if role_a == "ranizow_rynek":
            direction = "ranizow_rzeszow"
            board_row, from_stop, to_stop = row_a, "ranizow_rynek", "rzeszow_da"
        else:
            direction = "rzeszow_ranizow"
            board_row, from_stop, to_stop = row_a, "rzeszow_da", "ranizow_rynek"

        trip_meta = target_trip_ids[tid]
        route_no = target_route_ids[trip_meta["route_id"]]
        service_id = trip_meta["service_id"]
        used_service_ids.add(service_id)

        counter += 1
        new_trips.append({
            "id": f"pks_gtfs_{counter}",
            "carrier": "pks",
            "line": route_no,
            "direction": direction,
            "time": norm_time(board_row.get("departure_time") or board_row.get("arrival_time")),
            "fromStop": from_stop,
            "toStop": to_stop,
            "serviceIds": [f"pks_gtfs_{service_id}"],
        })

    print(f"Zbudowano {len(new_trips)} kursów PKS (linie {sorted(set(target_route_ids.values()))}).")

    new_services = build_services(zf, used_service_ids)
    print(f"Zbudowano {len(new_services)} definicji usług (kalendarzy) PKS.")

    # ---- scal z istniejącym data.json, dotykając tylko sekcji PKS ----
    data = json.loads(DATA_JSON_PATH.read_text(encoding="utf-8"))

    data["trips"] = [t for t in data["trips"] if t.get("carrier") != "pks"] + new_trips
    data["services"] = {
        sid: svc for sid, svc in data["services"].items() if not sid.startswith("pks_gtfs_")
    }
    data["services"].update(new_services)

    data["meta"]["pksDataStatus"] = "live"
    data["meta"]["pksLastUpdated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["meta"]["pksNote"] = "Dane pobrane automatycznie z oficjalnego pliku GTFS PKS (mpkrzeszow.pl)."

    DATA_JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Zapisano {DATA_JSON_PATH}. Gotowe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
