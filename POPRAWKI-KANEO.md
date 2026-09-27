# Kaneo — co poprawić na gałęzi `claude/integration-all`

Commit `555613a5`. Przebieg z 27 września 2026 na anonimowym planie budowy domu
(108 zadań, 6 projektów, 16 powiązań przez granicę projektu).

Lista uporządkowana według stosunku „skutek do kosztu”. Każda pozycja ma objaw,
dowód z uruchomionej instancji, miejsce w kodzie i propozycję.

Szczegółowe pomiary i zrzuty: `RAPORT-KANEO-DLA-MAINTAINEROW.md`.

---

## 1. Dziennik ma dane przed/po i ich nie pokazuje

**Objaw.** Zmiana harmonogramu renderuje się jako „updated the plan”. Wiersz
obok, zapisany w tej samej sekundzie tą samą operacją, brzmi „changed priority
from Medium to High”.

**Dowód.** Zdarzenie `updated` w bazie:

```json
{"changes":{"startDate":{"from":"2026-11-24…","to":"2026-11-26…"},
            "dueDate":{"from":"2026-11-27…","to":"2026-11-30…"},
            "progress":{"from":0,"to":10}}}
```

**Kod.** `apps/web/src/components/activity/index.tsx:437`

```tsx
if (activity.type === "updated") {
  return <span …>{t("activity:updatedPlan")}</span>;
}
```

Gałąź zwraca stały napis. Sąsiednie gałęzie (`priority_changed`,
`status_changed`, `due_date_changed`, `approval_changed`) czytają `eventData`
i składają zdanie z wartościami — wzorzec jest już w tym pliku, linie 184–330.

**Propozycja.** Przejść po `eventData.changes` i wyrenderować listę „pole:
z → na”, tym samym formatowaniem dat co `formatActivityDateText`. Klucze
i18n dla nazw pól już istnieją.

**Koszt.** Jeden plik, jedna funkcja. Największy skutek za najmniejszą pracę
na tej liście.

---

## 2. Filtr typów w dzienniku pomija trzy typy zdarzeń

**Objaw.** Nie da się odfiltrować zmian harmonogramu, zgód ani relacji.

**Dowód.** W bazie występują typy: `created`, `relation_created`, `updated`,
`approval_changed`, `priority_changed`. Lista filtra ma dziesięć pozycji
i nie ma wśród nich trzech pierwszych z tego zestawu.

**Kod.** `apps/web/src/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/activity.tsx:34`

```ts
const ACTIVITY_TYPES = ["comment","created","moved","status_changed",
  "priority_changed","assignee_changed","unassigned","due_date_changed",
  "title_changed","description_changed"] as const;
```

**Propozycja.** Dopisać `updated`, `approval_changed`, `relation_created`,
`relation_deleted` i klucze i18n. Osobno: dodać filtr po projekcie — dziś
filtry to tylko użytkownik, typ i zakres dat, a dziennik obejmuje cały obszar
roboczy.

**Koszt.** Tablica plus etykiety. Filtr projektu — dodatkowo parametr zapytania.

---

## 3. MCP przyjmuje dowolne nieznane pole i odpowiada sukcesem

To jest szersze niż zgłaszałem poprzednio. Wtedy opisałem to jako „MCP nie zna
bramek zgód”. Objaw dotyczy **wszystkich narzędzi i wszystkich nieznanych pól**.

**Dowód.**

```
update_task {"taskId":"…","approvalStatus":"approved"}   → isError: false, baza bez zmian
update_task {"taskId":"…","zupelnieNieistniejacePole":1} → isError: false
get_task    {"taskId":"…","bzdura":1}                    → isError: false
```

Żadne z **47 narzędzi** nie publikuje `additionalProperties: false`
w `inputSchema`, mimo że schematy w źródle są `.strict()`.

Dla kontrastu walidacja typów działa poprawnie:

```
update_task {"startDate":"2027-04-26"} → isError: true, "Invalid ISO datetime at startDate"
```

**Przyczyna.** Rozjazd wersji Zoda.

| Miejsce | Wersja |
|---|---|
| `apps/api` (schematy narzędzi) | **zod 4.4.3** |
| `@modelcontextprotocol/sdk@1.30.0` (własne drzewo zależności) | **zod 3.25.76** |

Sprawdzone lokalnie na Zodzie 4.4.3: `z.object({a}).strict().safeParse({a,obcy})`
zwraca `success: false`, a `z.toJSONSchema` emituje `additionalProperties: false`.
Czyli schemat jest poprawny — gubi się po drodze.

SDK parsuje argumenty pierwsze
(`@modelcontextprotocol/sdk/dist/cjs/server/mcp.js:433`, `safeParseAsync`)
i przekazuje do wywołania zwrotnego obiekt już oczyszczony z nieznanych kluczy.
Dlatego własna walidacja w opakowaniu nigdy ich nie widzi:

`apps/api/src/mcp/tools.ts:329`

```ts
server.registerTool(name, config, async (args) => {
  const parsed = config.inputSchema.safeParse(args);   // args są już obcięte
  if (!parsed.success) return errorResult(z.prettifyError(parsed.error));
  return callback(parsed.data);
});
```

**Propozycja.** Wybrać jedno z trzech:

1. Walidować surowe `request.params.arguments`, zanim zrobi to SDK.
2. Ujednolicić wersję Zoda, którą rozwiązuje SDK, z tą w `apps/api`.
3. Jeśli obcinanie ma zostać — publikować `additionalProperties: false`
   w schematach, żeby agent po drugiej stronie wiedział, co wolno wysłać.

Bez tego agent dostaje potwierdzenie sukcesu operacji, która się nie wykonała.
To ten sam wzorzec, który naprawiono dla `dependencyType` i `progress` —
tam punktowo, tutaj u źródła.

**Koszt.** Jedna decyzja projektowa, potem kilka linii. Warto zrobić przed
dokładaniem kolejnych pól.

---

## 4. Bramki zgód: brak w MCP, brak w eksporcie, brak odznaki na kamieniu milowym

Trzy osobne luki w jednej, najnowszej funkcji.

**4a. MCP.** Żadnego narzędzia dotyczącego zgód wśród 47. Po naprawieniu
pozycji 3 wywołanie z `approvalStatus` zacznie zwracać błąd — to już postęp,
ale docelowo potrzebne jest narzędzie albo pole w `update_task`.
Punkt końcowy istnieje: `PUT /api/task/approval/{id}`
(`apps/api/src/task/index.ts:523`).

**4b. Eksport.** `GET /api/task/export/{projectId}` zwraca 16 pól. Nie ma wśród
nich `approvalStatus` ani `approvalNote`. Przypisanie wychodzi jako `userId`,
bez nazwiska. Kod: `apps/api/src/task/controllers/export-tasks.ts:24` (lista
`select`) i `:147` (składanie odpowiedzi).

Raport dla komitetu sterującego bez informacji „kto się zgodził” jest niepełny.

**4c. Odznaka statusu.** Odznaka renderuje się tylko w gałęzi rysującej zwykły
słupek (`apps/web/src/components/gantt/gantt-task-bar.tsx:754`), nie w gałęzi
rysującej romb kamienia milowego (`:608`). W moim planie wszystkie sześć bramek
to kamienie milowe, więc **żadna nie pokazuje swojego statusu**. Selektor
`[aria-label^="Approval:"]` zwrócił zero elementów.

Widoczne jest tylko ostrzeżenie na zadaniu **za** bramką
(„1 unapproved gate blocking this task”) — czyli skutek, nie stan.

**Propozycja.** Przenieść odznakę o poziom wyżej, wspólnie dla obu gałęzi.

---

## 5. Ścieżka krytyczna podświetla dokładnie to, czego nie szukamy

**Objaw.** Na planie budowy przełącznik podświetla **21 zadań — wyłącznie
takich, które nie mają żadnej zależności** (dostawy, inspekcje, nadzór).
Ani jednego zadania z łańcucha. Ani jednego z 16 powiązań międzyprojektowych.

**Dowód — eksperyment kontrolny**, dwie pary zadań z relacją FS:

| Układ | Wynik |
|---|---|
| A kończy 10 mar, B zaczyna **10 mar** (ten sam dzień) | oba **krytyczne** |
| C kończy 10 kwi, D zaczyna **11 kwi** (nazajutrz) | **żadne** |

**Kod.** `apps/web/src/components/gantt/gantt-critical-path.ts`

Składają się na to dwie reguły, obie udokumentowane w komentarzu modułu:

1. `forwardRequiredStart` (linia 116) dla FS zwraca `sourceEF + lagDays`.
   Powiązanie jest „napięte” tylko wtedy, gdy następnik startuje **w dniu
   zakończenia** poprzednika. Przekazanie nazajutrz to 1 dzień luzu,
   z piątku na poniedziałek — 3 dni. **Kalendarz roboczy nie jest tu
   uwzględniany**, choć wykres go zna (`gantt-working-calendar.ts`).
2. Zadanie bez żadnej krawędzi jest z rozmysłem krytyczne
   (*„A lone task … is trivially critical”*).

Osobno każda reguła jest obroniona. Razem dają wynik odwrotny do zamierzonego:
w planie wpisanym ręcznie łańcuch nigdy nie jest krytyczny, a każde luźne
zadanie jest.

**Propozycja.**

- Liczyć luz w **dniach roboczych** z kalendarza obszaru, nie w dniach
  kalendarzowych. Wtedy przekazanie z piątku na poniedziałek to zero luzu,
  czyli to, co PM rozumie przez „napięte”.
- Zadania bez żadnej krawędzi wyłączyć z podświetlenia albo oznaczyć inaczej
  niż łańcuch. Dziś tworzą szum, który zakrywa wynik.

**Koszt.** Zmiana w czystym module bez Reacta i DOM, z istniejącymi testami
jednostkowymi obok. Największa wartość merytoryczna na tej liście.

---

## 6. Portfel nie rysuje zależności międzyprojektowych

**Objaw.** Sześć projektów na jednej osi, zero linii relacji. W planie jest
16 powiązań przez granicę projektu — i to one decydują o ryzyku.

**Dowód.** Wykres pojedynczego projektu radzi sobie z tym poprawnie: wciąga
drugi koniec powiązania jako wiersz zewnętrzny, wyszarzony, z nazwą projektu
właściciela. Portfel tego nie robi, bo `GET /api/project/portfolio` w ogóle
nie zwraca relacji (`apps/api/src/project/controllers/get-portfolio.ts`).

**Propozycja.** Dołożyć relacje do odpowiedzi punktu końcowego, potem rysować
— logika rysowania istnieje w `gantt-portfolio.ts` i `dependency-lines.ts`.

**Koszt.** Praca porównywalna z tą, którą już wykonano na samym portfelu.

---

## 7. Próg 20 px spłaszcza wszystkie krótkie zadania

**Objaw.** W skali Miesiąc zadanie 1-dniowe, 3-dniowe i 5-dniowe rysują się
identycznie.

**Dowód.** Zmierzone szerokości rysowanego słupka, okno 1600 px,
12 miesięcy ≈ 2,88 px/dzień:

| Zadanie | Długość | Słupek |
|---|---|---|
| Brick and block delivery | 1 dzień | 20 px |
| Lintel and padstone setting | 3 dni | 20 px |
| Cavity insulation | 5 dni | 20 px |
| Ground floor blockwork | 15 dni | 30 px |
| Weekly site progress meeting | 74 dni | 195 px |
| Site supervision | 298 dni | 857 px |

**Kod.** `apps/web/src/components/gantt/timeline.ts:84` —
`MIN_BAR_HOVER_HIT_PX = 20`, użyte w `gantt-task-bar.tsx:690`.

Komentarz tamże mówi, że minimum poszerza wyłącznie obszar trafienia,
a *„the visible bar inside still renders at its own (possibly narrower)
computed width”*. Pomiar tego nie potwierdza: dla zadania 5-dniowego kontener
rysowany ma 13 px, ale widoczny przycisk w środku — 20 px. Przycisk rozciąga
się do szerokości rodzica.

W skali Tydzień proporcje są poprawne (5 dni = 66 px, 15 dni = 223 px).

**Propozycja.** Oddzielić obszar trafienia od rysunku tak, jak zakłada
komentarz — przezroczysta warstwa 20 px wokół słupka o właściwej szerokości.
Albo skalować próg do jednostki czasu.

**Koszt.** Jedna warstwa w drzewie słupka.

---

## 8. Portfel otwiera się domyślnie w skali Kwartał

Skutek pozycji 7 widać najmocniej właśnie tam: przy pierwszym wejściu każde
zadanie jest jednakową pigułką i widok wygląda na bezużyteczny, zanim
użytkownik przełączy skalę. Miesiąc jest lepszym domyślnym ustawieniem
dla planu rocznego.

**Koszt.** Jedna wartość początkowa.

---

## 9. Obłożenie zasobów i dziennik bez filtra projektu

Projekt testowy z 1200 zadaniami w tym samym obszarze roboczym dał w obłożeniu
wiersz „Unassigned” z wartościami 71–91 i przykrył cały zespół. Musiałem
przenieść go do osobnego obszaru, żeby widok był czytelny.

Dodatkowo w obłożeniu: okno jest sztywne, osiem tygodni od dziś, bez
dowolnego zakresu; osoba bez zadań w oknie znika z tabeli zamiast pokazać
wiersz z zerami; nie ma przejścia z komórki do listy zadań danej osoby.

---

## 10. Pobieranie listy zadań: 13 żądań na 1200 pozycji

Wirtualizacja wierszy działa dobrze — w DOM jest 10–24 słupki i mniej niż
1700 elementów. Ale lista nadal schodzi stronami po 100 przy każdym wejściu.
Wczytanie do `networkidle` zajęło 6,5 s.

**Propozycja.** Większa strona dla wykresu albo pobieranie zakresem dat
widocznego okna.

---

## 11. Drobne

- **Tłumaczenia.** Po naprawie z 555613a5 w obszarze planowania zostały
  24 klucze identyczne z angielskimi, z czego 6 to skróty FS/SS/FF/SF
  i wzorce formatowania. Reszta to ustawienia pól własnych (9) i duplikowanie
  zadania (4). Pozostałe języki: fr 14, zh 17, ja 21, de 23, nl 27 z 208.
- **Retencja dziennika** nadal nie jest egzekwowana — ustawienie
  `activityRetentionDays` zapisuje się, nic nie kasuje starych wpisów.
- **Zmiany kalendarza roboczego nie trafiają do dziennika**, bo
  `activity.task_id` jest `NOT NULL`. To wymaga migracji schematu.
- **Raport CI `pnpm i18n:untranslated`** jest nieblokujący. Gdyby blokował,
  obie luki tłumaczeniowe nie weszłyby na gałąź.

---

## Kolejność, którą proponuję

| Kolejność | Pozycja | Dlaczego |
|---|---|---|
| 1 | 1 — `eventData.changes` w widoku | dane są, renderer ich nie używa; jeden plik |
| 2 | 3 — walidacja MCP u źródła | ciche sukcesy psują każde następne pole |
| 3 | 5 — ścieżka krytyczna | funkcja jest, ale dziś wprowadza w błąd |
| 4 | 4 — bramki zgód, trzy luki | najnowsza funkcja, niedokończona w trzech miejscach |
| 5 | 2, 8 — filtry i domyślna skala | tanie, widoczne od razu |
| 6 | 6 — linie w portfelu | większa praca, duża wartość |
| 7 | 7 — próg 20 px | poprawia czytelność każdego planu |

---

*Liczby pochodzą z pomiarów na uruchomionej instancji: z DOM, z odpowiedzi API,
z sesji MCP albo z zapytań do bazy. Wnioski wyprowadzone z samego kodu są
oznaczone odwołaniem do pliku i linii. Materiał jest pomocniczy — przed
decyzją wymaga weryfikacji przez właściciela produktu.*
