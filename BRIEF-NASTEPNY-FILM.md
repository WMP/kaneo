# Założenia następnego filmu

Ustalenia użytkownika z 26 września 2026. Ten plik istnieje po to, żeby
przetrwać koniec sesji — kontener jest tymczasowy.

## 1. Odbiorca: maintainerzy, nie kierownik projektu

Dwa poprzednie filmy pokazywały pracę kierownika projektu. Ten ma pokazać
**wszystkie nasze zmiany** osobie, która utrzymuje kod.

Skutki dla scenariusza:

- Prowadzić po funkcjach, nie po przebiegu pracy. Każda zmiana z obu raportów
  dostaje swój fragment.
- Pokazać także to, co naprawione tylko częściowo, i to, co nie działa —
  maintainer potrzebuje pełnej listy, nie prezentacji sprzedażowej.
- Wolno pokazywać dowody techniczne: odpowiedź API, wywołanie MCP, wpis
  w dzienniku, wartość w DOM. Poprzednie filmy tego unikały.

Zakres = 21 pozycji tabeli zbiorczej z `RAPORT-KANEO-INTEGRATION-ALL.md`
plus dwie nowe funkcje (bramki zgód klientów, pola własne przez MCP).

## 2. Dane demonstracyjne: budowa domu, nie migracja do chmury

Plan migracji 3000 maszyn wirtualnych był zbyt konkretny. Nowe dane mają być
**anonimowe** — żadnych nazw dostawców, linii produktowych ani systemów, które
dałoby się powiązać z rzeczywistym klientem.

Temat zastępczy: **budowa domu**. Na przykład: pozwolenia, fundamenty, stan
surowy, dach, instalacje, wykończenie, odbiór.

## 3. Język danych: angielski

Nazwy projektów, zadań, etykiet i osób — po angielsku. Interfejs i napisy też
po angielsku, tak jak w filmie `demo-kaneo-integration-all.mp4`.

## 4. Długość zadań i skala osi czasu

Dwie uwagi z poprzednich nagrań. Obie dotyczą tego samego: plan wygląda
nieprawdziwie.

**Zadania muszą mieć różną długość.** W poprzednich danych prawie wszystkie
zadania trwały podobnie (2–4 tygodnie), więc na wykresie wychodziły jednakowe
kwadraciki. Prawdziwa budowa tak nie wygląda. Nowy plan ma mieszać:

| Rodzaj pozycji | Długość |
|---|---|
| kamienie milowe (odbiory, pozwolenia) | 0 dni |
| krótkie czynności (wylanie chudziaka, przegląd) | 1–3 dni |
| typowe zadania | 1–3 tygodnie |
| długie etapy (stan surowy, instalacje) | 2–4 miesiące |
| czynności ciągnące się przez cały projekt | nadzór budowlany przez cały czas |

**Domyślnie pokazywać widok Miesiąc, nie Kwartał.** W Kwartale krótkie zadania
i tak nie mają swojej szerokości — słupek jest dociskany do minimum 20 px
(`MIN_BAR_HOVER_HIT_PX` w `timeline.ts`), więc zadanie 2-dniowe i 3-tygodniowe
wyglądają tak samo. To jest druga przyczyna „równych kwadracików”, niezależna
od danych.

W widoku Miesiąc słupki są proporcjonalne i różnica długości jest widoczna.
Kwartału używać tylko tam, gdzie chodzi o pokazanie całego roku naraz —
na przykład przy podświetlaniu po najechaniu (punkt 4.10 raportu) albo przy
ścieżce krytycznej przez cały plan. W pozostałych fragmentach: Miesiąc.

## 5. Co zostaje bez zmian

- jeden film, nie zestaw krótkich,
- widoczny kursor myszy (nakładka — nagranie przeglądarki nie zawiera
  wskaźnika systemowego), kliknięcia zaznaczone pierścieniem,
- napisy wyjaśniające, co robię,
- 1600 × 900, H.264,
- rozdziały z podpisami.

## 6. Czego plan musi dotknąć

Żeby nagranie pokazało wszystko, zestaw danych musi zawierać:

| Funkcja | Czego potrzebuje w danych |
|---|---|
| typy zależności | relacje FS, SS, FF i SF, każda z opóźnieniem |
| plan bazowy i poślizg | zadania z planem bazowym i odchyleniem w obie strony |
| ograniczenia dat | SNET, FNLT i MSO |
| kamienie milowe | odbiory i przeglądy |
| ścieżka krytyczna | łańcuch przechodzący przez granicę projektu |
| portfel | kilka projektów na jednej osi |
| obłożenie zasobów | kilka osób, w tym jedna przeciążona |
| bramki zgód | zgody inwestora: oczekująca, zatwierdzona, odrzucona |
| kalendarz roboczy | dni wolne i skrócony tydzień |
| dziennik i eksport | zmiany planu z wartościami przed/po |
| wirtualizacja i skala | osobny projekt z około 1200 zadaniami |
| MCP | wywołanie na żywo, które zmienia plan na ekranie |
| pola własne | co najmniej jedno pole widoczne w karcie zadania |
| czytelność wykresu | rozrzut długości zadań od 0 dni do kilku miesięcy (punkt 4) |

## 7. Uwaga o zgodności

Dane demonstracyjne muszą pozostać zmyślone. Nie używać nazw, adresów ani
danych osobowych pochodzących od rzeczywistych klientów.
