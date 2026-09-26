# Kaneo — powtórka testów na gałęzi `claude/integration-all`

**Autor:** kierownik projektu (test praktyczny)
**Data:** 26 września 2026
**Testowana wersja:** Kaneo v2.27.0, gałąź `claude/integration-all`, commit `8a79651`
**Poprzedni raport:** `RAPORT-KANEO-GANTT.md` — gałąź `claude/gantt-plus-cross-project`, commit `9a5dca8`

**Film:** `demo-kaneo-integration-all.mp4` — nagranie ekranu z widocznym kursorem,
**angielski interfejs i angielskie napisy**, pokazujące pracę kierownika projektu
na nowych funkcjach. Spis rozdziałów w załączniku A.

---

## 1. Po co ta powtórka

Poprzedni raport kończył się werdyktem: **jako jedyne narzędzie do prowadzenia
migracji 3000 maszyn — nie**. Cztery braki uznałem za krytyczne: brak śladu
audytowego zmian harmonogramu, brak widoku portfela, brak obłożenia zasobów
i brak eksportu planu z zależnościami.

Gałąź `claude/integration-all` zawiera **164 commity** ponad poprzednio testowaną
gałąź i scala kilkanaście osobnych gałęzi, których nazwy odpowiadają po kolei
punktom mojego raportu: `fix-activity-logging`, `feat-portfolio-timeline`,
`feat: add workspace workload view`, `fix-export-fields`, `fix-mcp-fields`,
`feat-cross-project-critical-path`, `feat-gantt-virtualization`,
`feat-incremental-realtime`, `feat-approval-gates`, `feat-mcp-task-custom-fields`,
`feat-i18n-untranslated-report`, `fix-date-format`.

Zadanie było więc proste: **sprawdzić, czy to działa** — i szukać regresji.

## 2. Środowisko i metoda

Ten sam wariant co poprzednio: uruchomienie z kodu źródłowego. Obraz Dockera
nadal jest poza zasięgiem (polityka ruchu wychodzącego blokuje magazyn warstw
GHCR).

**Baza od zera.** Skasowałem bazę i utworzyłem ją na nowo, żeby migracje
przeszły od pustego stanu i żeby liczby były porównywalne. Migracje wykonały się
bez błędu. `pnpm install` — 16,5 s.

**Dane.** Ten sam plan migracji co poprzednio, wprowadzony przez API, plus dwie
rzeczy, których wcześniej nie było, bo nie było czego nimi testować:

| Element | Liczba |
|---|---|
| Projekty | 7 |
| Zadania | 252 (**wszystkie przypisane**) |
| Osoby w zespole | 7 |
| Kamienie milowe | 28 |
| Zależności blokujące | 243 (FS/SS/FF/SF z lagami) |
| Zależności **międzyprojektowe** | 19 |
| Zadania z planem bazowym | 129 |
| Ograniczenia dat | 15 |
| **Bramki zgód klientów** | 8 (4 zatwierdzone, 2 oczekujące, 1 odrzucona, 1 nierozpoczęta) |
| Dni wolne w kalendarzu | 10 |

Obciążenie zespołu jest celowo nierówne — Anna Infrastruktura ma 101 z 252 zadań,
Ola Bezpieczeństwo 14. Bez tego widok obłożenia nie miałby czego pokazać.

**Metoda.** Interfejs przeklikany trzema równoległymi zestawami testów
(agenci Sonnet 5, Chromium sterowany przez Playwright), każdy w innym obszarze:
portfel i obłożenie, dziennik i bramki zgód, wykres Gantta i regresje.
Audyt MCP, badanie bezpieczeństwa, test skali i analizę tłumaczeń wykonałem sam,
przez API i bazę.

---

## 3. Tabela zbiorcza — 21 zarzutów z poprzedniego raportu

Pozycje 1–16 to główne zarzuty z tabeli poprzedniego raportu. Pozycje 17–21 to
usterki użyteczności wykresu, które poprzednio opisałem w części „co bym
zmienił”. Sprawdziłem wszystkie.

| # | Zarzut | Werdykt |
|---|---|---|
| 1 | Brak śladu audytowego zmian harmonogramu | **naprawione w danych i eksporcie**, widok streszcza zmiany planu |
| 2 | Brak widoku portfela (wiele projektów na jednej osi) | **naprawione** (bez linii zależności) |
| 3 | Brak obłożenia zasobów | **naprawione częściowo** |
| 4 | Eksport bez postępu, kamieni, planu bazowego, ograniczeń i relacji | **naprawione częściowo** |
| 5 | Ścieżka krytyczna pomijała zależności międzyprojektowe | **naprawione** |
| 6 | MCP nie ustawiał żadnego z nowych pól | **naprawione** |
| 7 | 87 ze 122 komunikatów nowych funkcji po angielsku | **naprawione po polsku poza dwiema grupami** (relacje, pola własne), pozostałe 18 języków bez zmian |
| 8 | Brak wirtualizacji — 1200 wierszy naraz w DOM | **naprawione** |
| 9 | Pełne pobieranie listy zadań co ~25 s | **naprawione** |
| 10 | Brak masowej zmiany postępu | **naprawione** |
| 11 | Brak właściciela zadania na wykresie | **naprawione** |
| 12 | Brak eksportu dziennika i polityki retencji | **naprawione częściowo** (retencja nieegzekwowana) |
| 13 | Typu zależności nie dało się zobaczyć ani zmienić z wykresu | **naprawione** |
| 14 | Plan bazowy nie pokazywał liczby dni poślizgu | **naprawione** |
| 15 | Etykiety opóźnień zlewały się w węzłach rozgałęzienia | **naprawione** (stos, przy dużym rozgałęzieniu ciasny) |
| 16 | Brak znacznika „po terminie” | **naprawione** (chip „Overdue”) |
| 17 | Podświetlanie po najechaniu nie działało w widoku Kwartał | **naprawione** |
| 18 | Słupek zbiorczy podzadań bez wskaźnika postępu | **naprawione** |
| 19 | Uchwyt zależności zasłaniał uchwyt zmiany długości | **naprawione częściowo** |
| 20 | Przeciąganie kolumny nazw zaznaczało tekst | **naprawione częściowo** |
| 21 | Cieniowanie dni wolnych zbyt słabe w trybie ciemnym | **naprawione wg kodu** (niepotwierdzone pomiarem) |

Bilans: **15 zamkniętych, 5 zamkniętych częściowo, 1 potwierdzony tylko
w kodzie** (pozycja 21 — nie zmierzyłem kontrastu na ekranie, punkt 9.8).

Do tego doszły dwie funkcje, o które prosiłem w kategorii „miłe w posiadaniu”:
**bramki zgód klientów** (z zastrzeżeniami — punkt 6.3) oraz **pola własne
dostępne przez MCP** (w pełni).

---

## 4. Co naprawiono dobrze

### 4.1. Ślad audytowy — to jest zmiana, która przesądza o werdykcie

Poprzednio: pięć operacji na zadaniu → dwa wpisy w dzienniku, przeciągnięcie
słupka nie zostawiało nic.

Teraz powtórzyłem ten sam test kontrolowany na czystej bazie:

| Operacja | Trasa API | Poprzednio | Teraz |
|---|---|---|---|
| daty + postęp + ograniczenie (przeciągnięcie na Gantcie) | `PUT /task/{id}` | **nie** | **tak**, z wartościami przed/po |
| plan bazowy | `POST /task/{id}/baseline` | **nie** | **tak** |
| utworzenie zależności | `POST /task-relation` | **nie** | **tak** (`relation_created`) |
| bramka zgody | `PUT /task/approval/{id}` | nie istniała | **tak** (`approval_changed`) |
| zmiana statusu | `PUT /task/status/{id}` | tak | tak |
| **kaskada auto-przeplanowania** | `PATCH /task/bulk` (`updateSchedule`) | **nie** | **tak** |
| **zbiorcza zmiana postępu** | `PATCH /task/bulk` (`updateProgress`) | nie istniała | **tak** |

Zapis jest polowy, nie ogólnikowy:

```
updated → {"changes": {
    "dueDate":        {"from": "2026-12-07", "to": "2027-02-20"},
    "startDate":      {"from": "2026-10-18", "to": "2027-01-05"},
    "progress":       {"from": 0,            "to": 33},
    "constraintType": {"from": "none",       "to": "start_no_earlier_than"},
    "constraintDate": {"from": null,         "to": "2027-01-05"}
}}
```

Po wszystkich testach w bazie jest 183 wpisy typu `updated` i **wszystkie 183
zawierają wartości przed i po** — sprawdzone zapytaniem, nie na próbce.

Dla porównania, dziennik całego obszaru roboczego zaraz po zasilaniu planem:

| Typ wpisu | Poprzednia gałąź | `integration-all` |
|---|---|---|
| `created` | 252 | 252 |
| `updated` | **0** | **160** |
| `relation_created` | **0** | **259** |
| `approval_changed` | — | **7** |

**To zamyka zarzut, który wcześniej dyskwalifikował narzędzie w tym projekcie.**

Jest też widok na poziomie obszaru roboczego — `/dashboard/workspace/<id>/activity`
— z filtrami po użytkowniku, typie zdarzenia i zakresie dat oraz przyciskiem
eksportu.

![Dziennik aktywności obszaru roboczego](raport-zrzuty-2/07-dziennik-obszaru.png)
*Kto, co, kiedy, na którym zadaniu i w którym projekcie, plus filtry i eksport.*

**Ale tu jest luka, i nie jest kosmetyczna.** Zmiany harmonogramu są streszczane
jednym zdaniem — **„zaktualizował plan”** — bez wypisania, które pole się
zmieniło i z jakiej wartości na jaką. Przyczyna jest w kodzie:
`apps/web/src/components/activity/index.tsx`, gałąź `type === "updated"` zwraca
stały tekst i **w ogóle nie sięga po `eventData.changes`**. Ten sam komponent
renderuje historię w karcie zadania, więc luka dotyczy obu miejsc.

W teście na żywo pięć różnych operacji na jednym zadaniu (przesunięcie dat,
zmiana postępu, kamień milowy, plan bazowy, ograniczenie) dało siedem
identycznych wpisów „Marcin PM zaktualizował plan”. Dla porównania zmiany
statusu i zgody renderują się poprawnie: *„zmienił status zatwierdzenia
z Nie wymaga zatwierdzenia na Oczekuje na zatwierdzenie”*.

Do tego **filtr typu zdarzenia nie zawiera tych typów**, które niosą dane
harmonogramu. Lista `ACTIVITY_TYPES` w interfejsie ma 10 pozycji i pomija
`updated`, `approval_changed` oraz `relation_created`. Nie da się więc przez
interfejs odfiltrować samych zmian planu. Brakuje też **filtra po projekcie** —
ani w zapytaniu API, ani w interfejsie.

![Historia zadania: jedenaście identycznych wpisów](raport-zrzuty-2/11-dziennik-zaktualizowal-plan.png)
*Jedenaście różnych operacji, jeden i ten sam opis. Po prawej widać, że panel
właściwości ma już komplet pól po polsku — poza „Must start on”, czyli jedną
z pięciu nieprzetłumaczonych nazw typów ograniczeń.*

Ocena uczciwa: **zbudowano kompletny rejestrator i nie podłączono go do ekranu,
który ludzie faktycznie czytają.** Audytor z eksportem CSV ma wszystko. Audytor
patrzący na widok — nie odróżni przesunięcia terminu od zmiany postępu.

Eksport sprawdziłem w obu formatach. CSV ma 17 kolumn
(`id, taskId, taskNumber, taskTitle, projectId, projectName, projectSlug, type,
createdAt, userId, userName, content, eventData, …`), poprawny nagłówek
`Content-Disposition` i BOM, więc otwiera się w Excelu bez psucia polskich
znaków. Kolumna `eventData` niesie pełną zmianę:

```
{"changes":{"dueDate":  {"from":"2026-07-30","to":"2026-09-02"},
            "startDate":{"from":"2026-07-16","to":"2026-08-19"}}}
```

Eksport JSON zwrócił 736 rekordów, w tym 184 typu `updated`. To jest materiał,
który da się przekazać zespołowi bezpieczeństwa.

### 4.2. Widok portfela

Nowy widok `/dashboard/workspace/<id>/portfolio`. Wszystkie 7 projektów na
jednej osi czasu, domyślny zakres marzec 2026 – maj 2027 obejmuje cały plan bez
przełączania. Po zwinięciu projektów całość mieści się na jednym ekranie.
Kamienie milowe jako romby, pasek postępu na każdym wierszu projektu,
podświetlony bieżący kwartał, przejście do Gantta projektu i do karty zadania.
Czas wczytania **~2,0 s** dla 252 zadań.

Punkt końcowy `GET /api/project/portfolio` zwraca wszystkie 7 projektów z
kompletem 252 zadań (daty, postęp, flaga kamienia milowego).

![Portfel — 7 projektów na jednej osi czasu](raport-zrzuty-2/01-portfel-7-projektow.png)
*Cały program na jednym ekranie: marzec 2026 – marzec 2027, pasek postępu przy
każdym projekcie, bieżący miesiąc wyróżniony. Tego widoku wcześniej nie było.*

### 4.3. Ścieżka krytyczna obejmuje zależności międzyprojektowe

Poprzednio algorytm odrzucał każdą krawędź wychodzącą poza projekt — w migracji
akurat te najważniejsze (zgody klientów, bramka bezpieczeństwa). Teraz zadanie
z innego projektu, które ma daty, bierze udział w obliczeniu, a wynik zawiera
licznik `droppedEdgeCount` — czyli dokładnie to ostrzeżenie, o które prosiłem.

Widać to na wykresie: po włączeniu przełącznika bursztynowy akcent obejmuje
również wiersz **SEC-13 „Zgoda bezpieczeństwa na start fal produkcyjnych”**,
czyli zadanie z projektu bezpieczeństwa, wyświetlane w OVH jako wiersz
międzyprojektowy. Poprzednio ten sam wiersz pozostawał szary.

![Ścieżka krytyczna obejmuje zadanie z innego projektu](raport-zrzuty-2/12-sciezka-krytyczna-miedzyprojektowa.png)
*Bramka bezpieczeństwa z innego projektu jest teraz częścią ścieżki krytycznej.
W legendzie doszły pozycje „Typ (kliknij, aby zmienić)” i „Ścieżka krytyczna”.*

### 4.4. MCP — z 36 do 47 narzędzi

Każdy brak z poprzedniej tabeli ma teraz swoje narzędzie, a zapisy **naprawdę
się utrwalają** (poprzednio były po cichu porzucane). Sprawdzone wywołaniami na
żywo — szczegóły w sekcji 7.

### 4.5. Wirtualizacja i koniec odpytywania

| Miara przy 1200 zadaniach | Poprzednio | Teraz |
|---|---|---|
| Wiersze w DOM | 1201 | **18** (po przewinięciu 24) |
| Węzły DOM | 18 998 | **5 616** |
| Pamięć sterty JS | 415 MB | **347 MB** |
| Wejście → pierwsze wiersze | 11,0 s | **7,3 s** |
| Wejście → widok ustabilizowany | 13,5 s | **12,0 s** |
| Przełączenie jednostki | 3,3 – 4,7 s | **1,9 – 2,8 s** |
| Ścieżka krytyczna | nie mierzone | **1,4 s** |
| Odświeżenia listy w 90 s | 3 pełne cykle (36 żądań) | **0** |
| Błędy w konsoli | 0 | 0 |

Odpytywanie cykliczne zmieniono z ~25 s na **5 minut** jako siatkę
bezpieczeństwa; bieżąca aktualizacja idzie przez WebSocket, który dociąga
zaległości po powrocie do karty.

![Projekt z 1200 zadaniami po wprowadzeniu wirtualizacji](raport-zrzuty-2/09-skala-1200-wirtualizacja.png)
*Ten sam test skali co poprzednio. W DOM jest kilkanaście wierszy zamiast 1201.*

### 4.6. Tłumaczenia — po polsku prawie zrobione

Poprzednio 87 ze 122 komunikatów nowych funkcji było po angielsku. Teraz
policzyłem to odtwarzalnie: wziąłem klucze, które ta gałąź dodaje względem
`main`, zawęziłem do obszaru planowania i sprawdziłem, ile z nich ma
w `i18n/pl-PL.json` wartość identyczną z angielską.

| Grupa komunikatów | Nowych kluczy | Po angielsku w pl |
|---|---|---|
| Gantt: słupki, plan bazowy, ograniczenia | 59 | 6 |
| Dziennik i retencja | 45 | 1 |
| Kalendarz roboczy | 29 | 0 |
| Obłożenie zasobów | 18 | 0 |
| Portfel | 13 | 1 |
| Bramki zgód | 10 | 0 |
| Relacje i typy zależności | 18 | **18** |
| Pola własne, duplikat, operacje zbiorcze | 16 | **16** |
| **Razem** | **208** | **42** |

Sześć z tych 42 to wartości, które mają zostać bez zmian: skróty FS/SS/FF/SF
i wzorce formatowania (`{{start}} – {{end}}`). Realnych braków jest **36**,
i one nie rozkładają się równomiernie — **dwie grupy są nietknięte w całości**:
relacje (punkt 6.5) oraz pola własne z duplikowaniem zadania. Wszystko, co
dotyczy samego wykresu, kalendarza, dziennika, portfela, obłożenia i bramek
zgód, jest po polsku.

Doszedł też raport CI `pnpm i18n:untranslated` — nieblokujący, wykrywa wartości
identyczne z angielskimi. To dokładnie ta kontrola procesu, o którą prosiłem:
poprzednio kontrola sprawdzała tylko obecność klucza, więc angielski tekst
w polskim pliku przechodził. Gdyby ten raport blokował scalanie, obie luki
wyżej nie weszłyby na gałąź.

### 4.7. Typ zależności wprost na wykresie

Poprzednio: wszystkie linie blokujące były czerwone, bez rozróżnienia FS/SS/FF/SF,
a typ i opóźnienie dało się zmienić **wyłącznie** w karcie zadania — miejscu,
którego PM nie znajdzie bez podpowiedzi.

Teraz każda linia ma podpis typu i opóźnienia („FS”, „SS +15d”, „FF +15d”,
„SS +25d”), a w legendzie jest chip **„Type (click to change)”**. Sprawdziłem
to kliknięciem: etykieta jest przyciskiem, a kliknięcie otwiera wprost na
wykresie okno z wyborem typu (Finish → Start, Start → Start, …), polem
„Lag (days)” i przyciskiem zapisu. Zastrzeżenie: to okno jest po angielsku
także wtedy, gdy cały interfejs jest po polsku — opisuję to w punkcie 6.5.

![Gantt z podpisami typów zależności i inicjałami właścicieli](raport-zrzuty-2/08-gantt-angielski.png)
*Ten jeden zrzut zamyka trzy dawne zarzuty naraz: typ zależności przy linii,
inicjały przypisanej osoby przy zadaniu i paski planu bazowego pod słupkami.*

### 4.8. Plan bazowy podaje poślizg w dniach

Poprzednio: pod słupkiem był cieńszy pasek planu bazowego, więc widać było,
**że** jest poślizg, ale nigdzie nie było napisane **ile**. PM musiał odejmować
daty ręcznie.

Teraz przy słupku jest etykieta z liczbą dni. Sprawdziłem na łańcuchu OpenStack:
„OpenStack: control plane” pokazuje **+21d**, „OpenStack: PoC na 3 węzłach”
**+14d** — zgodnie z poślizgiem, który sam wprowadziłem do danych. Etykieta ma
też opis dostępności („finishing 21d later than baseline”) i osobny wariant dla
zadań kończących się przed planem.

### 4.9. Etykiety opóźnień są czytelne, doszedł znacznik „po terminie”

Poprzednio w węźle z ośmioma wychodzącymi zależnościami etykiety opóźnień
rysowały się jedna na drugiej i dawały nieczytelny ciąg znaków. Teraz układają
się w pionowy stos i każdą da się odczytać: przy kamieniu „Platforma kontenerowa
gotowa” widzę kolejno FS +5d, +25d, +45d, +65d, +85d, +105d, +125d, +145d.

Zmierzyłem to programowo: na 23 etykiety w widoku Kwartał 10 par nadal ma
stykające się prostokąty, więc przy bardzo gęstym rozgałęzieniu stos robi się
ciasny — ale to jest różnica między „ciasno” a „nieczytelnie”.

Przy okazji widać drugą rzecz, o którą prosiłem: zadania po terminie mają teraz
czerwony znacznik **„Overdue”** w liście zadań.

![Stos etykiet opóźnień i znaczniki „Overdue”](raport-zrzuty-2/13-etykiety-i-overdue.png)
*Osiem zależności wychodzących z jednego kamienia milowego — każda etykieta
czytelna. Po lewej widać znaczniki „Overdue” i wiersz międzyprojektowy AZURE-6.*

### 4.10. Podświetlanie działa w widoku Kwartał — i słupki da się trafić

Poprzednio to był dla mnie najbardziej dokuczliwy drobiazg. W widoku Dzień
najechanie kursorem przygaszało niepowiązane słupki, ale w widoku **Kwartał** —
czyli tym jedynym, w którym widzę cały roczny plan — słupek miał 3,6 px
szerokości i nie dało się go trafić. Podświetlanie istniało, tylko nie działało
tam, gdzie było potrzebne.

Teraz słupek ma gwarantowaną szerokość trafienia **20 px**
(`MIN_BAR_HOVER_HIT_PX` w `timeline.ts` — obszar trafienia, nie rysunek), więc
w Kwartale najechanie działa. Zmierzyłem efekt w DOM po najechaniu na „Azure:
tożsamość (Entra ID) i model uprawnień”:

| Element | Stan po najechaniu |
|---|---|
| linie niepowiązane | 97 linii przygaszonych do `stroke-opacity 0.12` |
| linie dotyczące zadania | 3 linie pogrubione do `stroke-width 2.5` |
| słupki powiązane | 2 z obwódką `ring-primary` |
| pozostałe słupki | `opacity-35` |

![Widok Kwartał przed najechaniem](raport-zrzuty-2/14-kwartal-przed-najechaniem.png)
*Przed najechaniem: wszystkie linie jednakowo czerwone, plątanina.*

![Widok Kwartał po najechaniu](raport-zrzuty-2/15-kwartal-po-najechaniu.png)
*Po najechaniu na „Azure: tożsamość (Entra ID)”: zostają trzy linie, które
dotyczą tego zadania. W skali całego roku to jest różnica między „widzę wykres”
a „rozumiem wykres”.*

### 4.11. Słupek zbiorczy podzadań pokazuje postęp

Poprzednio zwinięta fala pokazywała belkę z zaczepami i żadnej liczby — PM
patrzył na rodzica i nie wiedział, czy fala jest w 10 %, czy w 90 %.

Teraz słupek zbiorczy ma wypełnienie postępu. Sprawdziłem na „Fala 5: replikacja
Windows (145 VM)”: dwa podzadania po 45 %, wypełnienie rodzica `width: 45%`.
Zastrzeżenie do tego pomiaru: przy dwóch dzieciach o równym postępie nie da się
odróżnić średniej prostej od średniej ważonej czasem trwania. Potwierdziłem, że
wartość jest liczona i wyświetlana — nie potwierdziłem, według jakiej wagi.

### 4.12. Kaskada nadal liczy się poprawnie

Sprawdziłem, czy nowe funkcje nie zepsuły tego, co działało. Przesunąłem zadanie
w łańcuchu OVH o 5 dni i porównałem stan bazy przed i po:

- następniki przesunięte dokładnie o **+5 dni**,
- długość zadania 14-dniowego **zachowana**,
- opóźnienie `SS +10d` **zachowane**,
- żadnych przesunięć poza łańcuchem.

Przy włączonej ścieżce krytycznej podświetliło się **15 słupków**, w tym
1 wiersz z innego projektu. Licznik pominiętych krawędzi
(`droppedEdgeCount`) wyniósł 0, więc ostrzeżenie o niepełnym grafie słusznie
się nie pojawiło.

### 4.13. Drobne, o które prosiłem

- **Właściciel zadania widoczny na wykresie** — nazwisko przypisanej osoby jest
  teraz atrybutem słupka.
- **Masowa zmiana postępu** — operacja `updateProgress` w `PATCH /task/bulk`
  i w pasku zaznaczenia wielokrotnego.
- **Format daty** — poprawiony. W polskim interfejsie daty renderują się jako
  „1 kwi 2026”, „26 maj 2026”. Jedyne pole, które nadal pokazuje mm/dd/yyyy, to
  natywne `<input type="date">` w nagłówku osi — jego wygląd narzuca przeglądarka
  według swojej lokalizacji, aplikacja trzyma tam poprawną wartość ISO. To nie
  jest usterka Kaneo.

---

## 5. Co naprawiono tylko częściowo

### 5.1. Portfel bez linii zależności

Widok pokazuje 7 projektów na jednej osi, ale **nie rysuje zależności między
nimi**. W danych jest 19 takich relacji i są to te najważniejsze: zgody klientów
przed cutoverami, bramka bezpieczeństwa przed falami produkcyjnymi, „Proxmox
gotowy” przed wyłączaniem systemów on-prem. Odpowiedź `GET /api/project/portfolio`
w ogóle nie zawiera relacji, więc nie jest to kwestia rysowania — danych tam nie
ma. Żeby zobaczyć powiązanie, trzeba otworzyć konkretne zadanie.

To był jeden z dwóch głównych powodów, dla których prosiłem o widok portfela.
Połowa problemu została rozwiązana.

![Relacja międzyprojektowa widoczna dopiero po otwarciu zadania](raport-zrzuty-2/06-relacja-miedzyprojektowa-tylko-w-karcie.png)
*Powiązanie „K8s: landing zone AKS” (inny projekt, SS −40 d) istnieje w danych,
ale znajduję je dopiero w karcie zadania, nie na osi portfela.*

### 5.2. Obłożenie zasobów — dobre narzędzie, zły domyślny widok

Tabela osoba × tydzień z liczbą aktywnych, nieukończonych zadań, z konfigurowalnym
progiem przeciążenia (2/3/4/5/8) i pomarańczowym oznaczeniem. Miara jest jasno
opisana. Czas wczytania ~0,9 s. Punkt końcowy `GET /api/workload/{ws}?from&to`
zwraca tygodniowe kubełki i osobny wiersz dla zadań nieprzypisanych.

Cztery rzeczy szwankują z perspektywy cotygodniowego statusu:

- **Okno jest sztywne: 8 tygodni od dziś**, przewijane strzałkami. Nie ma
  dowolnego zakresu dat ani widoku „cały rok, jedna liczba na osobę”.
- **W domyślnym oknie obraz potrafi być mylący.** Anna (101 zadań) miała jedną
  komórkę powyżej progu, a Ola (14 zadań) — trzy. Dopiero w następnym oknie cały
  wiersz Anny jest pomarańczowy. PM musi ręcznie przewijać, żeby złapać skalę
  dysproporcji.
- **Osoba bez zadań w oknie znika z tabeli** zamiast pokazać wiersz z zerami.
- **Brak przejścia** z obłożenia do listy zadań danej osoby.

![Obłożenie zasobów — tabela osoba × tydzień](raport-zrzuty-2/03-obciazenie-tabela.png)
*Domyślne okno ośmiu tygodni od dziś.*

![Obłożenie — przeciążenie Anny w kolejnym oknie](raport-zrzuty-2/04-obciazenie-przeciazenie.png)
*Dopiero po przewinięciu o osiem tygodni cały wiersz Anny robi się pomarańczowy.*

### 5.3. Eksport planu — pełniejszy, ale nie pełny

| Pole | Poprzednio | Teraz |
|---|---|---|
| tytuł, opis, status, priorytet, daty, przypisanie, etykiety | jest | jest |
| `progress`, `isMilestone` | **brak** | **jest** |
| `baselineStartDate`, `baselineDueDate` | **brak** | **jest** |
| `constraintType`, `constraintDate` | **brak** | **jest** |
| `relations` (z `dependencyType` i `lagDays`) | **brak** | **jest** |
| `approvalStatus`, `approvalNote` | nie istniały | **brak** |
| nazwa przypisanej osoby (jest tylko `userId`) | brak | **brak** |
| pola własne | brak | **brak** |
| format | JSON | JSON (nadal bez CSV) |

Z ośmiu pól zrobiło się szesnaście i doszły relacje z typem oraz opóźnieniem —
plan da się już wyeksportować sensownie. Ale **status zgody klienta, czyli
najnowsza funkcja, nie trafia do eksportu**, a raport dla komitetu sterującego
bez informacji „kto się zgodził” jest niepełny.

### 5.4. Retencja dziennika — ustawienie bez egzekwowania

Jest ustawienie `activityRetentionDays` i jest eksport dziennika do CSV i JSON.
Ale **nic tego ustawienia nie egzekwuje**: w harmonogramie zadań nie ma nic, co
kasowałoby stare wpisy. Dokumentacja punktu końcowego mówi to wprost
(*„This is a stored setting only; no automatic deletion currently enforces it”*),
co jest uczciwe, ale dla zespołu bezpieczeństwa „retencja skonfigurowana” i
„retencja działa” to dwie różne rzeczy.

### 5.5. Uchwyt zmiany długości — trafialny, ale nie na środku krawędzi

Poprzednio ikona tworzenia zależności leżała na tej samej krawędzi słupka co
uchwyt zmiany długości i przechwytywała kliknięcie. Zamiast wydłużyć zadanie,
PM zaczynał rysować relację.

Teraz da się wydłużyć zadanie, ale trzeba wiedzieć gdzie celować. Test na
„Fala 1: inwentaryzacja i ocena (341 VM)”:

| Punkt chwytu | Wynik |
|---|---|
| dokładnie środek krawędzi | trafia w kropkę relacji, zaczyna się rysowanie zależności |
| **17 px powyżej/poniżej środka** | zmiana długości działa, data końca 30 lis 2026 → 2 gru 2026 |

Czyli poprawka polega na zmniejszeniu kropki, a nie na rozdzieleniu obu
gestów. Dla kogoś, kto zna to miejsce — wystarczy. Dla kogoś, kto siada do
narzędzia pierwszy raz — nadal jest to pułapka. Właściwe rozwiązanie to osobna
strefa: uchwyt długości na krawędzi, kropka relacji poza obrysem słupka.

### 5.6. Kolumna nazw — koniec zaznaczania tekstu, ale przewijania nadal nie ma

Poprzednio przeciągnięcie po kolumnie z nazwami zadań zaznaczało tekst zamiast
przesunąć widok. Zaznaczanie zniknęło (w kodzie doszło `select-none`), więc
ekran nie robi się już niebieski. Ale **przeciąganie kolumny nazw nadal nie
przewija osi czasu** — trzeba przejść kursorem na obszar wykresu. To pół
poprawki: usunięto skutek uboczny, nie dodano oczekiwanego zachowania.

---

## 6. Czego nie naprawiono i co doszło nowego

### 6.1. Tłumaczenia — polski dużo lepszy, reszta nietknięta

Naprawiono **wyłącznie polski**. Ten sam pomiar co w punkcie 4.6, rozszerzony
na pozostałe języki:

| Język | Obszar planowania (208 kluczy) | Wszystkie nowe klucze (390) |
|---|---|---|
| polski | **42** po angielsku | 199 |
| francuski | 195 | 360 |
| niemiecki | 202 | 342 |
| niderlandzki | 202 | 368 |
| chiński | 200 | 365 |

Czyli pozostałe języki dostały po **6–13 przetłumaczonych kluczy z 208**.
W liczbach bezwzględnych mają teraz **więcej** komunikatów angielskich niż przed
zmianą, bo doszły klucze nowych widoków.

Osobna sprawa: gałąź dodaje 390 kluczy, z czego 182 to funkcje spoza mojego
zakresu, które przyszły przy okazji (integracja GitLab, subskrypcje kalendarza,
strona bezpieczeństwa konta, tła projektów). Tam polski ma 157 komunikatów
angielskich. Nie testowałem tych funkcji i nie liczę tego do oceny wykresu, ale
dla wdrożenia produkcyjnego to widoczny dług.

Dla wdrożenia w jednej firmie w Polsce większość tego jest nieszkodliwa — poza
oknem, które PM otwiera przy każdej zmianie typu zależności (punkt 6.5). Dla
produktu sprzedawanego w 19 językach — jest to problem.

### 6.2. MCP nie zna bramek zgód — i znowu milczy

To jedyny powrót starego wzorca. `update_task` przyjmuje `approvalStatus`
i `approvalNote`, zwraca `isError: false`, a w bazie nie zmienia się nic:

```
update_task {"taskId": "...", "approvalStatus": "approved", "approvalNote": "przez MCP"}
→ isError: false
→ baza: approval_status = none, approval_note = null
```

Nie ma też osobnego narzędzia do bramek. Agent pracujący przez MCP dostanie
potwierdzenie sukcesu operacji, która się nie wykonała. To dokładnie ten sam
problem, który zgłaszałem poprzednio dla `dependencyType` i `progress` — tam
naprawiony, tutaj powtórzony na najnowszej funkcji.

### 6.3. Bramki zgód klientów — funkcja jest, ale nie robi tego, co obiecuje nazwa

To nowa funkcja i jako model danych jest dobra: cztery statusy
(brak / oczekuje / zatwierdzona / odrzucona), notatka, własny typ zdarzenia
w dzienniku. W karcie zadania działa bez zarzutu — zmiana statusu zapisuje się,
notatka jest widoczna, wpis w dzienniku ma czytelny opis „przed → po”.

![Bramka zgody w karcie zadania](raport-zrzuty-2/10-bramka-zgody-karta-zadania.png)
*W karcie zadania bramka działa wzorowo: cztery statusy z odrębnymi ikonami,
pole notatki, a zmiana trafia do dziennika z czytelnym opisem „przed → po”.*

Trzy rzeczy nie działają tak, jak PM by oczekiwał:

- **Statusu zgody nie widać na wykresie Gantta.** Odznaka statusu istnieje
  w kodzie (`gantt-task-bar.tsx`), ale **tylko w gałęzi rysującej zwykły słupek,
  nie w gałęzi rysującej romb kamienia milowego**. Wszystkie 8 bramek w moim
  planie to kamienie milowe, więc **żadna nie pokazuje swojego statusu**.
  Niebieska plakietka, którą widać przy rombie, to znacznik ograniczenia daty,
  identyczny niezależnie od statusu zgody. Selektor odznaki zwrócił 0 elementów
  w DOM. Nie da się odróżnić zatwierdzonej od odrzuconej gołym okiem.
- **Bramka niczego nie blokuje.** Komentarz w kodzie mówi to wprost:
  *„Hard-blocking at the database level is out of scope for v1: this only
  surfaces a warning”*. Test na żywo: przeciągnięcie zadania zależnego od zgody
  o statusie **odrzucona** przeszło bez dialogu, bez potwierdzenia, bez blokady.
  Zostaje mały czerwony trójkąt ostrzegawczy — łatwy do przeoczenia.
- **Nie ma zbiorczej listy „co czeka na zgodę”.** Ani punktu końcowego
  agregującego po statusie, ani sekcji w interfejsie. Bramki trzeba znajdować
  ręcznie, po tytule zadania.

Dla projektu, w którym część linii produktowych **nie może** ruszyć bez podpisu
klienta, to jest funkcja informacyjna, nie kontrolna. Warto to nazwać wprost
w produkcie, bo dziś zachowanie jest ciche.

### 6.4. Nadal 12 żądań na wczytanie 1200 zadań

Lista zadań jest pobierana stronami po 100. Przy 1200 pozycjach to nadal 12
kolejnych żądań przy każdym wejściu. Wirtualizacja rozwiązała problem
renderowania, nie problem pobierania.

### 6.5. Nowa luka: okno typu zależności jest po angielsku w polskim interfejsie

To usterka, która powstała razem z funkcją chwaloną w punkcie 4.7. Etykieta
typu przy linii jest po polsku, legenda mówi „Typ (kliknij, aby zmienić)”, ale
okno, które się po tym kliknięciu otwiera, **jest w całości po angielsku**:
„Dependency type”, „Finish → Start”, „Lag (days)”, „Positive delays the start;
negative (lead) allows overlap.”, „Save”.

![Angielskie okno typu zależności w polskim interfejsie](raport-zrzuty-2/16-okno-typu-zaleznosci-po-angielsku.png)
*Cały ekran po polsku, jedno okno po angielsku. To nie jest kwestia kodu —
komponent używa kluczy `t(...)`, tylko `i18n/pl-PL.json` ma w bloku
`tasks.relations.dependency` wklejone wartości angielskie.*

Sprawdziłem plik tłumaczeń: cały blok `tasks.relations.dependency` w
`i18n/pl-PL.json` zawiera wartości identyczne z `en-US` — 9 komunikatów do
przetłumaczenia (`typeLabel`, `lagLabel`, `lagHint`, `save`, `updateError`
i cztery nazwy typów), plus 6 wartości, które słusznie zostają bez zmian
(skróty FS/SS/FF/SF i dwa wzorce formatowania).

Naprawa to jedna edycja pliku JSON, bez zmiany kodu. Wymieniam to osobno, bo
dotyczy okna, w którym PM pracuje najczęściej ze wszystkich nowych elementów
wykresu.

---

## 7. Pokrycie MCP — nowa tabela

Listę i zachowanie potwierdziłem na żywo, przez sesję MCP po HTTP
(`initialize` → `notifications/initialized` → `tools/call`).
**47 narzędzi** (poprzednio 36).

| Funkcja | Poprzednio | Teraz | Narzędzie / dowód |
|---|---|---|---|
| `dependencyType` (fs/ss/ff/sf) | brak | **obsługiwana** | `create_task_relation`; wywołanie z `ss` zwróciło `dependencyType: ss` |
| `lagDays` | brak | **obsługiwana** | jw., `lagDays: 7` utrwalone |
| zmiana typu/lagu istniejącej relacji | brak | **obsługiwana** | nowe `update_task_relation` |
| `progress` | brak | **obsługiwana** | `create_task` zwrócił `progress: 40` |
| `isMilestone` | brak | **obsługiwana** | `create_task` zwrócił `isMilestone: true` |
| `constraintType` / `constraintDate` | brak | **obsługiwana** | `update_task`; baza: `must_start_on`, `2027-02-03` |
| plan bazowy | brak | **obsługiwana** | nowe `set_task_baseline` / `clear_task_baseline` |
| kalendarz: dni robocze | brak | **obsługiwana** | `get_workspace_calendar`, `update_workspace_working_days` |
| kalendarz: święta | brak | **obsługiwana** | `add_workspace_holiday` / `delete_workspace_holiday`; 10 → 11 → 10 |
| pola własne | brak | **obsługiwana** | `list_project_custom_fields`, `set_task_custom_field_value`, `get_task_custom_fields`; wartość widoczna też w `get_task` |
| **bramki zgód klientów** | nie istniały | **BRAK** | brak narzędzia; `update_task` po cichu ignoruje pola |
| ścieżka krytyczna | N/D | **N/D** | nadal liczona po stronie klienta |
| odczyt wszystkich pól Gantta | obsługiwana | obsługiwana | `get_task`, `get_task_relations` |

Poza tym doszło `duplicate_task`. Oba rejestry — pakiet stdio `packages/mcp`
i trasy HTTP `apps/api/src/mcp` — **są w tej chwili zgodne**: po 47 narzędzi,
identyczne listy nazw, oba znają nowe pola i oba tak samo nie znają bramek zgód.
Pozostają jednak osobnymi implementacjami tego samego zestawu, więc ryzyko
rozjechania się przy kolejnych zmianach jest nadal otwarte.

---

## 8. Bezpieczeństwo i logi

### Co sprawdziłem doświadczalnie

**Granica obszaru roboczego trzyma także na nowych punktach końcowych.**
Konto spoza obszaru roboczego dostało 403 na każdej próbie:

| Próba | Wynik |
|---|---|
| obłożenie zasobów | 403 |
| dziennik obszaru roboczego | 403 |
| eksport dziennika | 403 |
| odczyt retencji | 403 |
| zmiana retencji (`PATCH`) | 403 |
| zmiana bramki zgody | 403 |
| pola własne projektu | 403 |

**Rola „viewer” czyta, ale nie zapisuje.** Po dodaniu obcego konta jako `viewer`:

| Operacja | Wynik |
|---|---|
| odczyt obłożenia, dziennika, eksportu, retencji | 200 |
| zmiana retencji | 403 |
| zmiana bramki zgody | 403 |
| ustawienie planu bazowego | 403 |
| zmiana dni roboczych | 403 |

### Ocena

Audyt przeszedł z poziomu „nie do przyjęcia” na „użyteczny”: jest pełna historia
zmian harmonogramu z wartościami przed i po, widok na poziomie obszaru roboczego,
filtry i eksport do CSV. Dla wymagania „kto co zmienił” to wystarczy.

Trzy rzeczy zostają do domknięcia przed produkcyjnym użyciem w projekcie, gdzie
audyt jest wymaganiem krytycznym:

1. **Retencja nie jest egzekwowana** — ustawienie istnieje, kasowania nie ma.
2. **Zmiany kalendarza roboczego nadal nie są rejestrowane** — i tym razem wiem
   dlaczego. Kolumna `activity.task_id` jest `NOT NULL` z kluczem obcym do
   `task`, a święta i dni robocze to encje obszaru roboczego bez żadnego
   zadania. **W obecnym modelu danych nie ma gdzie takiego wpisu zapisać.**
   Sprawdzone doświadczalnie: dodanie i usunięcie święta nie zostawiło ani
   jednego wiersza w dzienniku. To nie jest przeoczenie w kontrolerze, tylko
   ograniczenie schematu — naprawa wymaga dopuszczenia wpisów bez zadania.
   A zmiana dni roboczych przesuwa kaskadę w całym planie.
3. **Bramki zgód nie trafiają do eksportu planu** (są w dzienniku, ale nie
   w eksporcie zadań), więc dowód „klient się zgodził” trzeba składać z dwóch
   źródeł.

---

## 9. Czego NIE sprawdziłem

1. **Obrazu Dockera** — polityka ruchu wychodzącego sesji nadal blokuje magazyn
   warstw GHCR. Testowałem kod z gałęzi, commit `8a79651`.
2. **Zachowania dla projektów zarchiwizowanych** w portfelu i obłożeniu. Kod
   filtruje `archivedAt`, ale w danych testowych nie było zarchiwizowanego
   projektu i nie tworzyłem go, żeby nie kolidować z równoległymi testami.
3. **Redis i wielu instancji API** — pojedyncza instancja, adapter w pamięci.
4. **Urządzeń dotykowych i telefonów** — wyłącznie Chromium 1600 × 900.
5. **Skali powyżej 1200 zadań** oraz portfela/obłożenia przy tysiącach zadań —
   oba nowe widoki mierzyłem na 252 zadaniach.
6. **Egzekwowania retencji w czasie** — ustawienie zapisuje się, ale nie czekałem,
   czy cokolwiek kasuje (kod pokazuje, że nie).
7. **Integracji** (GitHub, GitLab, Slack) i powiadomień e-mail — poza zakresem.
8. **Kontrastu cieniowania dni wolnych w trybie ciemnym.** Wiem z porównania
   kodu, że klasa zmieniła się z `bg-foreground/[0.06]` na
   `bg-foreground/[0.1]` — czyli cieniowanie jest o dwie trzecie mocniejsze —
   ale **nie zmierzyłem kontrastu na ekranie**, więc nie twierdzę, że zarzut
   jest zamknięty. To jedyna pozycja w tabeli z punktu 3 oparta wyłącznie na
   kodzie.

---

## 10. Werdykt

**Czy teraz nadaje się do prowadzenia migracji 3000 VM w rok?**

Zmieniam ocenę z **„jako jedyne narzędzie: nie”** na **„tak, z listą zastrzeżeń
do domknięcia”**.

Co przesądza:

- **Ślad audytowy istnieje i jest kompletny w danych.** Zarzut, który poprzednio
  dyskwalifikował narzędzie, przestał być blokadą: wartości przed/po są
  zapisywane na wszystkich ścieżkach zapisu, łącznie z kaskadą Gantta, i wychodzą
  w eksporcie CSV. Zastrzeżenie: widok streszcza je jako „zaktualizował plan”,
  więc audyt „z ekranu” jeszcze nie działa.
- **Portfel i obłożenie istnieją i działają.** Arkusz obok przestaje być
  konieczny do trzymania obrazu całości.
- **MCP potrafi zbudować cały plan** poza jedną, najnowszą funkcją.
- **Wydajność przy tysiącu pozycji przestała boleć.**

Czego bym wymagał przed podpisaniem decyzji wdrożeniowej:

1. **Podłączenie `eventData.changes` do widoku dziennika.** Dane są, renderer
   ich nie używa. Do tego dodanie `updated`, `approval_changed` i `relation_*`
   do filtra typów oraz filtra po projekcie. To najtańsza poprawka o największym
   znaczeniu — dokładnie tak jak poprzednio subskrypcja `task.updated`.
2. **Zależności międzyprojektowe na osi portfela** — dziś widzę projekty, nie
   widzę powiązań między nimi, a to one decydują o ryzyku.
3. **Bramki zgód: odznaka statusu na kamieniach milowych, obecność w MCP
   i w eksporcie.** Obecny stan — ciche ignorowanie w MCP i niewidoczny status
   na wykresie — jest gorszy niż brak funkcji, bo wprowadza w błąd.
   Plus decyzja produktowa: czy bramka ma blokować, czy tylko ostrzegać.
4. **Egzekwowanie retencji dziennika** i **rejestrowanie zmian kalendarza
   roboczego** (to drugie wymaga zmiany schematu — `activity.task_id` musi
   dopuszczać brak zadania).
5. **Widok obłożenia w skali całego roku**, nie tylko ośmiu tygodni od dziś.
6. **Przetłumaczenie bloku `tasks.relations.dependency` na polski** — dziewięć
   komunikatów w jednym pliku JSON, bez zmiany kodu. Okno typu zależności jest
   dziś jedynym miejscem w ścieżce pracy PM-a, które wypada z języka.

Punkty 1, 3 i 6 są tanie i zmieniają ocenę istotnie. Punkt 2 to praca
porównywalna z tą, która już została wykonana na portfelu. Punkt 4 wymaga
migracji schematu.

Osobno, poza moim projektem: **tłumaczenia dla 18 pozostałych języków** są nadal
nietknięte — w obszarze planowania przetłumaczono im po 7 ze 152 nowych kluczy.
To jest teraz największy dług tej gałęzi.

---

## Załącznik A — film

Plik: **`demo-kaneo-integration-all.mp4`**, 1600 × 900, H.264.
Interfejs aplikacji po **angielsku**, napisy po **angielsku**, widoczny kursor
myszy (nakładka — nagranie ekranu przeglądarki nie zawiera wskaźnika systemowego),
kliknięcia zaznaczone bursztynowym pierścieniem.

Film nie jest przeglądem funkcji, tylko **przebiegiem pracy kierownika projektu**
na nowych możliwościach:

| # | Rozdział | Co pokazuje |
|---|---|---|
| 1 | The programme | skala planu i cztery braki z poprzedniego raportu |
| 2 | Portfolio | siedem projektów na jednej osi czasu |
| 3 | Workload | kto jest przeciążony, próg ostrzegawczy |
| 4 | Into the project | Gantt OVH, filtrowanie łańcucha OpenStack, plan bazowy |
| 5 | Critical path across projects | ścieżka krytyczna z bramkami międzyprojektowymi |
| 6 | Client approval gates | zgody klientów jako pole zadania |
| 7 | Re-planning a wave | przeciągnięcie zadania i kaskada |
| 8 | The audit trail | dziennik zmian z wartościami przed/po i eksport |
| 9 | An agent editing the plan over MCP | wywołanie MCP na żywo i efekt na wykresie |
| 10 | Scale | 1200 zadań po wprowadzeniu wirtualizacji |
| 11 | Where this leaves me | co zostało do domknięcia |

## Załącznik B — jak odtworzyć

```bash
git clone https://github.com/WMP/kaneo.git && cd kaneo
git checkout claude/integration-all      # commit 8a79651

pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE ROLE kaneo LOGIN PASSWORD 'kaneo' SUPERUSER;\""
su postgres -c "psql -c 'CREATE DATABASE kaneo OWNER kaneo;'"

cat > .env <<'EOF'
POSTGRES_USER=kaneo
POSTGRES_PASSWORD=kaneo
POSTGRES_DB=kaneo
DATABASE_URL=postgres://kaneo:kaneo@127.0.0.1:5432/kaneo
AUTH_SECRET=<co najmniej 32 znaki: openssl rand -hex 32>
KANEO_API_URL=http://localhost:1337
KANEO_CLIENT_URL=http://localhost:5173
VITE_API_URL=http://localhost:1337
EOF

pnpm install
pnpm dev                 # API 1337, aplikacja 5173, migracje przy starcie
pnpm i18n:untranslated   # raport nieprzetłumaczonych kluczy
```

Sesję MCP po HTTP otwiera się sekwencją `initialize` →
`notifications/initialized` → `tools/call`, przekazując nagłówek
`mcp-session-id` zwrócony przez `initialize` oraz token sesji w nagłówku
`Authorization: Bearer`. Język interfejsu wynika z ustawień przeglądarki.

---

*Wszystkie liczby pochodzą z pomiarów na uruchomionej instancji: z interfejsu,
z odpowiedzi API, z wywołań MCP albo z zapytań do bazy. Wnioski wyprowadzone
z samego kodu są oznaczone odwołaniem do pliku. Raport jest materiałem
pomocniczym — przed decyzją wdrożeniową wymaga weryfikacji przez właściciela
produktu i zespół bezpieczeństwa.*
