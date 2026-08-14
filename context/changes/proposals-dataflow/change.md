---
change_id: proposals-dataflow
title: Analiza przepływu danych w osi propozycji (api/proposals.ts → lib → Supabase/Spoonacular)
status: preparing
created: 2026-08-10
updated: 2026-08-10
archived_at: null
---

## Notes

Analiza przepływu danych w wybranym obszarze.

Cel wybrany z `context/map/repo-map.md`:
- **Strefa ryzyka #1** — `src/pages/api/proposals.ts`: węzeł orkiestracji, najwyższy fan-out w repo (5), jedyny plik łączący oba klienty Supabase (user + admin) w jednej funkcji; błąd w wyborze klienta = błąd uprawnień RLS.
- **Entry pointy** (sekcja „Pierwszy dzień", poz. 3/4/6): `src/pages/api/proposals.ts`, `src/lib/proposals.ts`, `src/lib/history.ts`.
- **Pierwsze unknowns** (sekcja „Ograniczenia"): `supabase/migrations` jest poza grafem importów — sprzężenie `history.ts` ↔ schemat znane wyłącznie z gita, nie z analizy zależności; żadne z narzędzi mapy nie analizowało runtime'u; brak pokrycia e2e dla US-01.
