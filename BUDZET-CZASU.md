# Budżet czasu i triaż poprawek — Gantt Kaneo

Dokument towarzyszy raportowi `RAPORT-KANEO-GANTT.md`. Dla każdego wniosku z
raportu określa:

- **kategorię** — czy to **defekt w obecnym PR** (poprawiamy w istniejącym PR),
  czy **nowy zakres** (osobny nowy PR),
- **docelowy PR / gałąź**,
- **szacunek** w osobodniach (1 programista),
- **priorytet**.

Szacunki są zgrubne i wymagają potwierdzenia przez wykonawcę. To materiał
pomocniczy do planowania, nie zobowiązanie.

Oznaczenia PR (fork `WMP/kaneo` → `usekaneo/kaneo`):

- `pr/cross-project-relations` (#1784) — relacje między projektami
- `pr/gantt-dependencies` (#1785) — linie zależności, pan/zoom, jednostki
- `pr/gantt-pro-features` (#1788) — postęp, kamienie, plan bazowy, rollup
- `pr/phase-2` (#1793) — typy FS/SS/FF/SF, lag, cykle, drag-to-link
- `pr/phase-3` (#1794) — auto-przeplanowanie, ścieżka krytyczna, kalendarz, ograniczenia

---

## A. Defekty w obecnych PR — poprawiamy w istniejących PR

| # | Wniosek | Docelowy PR | Pliki | Szacunek | Priorytet |
|---|---------|-------------|-------|----------|-----------|
| A1 | Tłumaczenia nowych kluczy: wartości są angielskie w 19 językach (58/81 Gantt, 29/41 kalendarz) | wszystkie (klucze per faza) | `i18n/*.json` | 2–3 d | Wysoki |
| A2 | Kontrast cieniowania dni wolnych w trybie ciemnym za słaby (6% → 10–12%) | phase-3 | `gantt.tsx` | 0,25 d | Średni |
| A3 | Brak potwierdzenia zapisu postępu (nieużyty klucz `progress.updateSuccess`) | gantt-pro-features | popover postępu | 0,25 d | Średni |
| A4 | Postęp jako suwak co 5% — dodać wpis liczbowy | gantt-pro-features | popover postępu | 0,5 d | Średni |
| A5 | Plan bazowy: brak liczby dni poślizgu (etykieta „+Nd”) | gantt-pro-features | `gantt-task-bar.tsx` | 0,5 d | Wysoki |
| A6 | Słupek zbiorczy podzadań bez wskaźnika postępu | gantt-pro-features | `gantt-summary-task-bar.tsx` | 0,5–1 d | Wysoki |
| A7 | Domyślna jednostka osi nie dobrana do zakresu (wykres otwiera się „pusty”) | gantt-pro-features | trasa Gantta | 0,5 d | Średni |
| A8 | Typ zależności niewidoczny/nieedytowalny na wykresie (etykieta typu przy linii, edycja z menu) | phase-2 | overlay zależności, `gantt.tsx` | 1–2 d | Wysoki |
| A9 | Nakładające się etykiety opóźnień w węzłach rozgałęzienia | phase-2 | overlay zależności | 0,5 d | Średni |
| A10 | Drag-to-create tworzy tylko FS/0 — pozwolić wybrać typ | phase-2 | `gantt-link-drag`, `gantt.tsx` | 0,5–1 d | Średni |
| A11 | Podświetlanie po najechaniu nie działa w widoku Kwartał (za wąski obszar trafienia; linie łapią kursor) | gantt-dependencies | `gantt-task-bar.tsx`, overlay | 0,5–1 d | Wysoki |
| A12 | Przeciąganie kolumny nazw zaznacza tekst zamiast przewijać | gantt-dependencies | `[data-gantt-rail]` | 0,25 d | Średni |
| A13 | Ostrzeżenie, że ścieżka krytyczna pomija zależności międzyprojektowe (liczba pominiętych krawędzi) | phase-3 | `gantt-critical-path.ts`, `gantt.tsx` | 0,5 d | Wysoki |
| A14 | Trzy kolizje UI: uchwyt linku łapie kliknięcia, znacznik naruszenia zasłania romb, toast zasłania „Add holiday” | phase-2 / phase-3 | `gantt-task-bar.tsx`, ustawienia kalendarza | 0,5 d | Średni |
| A15 | Właściciel (inicjały) i znacznik „po terminie” na wykresie | gantt-dependencies / gantt-pro-features | `gantt-task-bar.tsx` | 1 d | Średni |
| A16 | Masowa zmiana postępu (operacja zbiorcza) | phase-3 | `bulk-update-tasks.ts`, pasek zaznaczenia | 0,5–1 d | Średni |

**Suma A: ~9–13 osobodni.**

> Uwaga strukturalna: pliki `gantt-task-bar.tsx`, `gantt.tsx`, overlay zależności
> występują w kilku gałęziach PR (są to niezależne „squash” PR-y na `main`).
> Poprawka współdzielonego pliku musi trafić do każdej gałęzi, która go zawiera
> — to zwiększa czas wdrożenia względem powyższych szacunków (mnożnik ~1,3–1,5).
> Docelowo najczyściej po scaleniu wcześniejszych PR i przebazowaniu kolejnych.

---

## B. Nowy zakres — osobne nowe PR

### B1. Dziennik i audyt (krytyczne dla tego projektu)

| # | Wniosek | Szacunek | Priorytet |
|---|---------|----------|-----------|
| B1.1 | Subskrypcja `task.updated` w module aktywności — pokrywa przeciąganie słupka, kaskadę i plan bazowy (`apps/api/src/activity/index.ts`) | 0,5–1 d | **Krytyczny** |
| B1.2 | Zdarzenia i wpisy dziennika dla relacji zadań i kalendarza roboczego | 1–2 d | Wysoki |
| B1.3 | Osobny dziennik audytu obszaru roboczego: widok „wszystkie zmiany”, filtr po użytkowniku i dacie, wartość przed/po | 3–5 d | Wysoki |
| B1.4 | Eksport dziennika + polityka retencji (wyprowadzenie do SIEM) | 2–3 d | Wysoki |

### B2. Eksport i integracje

| # | Wniosek | Szacunek | Priorytet |
|---|---------|----------|-----------|
| B2.1 | Eksport planu o `progress`, `isMilestone`, `baseline*`, `constraint*` i relacje (`export-tasks.ts`) | 1 d | Wysoki |
| B2.2 | MCP: `create_task_relation` + `dependencyType`/`lagDays`; nowe `update_task_relation`; `create/update_task` + `progress`/`isMilestone`/`constraint*`; `set/clear_task_baseline`; narzędzia kalendarza | 1–2 d | Średni |
| B2.3 | MCP: **odrzucać nieznane pola zamiast po cichu je pomijać** (dziś cicha utrata danych — patrz niżej) | 0,5 d | **Krytyczny** |

### B3. Wydajność i skala

| # | Wniosek | Szacunek | Priorytet |
|---|---------|----------|-----------|
| B3.1 | Wirtualizacja wierszy wykresu (dziś ~19 tys. węzłów DOM przy 1200 zadaniach) | 2–4 d | Wysoki |
| B3.2 | Zastąpić pełne odświeżanie co ~25 s aktualizacją przyrostową przez istniejący WebSocket | 1–2 d | Średni |

### B4. Braki produktowe (duże)

| # | Wniosek | Szacunek | Priorytet |
|---|---------|----------|-----------|
| B4.1 | Widok portfela — wiele projektów na jednej osi czasu | 5–10 d | **Krytyczny** |
| B4.2 | Obłożenie zasobów — obciążenie osoby/zespołu, ostrzeżenia o przeciążeniu | 5–10 d | **Krytyczny** |
| B4.3 | Ścieżka krytyczna na całym obszarze roboczym (międzyprojektowa, liczona po stronie serwera, dostępna dla MCP/raportów) | 3–5 d | Średni |
| B4.4 | Obsługa zgód/bramek: pole statusu (oczekuje/udzielona/odmowa), twarda blokada, ślad audytowy | 3–5 d | Średni |
| B4.5 | Pola własne widoczne na wykresie i dostępne w MCP | 2–3 d | Niski |

### B5. Narzędzia i drobne

| # | Wniosek | Szacunek | Priorytet |
|---|---------|----------|-----------|
| B5.1 | Reguła CI wykrywająca wartość i18n identyczną z angielską (dziś kontrola sprawdza tylko obecność klucza) | 0,5 d | Średni |
| B5.2 | Format daty niezależny od strefy/języka (dziś zawsze mm/dd/yyyy) | 0,5 d | Średni |
| B5.3 | Zbadać powtarzający się błąd konsoli `hasPermission check failed … Failed to fetch` | 0,5–1 d | Średni |

**Suma B: ~32–56 osobodni** (z czego braki produktowe B4 to ~18–33).

---

## Podsumowanie budżetu

| Blok | Osobodni |
|------|----------|
| A. Defekty w obecnych PR | 9–13 |
| B1. Dziennik i audyt | 6,5–11 |
| B2. Eksport i MCP | 2,5–3,5 |
| B3. Wydajność | 3–6 |
| B4. Braki produktowe | 18–33 |
| B5. Narzędzia i drobne | 1,5–2,5 |
| **Razem** | **~40–69 osobodni** |

Rekomendowana kolejność (fazy):

1. **Faza szybka (~2–3 d):** B1.1 (dziennik `task.updated`), B2.3 (MCP nie gubi
   danych po cichu), A2/A3/A13 i pozostałe drobne z A. Najwięcej wartości,
   najmniej ryzyka.
2. **Faza „prowadzenie projektu” (~10–15 d):** reszta A, B1.2–B1.4 (audyt),
   B2.1–B2.2 (eksport, MCP), B3 (wydajność).
3. **Faza produktowa (~18–33 d):** B4 (portfel, zasoby, bramki) — decyzja
   produktowa, nie tylko inżynierska.

---

## Najpoważniejsze ryzyko do świadomej decyzji

**MCP po cichu gubi dane.** `create_task`/`create_task_relation`/`update_task`
przez MCP przyjmują nowe pola (`progress`, `dependencyType`, `lagDays`,
`constraintType`…), zwracają sukces, a w bazie zapisują wartości domyślne.
Agent działający przez MCP jest przekonany, że ustawił SS z opóźnieniem 7 dni —
w bazie jest FS/0. **Cicha utrata danych jest gorsza niż odrzucenie żądania**
(B2.3) i powinna być załatana najpierw, niezależnie od reszty MCP.

To materiał pomocniczy. Wynik i decyzje wymagają weryfikacji przez człowieka
przed wdrożeniem.
