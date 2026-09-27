# Scenariusz filmu: tutorial po nowych funkcjach Kaneo

Film budujący. Zaczyna od pustego projektu, dokłada zadania po jednym —
**każde dodanie pokazuje coś innego** — potem czyta gotowy plan na wykresie,
przesuwa cały harmonogram, bo pozwolenie na budowę się opóźniło, i na końcu
oddaje sterowanie agentowi przez MCP.

Znaczniki **[F01]–[F46]** odsyłają do `FUNKCJONALNOSCI.md`. Każda scena ma
wypisane funkcje, które pokazuje, żeby dało się sprawdzić, czy czegoś nie
pominęliśmy.

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

Tempo: jedna myśl na napis, napis trzymany 4–5 s. Nic nie dzieje się
bez zapowiedzi — to tutorial, nie pokaz.

---

# AKT 1 — Budujemy plan ręcznie

Pusty projekt **Main House**. Widz ma zobaczyć, skąd bierze się każdy element
wykresu.

### Scena 1 · Pierwsze zadanie — `[F16]`
**Na ekranie.** Nowe zadanie „Topographic and soil survey". Wpisanie daty
rozpoczęcia i zakończenia, ustawienie postępu na 100 %.
**Napis.** „A task becomes a Gantt bar the moment it has a start and a due date.
Progress is a first-class field now, not a label."
**Pokazuje.** postęp zadania `[F16]`, daty renderowane w języku interfejsu `[F46]`

### Scena 2 · Drugie zadanie i pierwsza zależność — `[F11]` `[F04]`
**Na ekranie.** Dodanie „Concept design". Przeciągnięcie **uchwytu z krawędzi
pierwszego słupka** na drugi. Pojawia się czerwona linia.
**Napis.** „Drag the handle on a bar's edge onto another bar. That is a blocking
dependency — no dialog, no task card."
**Pokazuje.** tworzenie zależności przeciągnięciem `[F11]`, linie zależności
prowadzone rynnami między wierszami `[F04]`

### Scena 3 · Kamień milowy i zwłoka — `[F16]` `[F10]` `[F12]`
**Na ekranie.** „Planning permission granted" jako **kamień milowy** (romb).
Zależność od „Concept design", potem kliknięcie etykiety przy linii i wpisanie
zwłoki **+40 dni** — ustawowy czas na decyzję.
**Napis.** „A milestone is a task with the same start and due date. And this
label is a button: lag goes in here, in days."
**Pokazuje.** kamienie milowe `[F16]`, zwłoka na relacji `[F10]`, edycja typu
i zwłoki z poziomu wykresu `[F12]`

### Scena 4 · Inny typ zależności — `[F10]` `[F12]`
**Na ekranie.** „Structural calculations" nie czeka na koniec projektowania,
tylko rusza 16 dni po jego **rozpoczęciu**. Zmiana typu z Finish → Start
na **Start → Start** w tym samym oknie.
**Napis.** „Four types, not one: finish to start, start to start, finish to
finish, start to finish. Real plans need all four."
**Pokazuje.** typy FS/SS/FF/SF `[F10]`, zmiana typu z wykresu `[F12]`

### Scena 5 · Próba pętli — `[F13]`
**Na ekranie.** Próba poprowadzenia zależności z powrotem do pierwszego zadania.
Odmowa z komunikatem.
**Napis.** „Circular dependencies are rejected at the API, not just hidden in
the UI."
**Pokazuje.** odrzucanie zależności cyklicznych `[F13]`

### Scena 6 · Podzadania i postęp ważony — `[F24]` `[F25]` `[F26]`
**Na ekranie.** „First fix carpentry" dostaje dwa podzadania o **różnej
długości i różnym postępie**: 10 dni na 75 % i 9 dni na 20 %. Zwinięcie
rodzica. Wypełnienie słupka pokazuje **48,9 %**.
**Napis.** „Collapse the parent and it keeps the number. Not the plain average
of 47.5 — the duration-weighted 48.9."
**Pokazuje.** słupki zbiorcze ze zwijaniem `[F24]`, postęp ważony czasem
trwania `[F25]`, postęp podzadań na kartach `[F26]`

### Scena 7 · Duplikowanie zamiast przepisywania — `[F41]`
**Na ekranie.** Powielenie zadania z menu kontekstowego karty i zmiana tytułu.
**Napis.** „Two similar tasks? Duplicate the first one."
**Pokazuje.** duplikowanie zadania `[F41]`

### Scena 8 · Pola własne — `[F38]` `[F07]`
**Na ekranie.** Założenie dwóch pól w ustawieniach projektu: **Cost code**
(tekst) i **Trade** (lista wielokrotnego wyboru). Wypełnienie na kilku
zadaniach. Powrót na wykres i **wybranie kolumny „Cost code"** w kolumnie zadań.
**Napis.** „Custom fields are not just a task-card thing. Pick one and it becomes
a column on the chart rail."
**Pokazuje.** pole wielokrotnego wyboru `[F38]`, wybierana kolumna pola
własnego `[F07]`

### Scena 9 · Zadanie z innego projektu — `[F14]` `[F15]`
**Na ekranie.** Projekt **Client Approvals** z bramką „Client approval:
external finishes". Powiązanie jej z „Roof covering" w Main House. Powrót na
wykres Main House: bramka **jest tam**, wyszarzona, podpisana nazwą swojego
projektu.
**Napis.** „Link a task from another project in the same workspace. The chart
pulls it in as a read-only external row, so the line has somewhere to land."
**Pokazuje.** wiązanie międzyprojektowe `[F14]`, wiersz zewnętrzny `[F15]`

### Scena 10 · Ograniczenie daty — `[F18]`
**Na ekranie.** „Pour foundations" dostaje ograniczenie **Must start on** —
betoniarka zamówiona na konkretny dzień. Znacznik pojawia się na słupku.
**Napis.** „Three constraint kinds: start no earlier than, finish no later
than, must start on. The concrete truck is booked — this one cannot float."
**Pokazuje.** ograniczenia SNET/FNLT/MSO `[F18]`

### Scena 11 · Plan bazowy — `[F16]`
**Na ekranie.** Zapisanie planu bazowego na całym łańcuchu. Pod słupkami
pojawiają się cieńsze paski.
**Napis.** „Save a baseline now. It is the line you will be judged against."
**Pokazuje.** plan bazowy `[F16]`

---

# AKT 2 — Czytamy gotowy plan

Przełączenie na pełny plan **Riverside House Build** — 108 zadań, 6 projektów.

### Scena 12 · Jednostki czasu — `[F01]` `[F02]`
**Na ekranie.** Dzień → Tydzień → Miesiąc → Kwartał i z powrotem na Miesiąc.
**Napis.** „Four zoom levels. The chart picks one for you from the project's
own date span — you rarely have to think about it."
**Uwaga produkcyjna.** Tu pada zdanie o tym, że w skali Miesiąc zadania krótsze
niż mniej więcej dziesięć dni rysują się jednakowo. Nie ukrywamy tego.
**Pokazuje.** przełącznik jednostki `[F01]`, dobór domyślny `[F02]`

### Scena 13 · Przesuwanie i przybliżanie — `[F03]`
**Na ekranie.** Przeciągnięcie płótna, przybliżenie kółkiem myszy.
**Napis.** „Drag the canvas, scroll to zoom."
**Pokazuje.** przeciąganie i przybliżanie `[F03]`

### Scena 14 · Kolumna zadań — `[F06]`
**Na ekranie.** Inicjały właściciela przy każdym wierszu, czerwony chip
**Overdue** na zadaniu po terminie.
**Napis.** „Who owns it, and whether it is late — without opening anything."
**Pokazuje.** awatar właściciela i znacznik po terminie `[F06]`

### Scena 15 · Podświetlanie — `[F09]`
**Na ekranie.** Najechanie na słupek w skali Miesiąc, potem **to samo w skali
Kwartał**, gdzie słupek jest wąski.
**Napis.** „Hover dims everything unrelated. It works at Quarter scale too,
where the bars are only a few pixels wide."
**Pokazuje.** podświetlanie, także na wąskich słupkach `[F09]`

### Scena 16 · Kalendarz roboczy — `[F20]` `[F08]`
**Na ekranie.** Ustawienia obszaru: dni robocze i lista świąt. Dodanie
**przerwy świątecznej**. Powrót na wykres: kolumny są zacieniowane.
**Napis.** „Working days and holidays live on the workspace. The chart shades
them, and — you will see in a minute — the cascade steps over them."
**Pokazuje.** kalendarz roboczy `[F20]`, cieniowanie dni wolnych `[F08]`

### Scena 17 · Plan bazowy i poślizg — `[F17]`
**Na ekranie.** Etykiety „+14d" i „−7d" przy słupkach, z opisem dostępności.
**Napis.** „The baseline bar tells you there is drift. The label tells you how
much — in both directions."
**Pokazuje.** etykieta poślizgu `[F17]`

### Scena 18 · Ścieżka krytyczna — `[F21]` `[F22]` `[F23]`
**Na ekranie.** Przełącznik „Critical path". Podświetlenie, w tym wiersz
z innego projektu. Baner ostrzegawczy, gdy w grafie są zadania bez dat.
**Napis.** „The critical path crosses project boundaries, and it tells you when
it had to drop an edge it could not resolve."
**Uwaga produkcyjna.** Scena mówi wprost, co dziś działa źle: na planie
wpisanym ręcznie podświetlają się zadania **bez** zależności, bo luz liczony
jest w dniach kalendarzowych, nie roboczych. Pokazujemy funkcję razem
z jej ograniczeniem.
**Pokazuje.** ścieżka krytyczna `[F21]`, przez granicę projektu `[F22]`,
ostrzeżenie o pominiętych krawędziach `[F23]`

### Scena 19 · Skala — `[F05]`
**Na ekranie.** Projekt z 1200 zadaniami. Przewijanie.
**Napis.** „Twelve hundred tasks. The browser holds about twenty rows at a
time, not twelve hundred."
**Pokazuje.** wirtualizacja wierszy `[F05]`

---

# AKT 3 — Pozwolenie się opóźnia

Oś dramaturgiczna filmu. Jedna zła wiadomość, cała reszta filmu to reakcja.

### Scena 20 · Wiadomość — `[F19]`
**Na ekranie.** Przeciągnięcie kamienia milowego „Planning permission granted"
o trzy tygodnie w prawo.
**Napis.** „The council needs three more weeks. Watch what moves."
**Pokazuje.** kaskada przy przeciąganiu `[F19]`

### Scena 21 · Kaskada — `[F19]` `[F20]`
**Na ekranie.** Zwolnienie przycisku. Następniki przesuwają się łańcuchem;
żadne nowe rozpoczęcie nie wypada w dzień wolny.
**Napis.** „Everything downstream moved with it, and nothing landed on a
non-working day."
**Pokazuje.** kaskada `[F19]`, omijanie dni wolnych `[F20]`

### Scena 22 · Ograniczenie stawia opór — `[F18]`
**Na ekranie.** Zadanie z ograniczeniem **Must start on** nie przesuwa się;
pojawia się znacznik naruszenia.
**Napis.** „The constraint held. The chart flags the conflict instead of
silently breaking the booking."
**Pokazuje.** ograniczenia i ich naruszenia `[F18]`

### Scena 23 · Plan bazowy pokazuje rachunek — `[F17]`
**Na ekranie.** Etykiety poślizgu po kaskadzie.
**Napis.** „This is what the baseline was for."
**Pokazuje.** poślizg wobec planu bazowego `[F17]`

### Scena 24 · Nowa zależność prosto z wykresu — `[F11]` `[F12]`
**Na ekranie.** Opóźnienie wymusza nową kolejność: przeciągnięcie uchwytu,
żeby „Winter weather protection" blokowało „Roof covering", i ustawienie
**FF +5d** przy linii.
**Napis.** „A new constraint in the real world becomes a new edge here — drawn
on the chart, typed on the chart."
**Pokazuje.** tworzenie zależności z wykresu `[F11]`, edycja typu `[F12]`

### Scena 25 · Bramka zgody klienta — `[F33]` `[F34]` `[F35]`
**Na ekranie.** Karta zadania „Client approval: external finishes": zmiana
statusu na **Rejected** z notatką. Powrót na wykres: na zadaniu za bramką
pojawia się ostrzeżenie.
**Napis.** „The client rejected the brick blend. The gate does not block the
schedule — it warns. That is a deliberate v1 decision, and worth knowing."
**Pokazuje.** bramki zgód w API `[F33]`, sterowanie w karcie `[F34]`,
ostrzeżenie na wykresie `[F35]`

### Scena 26 · Ślad audytowy — `[F31]` `[F32]` `[F29]`
**Na ekranie.** Dziennik obszaru roboczego. Wpisy z ostatnich dwóch minut:
zmiana harmonogramu, nowa relacja, zmiana statusu zgody.
**Napis.** „Every one of those edits is in the log, with the value before and
the value after."
**Uwaga produkcyjna.** Mówimy też, że widok streszcza zmianę planu jako
„updated the plan", choć dane przed/po są zapisane — to poz. 1
w `POPRAWKI-KANEO.md`.
**Pokazuje.** rejestrowanie zmian planu i relacji `[F31]`, nowe typy zdarzeń
w widoku `[F32]`, dziennik obszaru `[F29]`

### Scena 27 · Eksport dziennika — `[F30]`
**Na ekranie.** Przycisk „Export", plik CSV z wartościami przed/po.
**Napis.** „And it exports, so the audit does not have to happen on my screen."
**Pokazuje.** eksport dziennika i retencja `[F30]`

---

# AKT 4 — Agent prowadzi plan przez MCP

Panel po prawej stronie ekranu pokazuje **prompt wpisany do agenta**, a pod nim
wywołania MCP, które agent wykonał. Wykres zostaje widoczny po lewej.

### Scena 28 · Pierwszy prompt — `[F43]` `[F45]`
**Prompt na ekranie.**
> „Winter protection needs to start two weeks earlier. Move it, and make roof
> covering depend on it, finish-to-finish with five days of lag."

**Na ekranie.** Wywołania: `update_task`, `create_task_relation`.
Wykres **zmienia się bez odświeżania strony**.
**Napis.** „Forty-seven tools over MCP. Dates, dependency types, lag — all of
it writes. And the chart picks the change up over the websocket, no reload."
**Pokazuje.** pola Gantta przez MCP `[F43]`, odświeżanie sterowane zdarzeniami
`[F45]`

### Scena 29 · Drugi prompt: pola własne — `[F36]` `[F37]`
**Prompt na ekranie.**
> „Set the cost code to 2410-ROO on every roofing task, and tag them Carpentry."

**Na ekranie.** `list_project_custom_fields`, `set_task_custom_field_value`,
potem `get_task` pokazujące wartość. Kolumna na wykresie się zmienia.
**Napis.** „Custom fields read and write over MCP too, and they come back in
get_task and list_tasks."
**Pokazuje.** pola własne w MCP `[F36]`, wartości w odczycie `[F37]`

### Scena 30 · Trzeci prompt: plan bazowy i kalendarz — `[F43]` `[F20]`
**Prompt na ekranie.**
> „Re-baseline the whole roofing chain, and add the 24th of December as a
> holiday."

**Na ekranie.** `set_task_baseline` ×n, `add_workspace_holiday`. Na wykresie
pojawia się nowa zacieniowana kolumna.
**Napis.** „Baselines and the working calendar are reachable from the agent as
well."
**Pokazuje.** plan bazowy i kalendarz przez MCP `[F43]`, kalendarz roboczy
`[F20]`

### Scena 31 · Zbiorcza zmiana postępu — `[F39]` `[F40]`
**Na ekranie.** Zaznaczenie kilku zadań w widoku listy, ustawienie postępu
jedną operacją. Potem wpisanie dokładnej wartości w karcie jednego zadania.
**Napis.** „Progress in bulk, or an exact number on one task."
**Pokazuje.** zbiorcza zmiana postępu `[F39]`, wpisanie dokładnej wartości
`[F40]`

### Scena 32 · Ten sam zestaw narzędzi lokalnie — `[F44]`
**Na ekranie.** Krótkie ujęcie pakietu stdio `packages/mcp`.
**Napis.** „The same forty-seven tools ship as a stdio package, so an agent on
your own machine drives the same plan."
**Pokazuje.** zgodność pakietu stdio `[F44]`

---

# AKT 5 — Widok z góry

### Scena 33 · Portfel — `[F27]`
**Na ekranie.** Sześć projektów na jednej osi, w skali Miesiąc.
**Napis.** „Every project in the workspace on one axis."
**Uwaga produkcyjna.** Mówimy, że linie zależności między projektami tu nie są
rysowane — poz. 6 w `POPRAWKI-KANEO.md`.
**Pokazuje.** portfel `[F27]`

### Scena 34 · Obłożenie zasobów — `[F28]`
**Na ekranie.** Osoba × tydzień, zmiana progu przeciążenia, podświetlone komórki.
**Napis.** „Who is over the line, and in which week."
**Pokazuje.** obłożenie zasobów `[F28]`

### Scena 35 · Eksport planu — `[F42]`
**Na ekranie.** `GET /api/task/export/{projectId}` i pola w odpowiedzi.
**Napis.** „The export carries the Gantt fields and the relations now, with
type and lag."
**Pokazuje.** eksport planu `[F42]`

### Scena 36 · Zamknięcie
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

**Wszystkie F01–F46 mają przypisaną scenę.** Funkcje powtarzające się w kilku
aktach (F11, F12, F17, F18, F19, F20) są tam pokazane w innym zastosowaniu,
nie powtórzone.

## Czego scenariusz świadomie nie ukrywa

Trzy sceny mówią wprost o tym, co działa źle: 12 (próg 20 px w skali Miesiąc),
18 (ścieżka krytyczna liczy luz w dniach kalendarzowych), 26 („updated the
plan" zamiast wartości przed/po), 33 (portfel bez linii zależności).
To tutorial dla osób, które będą tego używać — przemilczenie kosztowałoby
więcej niż przyznanie.
