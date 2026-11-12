# Raniżów · rozkład jazdy

Jedna lista odjazdów na stronie, w PWA i w aplikacji Android. Bez kont, reklam i lokalizacji.

- Główna trasa: Raniżów ↔ Rzeszów. Dodatkowo Raniżów → Głogów.
- Bez filtrów połączeń i czasu oczekiwania. Przesiadki mają wyraźny opis na wspólnej liście.
- Wyłącznie dwie przesiadki potwierdzone na stronie PKS:
  - 08:42 Raniżów → 09:05 Głogów (311), następnie 09:06 Głogów → 09:34 Rzeszów (310).
  - 10:35 Raniżów → 10:58 Głogów (311), następnie 11:00 Głogów → 11:28 Rzeszów (313).
- Oba połączenia w dni robocze bez świąt; 10:35 nie kursuje w wakacje letnie. Nie stosujemy limitu minimalnego czasu przesiadki: rozkładowo są to 1 i 2 minuty. Przesiadki nie są gwarantowane.
- Powroty Rzeszów → Raniżów są bezpośrednie. Zgodnie z korektą właściciela wykluczono Głogów → Raniżów.
- Ekspres Bus 18:05 jest trwale usunięty.
- Mały przycisk „Pobierz aplikację” otwiera pobieranie APK lub instrukcję instalacji w Safari. Nie ma dużego banera pobierania.

## Uruchomienie i sprawdzenie

Node.js 22+, Python 3.12:

```sh
npm ci
npm run build
npm run dev
npm test
```

Edytuj źródła w katalogu głównym i `js/`, a następnie przebuduj `dist`. Serwer deweloperski używa portu 8000. Do testu przeglądarkowego uruchom serwer `dist` na porcie 8001, a następnie:

```sh
mkdir -p artifacts
APP_TEST_URL=http://127.0.0.1:8001 python3 tests/browser_smoke.py
```

Test używa Python Playwright i `/usr/bin/chromium`. Sprawdza jedną listę, obie przesiadki, święta/weekendy, pobieranie APK, mały przycisk na komputerze, tryb offline, uruchomienie natywne bez czekania na hosting oraz migrację starej pamięci podręcznej.

## Źródła i kalendarz

`python3 scripts/update_pks_gtfs.py` pobiera GTFS z <https://www.mpkrzeszow.pl/gtfs-pks/latest.zip> oraz publiczne tablice PKS z <https://pks.rzeszow.pl/>. `scripts/pks_official.py` odczytuje oznaczenia kursów i szczegóły dwóch dalszych autobusów.

GTFS sam nie wystarczał: nie uwzględniał poprawnie postojów drugiego autobusu i nie rozróżniał wszystkich oznaczeń D/S/De/+b. Dlatego dla kursów wyświetlanych na trasie Raniżów ↔ Rzeszów oraz Raniżów → Głogów kalendarz oficjalnych tablic ma pierwszeństwo, w granicach opublikowanej ważności. Nie stosujemy reguły „święto = zwykły dzień tygodnia”. Uwzględniamy m.in. święta ustawowe (w tym Wigilię od 2025 r.), dni szkolne, wakacje, wyjątek 25 grudnia i 31 grudnia zgodnie z oznaczeniami konkretnego kursu.

Nieznane oznaczenie, brak wymaganego kursu lub zmiana wskazanego odjazdu przerywają import przed zapisaniem danych, zamiast dopisywać niepotwierdzone połączenie. Do powtarzalnego importu bez sieci:

```sh
python3 scripts/update_pks_gtfs.py --gtfs-file /sciezka/latest.zip --official-cache-dir /katalog/zapisanych/stron
```

Katalog zawiera `pks-ranizow.html`, `pks-rzeszow.html`, `pks-glogow.html` i szczegóły `pks-trip-7755.html`, `pks-trip-7711.html`. Niewielkie wyciągi ze stron z 12.11.2026 są w `tests/fixtures/official`. Dane mają ważność 07.11–31.12.2026; poza nią aplikacja wyświetla ostrzeżenie. Kalendarz szkolny wymaga corocznej aktualizacji. Ferie podkarpackie 18–31.01.2027 potwierdzono w komunikacie MEN: <https://www.gov.pl/web/edukacja/terminy-ferii-zimowych-w-roku-szkolnym-20262027>.

Ekspres Bus jest utrzymywany ręcznie w `data.json`. Import PKS nie zmienia jego reguł poza usunięciem 18:05.

## Aplikacja i aktualizacje

```sh
npm run sync       # zasoby natywne bez instalatora APK w środku
npm run android    # Android Studio
npm run ios        # Xcode na macOS
```

Android: minimum 7.0/API 24 i WebView 80+, JDK 21, SDK 36. iOS/Safari: 15+. Natywny projekt iOS jest zachowany, a użytkownicy iPhone’a instalują PWA z Safari. Nie publikujemy w sklepach.

Wydanie Android 1.0.1 ma `versionCode=2`, jest podpisane tym samym kluczem co 1.0.0 i instaluje się jako aktualizacja. Klucz i hasło pozostają poza repozytorium w chronionym `/workspace/pks-signing`; zachowaj bezpieczną kopię przed zmianą środowiska. Nigdy nie wysyłaj ich na hosting ani do Git.

`app.config.json` ustawia aktualizacje rozkładu z `https://ranizowpksibus.free.nf/schedule.php`; zmienna `SCHEDULE_DATA_URL` może nadpisać adres przy kompilacji. Punkt PHP ustawia CORS dla publicznego JSON. Rozkład zapisany lub dołączony do APK jest widoczny natychmiast, a pobieranie działa w tle. Stara pamięć podręczna bez dwóch potwierdzonych połączeń nie jest używana przez nową aplikację.

`npm run build` kopiuje instalatory z `downloads` do `dist/downloads`; `npm run sync` ich nie kopiuje. APK nie jest wstępnie pobierany przez service worker. Wersja cache powłoki zależy od hasha zbudowanych plików.

## Hosting

Workflow `update-pks.yml` działa po zmianie `main`, z harmonogramu i ręcznie. Pobiera rozkład, sprawdza PHP i testy importera, buduje `dist`, zapisuje dane w Git i przesyła całość na istniejący hosting. Używa sekretów GitHub Actions: `FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_REMOTE_DIR`. Weryfikuje przez ponowne pobranie FTP zgodność `index.html`, danych, punktu PHP i aktualnego APK.

Dostęp HTTP z tego środowiska do hostingu wcześniej zwracał 503; nie wyłączamy weryfikacji TLS. Sukces i porównanie bajtów przez FTP potwierdzają przesłanie plików, ale nie zastępują testu na rzeczywistym telefonie.

[Instalacja bez sklepów](docs/PUBLIKACJA.md).
