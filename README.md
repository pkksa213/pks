# Raniżów · rozkład jazdy

Aplikacja na Androida, iOS i przeglądarkę (PWA), rozwijająca pierwotną stronę HTML/JS. Wspólny kod używa istniejących modułów `Calendar` i `Services` oraz importera GTFS. Bez kont, reklam, lokalizacji i bazy danych.

- Główny widok: **Raniżów ↔ Rzeszów**.
- Raniżów → Rzeszów: bezpośrednio lub z jedną przesiadką w Głogowie Małopolskim.
- Rzeszów → Raniżów: tylko połączenia bezpośrednie.
- Dodatkowo: **Raniżów → Głogów** oraz Głogów ↔ Rzeszów.
- Zgodnie z korektą właściciela aplikacja **nie oferuje Głogów → Raniżów**, nawet jeśli takie odcinki występują w pliku GTFS. Importer usuwa je przy każdej aktualizacji.
- Kurs Ekspres Bus **18:05 jest usunięty** i nie wraca po imporcie.
- Ostatni rozkład i ustawienia trasy są zapamiętywane lokalnie; aplikacja działa offline.

## Uruchomienie

Wymagane: Node.js 22+ i Python 3.12. Instalacja jest jednorazowa:

```sh
npm ci
npm run build
npm run dev
```

Serwer używa portu 8000 i katalogu `dist`. Źródła pozostają w katalogu głównym oraz `js/`; po zmianie ponów `npm run build`. Nie edytuj plików w `dist`.

```sh
npm test                         # testy planera, kalendarzy i importera
npm run sync                     # build + zasoby Android/iOS
npm run android                  # otwarcie projektu w Android Studio
npm run ios                      # otwarcie projektu w Xcode, wyłącznie macOS
```

Android: JDK 21, Android SDK 36, Build Tools 36, Android Studio zgodne z Capacitor 8. iOS: macOS, Xcode 26+, konto Apple do podpisywania. Projekt iOS korzysta ze Swift Package Manager, bez CocoaPods.

Obsługiwany zakres konfiguracji: **Android 7.0+ (API 24)** z Android System WebView **80+**, **iOS 15+**. `targetSdkVersion=36` jest wymaganiem publikacji, a nie minimalną wersją telefonu. Nie gwarantujemy działania na starszych systemach. Testy na fizycznych urządzeniach są osobnym etapem przed wydaniem.

## Dane i przesiadki

```sh
python3 scripts/update_pks_gtfs.py
# Odtworzenie konkretnego pobranego pliku bez sieci:
python3 scripts/update_pks_gtfs.py --gtfs-file /sciezka/latest.zip
```

Źródło: <https://www.mpkrzeszow.pl/gtfs-pks/latest.zip>. Import obejmuje Raniżów Rynek, **Głogów Młp. Kolejowa I Centrum Przesiadkowe 01 (GTFS stop_id 597)** i Rzeszów D.A. Zachowuje dokładne nazwy stanowisk. Wszystkie linie w GTFS między węzłem a Rzeszowem mogą obsłużyć drugi odcinek, nie tylko 311 i 314.

Planer łączy różne kursy na **dokładnie tym samym przystanku**, sprawdza kalendarz obu odcinków, przyjazd pierwszego i odjazd drugiego. Nie proponuje wysiadania z autobusu jadącego już do celu. Domyślne minimum: 5 minut; maksymalne oczekiwanie: 45 minut. Użytkownik może wybrać minimum 10/15 i maksimum 30/90 minut. To połączenia wynikające z rozkładu, **nie gwarantowane skomunikowanie przez przewoźnika**. Brak danych o opóźnieniach. Nie dopisujemy godzin przyjazdu Ekspres Bus, których nie ma w źródle.

Pobrany 12.11.2026 GTFS obejmuje 31.10–31.12.2026. Przykłady na 12.11:

- Raniżów 08:42 → Głogów 09:05 (311); Głogów 09:44 → Rzeszów 10:15 (301), 39 minut oczekiwania.
- Raniżów 10:35 → Głogów 10:58 (311); Głogów 12:13 → Rzeszów 12:46 (301), 75 minut oczekiwania — widoczny dopiero po wybraniu limitu 90 minut.

Ważność jest odczytywana z GTFS. Po jej końcu aplikacja pokazuje ostrzeżenie i nie przenosi kursów PKS na niepotwierdzone daty. Ekspres Bus pozostaje źródłem ręcznym; edytuj jego wpisy w `data.json`. Kalendarz szkolny w `js/calendar.js` wymaga corocznej konserwacji.

## Aktualizacje w aplikacji natywnej

Paczka zawsze zawiera rozkład do pracy offline. Domyślny adres zapisany w `app.config.json` to **https://ranizowpksibus.free.nf/schedule.php**, na podstawie adresu podanego przez właściciela. Można go nadpisać przy kompilacji:

```sh
SCHEDULE_DATA_URL=https://TWOJA-DOMENA/schedule.php npm run sync
```

Powyższe polecenie jest przykładem nadpisania adresu. Bez zmiennej używany jest adres z `app.config.json`. Jawnie puste `SCHEDULE_DATA_URL` wyłącza zdalne pobieranie. Punkt `schedule.php` zwraca publiczny `data.json` w formacie `schemaVersion: 2` i ustawia `Access-Control-Allow-Origin: *`, aby Android i iOS mogły pobierać dane. Hosting musi obsługiwać PHP. Nie ma tam kont ani danych osobowych. Zabezpieczenia hostingu wymagające obsługi JavaScript lub ciasteczek mogą nadal uniemożliwiać dostęp z aplikacji; działanie zdalnej aktualizacji trzeba sprawdzić na telefonie. Brak skonfigurowanego adresu oznacza korzystanie z danych dołączonych do paczki. Przy niedostępnym serwerze używany jest ostatni zapisany rozkład z datą ważności. Adres jest ustawieniem kompilacji, nie sekretem.

PWA aktualizuje `data.json` ze swojego hostingu. Service worker przechowuje powłokę aplikacji; wersja cache jest hashem zbudowanych zasobów. Wymagany HTTPS dla instalacji/offline poza lokalnym developmentem.

## Wdrożenie i testy

Workflow `update-pks.yml` pobiera GTFS, zapisuje dane w Git, buduje `dist` i wgrywa **całą zawartość `dist`** przez dotychczasowy FTP. Używa istniejących sekretów GitHub Actions: `FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_REMOTE_DIR`. Nie wkładaj ich do aplikacji. Zdalne wdrożenie nie zostało uruchomione w ramach zmian.

Workflow `android.yml` uruchamiany ręcznie tworzy testowy APK jako artefakt GitHub Actions. Zwykły `check.yml` uruchamia testy i synchronizację obu projektów.

Testy z `tests/fixtures/schedule-2026-11-12.json` sprawdzają konkretny zweryfikowany rozkład, niezależnie od późniejszych zmian feedu. Testy importera korzystają z małych sztucznych plików GTFS. Test przeglądarkowy obejmuje nawigację, korektę tras, przesiadki, responsywność i **przeładowanie bez sieci**:

```sh
# Serwuj dist na porcie 8001 w osobnej sesji:
python3 -m http.server 8001 --bind 127.0.0.1 --directory dist
# W środowisku z Python Playwright i Chromium:
mkdir -p artifacts
APP_TEST_URL=http://127.0.0.1:8001 python3 tests/browser_smoke.py
```

Instalowanie APK i wersji iPhone bez sklepów: **[docs/PUBLIKACJA.md](docs/PUBLIKACJA.md)**.

### Status połączenia z hostingiem

12.11.2026 połączenia z tego środowiska do domeny `ranizowpksibus.free.nf` zakończyły się błędem połączenia upstream HTTP 503, a próba w Chromium błędem zaufania certyfikatu. Nie potwierdzono pobierania JSON ani CORS. Nie wyłączano weryfikacji TLS. Przed wydaniem wgraj nowy `dist` na hosting i sprawdź rzeczywiste pobieranie na Androidzie/iOS. Jeśli hosting wymaga przeglądarkowej weryfikacji lub nie dopuszcza zapytań aplikacji, przenieś publiczny plik JSON na hosting HTTPS obsługujący takie żądania i zmień `app.config.json`. Zwykła strona otwierana w Safari/Chrome nie dowodzi dostępności API dla aplikacji.

## Pobieranie aplikacji ze strony

Na stronie są przyciski **„Pobierz na Androida · APK”** i **„Zainstaluj na iPhonie”**. Android pobiera `downloads/ranizow-1.0.0.apk`, podpisany własnym kluczem wydania. iPhone instaluje PWA z Safari → Udostępnij → Do ekranu początkowego. Nie publikujemy aplikacji w sklepach. To wspólny kod, ale APK działa wyłącznie na Androidzie; iOS korzysta z wersji webowej.

`npm run build` kopiuje pliki do pobrania do `dist/downloads`. `npm run sync` buduje zasoby natywne **bez APK w środku**, aby aplikacja nie zawierała własnego instalatora. Plik APK nie jest automatycznie pobierany przez service worker. Workflow wdraża po zmianie `main`, z harmonogramu lub ręcznie; po wgraniu porównuje bajty najważniejszych plików i APK przez FTP.

APK w `downloads/` jest plikiem wydania, a nie plikiem debug. Klucz podpisujący i hasło znajdują się poza repozytorium w chronionym katalogu `/workspace/pks-signing`. Należy zachować ich bezpieczną kopię przed zmianą środowiska; ten sam klucz jest niezbędny do wydawania aktualizacji APK. Nie dodawaj ich do Git ani na hosting. Instalacja tej wersji po starszym debug APK może wymagać odinstalowania debug APK z powodu innego podpisu.
