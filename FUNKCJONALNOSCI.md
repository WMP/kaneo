# Kaneo — nowe funkcjonalności na gałęzi `claude/integration-all`

Stan na commit `555613a5`. Lista wyprowadzona z 199 commitów względem `main`,
a nie z pamięci: każda pozycja ma commit albo miejsce w kodzie.

Zakres: **planowanie, wykres Gantta, MCP, ślad audytowy, widoki obszaru
roboczego i wydajność**. Poza listą zostawiam rzeczy, które przyszły na tę
gałąź przy okazji i nie należą do naszego zakresu — integracja GitLab,
tła projektów, ekran zmiany hasła, subskrypcje kalendarza, skanowanie
sekretów w CI.

Identyfikatory **F01–F46** są używane w `SCENARIUSZ-TUTORIAL.md`, żeby
w każdej scenie było widać, którą funkcję pokazuje.

---

## A. Wykres Gantta — podstawa widoku

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F01** | Przełącznik jednostki czasu **Dzień / Tydzień / Miesiąc / Kwartał** | pasek narzędzi nad wykresem |
| **F02** | Domyślna jednostka dobierana z rozpiętości dat projektu | pierwsze wejście na wykres |
| **F03** | Przeciąganie płótna i przybliżanie kółkiem myszy | obszar wykresu |
| **F04** | Linie zależności rysowane na wykresie, prowadzone rynnami między wierszami zamiast w poprzek słupków | obszar wykresu |
| **F05** | Wirtualizacja wierszy dla dużych tablic | projekt z 1200 zadaniami: 10–24 słupki w DOM |
| **F06** | Awatar właściciela i znacznik **Overdue** w kolumnie zadań | lewa kolumna |
| **F07** | Wybierana kolumna pola własnego w kolumnie zadań | lista rozwijana obok jednostki czasu |
| **F08** | Cieniowanie dni wolnych, z kontrastem naprawionym dla trybu ciemnego (10 %) | tło kolumn |
| **F09** | Podświetlanie po najechaniu — działa także na wąskich słupkach w skali Kwartał | najechanie na słupek |

## B. Zależności

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F10** | Typy zależności **FS / SS / FF / SF** ze zwłoką na relacjach „blokuje" | etykieta przy linii |
| **F11** | Tworzenie zależności przeciągnięciem z uchwytu na słupku | krawędź słupka |
| **F12** | Typ zależności widoczny na wykresie i **edytowalny z poziomu wykresu**, z rozsunięciem etykiet przy rozgałęzieniu | kliknięcie etykiety „FS +10d" |
| **F13** | Odrzucanie zależności cyklicznych (blokuje i podzadania) | komunikat przy próbie |
| **F14** | Wiązanie zadań z innych projektów tego samego obszaru roboczego | wybierak relacji w karcie zadania |
| **F15** | Zadanie z innego projektu rysowane jako **wiersz zewnętrzny** — wyszarzony, z nazwą projektu, tylko do odczytu | wykres projektu |

## C. Harmonogram

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F16** | Postęp zadania, kamienie milowe, plan bazowy | słupek i karta zadania |
| **F17** | Etykieta poślizgu wobec planu bazowego w dniach, w obie strony | „+14d", „−7d" przy słupku |
| **F18** | Ograniczenia dat **SNET / FNLT / MSO** | znacznik na słupku |
| **F19** | Kaskadowe przeplanowanie następników przy przeciąganiu i zmianie długości | po puszczeniu słupka |
| **F20** | Kalendarz roboczy obszaru: dni robocze i święta, z cieniowaniem i omijaniem przez kaskadę | ustawienia obszaru + wykres |
| **F21** | Podświetlanie ścieżki krytycznej | przełącznik „Critical path" |
| **F22** | Ścieżka krytyczna przechodząca przez granicę projektu | jw. |
| **F23** | Ostrzeżenie, gdy ścieżka krytyczna pomija zależności międzyprojektowe albo zadania bez dat | baner nad wykresem |
| **F24** | Słupki zbiorcze podzadań ze zwijaniem i rozwijaniem | wiersz rodzica |
| **F25** | Postęp na słupku zbiorczym **ważony czasem trwania** | wypełnienie słupka rodzica |
| **F26** | Postęp podzadań na kartach i w wierszach listy | tablica i lista |

## D. Widoki obszaru roboczego

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F27** | **Portfel** — wspólna oś czasu dla wszystkich projektów obszaru | menu boczne → Portfolio |
| **F28** | **Obłożenie zasobów** — osoba × tydzień, z konfigurowalnym progiem przeciążenia | menu boczne → Workload |
| **F29** | **Dziennik aktywności obszaru roboczego** z filtrami | menu boczne → Activity |
| **F30** | Eksport dziennika do CSV i JSON oraz ustawienie retencji | przycisk „Export" |
| **F31** | Rejestrowanie zmian harmonogramu i planu oraz tworzenia i usuwania relacji | wpisy w dzienniku |
| **F32** | Nowe typy zdarzeń renderowane w dzienniku, łącznie ze zbiorczą zmianą postępu | jw. |

## E. Bramki zgód klientów

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F33** | Kolumny bramki zgody w tabeli zadań i obsługa w API | `PUT /api/task/approval/{id}` |
| **F34** | Sterowanie bramką w karcie zadania: cztery statusy i notatka | karta zadania |
| **F35** | Ostrzeżenie na wykresie przy zadaniu za niezatwierdzoną bramką | chip „Gate" na słupku |

## F. Pola własne

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F36** | Pola własne dostępne przez MCP do odczytu i zapisu | `list_project_custom_fields`, `set_task_custom_field_value` |
| **F37** | Wartości pól własnych w `get_task` i `list_tasks` | odpowiedź MCP |
| **F38** | Pole własne typu wielokrotny wybór | ustawienia projektu |

## G. Operacje na zadaniach

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F39** | Zbiorcza zmiana postępu | pasek zaznaczenia wielokrotnego |
| **F40** | Wpisanie dokładnej wartości postępu z potwierdzeniem | karta zadania |
| **F41** | Duplikowanie zadania z menu kontekstowego karty | menu „…" |
| **F42** | Eksport planu z polami Gantta i relacjami | `GET /api/task/export/{projectId}` |

## H. MCP

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F43** | Pola Gantta przestały być po cichu gubione przez MCP po HTTP — typ zależności, zwłoka, postęp, kamień milowy, plan bazowy, ograniczenia, kalendarz | sesja MCP, **47 narzędzi** |
| **F44** | Te same poprawki przeniesione do pakietu stdio `packages/mcp` | oba rejestry zgodne |

## I. Wydajność i praca na żywo

| # | Funkcjonalność | Gdzie widać |
|---|---|---|
| **F45** | Koniec odpytywania listy zadań — odświeżanie sterowane zdarzeniami; WebSocket wznawia się i nadrabia zaległości po zerwaniu połączenia | zakładka sieci |
| **F46** | Daty renderowane w języku interfejsu; buforowane formatery `Intl` | cały interfejs |

---

## Czego na tej liście nie ma, a bywa mylone z naszym zakresem

Integracja GitLab (18 commitów), tła projektów, ekran zmiany hasła,
subskrypcje kalendarza z filtrem etykiet, przenoszenie projektu między
obszarami, skalowanie obrazów w opisie zadania, zewnętrzne odnośniki,
skanowanie sekretów i audyt przepływów w CI. To są zmiany z tej samej gałęzi,
ale spoza zakresu, który badałem.

---

## Stan każdej funkcji po przebiegu testowym

Pełne pomiary: `RAPORT-KANEO-DLA-MAINTAINEROW.md`. Skrót:

| Stan | Funkcje |
|---|---|
| **działa, potwierdzone kliknięciem lub pomiarem** | F01–F12, F14–F21, F24, F25, F27–F31, F33–F37, F39–F43, F45, F46 |
| **działa częściowo** | F22, F23 (ścieżka krytyczna liczy luz w dniach kalendarzowych, więc na planie wpisanym ręcznie podświetla zadania bez zależności zamiast łańcucha — poz. 5 w `POPRAWKI-KANEO.md`) |
| **działa, ale niewidoczne tam, gdzie trzeba** | F35 na kamieniach milowych — odznaka statusu renderuje się tylko w gałęzi zwykłego słupka |
| **niesprawdzone** | F13 (cykle), F26, F38, F44 — nie zdążyłem ich przeklikać w tym przebiegu |

---

## Załącznik — zrzuty ekranu

Katalog `zrzuty-funkcje/`. Wszystkie z uruchomionej instancji na commicie
`555613a5`, interfejs angielski, plan „Riverside House Build".

| Funkcje | Zrzut |
|---|---|
| F01, F02 | ![Jednostki czasu, skala Miesiąc](zrzuty-funkcje/F01-F02-jednostki-czasu-miesiac.png) |
| F01 | ![Ta sama część planu w skali Tydzień](zrzuty-funkcje/F01-jednostki-czasu-tydzien.png) |
| F03 | ![Po przeciągnięciu płótna i przybliżeniu](zrzuty-funkcje/F03-przeciaganie-i-przyblizanie.png) |
| F04, F16 | ![Linie zależności na planie](zrzuty-funkcje/F04-linie-zaleznosci-i-plan.png) |
| F05 | ![1200 zadań, wirtualizacja wierszy](zrzuty-funkcje/F05-wirtualizacja-1200-zadan.png) |
| F06 | ![Inicjały właściciela i znacznik Overdue](zrzuty-funkcje/F06-wlasciciel-i-overdue.png) |
| F07 | ![Kolumna pola własnego w kolumnie zadań](zrzuty-funkcje/F07-kolumna-pola-wlasnego.png) |
| F08 | ![Cieniowanie dni wolnych w skali Dzień](zrzuty-funkcje/F08-cieniowanie-dni-wolnych.png) |
| F09 | ![Podświetlanie po najechaniu w skali Kwartał](zrzuty-funkcje/F09-podswietlanie-kwartal.png) |
| F10, F12 | ![Okno typu zależności i zwłoki](zrzuty-funkcje/F10-F12-edycja-typu-zaleznosci.png) |
| F15 | ![Wiersz zewnętrzny z innego projektu](zrzuty-funkcje/F15-wiersz-zewnetrzny-z-innego-projektu.png) |
| F17 | ![Poślizg wobec planu bazowego](zrzuty-funkcje/F17-poslizg-planu-bazowego.png) |
| F18 | ![Ograniczenie „finish no later than"](zrzuty-funkcje/F18-ograniczenie-finish-no-later-than.png) |
| F20 | ![Kalendarz roboczy obszaru](zrzuty-funkcje/F20-kalendarz-roboczy-obszaru.png) |
| F21, F22 | ![Ścieżka krytyczna](zrzuty-funkcje/F21-F22-sciezka-krytyczna.png) |
| F24, F25 | ![Słupek zbiorczy podzadań](zrzuty-funkcje/F24-F25-slupek-zbiorczy-podzadan.png) |
| F27 | ![Portfel](zrzuty-funkcje/F27-portfel.png) |
| F28 | ![Obłożenie zasobów](zrzuty-funkcje/F28-obciazenie-zasobow.png) |
| F29, F30 | ![Dziennik obszaru roboczego z eksportem](zrzuty-funkcje/F29-F30-dziennik-obszaru.png) |
| F14, F16, F18, F33, F34 | ![Karta zadania: bramka zgody, plan bazowy, ograniczenie, relacja](zrzuty-funkcje/F33-F34-bramka-zgody-karta-zadania.png) |
| F35 | ![Ostrzeżenie o niezatwierdzonej bramce](zrzuty-funkcje/F35-ostrzezenie-o-bramce-na-wykresie.png) |
| F36, F38 | ![Pola własne w ustawieniach projektu](zrzuty-funkcje/F36-F38-pola-wlasne-ustawienia.png) |
| F39 | ![Zaznaczenie wielokrotne i zmiana postępu](zrzuty-funkcje/F39-zaznaczenie-wielokrotne-i-postep.png) |

Bez zrzutu zostają funkcje, których nie da się pokazać nieruchomym obrazem
albo których nie zdążyłem przeklikać: F11 i F19 (gesty — przeciągnięcie
uchwytu i kaskada), F13, F23, F26, F31, F32, F37, F40–F46.
