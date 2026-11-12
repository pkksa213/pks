# Instalacja aplikacji bez sklepów

Ustalony sposób dystrybucji: strona https://ranizowpksibus.free.nf/ — bez Google Play i App Store.

## Android

1. Otwórz stronę i wybierz „Pobierz na Androida · APK”.
2. Po pobraniu otwórz `ranizow-1.0.1.apk`.
3. Gdy Android poprosi, zezwól przeglądarce na instalację z tego źródła i potwierdź instalację.
4. Uruchom aplikację z ekranu telefonu. Ostatni rozkład działa także offline.

Wymagany Android 7.0+ i Android System WebView 80+. Plik jest podpisany tym samym kluczem wydania co wersja 1.0.0. Wersję 1.0.1 zainstaluj nad poprzednią jako aktualizację. Android może wyświetlić informację, że plik jest pobierany spoza sklepu. Nie wyłączaj Play Protect ani innych mechanizmów weryfikacji. Wersja debug udostępniona wcześniej ma inny podpis; do przejścia z debug na wydanie może być konieczne odinstalowanie poprzedniej wersji.

## iPhone / iPad

1. Otwórz stronę w Safari.
2. Wybierz „Zainstaluj na iPhonie”, aby zobaczyć instrukcję.
3. W Safari wybierz Udostępnij → „Do ekranu początkowego” → Dodaj.
4. Uruchamiaj z dodanej ikony. Po pierwszym załadowaniu aplikacja zachowuje rozkład offline, o ile Safari/system nie usunie pamięci witryny.

To PWA, czyli aplikacja instalowana z przeglądarki, korzystająca z tego samego interfejsu i planera. APK nie instaluje się na iOS. Nie ma osobnego pliku IPA do zwykłego pobrania ze strony. Kod przygotowany jest dla Safari/iOS 15+; natywny projekt iOS pozostaje w repozytorium, ale nie jest publikowany.

## Aktualizacje i podpis

Rozkład aktualizuje hosting, a aplikacja zapisuje ostatnią poprawną kopię. Android pobiera dane przez publiczny `schedule.php` (HTTPS i CORS). Przy awarii lub blokadzie hostingu używa kopii offline z datą ważności. PWA pobiera dane z tego samego hostingu.

Nowe wydanie Androida wymaga zwiększenia `versionCode`, przebudowania aplikacji i podpisania tym samym kluczem co pierwsze wydanie. Zmień nazwę APK, metadane `downloads/release.json` i odnośnik na stronie. Klucz i hasło są poza repozytorium w `/workspace/pks-signing`; nie wolno ich wgrywać na hosting ani dodawać do Git. Przed usunięciem środowiska zachowaj bezpieczną kopię klucza i hasła. Utrata klucza uniemożliwi aktualizację istniejącej instalacji pod tym samym identyfikatorem.
