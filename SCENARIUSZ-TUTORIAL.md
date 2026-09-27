# Scenariusz filmu: tutorial po nowych funkcjach Kaneo

Film budujący. Zaczyna od pustego projektu, dokłada zadania po jednym —
**każde dodanie pokazuje coś innego** — potem czyta gotowy plan na wykresie,
przesuwa cały harmonogram, bo pozwolenie na budowę się opóźniło, i na końcu
oddaje sterowanie agentowi przez MCP.

Znaczniki **[F01]–[F46]** odsyłają do `FUNKCJONALNOSCI.md`.

Każda scena ma cztery wiersze:

- **Po co** — problem, który ta funkcja rozwiązuje. To jest najważniejszy
  wiersz: widz ma zrozumieć, kiedy po nią sięgnie, a nie tylko gdzie ją
  kliknąć.
- **Na ekranie** — co widać.
- **Napis** — treść napisu, po angielsku, gotowa do nagrania.
- **Pokazuje** — identyfikatory funkcji, do kontroli pokrycia.

## Ustalenia produkcyjne

| Rzecz | Ustalenie |
|---|---|
| Interfejs i napisy | angielski |
| Rozdzielczość | 1600 × 900, H.264 |
| Kursor | nakładka z widocznym wskaźnikiem, kliknięcia w bursztynowym pierścieniu |
| Skala domyślna | **Miesiąc**; Kwartał tylko tam, gdzie chodzi o cały rok |
| Dane | anonimowa budowa domu, wszystko zmyślone |
| Prompty do agenta | **widoczne na ekranie** — panel po prawej z treścią promptu i listą wywołań MCP |
| Długość | około 13 minut, pięć aktów |

Tempo: jedna myśl na napis, napis trzymany 4–5 s. Nic nie dzieje się bez
zapowiedzi — to tutorial, nie pokaz.

---

# AKT 1 — Budujemy plan ręcznie

Pusty projekt **Main House**. Widz ma zobaczyć, skąd bierze się każdy element
wykresu.

### Scena 1 · Pierwsze zadanie — `[F16]`

**Po co.** Żeby status prac był liczbą, a nie rozmową. Zadanie bez dat nie
istnieje na harmonogramie; zadanie bez postępu wymaga telefonu do brygadzisty,
zanim odpowiesz inwestorowi, na czym stoicie.

**Na ekranie.** Nowe zadanie „Topographic and soil survey". Wpisanie daty
rozpoczęcia i zakończenia, ustawienie postępu na 100 %.

**Napis.** „A task becomes a Gantt bar the moment it has a start and a due
date. Progress is a real field now — you report a number, not an opinion."

**Pokazuje.** postęp zadania `[F16]`, daty w języku interfejsu `[F46]`

### Scena 2 · Druga pozycja i pierwsza zależność — `[F11]` `[F04]`

**Po co.** Żeby kolejność prac była zapisana w narzędziu, a nie w głowie
kierownika budowy. Dopóki nie jest, każde przesunięcie terminu trzeba
przeliczać ręcznie i za każdym razem coś się pomija.

**Na ekranie.** Dodanie „Concept design". Przeciągnięcie **uchwytu z krawędzi
pierwszego słupka** na drugi. Pojawia się czerwona linia.

**Napis.** „Drag the handle on a bar's edge onto another bar. Now the tool
knows the order of work — you will not have to remember it."

**Pokazuje.** tworzenie zależności przeciągnięciem `[F11]`, linie prowadzone
rynnami między wierszami `[F04]`

### Scena 3 · Kamień milowy i zwłoka — `[F16]` `[F10]` `[F12]`

**Po co.** Kamień milowy to punkt kontrolny wobec inwestora — coś, co się
raportuje, a nie wykonuje. Zwłoka opisuje czas, w którym **nikt nie pracuje,
a czekać trzeba**: urząd wydaje decyzję, beton dojrzewa, dostawa jest w drodze.
Bez zwłoki modeluje się to fikcyjnym zadaniem „czekanie", które potem myli
w obłożeniu zasobów.

**Na ekranie.** „Planning permission granted" jako kamień milowy (romb).
Zależność od „Concept design", potem kliknięcie etykiety przy linii i wpisanie
zwłoki **+40 dni**.

**Napis.** „A milestone is a checkpoint, not work. And the forty days after it
are the council's statutory period — nobody is idle, but nobody can start."

**Pokazuje.** kamienie milowe `[F16]`, zwłoka na relacji `[F10]`, edycja typu
i zwłoki z poziomu wykresu `[F12]`

### Scena 4 · Inny typ zależności — `[F10]` `[F12]`

**Po co.** Żeby nie wydłużać planu sztucznie. Jeśli obliczenia konstrukcyjne
mogą ruszyć w trakcie projektowania, a nie po nim, a mimo to wpiszesz FS,
sam dokładasz sobie tygodnie, których nie ma w rzeczywistości.

**Na ekranie.** „Structural calculations" rusza 16 dni po **rozpoczęciu**
projektowania. Zmiana typu z Finish → Start na **Start → Start** w tym samym
oknie.

**Napis.** „Four types, not one. Use start-to-start when work overlaps —
otherwise you add weeks to your own plan that reality does not have."

**Pokazuje.** typy FS/SS/FF/SF `[F10]`, zmiana typu z wykresu `[F12]`

### Scena 5 · Próba pętli — `[F13]`

**Po co.** Pętla w zależnościach oznacza plan, którego nie da się wykonać.
Lepiej dowiedzieć się o tym w sekundzie, w której się ją rysuje, niż trzy
tygodnie później, gdy ścieżka krytyczna zwróci bzdurę.

**Na ekranie.** Próba poprowadzenia zależności z powrotem do pierwszego
zadania. Odmowa z komunikatem.

**Napis.** „Circular dependencies are rejected at the API. A plan that depends
on itself cannot be executed, and you find out now, not in month three."

**Pokazuje.** odrzucanie zależności cyklicznych `[F13]`

### Scena 6 · Podzadania i postęp ważony — `[F24]` `[F25]` `[F26]`

**Po co.** Duże etapy trzeba dzielić, żeby ktokolwiek mógł je wykonać —
ale raportować trzeba jedną liczbą. Bez ważenia czasem trwania dwutygodniowe
podzadanie liczyłoby się tak samo jak dwudniowe i postęp rodzica byłby
nieprawdziwy dokładnie wtedy, gdy zależy od niego decyzja o płatności.

**Na ekranie.** „First fix carpentry" dostaje dwa podzadania o **różnej
długości i różnym postępie**: 10 dni na 75 % i 9 dni na 20 %. Zwinięcie
rodzica. Wypełnienie słupka pokazuje **48,9 %**.

**Napis.** „Collapse the parent and it keeps the number. Not the plain average
of 47.5 — weighted by duration, 48.9. That difference is what you invoice on."

**Pokazuje.** słupki zbiorcze ze zwijaniem `[F24]`, postęp ważony czasem
trwania `[F25]`, postęp podzadań na kartach `[F26]`

### Scena 7 · Duplikowanie zamiast przepisywania — `[F41]`

**Po co.** Prace powtarzalne — kolejne piętra, kolejne segmenty — różnią się
datami, nie treścią. Przepisywanie ich od zera to strata czasu i miejsce,
w którym gubi się jedno pole.

**Na ekranie.** Powielenie zadania z menu kontekstowego karty i zmiana tytułu.

**Napis.** „Second floor, same scope, different dates. Duplicate it."

**Pokazuje.** duplikowanie zadania `[F41]`

### Scena 8 · Pola własne — `[F38]` `[F07]`

**Po co.** Kod kosztowy i branża to dane, po których się filtruje, sortuje
i rozlicza. Dopisane do tytułu zadania nadają się tylko do czytania oczami.
Kolumna na wykresie robi z nich narzędzie pracy: widzisz kod przy każdym
słupku, bez otwierania czegokolwiek.

**Na ekranie.** Założenie dwóch pól w ustawieniach projektu: **Cost code**
(tekst) i **Trade** (lista wielokrotnego wyboru). Wypełnienie na kilku
zadaniach. Powrót na wykres i **wybranie kolumny „Cost code"**.

**Napis.** „Cost codes belong in a field, not in the task title — this way you
can filter and total them. Pick one and it becomes a column on the chart."

**Pokazuje.** pole wielokrotnego wyboru `[F38]`, wybierana kolumna pola
własnego `[F07]`

### Scena 9 · Zadanie z innego projektu — `[F14]` `[F15]`

**Po co.** Zgody inwestora, przyłącza i roboty ziemne prowadzą inne zespoły,
często innym rytmem — muszą być osobnymi projektami. Ale zależności między
nimi są prawdziwe i to one przewracają terminy. Bez wiązania
międzyprojektowego każdy zespół widzi spójny plan, a całość i tak się rozjeżdża.

**Na ekranie.** Projekt **Client Approvals** z bramką „Client approval:
external finishes". Powiązanie jej z „Roof covering" w Main House. Powrót na
wykres Main House: bramka jest tam, wyszarzona, podpisana nazwą swojego
projektu.

**Napis.** „Approvals are someone else's project, but the dependency is real.
Link it, and the chart pulls that task in as a read-only row."

**Pokazuje.** wiązanie międzyprojektowe `[F14]`, wiersz zewnętrzny `[F15]`

### Scena 10 · Ograniczenie daty — `[F18]`

**Po co.** Niektóre daty biorą się z umowy z zewnątrz, nie z układu zadań.
Betoniarka jest zamówiona na konkretny dzień, a kara umowna ma konkretny
termin. Narzędzie musi wiedzieć, czego **nie wolno** przesunąć — inaczej
kaskada uprzejmie przeniesie ci termin, za który płacisz karę.

**Na ekranie.** „Pour foundations" dostaje ograniczenie **Must start on**.
Znacznik pojawia się na słupku.

**Napis.** „Three kinds: start no earlier than, finish no later than, must
start on. The concrete truck is booked — this date is not the plan's to move."

**Pokazuje.** ograniczenia SNET/FNLT/MSO `[F18]`

### Scena 11 · Plan bazowy — `[F16]`

**Po co.** Bez punktu odniesienia nie da się odpowiedzieć na jedyne pytanie,
które zadaje inwestor: „o ile się spóźniacie". Plan bazowy zapisuje się raz,
w momencie uzgodnienia, i od tej chwili każde przesunięcie ma miarę.

**Na ekranie.** Zapisanie planu bazowego na całym łańcuchu. Pod słupkami
pojawiają się cieńsze paski.

**Napis.** „Save the baseline the day the plan is agreed. From now on every
slip has a number."

**Pokazuje.** plan bazowy `[F16]`

---

# AKT 2 — Czytamy gotowy plan

Przełączenie na pełny plan **Riverside House Build** — 108 zadań, 6 projektów.

### Scena 12 · Jednostki czasu — `[F01]` `[F02]`

**Po co.** Inna skala odpowiada na inne pytanie. Dzień — co robi jutro
brygada. Tydzień — czy zdążymy przed dostawą. Miesiąc — czy etap się mieści.
Kwartał — rozmowa z inwestorem o całym roku. Jedna skala do wszystkiego
zawsze jest zła dla trzech z tych czterech rozmów.

**Na ekranie.** Dzień → Tydzień → Miesiąc → Kwartał i z powrotem na Miesiąc.

**Napis.** „Four zoom levels, four different questions. The chart picks a
starting one from the project's own date span."

**Uwaga produkcyjna.** Tu pada zdanie, że w skali Miesiąc zadania krótsze niż
mniej więcej dziesięć dni rysują się jednakowo. Nie ukrywamy tego.

**Pokazuje.** przełącznik jednostki `[F01]`, dobór domyślny `[F02]`

### Scena 13 · Przesuwanie i przybliżanie — `[F03]`

**Po co.** Bo plan roczny nie mieści się na ekranie, a szukanie paska
przewijania przy każdej zmianie kwartału zniechęca do korzystania z wykresu.

**Na ekranie.** Przeciągnięcie płótna, przybliżenie kółkiem myszy.

**Napis.** „Drag the canvas, scroll to zoom. The chart should not fight you."

**Pokazuje.** przeciąganie i przybliżanie `[F03]`

### Scena 14 · Kolumna zadań — `[F06]`

**Po co.** Cotygodniowy przegląd sprowadza się do dwóch pytań: kto to prowadzi
i co jest po terminie. Jeśli odpowiedź wymaga otwarcia trzydziestu zadań,
przegląd trwa godzinę zamiast dziesięciu minut.

**Na ekranie.** Inicjały właściciela przy każdym wierszu, czerwony chip
**Overdue** na zadaniu po terminie.

**Napis.** „Who owns it, and whether it is late — without opening anything.
That is the whole weekly review, in one column."

**Pokazuje.** awatar właściciela i znacznik po terminie `[F06]`

### Scena 15 · Podświetlanie — `[F09]`

**Po co.** Przy stu zadaniach linie zależności zlewają się w plątaninę.
Pytanie, które PM zadaje naprawdę, brzmi „co się posypie, jeśli to jedno się
opóźni" — i najechanie kursorem odpowiada na nie w sekundę.

**Na ekranie.** Najechanie na słupek w skali Miesiąc, potem to samo w skali
Kwartał, gdzie słupek jest wąski.

**Napis.** „What breaks if this one slips? Hover it. Everything unrelated
dims — and it works at Quarter scale, where the bars are a few pixels wide."

**Pokazuje.** podświetlanie, także na wąskich słupkach `[F09]`

### Scena 16 · Kalendarz roboczy — `[F20]` `[F08]`

**Po co.** Plan liczony w dniach kalendarzowych kłamie. Ekipa nie pracuje
w święta ani w soboty, a narzędzie, które tego nie wie, przesunie zadanie na
Boże Narodzenie i poda termin, którego nikt nie dotrzyma.

**Na ekranie.** Ustawienia obszaru: dni robocze i lista świąt. Dodanie przerwy
świątecznej. Powrót na wykres: kolumny są zacieniowane.

**Napis.** „Working days live on the workspace. The chart shades them, and the
cascade steps over them — so the dates it gives you are dates people can work."

**Pokazuje.** kalendarz roboczy `[F20]`, cieniowanie dni wolnych `[F08]`

### Scena 17 · Plan bazowy i poślizg — `[F17]`

**Po co.** Na raport dla inwestora nie wystarczy „jest poślizg". Potrzebna
jest liczba i kierunek — i to bez odejmowania dat ręcznie, co przy
czterdziestu zadaniach zajmuje pół godziny i generuje pomyłki.

**Na ekranie.** Etykiety „+14d" i „−7d" przy słupkach, z opisem dostępności.

**Napis.** „The baseline bar says there is drift. The label says how much, in
both directions. That is your status report, already written."

**Pokazuje.** etykieta poślizgu `[F17]`

### Scena 18 · Ścieżka krytyczna — `[F21]` `[F22]` `[F23]`

**Po co.** Ze 108 zadań o terminie końcowym decyduje kilkanaście. Tam trzeba
kierować uwagę, ludzi i pieniądze; reszta ma zapas i może poczekać. Bez tego
przyspiesza się zadania, które i tak nie były problemem.

**Na ekranie.** Przełącznik „Critical path". Podświetlenie, w tym wiersz
z innego projektu. Baner ostrzegawczy, gdy w grafie są zadania bez dat.

**Napis.** „Out of a hundred tasks, a dozen set the finish date. This is where
your attention and your money go — the rest has float."

**Uwaga produkcyjna.** Scena mówi wprost, co dziś działa źle: na planie
wpisanym ręcznie podświetlają się zadania **bez** zależności, bo luz liczony
jest w dniach kalendarzowych, nie roboczych. Pokazujemy funkcję razem
z ograniczeniem.

**Pokazuje.** ścieżka krytyczna `[F21]`, przez granicę projektu `[F22]`,
ostrzeżenie o pominiętych krawędziach `[F23]`

### Scena 19 · Skala — `[F05]`

**Po co.** Żeby duży rejestr dało się w ogóle otworzyć. Wykres, który przy
tysiącu pozycji zamiera na kilkanaście sekund, przestaje być używany
i zespół wraca do arkusza.

**Na ekranie.** Projekt z 1200 zadaniami. Przewijanie.

**Napis.** „Twelve hundred tasks. The browser holds about twenty rows at a
time. A chart nobody can open is a chart nobody uses."

**Pokazuje.** wirtualizacja wierszy `[F05]`

---

# AKT 3 — Pozwolenie się opóźnia

Oś dramaturgiczna filmu. Jedna zła wiadomość, cała reszta to reakcja.

### Scena 20 · Wiadomość — `[F19]`

**Po co.** Bo tak wygląda prawdziwa praca z harmonogramem: nie wpisywanie go
raz, tylko reagowanie na to, co przyszło z zewnątrz.

**Na ekranie.** Przeciągnięcie kamienia milowego „Planning permission granted"
o trzy tygodnie w prawo.

**Napis.** „The council needs three more weeks. Watch what moves."

**Pokazuje.** kaskada przy przeciąganiu `[F19]`

### Scena 21 · Kaskada — `[F19]` `[F20]`

**Po co.** Ręczne przesunięcie czterdziestu następników to godzina pracy
i pewność, że coś się pominie. To jest ten moment, w którym narzędzie zwraca
koszt swojego wdrożenia.

**Na ekranie.** Zwolnienie przycisku. Następniki przesuwają się łańcuchem;
żadne nowe rozpoczęcie nie wypada w dzień wolny.

**Napis.** „Forty successors moved with it, and none landed on a non-working
day. By hand that is an hour, and you would miss two of them."

**Pokazuje.** kaskada `[F19]`, omijanie dni wolnych `[F20]`

### Scena 22 · Ograniczenie stawia opór — `[F18]`

**Po co.** Żeby narzędzie nie „naprawiło" po cichu terminu, który jest
zobowiązaniem wobec kogoś z zewnątrz. Konflikt ma być widoczny i rozstrzygnięty
przez człowieka, bo to człowiek dzwoni po betoniarkę.

**Na ekranie.** Zadanie z ograniczeniem **Must start on** nie przesuwa się;
pojawia się znacznik naruszenia.

**Napis.** „The constraint held. The chart flags the conflict instead of
quietly rebooking something you cannot rebook."

**Pokazuje.** ograniczenia i ich naruszenia `[F18]`

### Scena 23 · Plan bazowy pokazuje rachunek — `[F17]`

**Po co.** Żeby w ciągu minuty odpowiedzieć na pytanie, które padnie zaraz po
tej wiadomości: ile nas to kosztowało w dniach.

**Na ekranie.** Etykiety poślizgu po kaskadzie.

**Napis.** „Three weeks at the permit became this at the end. This is what the
baseline was for."

**Pokazuje.** poślizg wobec planu bazowego `[F17]`

### Scena 24 · Nowa zależność prosto z wykresu — `[F11]` `[F12]`

**Po co.** Plan żyje. Opóźnienie wepchnęło prace w zimę, więc pojawiło się
ograniczenie, którego pół roku temu nie było. Jeśli nie trafi do modelu,
następna kaskada policzy źle — a wiara w narzędzie kończy się przy pierwszym
złym wyniku.

**Na ekranie.** Przeciągnięcie uchwytu, żeby „Winter weather protection"
blokowało „Roof covering", i ustawienie **FF +5d** przy linii.

**Napis.** „Winter was not in the plan in March. A new constraint in the real
world has to become a new edge here, or the next cascade lies to you."

**Pokazuje.** tworzenie zależności z wykresu `[F11]`, edycja typu `[F12]`

### Scena 25 · Bramka zgody klienta — `[F33]` `[F34]` `[F35]`

**Po co.** Żeby udokumentować, że **czekamy na klienta** — na co dokładnie,
od kiedy i z jakim uzasadnieniem. Przy sporze o termin to jedyny dowód,
że opóźnienie nie leży po stronie wykonawcy.

**Na ekranie.** Karta zadania „Client approval: external finishes": zmiana
statusu na **Rejected** z notatką. Powrót na wykres: na zadaniu za bramką
pojawia się ostrzeżenie.

**Napis.** „The client rejected the brick blend, and that is now on the record
with a date. The gate warns, it does not block — a deliberate v1 decision."

**Pokazuje.** bramki zgód w API `[F33]`, sterowanie w karcie `[F34]`,
ostrzeżenie na wykresie `[F35]`

### Scena 26 · Ślad audytowy — `[F31]` `[F32]` `[F29]`

**Po co.** Po pół roku nikt nie pamięta, kto przesunął termin i na jakiej
podstawie. Przy rozliczeniu, przy sporze i przy audycie liczy się zapis
z wartością przed i po, a nie czyjaś pamięć.

**Na ekranie.** Dziennik obszaru roboczego. Wpisy z ostatnich dwóch minut:
zmiana harmonogramu, nowa relacja, zmiana statusu zgody.

**Napis.** „Six months from now nobody remembers who moved that date. The log
does — with the value before and the value after."

**Uwaga produkcyjna.** Mówimy też, że widok streszcza zmianę planu jako
„updated the plan", choć dane przed/po są zapisane — poz. 1
w `POPRAWKI-KANEO.md`.

**Pokazuje.** rejestrowanie zmian planu i relacji `[F31]`, nowe typy zdarzeń
w widoku `[F32]`, dziennik obszaru `[F29]`

### Scena 27 · Eksport dziennika — `[F30]`

**Po co.** Bo audytor i prawnik nie dostaną konta w narzędziu, a dowód musi
dać się załączyć do pisma.

**Na ekranie.** Przycisk „Export", plik CSV z wartościami przed/po.

**Napis.** „Your auditor will not get a login. The log exports."

**Pokazuje.** eksport dziennika i retencja `[F30]`

---

# AKT 4 — Agent prowadzi plan przez MCP

Panel po prawej pokazuje **prompt wpisany do agenta**, a pod nim wywołania MCP,
które agent wykonał. Wykres zostaje widoczny po lewej.

### Scena 28 · Pierwszy prompt — `[F43]` `[F45]`

**Po co.** Przeplanowanie po każdej zmianie na budowie to praca powtarzalna
i dobrze opisana — czyli taka, którą da się zlecić. Zamiast dwudziestu
kliknięć: jedno zdanie. To samo API obsługuje integrację z systemem
kosztowym albo z arkuszem, który i tak ktoś prowadzi.

**Prompt na ekranie.**
> „Winter protection needs to start two weeks earlier. Move it, and make roof
> covering depend on it, finish-to-finish with five days of lag."

**Na ekranie.** Wywołania `update_task` i `create_task_relation`. Wykres
**zmienia się bez odświeżania strony**.

**Napis.** „Forty-seven tools over MCP. One sentence instead of twenty clicks
— and the chart picks the change up over the websocket, no reload."

**Pokazuje.** pola Gantta przez MCP `[F43]`, odświeżanie sterowane zdarzeniami
`[F45]`

### Scena 29 · Drugi prompt: pola własne — `[F36]` `[F37]`

**Po co.** Kody kosztowe wpisuje się seriami, po dziesięć zadań naraz, zwykle
przepisując je z innego systemu. To jest dokładnie ta praca, przy której
człowiek się myli, a agent nie.

**Prompt na ekranie.**
> „Set the cost code to 2410-ROO on every roofing task, and tag them Carpentry."

**Na ekranie.** `list_project_custom_fields`, `set_task_custom_field_value`,
potem `get_task` z wartością. Kolumna na wykresie się zmienia.

**Napis.** „Ten tasks, one field, copied from another system. This is the work
people get wrong."

**Pokazuje.** pola własne w MCP `[F36]`, wartości w odczycie `[F37]`

### Scena 30 · Trzeci prompt: plan bazowy i kalendarz — `[F43]` `[F20]`

**Po co.** Po uzgodnieniu nowego terminu plan bazowy trzeba zapisać ponownie
— na całym łańcuchu, nie na jednym zadaniu. Klikanie tego po kolei to
najnudniejsza czynność w całym narzędziu.

**Prompt na ekranie.**
> „Re-baseline the whole roofing chain, and add the 24th of December as a
> holiday."

**Na ekranie.** `set_task_baseline` ×n, `add_workspace_holiday`. Na wykresie
pojawia się nowa zacieniowana kolumna.

**Napis.** „Re-baselining a chain task by task is the dullest job in here.
Baselines and the calendar are both reachable from the agent."

**Pokazuje.** plan bazowy i kalendarz przez MCP `[F43]`, kalendarz roboczy
`[F20]`

### Scena 31 · Zbiorcza zmiana postępu — `[F39]` `[F40]`

**Po co.** Po tygodniu na budowie aktualizuje się dwadzieścia zadań naraz,
zwykle o tę samą wartość. Otwieranie każdego z osobna to powód, dla którego
postęp w większości narzędzi jest nieaktualny.

**Na ekranie.** Zaznaczenie kilku zadań w widoku listy, ustawienie postępu
jedną operacją. Potem wpisanie dokładnej wartości w karcie jednego zadania.

**Napis.** „Twenty tasks, same bump, one operation. Or an exact number on the
one task that is different."

**Pokazuje.** zbiorcza zmiana postępu `[F39]`, wpisanie dokładnej wartości
`[F40]`

### Scena 32 · Ten sam zestaw narzędzi lokalnie — `[F44]`

**Po co.** Nie każdy chce wystawiać API na zewnątrz. Pakiet stdio pozwala
prowadzić ten sam plan agentem uruchomionym na własnej maszynie.

**Na ekranie.** Krótkie ujęcie pakietu stdio `packages/mcp`.

**Napis.** „The same forty-seven tools ship as a stdio package — no exposed
endpoint needed."

**Pokazuje.** zgodność pakietu stdio `[F44]`

---

# AKT 5 — Widok z góry

### Scena 33 · Portfel — `[F27]`

**Po co.** Rozmowa z zarządem nie dotyczy jednej budowy. Dopóki każdy projekt
ma własną oś czasu, obraz całości powstaje w arkuszu obok — i rozjeżdża się
z danymi w tym samym tygodniu.

**Na ekranie.** Sześć projektów na jednej osi, w skali Miesiąc.

**Napis.** „Every project on one axis. This is the picture you used to keep in
a spreadsheet next to the tool."

**Uwaga produkcyjna.** Mówimy, że linie zależności między projektami tu nie są
rysowane — poz. 6 w `POPRAWKI-KANEO.md`.

**Pokazuje.** portfel `[F27]`

### Scena 34 · Obłożenie zasobów — `[F28]`

**Po co.** Harmonogram mówi, kiedy praca ma się wydarzyć. Nie mówi, czy jest
kto ma ją wykonać. Przeciążenie widać zwykle dopiero wtedy, gdy termin już
przepadł.

**Na ekranie.** Osoba × tydzień, zmiana progu przeciążenia, podświetlone
komórki.

**Napis.** „A schedule says when work should happen. It does not say whether
anyone is free to do it. This does."

**Pokazuje.** obłożenie zasobów `[F28]`

### Scena 35 · Eksport planu — `[F42]`

**Po co.** Plan trzeba oddać: do systemu klienta, do archiwum projektu,
do kosztorysanta. Eksport bez typów zależności i planu bazowego to nie plan,
tylko lista zadań.

**Na ekranie.** `GET /api/task/export/{projectId}` i pola w odpowiedzi.

**Napis.** „The export carries the Gantt fields and the relations now, with
type and lag. Without those it is a task list, not a plan."

**Pokazuje.** eksport planu `[F42]`

### Scena 36 · Zamknięcie

**Po co.** Żeby widz wiedział, ile tego było, czego film nie pokazał i gdzie
szukać szczegółów. Tutorial bez zakończenia zostawia wrażenie, że coś się
urwało.

**Napis.** „That is the whole set: forty-six changes across the chart, the
schedule engine, the workspace views, approval gates, custom fields and MCP."

**Napis.** „Four of them still need work. They are listed in the notes next to
this video, with the file and the line."

---

## Kontrola pokrycia

| Akt | Funkcje pokazane |
|---|---|
| 1 | F04, F07, F10, F11, F12, F13, F14, F15, F16, F18, F24, F25, F26, F38, F41, F46 |
| 2 | F01, F02, F03, F05, F06, F08, F09, F17, F20, F21, F22, F23 |
| 3 | F11, F12, F17, F18, F19, F20, F29, F30, F31, F32, F33, F34, F35 |
| 4 | F20, F36, F37, F39, F40, F43, F44, F45 |
| 5 | F27, F28, F42 |

**Wszystkie F01–F46 mają przypisaną scenę.** Funkcje powtarzające się
(F11, F12, F17, F18, F19, F20) są tam pokazane w innym zastosowaniu,
nie powtórzone.

## Czego scenariusz świadomie nie ukrywa

Cztery sceny mówią wprost o tym, co działa źle: 12 (próg 20 px w skali
Miesiąc), 18 (ścieżka krytyczna liczy luz w dniach kalendarzowych),
26 („updated the plan" zamiast wartości przed/po), 33 (portfel bez linii
zależności). To tutorial dla osób, które będą tego używać — przemilczenie
kosztowałoby więcej niż przyznanie.
