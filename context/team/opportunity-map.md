# Opportunity Map

## Context

- **Project / context**: Osobiste automatyzacje wokół pracy dewelopera (Co jemy? / Ultramare workflow)
- **Data constraint**: mock / local / read-only / non-sensitive dla pierwszej wersji
- **Date**: 2026-08-12

## Map

| Signal | Existing / default response | Thin complement | First useful version | Data risk | Direction if valuable |
|---|---|---|---|---|---|
| Cotygodniowy ręczny przegląd bazy użytkowników | Panel Supabase / zapisane SQL | Skrypt read-only → cotygodniowy digest | Lokalny skrypt na eksporcie/mocku → raport markdown | docelowo realne dane użytkowników (start: mock/eksport) | Narzędzie wewnętrzne — async/scheduled |
| Codzienny raport z commitów danego dnia | Skill `/my-timesheet-log` już to robi | Harmonogram odpalający istniejący skill | Już istnieje — brakuje tylko wyzwalacza | lokalne (git log) | Wait — użyj istniejącego narzędzia |
| Zapominam tworzyć issue do tasków | Skill `/my-issue-flow` (find-or-create dla brancha) | Cykliczny skan read-only branchy/commitów bez issue | Skrypt `gh` + `git log` listujący "sieroce" branche | read-only, niewrażliwe | Cienki komplement do istniejącego skilla (scheduled/gate) |

## Recommended First Candidate

```text
Kandydat:
weekly-users-digest

Czyta:
eksport / read-only zapytanie do tabeli użytkowników Supabase
(pierwsza iteracja: mock lub CSV-eksport)

Zwraca:
krótki tygodniowy digest w markdown: nowi użytkownicy, aktywność,
zmiany tydzień-do-tygodnia, ewentualne anomalie

Nie robi:
zapisu do bazy, dashboardu, alertów, automatycznego harmonogramu,
kontroli dostępu (dopóki działa na eksporcie)

Ryzyko danych:
docelowo realne dane użytkowników — zanim skrypt dotknie prawdziwej bazy,
potrzebny read-only klucz o minimalnym zakresie; start na mocku/eksporcie

Kierunek, jeśli się sprawdzi:
narzędzie wewnętrzne, ścieżka async/scheduled (cykliczne uruchamianie)
```

## Why This Candidate

Sygnały 2 i 3 są już w ~90% pokryte istniejącymi skillami (`/my-timesheet-log`, `/my-issue-flow`) — brakuje tam tylko wyzwalacza/przypomnienia, więc to konfiguracja, nie budowa. Sygnał 1 jako jedyny nie ma żadnego pokrycia, powtarza się co tydzień, ma jasny ręczny ból i jest w pełni testowalny read-only na eksporcie.

## Next Direction If Valuable

Wybrana ścieżka: walidacja przez `/10x-mom-test`, a jeśli problem się obroni — `/10x-shape` → `/10x-prd` → `/10x-roadmap`. Jeśli digest okaże się regularnie używany, kierunek to narzędzie wewnętrzne uruchamiane cyklicznie (async/scheduled), z read-only dostępem o minimalnym zakresie przed dotknięciem realnej bazy.
