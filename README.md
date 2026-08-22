# Raniżów ⇄ Rzeszów — rozkład jazdy

Statyczna strona łącząca rozkłady PKS Rzeszów (linie 311, 314) i Ekspres Bus
na trasie Raniżów, Rynek ↔ Rzeszów. Bez bazy danych, bez logowania — jeden
plik `data.json` i garść JS-a.

## Jak to jest zbudowane

```
index.html              strona
style.css                wygląd
js/calendar.js           święta, rok szkolny, wakacje/ferie (aktualizować raz w roku!)
js/services.js           zamienia "usługę" (np. "dni nauki szkolnej") na TAK/NIE dla daty
js/app.js                nawigacja po datach, renderowanie listy kursów
data.json                WSZYSTKIE dane: przystanki, przewoźnicy, kursy, kalendarze
scripts/update_pks_gtfs.py       pobiera GTFS PKS i podmienia sekcję PKS w data.json
.github/workflows/update-pks.yml automat: harmonogram + ręczny przycisk "odśwież teraz"
```

Zero bazy danych — przy tej skali (dwie linie PKS + jeden przystanek Ekspres
Bus) jeden plik JSON w zupełności wystarcza i jest dużo prostszy w
utrzymaniu niż serwer + baza.

---

## 1. Pierwsze wdrożenie (jednorazowo)

1. **Załóż repozytorium na GitHub** (może być prywatne) i wgraj do niego
   całą zawartość tego folderu.

2. **Dodaj sekrety FTP**, żeby automat mógł wgrywać stronę na Twój hosting:
   w repozytorium wejdź w **Settings → Secrets and variables → Actions →
   New repository secret** i dodaj cztery sekrety:

   | Nazwa | Co wpisać |
   |---|---|
   | `FTP_HOST` | adres serwera FTP (np. `ftp.twojadomena.pl`) |
   | `FTP_USER` | login FTP |
   | `FTP_PASS` | hasło FTP |
   | `FTP_REMOTE_DIR` | katalog na hostingu, gdzie ma trafić strona (np. `/public_html` albo `/` — zależy od hostingu) |

   Te dane nigdy nie trafiają do mnie ani do kodu — GitHub przechowuje je
   zaszyfrowane i podstawia tylko w trakcie działania automatu.

3. **Uruchom automat pierwszy raz ręcznie**, żeby od razu dociągnąć
   prawdziwe dane PKS (zamiast przykładowych) i wgrać stronę:
   zakładka **Actions** → workflow „Aktualizuj dane PKS i wgraj stronę”
   → przycisk **Run workflow**.

   To jest dokładnie Twój „przycisk odśwież teraz” — możesz go kliknąć w
   dowolnym momencie w przyszłości, kiedy będziesz chciał wymusić
   aktualizację PKS od razu, zamiast czekać na nocny harmonogram
   (domyślnie: co noc ok. 4–5 rano czasu polskiego — do zmiany w pliku
   `.github/workflows/update-pks.yml`, linia z `cron:`).

4. Sprawdź stronę pod swoją domeną. Jeśli baner „dane PKS to na razie
   przykład” zniknął — import się udał.

### Jeśli automat nie znajdzie linii/przystanków (sekcja skryptu do dostrojenia)

`scripts/update_pks_gtfs.py` dopasowuje przystanki po fragmencie nazwy
(`STOP_MATCHERS`) i linie po numerze (`TARGET_LINES`). W logach zakładki
**Actions** zobaczysz, ile linii i przystanków znalazł. Jeśli realny plik
GTFS nazywa je inaczej niż założyliśmy, popraw te dwie stałe na górze
skryptu — reszta zadziała bez zmian.

---

## 2. Ręczna aktualizacja rozkładu Ekspres Bus

Dane Ekspres Bus **nie** są nigdy dotykane przez automat PKS — edytujesz
je wyłącznie ręcznie w `data.json`, sekcja `"trips"`, wpisy z
`"carrier": "ekspresbus"`.

Przykład jednego kursu:

```json
{ "id": "eb1", "carrier": "ekspresbus", "direction": "ranizow_rzeszow",
  "time": "06:02", "fromStop": "ranizow_rynek", "toStop": "rzeszow_lokalny",
  "serviceIds": ["eb_D"] }
```

- `direction`: `"ranizow_rzeszow"` albo `"rzeszow_ranizow"`
- `serviceIds`: lista jednej lub więcej „usług" z sekcji `"services"` —
  kurs jedzie, jeśli **którakolwiek** z nich pasuje na wybraną datę
  (tak działał np. kod „DH" na tabliczce: dni robocze **lub** ferie/wakacje)
- gotowe usługi Ekspres Bus już czekają: `eb_D` (dni robocze), `eb_S`
  (dni nauki szkolnej), `eb_H` (wakacje/ferie/przerwy, codziennie)

Żeby dodać nowy, niestandardowy warunek (np. „nie kursuje 24-26 grudnia"),
dopisz nową usługę w sekcji `"services"` — wzór masz w usługach `pks_plus_b`
czy `pks_6s_T`, które już pokazują, jak wykluczyć konkretne dni.

Po edycji: zapisz plik i wgraj `data.json` na hosting przez FTP (tak jak
zwykle). Strona wczyta go od razu przy następnym odświeżeniu.

---

## 3. Coroczna konserwacja — WAŻNE

Raz w roku, najlepiej w maju/czerwcu, gdy MEN ogłasza terminy na kolejny
rok szkolny, otwórz `js/calendar.js` i dopisz kolejny obiekt do:

- `SCHOOL_YEARS` — początek/koniec roku szkolnego, przerwy świąteczne,
  ferie zimowe (**dla województwa podkarpackiego** — MEN ogłasza osobno
  dla każdego województwa),
- `SUMMER_BREAKS` — wakacje letnie (data końca roku szkolnego + 31 sierpnia).

Na razie wpisany jest rok szkolny 2026/2027 (zweryfikowany w sierpniu
2026) plus prowizoryczne wakacje 2027. Jeśli ktoś otworzy stronę z datą
poza tym zakresem, dni „S" po prostu nigdy nie zostaną uznane za dni
nauki szkolnej — więc pamiętaj o aktualizacji z wyprzedzeniem.

Święta ustawowe (Nowy Rok, Wielkanoc, Boże Ciało itd.) liczą się same —
nic nie trzeba tam poprawiać.

---

## 4. Założenia i rzeczy do wiedzy

- **Kod „DH" i podobne łączone oznaczenia** są interpretowane jako „TAK,
  jeśli którykolwiek z warunków jest spełniony" (logiczne LUB). Jeśli to
  się gdzieś okaże niezgodne z rzeczywistością, daj znać, w którym kursie.
- **Nazwa „Rzeszów D.A."** to oficjalna nazwa przystanku używana przez
  PKS/MPK Rzeszów (Dworzec Autobusowy) — to ten sam przystanek, o którym
  mówiłeś „Dworzec Główny".
- Strona pokazuje wyłącznie **planowy rozkład**, bez śledzenia pojazdów.
- Dane PKS pochodzą z oficjalnego pliku GTFS publikowanego przez MPK
  Rzeszów pod `mpkrzeszow.pl/gtfs-pks/latest.zip` — ten sam plik, który
  zasila oficjalne aplikacje.
