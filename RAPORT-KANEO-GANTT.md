# Kaneo jako narzędzie do prowadzenia migracji 3000 VM — raport z testów

**Autor:** kierownik projektu (test praktyczny)
**Data:** 26 września 2026
**Wersja testowana:** Kaneo v2.27.0, gałąź `claude/gantt-plus-cross-project`, commit `9a5dca8`
**Zakres:** wykres Gantta z nowymi funkcjami, pokrycie MCP, bezpieczeństwo i logi

**Film z przebiegu testów:** `demo-gantt-kaneo.mp4` — nagranie ekranu z widocznym
kursorem myszy i polskimi napisami, pokazujące kolejno wszystkie testowane
funkcje. Spis rozdziałów znajduje się w załączniku A.

---

## 1. Środowisko testowe

### Wariant, którego użyłem

Użyłem **Wariantu B — uruchomienia z kodu źródłowego**. Start się powiódł.

Wariant A (obraz Dockera) **nie był możliwy w tym środowisku**. Obraz
`ghcr.io/wmp/kaneo:claude-gantt-plus-cross-project` pobiera się w dwóch krokach:
manifest z `ghcr.io`, a warstwy z `pkg-containers.githubusercontent.com`. Manifest
pobrał się poprawnie. Pobranie warstw zostało odrzucone przez politykę ruchu
wychodzącego sesji:

```
gateway answered 403 to CONNECT (policy denial)
host: pkg-containers.githubusercontent.com:443
```

Nie obchodziłem tej blokady. Przeszedłem na Wariant B, który **uruchamia ten sam
kod**: HEAD gałęzi to commit `9a5dca8`, czyli dokładnie ten SHA, który prompt
wskazuje jako build obrazu (`...:sha-9a5dca8`).

### Konfiguracja

| Element | Wartość |
|---|---|
| Node.js | 22.22.2 |
| pnpm | 10.32.1 |
| PostgreSQL | 16.13 (lokalny klaster, nie kontener) |
| API | http://localhost:1337 |
| Aplikacja webowa | http://localhost:5173 |
| Migracje bazy | wykonane automatycznie przy starcie API |

`pnpm install` trwał 18 sekund. Migracje przeszły bez błędów. API i aplikacja
webowa wstały za pierwszym razem. **Uruchomienie było bezproblemowe.**

Uwaga: `package.json` wymaga Node.js ≥ 24, a środowisko ma 22.22.2. Mimo to
instalacja i uruchomienie zadziałały bez zastrzeżeń.

### Dane wprowadzone do systemu

Plan wprowadziłem przez **uwierzytelnione wywołania API**, tak jak robi to klient
webowy (ciasteczko sesji + nagłówek `Origin`). Interfejs testowałem osobno
przeglądarką Chromium sterowaną przez Playwright.

| Element planu | Liczba |
|---|---|
| Projekty | 7 |
| Zadania | 252 |
| Kamienie milowe | 28 |
| Zależności blokujące | 244 (FS 146, SS 67, FF 28, SF 3) |
| Relacje podzadań | 16 |
| Relacje „powiązane” | 1 |
| Zależności **między projektami** | 19 |
| Zadania z planem bazowym | 130 |
| Zadania z ograniczeniem daty | 15 |
| Dni wolne w kalendarzu | 10 |

Struktura planu odwzorowuje realia zlecenia:

- **Azure — fale migracyjne** (94 zadania): 8 fal po ~290 VM, każda z oceną,
  przygotowaniem, replikacją Windows i Linux, testami, cutoverem, kamieniem
  milowym i hypercare. Replikacja Windows ma podzadania per linia produktowa.
- **OVH — private cloud** (48): zamówienie sprzętu → Ceph → Proxmox → kamień
  „Proxmox gotowy” → OpenStack → kamień „OpenStack gotowy”, plus 6 fal migracji.
  Etap OpenStack ma celowo wprowadzony poślizg 21–24 dni.
- **Bazy danych MS SQL** (30), **Klastry Kubernetes** (21).
- **Linie produktowe i zgody klientów** (32): dla 8 linii wniosek, negocjacje,
  kamień „zgoda klienta — termin nieprzekraczalny” z ograniczeniem FNLT i okno
  serwisowe.
- **Systemy pozostające on-prem** (14): SCADA, archiwum danych osobowych, HSM
  i inne, z decyzją „pozostaje” i separacją sieciową.
- **Bezpieczeństwo, logi i audyt** (13): SIEM, PAM, przeglądy uprawnień, testy
  penetracyjne, bramka „zgoda bezpieczeństwa na start fal produkcyjnych”.

Zależności międzyprojektowe łączą to w całość: zgoda klienta blokuje cutover
odpowiedniej fali Azure, bramka bezpieczeństwa blokuje pierwsze fale produkcyjne,
„Proxmox gotowy” warunkuje wyłączanie systemów on-prem.

### Metoda testowania

Interfejs przeklikałem przeglądarką Chromium sterowaną przez Playwright.
Testy podzieliłem na cztery niezależne zestawy, prowadzone równolegle przez
agentów Sonnet 5, każdy w osobnym projekcie, żeby zmiany jednego nie
zafałszowały wyników drugiego:

| Zestaw | Projekt | Zakres |
|---|---|---|
| A | azure | linie zależności, podświetlanie, przewijanie, zoom, jednostki, relacje międzyprojektowe, wydajność |
| B | mssql + azure | panel właściwości, postęp, kamienie milowe, plan bazowy, podzadania |
| C | k8s | typy FS/SS/FF/SF, opóźnienia, cykle, tworzenie i usuwanie zależności |
| D | ovh + lob | auto-przeplanowanie, ścieżka krytyczna, kalendarz roboczy, ograniczenia dat |

Audyt MCP, badanie bezpieczeństwa, test skali i analizę tłumaczeń wykonałem
osobno. Każdy wynik potwierdzałem drugim źródłem: zrzutem ekranu, odpowiedzią
API albo zapytaniem do bazy.

**Stan danych po testach.** Testy zostawiły w danych ślady, głównie w projekcie
OVH: łańcuch OpenStack jest przesunięty o 15 dni względem zasilenia początkowego,
a fala 4 o 10 dni. Kalendarz roboczy i zadanie „Finanse: zgoda klienta”
przywrócono do stanu wyjściowego. W projekcie k8s przybyła jedna relacja
testowa, w mssql jedno zadanie ma postęp 65 %. Nie ma to wpływu na wnioski —
odnotowuję dla porządku.

---

## 2. Jak mi się pracowało

### Co działa dobrze

**Wprowadzenie planu przez API jest szybkie i przewidywalne.** 658 wywołań
utworzyło cały plan bez jednego błędu. Walidacja jest sensowna, komunikaty błędów
konkretne. Dla PM-a, który ma plan w arkuszu, to realna droga wejścia.

**Widok Kwartał mieści cały rok na jednym ekranie.** To najważniejsza zaleta dla
tego projektu. Przy 94 zadaniach szerokość treści równa się szerokości okna —
zero przewijania poziomego. Roczny plan da się ogarnąć wzrokiem.

| Jednostka | Zakres okna | Przewijanie poziome |
|---|---|---|
| Dzień | 13 wrz – 12 gru 2026 | 4328 px (dużo) |
| Tydzień | 13 wrz 2026 – 13 mar 2027 | 2710 px |
| Miesiąc | 22 mar 2026 – 8 maj 2027 | 1542 px |
| **Kwartał** | 22 mar 2026 – 8 maj 2027 | **1350 px = brak przewijania** |

![Widok Kwartał — cały roczny plan Azure na jednym ekranie](raport-zrzuty/02-gantt-kwartal-caly-rok.png)
*Widok Kwartał. Cały rok mieści się bez przewijania poziomego.*

**Relacje międzyprojektowe działają dokładnie tak, jak powinny.** W projekcie
Azure pojawiło się 14 wierszy zadań z innych projektów. To liczba równa liczbie
relacji międzyprojektowych dotyczących Azure — zgodność 1 : 1, bez duplikatów.
Wiersze są opisane („KBS-2 in Klastry Kubernetes”), mają przerywaną ramkę i są
tylko do odczytu: próba przeciągnięcia nie zmieniła pozycji o żaden piksel.
Zadania z innych projektów **bez relacji są niewidoczne** — sprawdziłem to na
konkretnym zadaniu z projektu on-prem. To dobrze zaprojektowana funkcja.

![Wiersze zadań z innych projektów na wykresie Azure](raport-zrzuty/05-relacje-miedzyprojektowe.png)
*Wiersze „KBS-2 in Klastry Kubernetes”, „LOB-3 in Linie produktowe…” — zadania
z innych projektów, tylko do odczytu.*

**Kodowanie kolorem linii działa.** Przy jednej relacji typu „powiązane”
w projekcie renderuje się dokładnie 1 linia szara (`--muted-foreground`)
i 13 czerwonych (`--destructive`). Legenda „Blocking / Related” odpowiada
rzeczywistości.

**Wykrywanie cyklu jest szczelne.** Próba zamknięcia pętli A → B → C → A
kończy się odmową (HTTP 409, „This dependency would create a circular
dependency”) i relacja nie powstaje. Nie da się przypadkiem zapętlić
harmonogramu.

**Postęp i kamienie milowe renderują się poprawnie.** Słupek wypełnia się
proporcjonalnie do postępu. Zadanie oznaczone jako kamień milowy zamienia się
w romb i wraca do słupka po cofnięciu oznaczenia — z zachowanym wypełnieniem.
Dla zadania z zakresem dat romb pojawia się na **dacie startu**.

![Słupek z wypełnieniem 65 %](raport-zrzuty/07-postep-65-procent.png)
![To samo zadanie jako kamień milowy](raport-zrzuty/08-kamien-milowy-romb.png)
*Postęp 65 % i ten sam element po oznaczeniu jako kamień milowy.*

**Zmiany są widoczne natychmiast.** Zmiana postępu w panelu zmienia wypełnienie
słupka bez odświeżania strony. WebSockety działają.

**Ścieżka krytyczna liczy się poprawnie — i potrafi zaskoczyć.** Po włączeniu
przełącznika bursztynowy akcent objął **39 zadań**: łańcuch budowy Proxmoksa,
a dalej fale migracyjne OVH od pierwszej do szóstej. Spodziewałem się, że
ścieżka pobiegnie przez OpenStack, bo to ten etap ma poślizg. Sprawdziłem daty:
„OVH fala 6: cutover” kończy się 27 lutego 2027, a „OpenStack gotowy”
12 lutego 2027. **Narzędzie ma rację, moja intuicja nie.** To dokładnie ta
sytuacja, do której ścieżka krytyczna służy. Ustawienie utrzymuje się po
odświeżeniu strony.

![Ścieżka krytyczna w projekcie OVH](raport-zrzuty/17-sciezka-krytyczna-wlaczona.png)
*Akcent obejmuje łańcuch Proxmox i biegnie dalej w dół, przez fale OVH.
Wiersz SEC-13 z innego projektu pozostaje szary — o tym niżej.*

**Auto-przeplanowanie działa i jest zrozumiałe.** Przeciągnąłem „OpenStack:
control plane” o 15 dni w prawo. Sześć zadań zależnych przesunęło się do przodu
i **zachowało swoją długość** (40, 30, 35 i 25 dni bez zmian). Pojawił się
komunikat „Rescheduled 6 dependent tasks”.

| Zadanie | Przed | Po |
|---|---|---|
| control plane | 18 paź → 27 lis | **2 lis → 12 gru** (+15 d) |
| integracja z Ceph | 23 lis → 23 gru | 27 lis → 27 gru (+4 d) |
| sieć Neutron | 3 gru → 7 sty | 7 gru → 11 sty (+4 d) |
| Keystone | 18 gru → 12 sty | 22 gru → 16 sty (+4 d) |
| testy akceptacyjne | 10 sty → 4 lut | 18 sty → 12 lut (+8 d) |

Przeciągnięcie **wstecz** o te same 15 dni cofnęło tylko zadanie źródłowe.
Zadania zależne zostały na miejscu. Tak ma działać kaskada jednokierunkowa.

**Kaskada omija dni wolne.** Wszystkie nowe daty startu wypadły w dni robocze:
poniedziałek, piątek, poniedziałek, wtorek, poniedziałek. Żadna nie trafiła
w weekend ani w żadne z 10 świąt.

**Zadanie z datą „musi zacząć” jest nieruchome.** Przesunięcie „OVH fala 4:
przygotowanie” o 10 dni pociągnęło migrację (+10 d) i testy (+12 d), ale
„OVH fala 4: cutover” z ograniczeniem MSO **został na 31 grudnia**. Powstał
widoczny konflikt: testy kończą się po cutoverze. To jest zachowanie poprawne —
narzędzie nie ukrywa konfliktu, tylko pokazuje go PM-owi do rozstrzygnięcia.

**Kalendarz roboczy da się edytować i zapis działa.** Ustawienia obszaru
roboczego pokazują poprawny stan (poniedziałek–piątek, 10 świąt). Odznaczenie
dnia roboczego zapisuje się i potwierdza komunikatem. Dodanie i usunięcie
święta działa.

![Kalendarz roboczy w ustawieniach obszaru roboczego](raport-zrzuty/22-kalendarz-roboczy-ustawienia.png)
*Ta sama strona pokazuje problem z tłumaczeniami w skrócie: nagłówek
i pola opisowe są po polsku, a cała sekcja „Working calendar” — z nazwami dni
tygodnia włącznie — po angielsku. Pole daty używa formatu mm/dd/yyyy.*

**Cieniowanie dni wolnych: 63 zacienione komórki, ale w trybie ciemnym ledwo
widoczne.** Sprawdziłem okres świąteczny. Weekendy, 24–26 grudnia, 31 grudnia,
1 i 6 stycznia są zacieniowane. W trybie jasnym kontrast jest wyraźny.
W trybie ciemnym cieniowanie to 6 % jasności na ciemnym tle — przy normalnym
powiększeniu PM może go po prostu nie zauważyć.

![Dni wolne, tryb ciemny](raport-zrzuty/18-dni-wolne-tryb-ciemny.png)
![Dni wolne, tryb jasny](raport-zrzuty/19-dni-wolne-tryb-jasny.png)
*Ten sam okres świąteczny w obu motywach.*

**Ograniczenia dat są widoczne i ostrzegają.** Znacznik na słupku podaje typ
i datę. Po przesunięciu zadania poza termin pojawia się ostrzeżenie o naruszeniu.

Ograniczenie ustawia się z panelu właściwości zadania. Popover pokazuje cztery
opcje ze znacznikiem przy aktywnej.

![Panel ustawienia ograniczenia daty](raport-zrzuty/21-panel-ograniczenia-daty.png)
*Wybór typu ograniczenia w karcie zadania.*

![Ostrzeżenie o naruszeniu terminu FNLT](raport-zrzuty/20-naruszenie-ograniczenia-fnlt.png)
*Zgoda klienta linii Finanse przesunięta poza termin nieprzekraczalny.
Na słupku pojawia się znacznik naruszenia.*

**Wydajność przy realnym planie jest dobra.** Projekt z 94 zadaniami: 2,66 s od
wejścia do pierwszego słupka, 744 ms na przełączenie jednostki, zero błędów
w konsoli.

### Gdzie jest tarcie

**Pierwsze wrażenie jest złe: wykres wygląda na pusty.** Domyślna jednostka to
Dzień, a okno obejmuje ~3 miesiące wokół „dziś”. Zadania z wcześniejszych
miesięcy są poza ekranem. PM otwiera Gantta rocznego planu i widzi listę zadań
bez żadnego słupka. Trzeba wiedzieć, że należy przełączyć na Kwartał.
**To psuje pierwsze 30 sekund kontaktu z narzędziem.**

![Domyślne otwarcie wykresu — lista zadań bez słupków](raport-zrzuty/01-gantt-domyslny-widok-dzien.png)
*Tak wygląda pierwsze wejście na wykres rocznego planu. Obszar wykresu jest pusty.*

**Podświetlanie po najechaniu nie działa tam, gdzie jest potrzebne.** W widoku
Dzień działa poprawnie: powiązane linie grubieją, niepowiązane słupki przygasają.
W widoku **Kwartał** — czyli tym, w którym PM ogląda cały plan — słupek ma
**3,6 piksela** szerokości, a leżąca nad nim linia zależności przechwytuje
kursor. Podświetlanie przestaje działać. Żeby „wypytać” wykres o powiązania,
trzeba wrócić do widoku Dzień i stracić obraz całości.

![Przed najechaniem kursorem](raport-zrzuty/03-podswietlanie-przed.png)
![Po najechaniu — niepowiązane słupki przygasają](raport-zrzuty/04-podswietlanie-po.png)
*Widok Dzień: przed najechaniem i po najechaniu na „Fala 3: cutover”.
W widoku Kwartał ten sam ruch nie daje żadnego efektu.*

**Przeciąganie nagłówka nie przewija, tylko zaznacza tekst.** Przeciągnięcie
pustego tła wykresu działa poprawnie. Przeciągnięcie kolumny z nazwami zadań
(`[data-gantt-rail]`) uruchamia natywne zaznaczanie tekstu przeglądarki —
podświetla się cały pasek boczny. To wygląda na usterkę.

**Typu zależności nie da się zmienić z wykresu.** Kliknięcie w słupek nic nie
otwiera. Kliknięcie prawym przyciskiem nie otwiera menu. Kliknięcie w linię
zależności nie działa, bo linie mają `pointer-events: none`. Typ FS/SS/FF/SF
i opóźnienie zmienia się **wyłącznie w karcie zadania**, w sekcji „Powiązania”,
przez małą odznakę typu. Funkcja istnieje i działa poprawnie — ale jest ukryta
w miejscu, którego PM nie znajdzie bez podpowiedzi.

![Panel powiązań w karcie zadania](raport-zrzuty/12-typ-zaleznosci-panel.png)
![Wybór typu zależności](raport-zrzuty/13-typ-zaleznosci-lista.png)
*Jedyne miejsce, w którym da się zmienić typ zależności i opóźnienie.
Cały ten panel jest po angielsku.*

**Nowa zależność zawsze powstaje jako FS z zerowym opóźnieniem.** Przeciągnięcie
uchwytu ze słupka tworzy relację, ale nie pozwala wybrać typu. Przy planowaniu
fal, gdzie połowa zależności to „start razem” (SS), oznacza to dwa kroki zamiast
jednego dla każdej relacji.

**Typów zależności nie widać na wykresie.** Wszystkie relacje blokujące są
czerwone, niezależnie od tego, czy to FS, SS, FF czy SF. Jedyna różnica to
krawędź słupka, do której linia się podłącza. Nie ma legendy tego mechanizmu ani
etykiety typu przy linii. Etykieta pojawia się tylko dla opóźnienia i tylko gdy
jest różne od zera. **PM patrzący na wykres nie wie, czy dwie fale mogą ruszyć
równolegle, czy jedna po drugiej.**

**Etykiety opóźnień zlewają się w węzłach rozgałęzienia.** Kamień milowy
„Platforma kontenerowa gotowa” blokuje 8 fal. Osiem etykiet opóźnienia rysuje się
w jednym punkcie i daje nieczytelny ciąg znaków. Ten wzorzec — jedna bramka
blokująca wiele fal — jest w migracji podstawowy, więc problem wystąpi wszędzie.

![Nakładające się etykiety opóźnień](raport-zrzuty/14-etykiety-opoznien-nakladanie.png)
*Osiem etykiet opóźnienia w jednym węźle. Żadnej nie da się odczytać.*

**Plan bazowy pokazuje, że jest poślizg, ale nie mówi ile.** Pod słupkiem
rzeczywistym rysuje się cieńszy pasek planu bazowego. Różnicę widać. Liczby dni
nie ma nigdzie: ani na wykresie, ani w oknie planu bazowego, które podaje tylko
surowe daty. PM musi odejmować daty ręcznie. To zaskakujące, bo narzędzie **już
umie** rysować etykiety typu „+4d” dla opóźnień w relacjach — ten sam wzorzec nie
został użyty tam, gdzie liczba dni jest najważniejsza.

![Słupek rzeczywisty i cieńszy pasek planu bazowego](raport-zrzuty/09-plan-bazowy-poslizg.png)
*Odchylenie widać. Liczby dni nie ma nigdzie.*

**Słupek zbiorczy podzadań nie pokazuje postępu.** Rodzic renderuje się jako
belka obejmująca zakres dat podzadań. Zwijanie i rozwijanie działa. Ale słupek
zbiorczy **nie ma w ogóle wskaźnika procentowego**. PM patrzący na zwiniętą falę
nie wie, czy jest ona ukończona w 10 %, czy w 90 %.

![Podzadania rozwinięte](raport-zrzuty/10-podzadania-rozwiniete.png)
![Podzadania zwinięte](raport-zrzuty/11-podzadania-zwiniete.png)
*Słupek zbiorczy rysuje się jako belka z zaczepami. Po zwinięciu podzadania
znikają — i razem z nimi jedyna informacja o postępie fali.*

**Ustawienie postępu to suwak, nie liczba.** Krok wynosi 5 %. Nie da się wpisać
wartości. Dokładne 65 % wymaga doregulowania strzałkami. Zapis **nie pokazuje
potwierdzenia** — klucz komunikatu „Task progress updated” istnieje
w tłumaczeniach, ale nie jest używany. Użytkownik nie wie, czy zapis się udał.

**Nie ma masowej aktualizacji postępu.** Operacje zbiorcze API obejmują status,
priorytet, przypisanie, etykiety, usunięcie, termin i harmonogram. Postępu na tej
liście nie ma. Przy falach po kilkadziesiąt zadań PM musi wchodzić w każde
zadanie osobno.

**Na wykresie nie widać, czyje jest zadanie.** Nie ma awatarów ani inicjałów
w żadnym wierszu. Nie ma też znacznika „po terminie”. PM musi przejść do Tablicy
albo Backlogu, żeby ustalić właściciela.

**Trzy drobne kolizje elementów interfejsu.** Każda z osobna jest mała, razem
dają wrażenie niedopracowania:

- **Uchwyt tworzenia zależności zasłania uchwyt zmiany długości.** Ikona łącza
  jest przezroczysta, ale nadal przechwytuje kliknięcia. Kliknięcie w środek
  prawej krawędzi słupka nie robi nic. Trzeba trafić bliżej góry albo dołu paska.
- **Znacznik naruszenia ograniczenia zasłania romb kamienia milowego.** Po
  pojawieniu się ostrzeżenia nie da się kliknąć w środek rombu, żeby otworzyć
  zadanie.
- **Komunikaty potwierdzeń zasłaniają przycisk „Add holiday”** w ustawieniach
  kalendarza. Trzeba odczekać, aż znikną.

Do tego w konsoli przeglądarki powtarza się błąd
`hasPermission check failed … TypeError: Failed to fetch`, obecny od pierwszego
wejścia i niezwiązany z wykonywanymi działaniami. Nie badałem go głębiej —
wykracza poza zakres testu, ale warto go zgłosić.

**Ścieżka krytyczna pomija zależności między projektami — i to jest pułapka.**
Algorytm celowo odrzuca krawędzie prowadzące do zadań z innych projektów.
Cytat z kodu (`apps/web/src/components/gantt/gantt-critical-path.ts:153-154`):
*„an edge into a cross-project or dateless task has no duration/anchor to reason
about, so it's dropped here”*. Widać to na zrzucie ze ścieżką krytyczną: wiersz
SEC-13 „Zgoda bezpieczeństwa na start fal produkcyjnych” pozostaje szary, choć
jest bramką dla fal produkcyjnych.

W tym projekcie **19 zależności to zależności międzyprojektowe** — i są to
akurat te najważniejsze: zgody klientów przed cutoverami, bramka bezpieczeństwa
przed falami, „Proxmox gotowy” przed wyłączaniem systemów on-prem. Ścieżka
krytyczna liczona bez nich **może wskazać zły łańcuch**. PM nie dostaje żadnego
ostrzeżenia, że część sieci zależności została pominięta.

**Ścieżka krytyczna nie planuje — tylko mierzy zapas.** Kaneo nie wylicza
harmonogramu z czasów trwania i zależności. Daty są zawsze wpisane ręcznie,
a algorytm liczy tylko, ile zapasu ma każde zadanie przy tych datach. To istotna
różnica wobec klasycznych narzędzi planistycznych: narzędzie nie powie
„ta fala skończy się 12 marca”, tylko „to zadanie nie ma zapasu”.

**Interfejs jest w połowie po angielsku.** To nie jest wrażenie — to liczby.
Z 81 komunikatów wykresu Gantta i panelu właściwości **58 ma w polskim pliku
tłumaczeń tekst angielski**. Do tego z 41 komunikatów kalendarza roboczego
nieprzetłumaczonych jest **29** — łącznie z nazwami dni tygodnia, które
w polskim interfejsie wyświetlają się jako „Monday”, „Tuesday”, „Friday”.
Razem **87 z 122 komunikatów nowych funkcji**. Problem dotyczy wszystkich
19 języków innych niż angielski:

| Język | Nieprzetłumaczone / wszystkie |
|---|---|
| polski | 58 / 81 |
| niemiecki | 58 / 81 |
| francuski | 61 / 81 |
| niderlandzki | 62 / 81 |
| chiński | 57 / 81 |

Klucze istnieją, więc automatyczna kontrola spójności tłumaczeń przechodzi.
Wartości są angielskie. W praktyce polski PM widzi „Critical path”, „Day /
Week / Month / Quarter”, „Set baseline”, „Constraint”, „Start no earlier than”
i komunikat o cyklu po angielsku, obok polskiego „Przejdź do dzisiaj”
i „UKOŃCZONE”. Znacznik ograniczenia łączy oba języki w jednym napisie:
*„OVH: instalacja Proxmox VE na 16 węzłach: Start no earlier than, 10 cze”*.

---

## 3. Skala — czy narzędzie zniesie ten plan

Zrobiłem osobny test syntetyczny: nowy obszar roboczy, jeden projekt,
**1200 zadań** i 1152 zależności, oś roczna. Porównanie:

| Miara | 94 zadania (realny projekt Azure) | 1200 zadań (test skali) |
|---|---|---|
| Wejście → pierwsze wiersze | 2,66 s | **11,0 s** |
| Wejście → widok ustabilizowany | ~2,7 s | **13,5 s** |
| Przełączenie jednostki | 744 ms | **3,3 – 4,7 s** |
| Węzły DOM | nie mierzone | **18 998** |
| Pamięć sterty JS | nie mierzone | **415 MB** |
| Żądania API na jedno wejście | 2 | **13** (12 stron po 100 zadań) |
| Odświeżanie cykliczne | — | **pełne pobranie co ~25 s** |

Wnioski:

- **Nie ma wirtualizacji.** Przy 1200 zadaniach w DOM znajduje się 1201 wierszy,
  1200 słupków i 1152 uchwyty do tworzenia zależności — wszystko naraz.
- **Lista zadań pobierana jest stronami po 100.** Przy 1200 pozycjach to 12
  kolejnych żądań przy każdym wejściu, a potem **ponownie co około 25 sekund**.
- Aplikacja **nie wywraca się** — zero błędów w konsoli. Jest tylko wolna.

![Projekt z 1200 zadaniami w widoku Kwartał](raport-zrzuty/16-skala-1200-zadan.png)
*1200 pozycji na rocznej osi. Wszystko się renderuje, ale słupki krótkich zadań
zlewają się w pionową wstęgę.*

**Ocena dla migracji 3000 VM.** Mój realistyczny model ma 252 zadania i działa
dobrze. Ale 252 zadania to ~35 VM na zadanie. Jeżeli plan ma odwzorować partie
migracyjne z dokładnością operacyjną (a przy 3000 maszyn zwykle musi), liczba
pozycji pójdzie w tysiące. **W tym przedziale narzędzie zaczyna męczyć:**
kilkanaście sekund na wejście i ponad 4 sekundy na przełączenie widoku to za
dużo dla narzędzia używanego codziennie na spotkaniu statusowym.

Granica użyteczności leży moim zdaniem w okolicach **500–800 pozycji na projekt**.
Powyżej trzeba dzielić plan na więcej projektów — a wtedy uderza brak widoku
portfela (punkt 5).

---

## 4. Bezpieczeństwo i logi

To dla tego projektu wymaganie krytyczne, więc sprawdziłem je osobno
i doświadczalnie, nie tylko w kodzie.

### Co jest dobre

**Granica obszaru roboczego trzyma.** Założyłem drugie konto spoza obszaru
roboczego i wykonałem 10 prób dostępu. Wszystkie zostały odrzucone kodem 403:

| Próba | Wynik |
|---|---|
| lista projektów obcego obszaru | 403 |
| odczyt zadań projektu | 403 |
| odczyt pojedynczego zadania | 403 |
| odczyt kalendarza roboczego | 403 |
| zmiana dni roboczych | 403 |
| dodanie święta | 403 |
| ustawienie planu bazowego | 403 |
| odczyt relacji zadania | 403 |
| lista członków | 403 |
| odczyt aktywności zadania | 403 |

To samo przez MCP: `list_projects` na cudzy obszar roboczy zwraca
„You don't have access to this workspace”.

**Rola „viewer” naprawdę blokuje zapis.** Dodałem obce konto jako `viewer`
i powtórzyłem próby. Odczyty przechodzą (200). **Wszystkie sześć dróg zapisu
zostaje odrzuconych (403)** — łącznie z operacją zbiorczą `updateSchedule`,
której używa kaskada Gantta. Ukrycie akcji w interfejsie nie jest tu jedyną
ochroną; API egzekwuje uprawnienia.

**Nowe punkty końcowe są chronione poprawnie.** Plan bazowy wymaga
`task:update` i dostępu do obszaru roboczego. Kalendarz roboczy wymaga osobnego
uprawnienia do zarządzania kalendarzem. Relacje zadań wymagają `task:update`.

### Czego brakuje — i to jest poważne

**Dziennik aktywności nie rejestruje zmian harmonogramu.** Sprawdziłem to testem
kontrolowanym: pięć operacji na jednym zadaniu, potem odczyt tabeli `activity`.

| Operacja | Trasa API | Wpis w dzienniku |
|---|---|---|
| zmiana dat + postępu + ograniczenia | `PUT /task/{id}` | **NIE** |
| zmiana terminu (osobna trasa) | `PUT /task/due-date/{id}` | TAK |
| ustawienie planu bazowego | `POST /task/{id}/baseline` | **NIE** |
| utworzenie zależności | `POST /task-relation` | **NIE** |
| zmiana statusu | `PUT /task/status/{id}` | TAK |

Przyczyna jest w kodzie: moduł aktywności nasłuchuje **siedmiu** zdarzeń
(`task.created`, `task.moved`, `task.status_changed`, `task.priority_changed`,
`task.unassigned`, `task.assignee_changed`, `task.due_date_changed`).
Zdarzenie `task.updated` — które publikuje pełna aktualizacja zadania, kaskada
Gantta i plan bazowy — **trafia wyłącznie do WebSocketów**. Nikt go nie zapisuje.

Skala problemu w liczbach: po całej sesji testowej, w której cztery niezależne
zestawy testów przesuwały słupki, zmieniały postęp, ustawiały plany bazowe
i tworzyły zależności, dziennik dla całego obszaru roboczego zawiera:

```
created          252
due_date_changed   3
status_changed     1
```

**Przeciągnięcie zadania na wykresie Gantta nie zostawia żadnego śladu.**
Dla projektu, w którym „kto co zmienił” jest wymaganiem krytycznym, to jest
brak dyskwalifikujący w obecnej postaci.

![Karta zadania: właściwości i historia](raport-zrzuty/15-karta-zadania-wlasciwosci.png)
*Karta zadania. Po prawej pola Progress, Milestone, Baseline i Constraint.
Na dole cała historia zadania: jeden wpis „utworzył(a) to zadanie”.*

**Nie ma osobnego dziennika audytu.** Historia jest przypięta do zadania.
Nie ma widoku „pokaż wszystkie zmiany w obszarze roboczym”, nie ma filtrowania
po użytkowniku ani po dacie.

**Nie ma eksportu dziennika ani polityki retencji.** Wpisy rosną bez ograniczeń
i nie da się ich wyprowadzić do systemu SIEM inaczej niż przez bezpośredni
dostęp do bazy.

**Zmiany kalendarza roboczego nie są nigdzie rejestrowane.** Kalendarz jest
zasobem obszaru roboczego, a dziennik jest przypięty do zadań. Zmiana dni
roboczych albo usunięcie święta przesuwa kaskadę w całym planie i nie zostawia
śladu.

### Zgody klientów i bramki

Modelowanie bramek **jest wykonalne, ale obejściem**. Użyłem kamieni milowych
z ograniczeniem „nie później niż” (FNLT) i zależności blokujących do cutoverów.
To działa i czyta się poprawnie na wykresie.

Czego brakuje do prawdziwej obsługi zgód:

- Nie ma **pola statusu bramki** („oczekuje / udzielona / odmowa / wycofana”).
  Pola własne obsługują typy tekst, liczba, data, lista i wartość logiczna, więc
  da się to zbudować — ale pól własnych **nie widać na wykresie Gantta** i **nie
  ma ich w MCP**.
- Nie ma **twardej blokady**: zadanie zależne od nieudzielonej zgody da się
  przesunąć i rozpocząć. Zależność jest wskazówką planistyczną, nie kontrolą.
- Nie ma **śladu audytowego udzielenia zgody** — z powodów opisanych wyżej.

---

## 5. Czego brakuje do prowadzenia tej migracji

### Krytyczne — bez tego nie poprowadzę projektu

1. **Pełny dziennik zmian harmonogramu.** Musi rejestrować: zmianę dat (także
   z przeciągnięcia i z kaskady), postęp, kamień milowy, plan bazowy,
   ograniczenie daty, utworzenie i usunięcie zależności oraz zmianę kalendarza
   roboczego. Z wartością przed i po oraz z autorem.
2. **Widok portfela — wiele projektów na jednej osi czasu.** Dziś Gantt istnieje
   wyłącznie w obrębie jednego projektu. Widok obszaru roboczego to lista
   projektów z procentami, bez osi czasu. Migracja jest z definicji
   wieloprojektowa: fale Azure zależą od zgód klientów, od platformy OVH
   i od bramki bezpieczeństwa. Wiersze międzyprojektowe łagodzą to tylko
   częściowo — pokazują pojedyncze zadania, nie plan.
3. **Obłożenie zasobów.** Nie ma niczego: ani widoku obciążenia osoby lub
   zespołu, ani ostrzeżenia o przeciążeniu. Przy 8 falach prowadzonych przez ten
   sam zespół infrastruktury i jeden helpdesk to podstawowe narzędzie planisty.
   Dziś muszę prowadzić to w arkuszu obok.
4. **Eksport planu z zależnościami.** Eksport zwraca JSON z ośmioma polami:
   tytuł, opis, status, priorytet, daty, przypisanie, etykiety. **Nie zawiera
   postępu, kamieni milowych, planu bazowego, ograniczeń ani żadnych relacji.**
   Nie da się wyeksportować planu do przeglądu na komitecie sterującym ani
   przenieść go do MS Project.

### Ważne — mocno utrudniają pracę

5. **Ścieżka krytyczna uwzględniająca zależności między projektami.** Dziś są
   pomijane bez ostrzeżenia. Minimum: komunikat „pominięto N zależności
   międzyprojektowych”. Docelowo: liczenie na całym obszarze roboczym.
6. **Liczba dni poślizgu przy planie bazowym.** Etykieta „+11 d” przy słupku.
7. **Postęp na słupku zbiorczym podzadań**, wyliczony z dzieci.
8. **Typ zależności widoczny i edytowalny na wykresie.** Etykieta typu przy linii
   oraz wybór typu przy przeciąganiu uchwytu albo z menu kontekstowego.
9. **Rozsuwanie etykiet opóźnień** w węzłach z wieloma zależnościami.
10. **Podświetlanie po najechaniu działające w widoku Kwartał** — minimalna
    szerokość obszaru trafienia niezależna od szerokości słupka.
11. **Dokończenie tłumaczeń.** 58 z 81 komunikatów Gantta w każdym języku.
12. **Masowa zmiana postępu** dla zaznaczonych zadań.
13. **Właściciel zadania widoczny na wykresie** (inicjały) oraz znacznik
    „po terminie”.
14. **Wirtualizacja wierszy** i rezygnacja z pełnego odświeżania co 25 sekund.

### Miłe w posiadaniu

15. Domyślna jednostka dobrana do rozpiętości planu, żeby wykres nie otwierał się
    pusty.
16. Pola własne widoczne na wykresie i dostępne w MCP (status zgody klienta).
17. Ślad rzeczowy przy kamieniu milowym: numer umowy, osoba zatwierdzająca.
18. Linia „dziś” i linie kamieni milowych przez całą wysokość wykresu.
19. Ścieżka krytyczna liczona po stronie serwera, żeby była dostępna dla MCP
    i raportów.
20. Mocniejszy kontrast cieniowania dni wolnych w trybie ciemnym.

---

## 6. Co bym poprawił — konkretnie

Kolejność według stosunku korzyści do kosztu.

1. **Dodać subskrypcję `task.updated` w module aktywności.**
   Plik: `apps/api/src/activity/index.ts`. Moduł ma już siedem takich
   subskrypcji; ósma jest zmianą kilkudziesięciu linii. Zdarzenie jest
   publikowane w trzech miejscach (`update-task.ts`, `bulk-update-tasks.ts`,
   `update-task-baseline.ts`), więc jedna subskrypcja pokryje przeciąganie
   słupka, kaskadę i plan bazowy. **To najtańsza poprawka o największym
   znaczeniu.**

2. **Publikować zdarzenia dla relacji zadań i kalendarza roboczego** i zapisywać
   je w dzienniku. Relacja to element planu, a nie metadana.

3. **Uzupełnić tłumaczenia.** Pliki `i18n/*.json`, klucze `tasks.gantt.*`,
   `tasks.popover.*`, `tasks.properties.*` oraz `settings.workspaceCalendar.*`.
   Warto dodać do kontroli CI regułę, która wykrywa wartość identyczną
   z angielską — dziś kontrola sprawdza tylko obecność klucza, więc angielski
   tekst w polskim pliku przechodzi. Przy okazji: pola dat pokazują format
   mm/dd/yyyy niezależnie od języka interfejsu.

4. **Dodać etykietę odchylenia od planu bazowego.** Komponent
   `gantt-task-bar.tsx` już rysuje pasek planu bazowego i zna obie pary dat.
   Brakuje jednej etykiety z różnicą dni. Wzorzec „+Nd” istnieje w overlayu
   zależności.

5. **Dodać postęp na słupku zbiorczym.** `gantt-summary-task-bar.tsx` — średnia
   ważona czasem trwania podzadań.

6. **Rozszerzyć eksport** o `progress`, `isMilestone`, `baselineStartDate`,
   `baselineDueDate`, `constraintType`, `constraintDate` i listę relacji.
   Kontroler `export-tasks.ts` zwraca dziś osiem pól zadania; dodanie sześciu
   pól i jednego złączenia to mała zmiana, a odblokowuje raportowanie.

7. **Dodać typ zależności i opóźnienie do MCP.** Szczegóły w punkcie 7.

8. **Naprawić przeciąganie kolumny nazw.** Ustawić `user-select: none` na
   `[data-gantt-rail]` albo obsłużyć na nim przeciąganie jako przewijanie.

9. **Powiększyć obszar trafienia słupka** do minimum ~8 px i obniżyć
   `pointer-events` linii zależności poniżej słupków, żeby podświetlanie działało
   w widoku Kwartał.

10. **Rozsunąć etykiety opóźnień** przy wspólnym węźle — przesunięcie pionowe
    proporcjonalne do indeksu krawędzi.

11. **Dodać `progress` do operacji zbiorczych** w `PATCH /task/bulk`
    i do paska zaznaczenia wielokrotnego.

12. **Dobrać domyślną jednostkę osi** do rozpiętości dat projektu przy pierwszym
    wejściu. Dziś zawsze Dzień.

13. **Dodać komunikat potwierdzenia przy zmianie postępu.** Klucz
    `tasks.popover.progress.updateSuccess` już istnieje i nie jest używany.

14. **Wprowadzić wirtualizację wierszy** i zastąpić pełne odświeżanie co 25 s
    aktualizacją przyrostową przez WebSocket, który już działa.

15. **Ostrzegać, gdy ścieżka krytyczna pomija zależności międzyprojektowe.**
    Liczba pominiętych krawędzi jest znana w momencie filtrowania
    (`gantt-critical-path.ts:153`), więc wystarczy ją pokazać obok przełącznika.
    To jedno zdanie w interfejsie, a chroni PM-a przed błędnym wnioskiem.

16. **Usunąć trzy kolizje elementów.** Ustawić `pointer-events: none` na
    przezroczystym uchwycie tworzenia zależności, przesunąć znacznik naruszenia
    poza obszar klikalny rombu, przenieść komunikaty potwierdzeń tak, żeby nie
    zasłaniały przycisków w ustawieniach kalendarza.

17. **Podnieść kontrast cieniowania dni wolnych w trybie ciemnym.** Dziś
    `bg-foreground/[0.06]`. Wartość rzędu 10–12 % byłaby widoczna bez
    przybliżania i nadal dyskretna.

---

## 7. Pokrycie MCP

### Metoda

MCP sprawdziłem w dwóch miejscach, tak jak wskazuje zlecenie:

- pakiet stdio `packages/mcp/src/tools/register.ts` (788 linii),
- trasy HTTP `apps/api/src/mcp/tools.ts` (959 linii), wystawione pod `/api/mcp`.

**Oba rejestry zawierają dokładnie te same 36 narzędzi.** Porównanie list nie
wykazało różnic. To jednak dwie niezależne implementacje tego samego zestawu —
ryzyko rozjechania się przy kolejnych zmianach.

Listę i zachowanie potwierdziłem **na żywo**, przez sesję MCP po HTTP
(`initialize` → `notifications/initialized` → `tools/list` → `tools/call`).
Uwierzytelnienie tokenem sesji w nagłówku `Authorization: Bearer`.

### Tabela pokrycia

| Funkcja | Stan | Narzędzie / pole |
|---|---|---|
| **Zapis — relacje** | | |
| `dependencyType` (fs/ss/ff/sf) | **BRAK** | `create_task_relation` przyjmuje tylko `sourceTaskId`, `targetTaskId`, `relationType` — `tools.ts:667-689` |
| `lagDays` | **BRAK** | jw. |
| zmiana typu/opóźnienia istniejącej relacji | **BRAK** | nie ma narzędzia `update_task_relation`; REST ma `PATCH /api/task-relation/{id}` |
| utworzenie relacji (fs/0) | obsługiwana | `create_task_relation` |
| usunięcie relacji | obsługiwana | `delete_task_relation` |
| **Zapis — zadanie** | | |
| `progress` | **BRAK** | `create_task` — `tools.ts:422-453`; `update_task` — `tools.ts:456-488` |
| `isMilestone` | **BRAK** | jw. |
| `baselineStartDate` / `baselineDueDate` | **BRAK** | brak narzędzia planu bazowego; REST ma `POST/DELETE /api/task/{id}/baseline` |
| `constraintType` / `constraintDate` | **BRAK** | `update_task` nie ma tych pól w schemacie |
| `startDate` / `dueDate` | obsługiwana | `create_task`, `update_task`, `update_task_due_date` |
| **Zapis — kalendarz roboczy** | | |
| dni robocze obszaru roboczego | **BRAK** | brak narzędzia; REST ma `PUT /api/calendar/{workspaceId}` |
| święta obszaru roboczego | **BRAK** | brak narzędzia; REST ma `POST/DELETE /api/calendar/{workspaceId}/holidays` |
| **Odczyt** | | |
| `progress`, `isMilestone`, `baseline*`, `constraint*` | obsługiwana | `get_task` i `list_tasks` zwracają komplet pól |
| `dependencyType`, `lagDays` | obsługiwana | `get_task_relations` zwraca oba pola |
| historia aktywności zadania | obsługiwana | `list_task_activity` |
| **Inne** | | |
| ścieżka krytyczna | **N/D** | liczona po stronie klienta w `apps/web/src/components/gantt/gantt-critical-path.ts`; API nie ma jej wcale |
| pola własne | **BRAK** | brak narzędzi MCP, mimo że REST je obsługuje |

### Wywołania na żywo — co potwierdziłem

**1. Lista narzędzi.** `tools/list` zwrócił 36 narzędzi. Pola wejściowe
`create_task_relation` to dokładnie trzy: `sourceTaskId`, `targetTaskId`,
`relationType`.

**2. Nowe pola są po cichu pomijane, bez błędu.** To najgroźniejsze zachowanie
w całym audycie MCP.

```
create_task  {..., "progress": 40, "isMilestone": true}
→ isError: false
→ wynik: "progress": 0, "isMilestone": false
```

```
create_task_relation {..., "dependencyType": "ss", "lagDays": 7}
→ isError: false
→ wynik: "dependencyType": "fs", "lagDays": 0
→ baza: fs | 0
```

Agent pracujący przez MCP dostaje potwierdzenie sukcesu i jest przekonany,
że ustawił SS z opóźnieniem 7 dni. W bazie jest FS z zerem. **Cicha utrata
danych jest gorsza niż odrzucenie żądania.**

**3. Odczyt działa w pełni.** `get_task` zwrócił komplet:

```
progress = 0            baselineStartDate = 2027-01-11
isMilestone = False     baselineDueDate   = 2027-01-13
constraintType = must_start_on
constraintDate = 2027-01-11
```

`get_task_relations` zwrócił `dependencyType` i `lagDays` dla każdej relacji
(potwierdzone wartości `ss / 14` i `ss / 16`).

**4. `update_task` nie niszczy pól, których nie zna — i to jest dobra
decyzja projektowa.** Ustawiłem przez REST `progress = 70`,
`isMilestone = true`, ograniczenie FNLT. Następnie zmieniłem przez MCP sam
tytuł. Wszystkie trzy pola przetrwały. Helper `buildFullTaskUpdateBody` celowo
pomija pola, których nie obsługuje, a API traktuje ich brak jako „nie ruszaj”.

**5. Ustawienie ograniczenia przez MCP nie działa i nie zgłasza błędu.**

```
update_task {"constraintType": "must_start_on", "constraintDate": "...", "progress": 15}
→ isError: false
→ baza bez zmian: progress = 70, constraint = finish_no_later_than
```

### Wniosek

MCP nadaje się dziś do **czytania** planu Gantta w całości i do **zakładania**
szkieletu zadań. Nie nadaje się do budowania planu migracji: nie ustawi typu
zależności, opóźnienia, postępu, kamienia milowego, planu bazowego, ograniczenia
daty ani kalendarza roboczego. Ponieważ REST obsługuje wszystkie te pola,
uzupełnienie MCP to rozszerzenie schematów wejściowych, a nie nowa logika.

Minimalny zakres poprawki:

- `create_task_relation`: dodać `dependencyType` i `lagDays`,
- nowe narzędzie `update_task_relation`,
- `create_task` i `update_task`: dodać `progress`, `isMilestone`,
  `constraintType`, `constraintDate`,
- nowe narzędzia `set_task_baseline` i `clear_task_baseline`,
- nowe narzędzia kalendarza roboczego,
- do czasu uzupełnienia: **odrzucać nieznane pola zamiast je pomijać**.

---

## 8. Czego NIE udało się przetestować

Podaję wprost, żeby nie mylić braku dowodu z dowodem braku.

1. **Wariant A — obraz Dockera.** Polityka ruchu wychodzącego sesji blokuje
   `pkg-containers.githubusercontent.com`, gdzie GHCR trzyma warstwy obrazu.
   Testowałem Wariant B z tego samego commita `9a5dca8`. Nie sprawdziłem samego
   obrazu, wejścia kontenera ani migracji uruchamianych przez entrypoint
   kontenera.
2. **Praca wielu użytkowników naraz.** Testowałem jednym kontem właściciela
   i jednym kontem obcym. Nie sprawdziłem konfliktów przy równoczesnej edycji
   tego samego zadania przez dwie osoby.
3. **Redis i wiele instancji API.** Uruchomiłem pojedynczą instancję
   z adapterem `InMemoryBroadcastAdapter`. Rozsyłania zdarzeń przez Redis nie
   sprawdziłem.
4. **Urządzenia dotykowe i telefony.** Testowałem wyłącznie Chromium
   1600 × 900 na biurku. Kod ma osobne progi dla dotyku, ale ich nie
   uruchamiałem.
5. **Wydajność przy ponad 1200 zadaniach.** Zatrzymałem się na 1200. Wnioski
   o tysiącach pozycji są ekstrapolacją z dwóch punktów pomiarowych (94 i 1200),
   a nie pomiarem.
6. **Integracje** (GitHub, Slack, webhooki) i **powiadomienia e-mail** — poza
   zakresem zlecenia, brak konfiguracji SMTP i kluczy.
7. **Import planu** z MS Project lub arkusza. Istnieje `POST /task/import/{id}`,
   ale przyjmuje te same osiem pól co eksport, więc i tak nie przeniesie
   zależności. Nie uruchamiałem go.

---

## 9. Werdykt

**Czy Kaneo nadaje się do prowadzenia migracji 3000 VM w rok?**

W obecnej postaci — **jako jedyne narzędzie: nie**. Jako narzędzie zespołu
wykonawczego, obok osobnego rejestru planu i osobnego rejestru zgód — **tak,
z zastrzeżeniami**.

Za:

- Rdzeń wykresu Gantta jest solidny: zależności, kamienie milowe, plan bazowy,
  podzadania, ograniczenia dat i kalendarz roboczy działają.
- Auto-przeplanowanie jest przewidywalne: przesuwa tylko do przodu, zachowuje
  długości zadań, omija dni wolne i respektuje twarde daty „musi zacząć”.
- Ścieżka krytyczna liczy poprawnie i potrafi skorygować intuicję PM-a.
- Relacje międzyprojektowe rozwiązano dobrze i oszczędnie.
- Autoryzacja i granice obszaru roboczego są egzekwowane po stronie API.
- Wdrożenie własne jest proste, a model danych czytelny.

Przeciw:

- **Brak śladu audytowego zmian harmonogramu** wyklucza użycie w projekcie,
  w którym audyt jest wymaganiem krytycznym — dopóki nie zostanie dodana
  subskrypcja `task.updated`.
- **Brak widoku portfela** zmusza PM-a do trzymania obrazu całości poza
  narzędziem.
- **Brak obłożenia zasobów** i **brak eksportu z zależnościami** oznaczają, że
  planowanie i raportowanie i tak odbędzie się w arkuszu.
- **MCP nie ustawi żadnego z nowych pól**, więc automatyzacja planu przez agentów
  jest dziś niemożliwa.

Trzy pierwsze poprawki z punktu 6 (dziennik, tłumaczenia, etykieta odchylenia)
są tanie i zmieniają ocenę istotnie. Widok portfela i obłożenie zasobów to praca
na osobny kwartał.

---

## Załącznik A — film z przebiegu testów

Plik: **`demo-gantt-kaneo.mp4`** — 7 min 36 s, 1600 × 900, H.264, 7,9 MB.

Nagranie powstało przez sterowanie prawdziwą przeglądarką Chromium. Kursor myszy
jest narysowany jako nakładka na stronie, bo nagranie ekranu przeglądarki nie
zawiera systemowego wskaźnika. Każde kliknięcie zaznaczono bursztynowym
pierścieniem. Napisy i nazwa rozdziału są wstrzykiwane do strony, więc są
częścią obrazu — nie wymagają osobnego pliku z napisami.

Rozdziały:

| # | Rozdział | Co pokazuje |
|---|---|---|
| 1 | Projekt i skala | obszar roboczy, 7 projektów, 252 zadania |
| 2 | Jednostki czasu | Dzień → Tydzień → Miesiąc → Kwartał |
| 3 | Linie zależności i podświetlanie | czerwone i szare linie, reakcja na najechanie |
| 4 | Relacje między projektami | wiersze tylko do odczytu z innych projektów |
| 5 | Przewijanie i powiększanie | przeciąganie tła, kółko myszy |
| 6 | Kamienie milowe i postęp | romb, wypełnienie słupka |
| 7 | Słupek zbiorczy podzadań | zwijanie i rozwijanie |
| 8 | Plan bazowy | plan kontra rzeczywistość na etapie OpenStack |
| 9 | Ścieżka krytyczna | przełącznik i bursztynowy akcent |
| 10 | Auto-przeplanowanie | kaskada do przodu po przesunięciu blokującego |
| 11 | Ograniczenia dat | znaczniki SNET, FNLT i MSO |
| 12 | Kalendarz roboczy | dni robocze i święta w ustawieniach |
| 13 | Cieniowanie dni wolnych | tryb ciemny i jasny |
| 14 | Typy FS/SS/FF/SF i opóźnienie | panel powiązań w karcie zadania |
| 15 | Nowa zależność przeciągnięciem | uchwyt na końcu słupka |
| 16 | Dziennik aktywności | pięć zmian, dwa wpisy w historii |
| 17 | Podsumowanie | wnioski |

Uwaga do rozdziału 12: widok przewija się nieco szybciej niż zmieniają się
napisy, więc przy zdaniu o dniach roboczych na ekranie jest już lista dni
wolnych. Treść pozostaje zgodna z tym, co robiłem.

---

## Załącznik B — jak odtworzyć to środowisko

```bash
git clone https://github.com/WMP/kaneo.git && cd kaneo
git checkout claude/gantt-plus-cross-project     # commit 9a5dca8

# baza
pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE ROLE kaneo LOGIN PASSWORD 'kaneo' SUPERUSER;\""
su postgres -c "psql -c 'CREATE DATABASE kaneo OWNER kaneo;'"

# konfiguracja
cat > .env <<'EOF'
POSTGRES_USER=kaneo
POSTGRES_PASSWORD=kaneo
POSTGRES_DB=kaneo
DATABASE_URL=postgres://kaneo:kaneo@127.0.0.1:5432/kaneo
AUTH_SECRET=<co najmniej 32 znaki, np. openssl rand -hex 32>
KANEO_API_URL=http://localhost:1337
KANEO_CLIENT_URL=http://localhost:5173
VITE_API_URL=http://localhost:1337
EOF

pnpm install
pnpm dev        # API 1337, aplikacja 5173, migracje przy starcie
```

Plan migracyjny wprowadzano skryptem w Node.js, który wywołuje to samo API co
klient webowy (ciasteczko sesji Better Auth plus nagłówek `Origin`). Sesję MCP
po HTTP otwiera się sekwencją `initialize` → `notifications/initialized` →
`tools/call`, przekazując nagłówek `mcp-session-id` zwrócony przez `initialize`
oraz token sesji w nagłówku `Authorization: Bearer`.

---

*Wszystkie liczby w raporcie pochodzą z pomiarów na uruchomionej instancji:
z interfejsu, z odpowiedzi API, z wywołań MCP albo z zapytań do bazy.
Wnioski wyprowadzone z samego kodu są oznaczone odwołaniem do pliku i linii.
Raport jest materiałem pomocniczym — przed decyzją wdrożeniową wymaga
weryfikacji przez właściciela produktu i zespół bezpieczeństwa.*
