# Artefakt 3 — Mapa kontrybutorów (kto wie co i o co go zapytać)

**Data analizy:** 2026-08-10 · **Gałąź:** `master` · **Zakres:** cała historia (68 commitów, 2026-05-23 → 2026-08-10 — jedyne dostępne "12 miesięcy")

**Zastrzeżenie metodologiczne, zanim przejdziesz dalej:** ten prompt-chain zakłada zespół — wynikiem ma być "linia wsparcia" wskazująca, kogo zapytać o dany obszar. Po przefiltrowaniu bota/agentów okazuje się, że **repo ma dokładnie jednego kontrybutora-człowieka**. Poniżej stosuję strukturę promptu 1:1, ale wniosek końcowy jest inny niż w typowym projekcie zespołowym — patrz sekcja 3.

---

## 0. Filtrowanie autorów

```
git log --pretty=format:'%an <%ae>' | sort | uniq -c
     67 KSchlagowski <kamilschlagowski@gmail.com>
      1 Kamil Schlagowski <mediewilnp@gmail.com>
```

Obie tożsamości to ta sama osoba (drugi adres = e-mail z bieżącej sesji, użyty tylko w commicie inicjalizującym repo). **Zero innych ludzkich autorów w polu `author` w całej historii.**

Osobno sprawdzono trailery `Co-Authored-By` (git log `--format='%(trailers:key=Co-Authored-By)'`) — obecne w większości commitów z lipca/sierpnia, wszystkie wskazują na `Claude Opus 5 <noreply@anthropic.com>` lub `Claude Fable 5 <noreply@anthropic.com>`. To zgodnie z instrukcją promptu odfiltrowane jako agent, nie kontrybutor — to narzędzie pair-programmingowe, którym posługuje się jedyny ludzki autor, nie osobny głos w projekcie.

**Wynik filtrowania: 1 kontrybutor-człowiek, 0 botów jako osobnych autorów, 0 innych ludzi.**

---

## 1. Top 5 obszarów wymagających potencjalnego kontaktu z kontrybutorami

Wybrane na podstawie ryzyka/sprzężenia z `artifact-1-territory.md` i `artifact-2-structure.md` — czyli miejsc, gdzie *gdyby* istniał zespół, warto by było wiedzieć kogo zapytać przed zmianą.

| # | Obszar | Dlaczego trafił na listę (dowód z artefaktów 1–2) |
|---|---|---|
| 1 | `src/pages/api/proposals.ts` + `ratings.ts` (węzeł orkiestracji) | Najwyższy fan-out w repo (5) — jedyny plik łączący oba klienty Supabase, domenę propozycji i historię ocen. Artefakt 2, sekcja 5: "błąd w wyborze klienta = błąd uprawnień RLS". |
| 2 | Oś domenowa `src/lib/proposals.ts` + `spoonacular.ts` + `history.ts` | Serce projektu wg artefaktu 1 (~60% aktywności kodowej); `history.ts` jedyny plik, którego zmiana regularnie ciągnie za sobą migrację schematu. |
| 3 | `src/lib/supabase.ts` | Najwyższy fan-in w repo (12) — fundament DB. Artefakt 2: "każda zmiana tu jest zmianą o najszerszym blast radius w repo". |
| 4 | `src/components/proposals` + `src/components/ratings` (współdzielony model przepisu) | Artefakt 1, wniosek 2 sekcji 3: karta propozycji i lista ocen dzielą `types.ts`; artefakt 2 potwierdza jednokierunkowe sprzężenie `ratings/types.ts → proposals/types.ts`. |
| 5 | Pokrycie testowe pętli propozycje→ocena (`testing-harness-proposal-units`, `e2e/`) | Artefakt 2, sekcja 5: brak e2e dla głównej pętli produktu (US-01) mimo że to jedyna ścieżka bez pokrycia przeglądarkowego. |

Poza listą świadomie: `src/components/auth` + `src/pages/auth` — zbudowane w Q2, zamrożone od czerwca (artefakt 1, wniosek 3), niskie ryzyko, niski priorytet kontaktu.

---

## 2. Linia wsparcia per obszar (po filtracji: jeden autor, sklasyfikowany tematycznie)

Dla każdego obszaru: kto go dotykał w ciągu ostatnich 12 miesięcy i jaki charakter miała ta praca — nie jako "kogo zapytać *zamiast* siebie", lecz jako mapa, gdzie leży najgłębsza, najświeższa wiedza kontekstowa u jedynego kontrybutora.

### Obszar 1 — `src/pages/api/proposals.ts` + `ratings.ts`

**Kontrybutor: KSchlagowski** — 15 commitów, 2026-06-01 → 2026-08-09.

| Wątek | Commity | Charakter |
|---|---|---|
| Bootstrap | `feat: init project files` (06-01) | Rusztowanie endpointów |
| Spoonacular spike | `feat/chore(spoonacular-retrieval-spike)` (07-18, 07-19) | Pierwsze podłączenie providera do warstwy API |
| Auth w produkcji | `feat(production-auth-loop)`: confirmation route, Supabase wiring (07-20) | Callback flow, sesje |
| Cold-start | `feat(cold-start-proposals): Proposals Endpoint` (07-21) | Pierwszy pełny endpoint 4-slotowy |
| Testy prowidera | `test(testing-harness-proposal-units): provider-edge & auth-gate leak guards` (07-22) | Guardy na wycieki auth/providera |
| Rating endpoint | `feat(rate-recipe): rating endpoint + unit tests` (08-08) | CRUD ocen |
| Personalizacja + zarządzanie ocenami | `feat(personalized-proposal-slots)`, `feat(manage-rated-recipes)`, oba z `fix(...): impl-review triage` (08-09) | Rozszerzenie payloadu, hardening po code-review |

**Wniosek:** to jedyna osoba, która przeszła przez pełną ewolucję tego pliku od spike'u do personalizacji — pytanie o "dlaczego RLS jest tak, a nie inaczej" ma tylko jednego adresata.

### Obszar 2 — oś domenowa (`lib/proposals.ts`, `lib/spoonacular.ts`, `lib/history.ts`)

**Kontrybutor: KSchlagowski** — 14 commitów, 2026-06-01 → 2026-08-09.

| Wątek | Commity | Charakter |
|---|---|---|
| Provider client | `feat(spoonacular-retrieval-spike): Wire the client locally` (07-18), `fix(spoonacular): harden client against fetch, parse, and quota edge cases` (07-20) | Odporność na 402/timeouty/malformed JSON |
| Retrieval + cold-start | `feat(cold-start-proposals): Retrieval Layer` (07-20) | Logika `sort=random` + `offset` |
| Testy jednostkowe domeny | `chore/test(testing-harness-proposal-units)`: bootstrap, `buildColdStartSet two-call invariant` (07-22) | Weryfikacja budżetu punktów (1 call/cuisine) |
| Historia ocen + migracja | `feat(personalized-proposal-slots): Migration + History Read Layer` (08-09) | `history.ts` ciągnące za sobą schemat — potwierdza artefakt 1 |
| Hardening po review | oba `impl-review triage` (08-09) | Poprawki po własnym code review |

**Wniosek:** jedyna osoba, która widziała quota-crunch providera z pierwszej ręki (spike → hardening) — kontekst "dlaczego limit 900 offsetu jest tam, gdzie jest" nie jest odtwarzalny z samego kodu.

### Obszar 3 — `src/lib/supabase.ts`

**Kontrybutor: KSchlagowski.** Sam plik nie ma dedykowanych commitów w top-10 (fundament, rzadko zmieniany — zgodnie z hipotezą artefaktu 2), ale każdy commit dotykający `production-auth-loop` (07-20, 4 commity) i każdy endpoint w obszarze 1 go konsumuje. Historia potwierdza: zbudowany raz w ramach `production-auth-loop`, od tego czasu stabilny — dokładnie profil "fundamentu", nie "aktywnego pola pracy".

**Wniosek:** niska częstotliwość zmian = niskie ryzyko bieżące, ale też jedyny plik, gdzie kontekst decyzji (dlaczego dwa klienty — user + admin) leży wyłącznie w commitach `production-auth-loop`, nigdzie indziej.

### Obszar 4 — `src/components/proposals` + `src/components/ratings`

**Kontrybutor: KSchlagowski** — 8 commitów, 2026-07-21 → 2026-08-09.

| Wątek | Commity | Charakter |
|---|---|---|
| Dashboard UI (cold-start) | `feat(cold-start-proposals): Dashboard UI` (07-21) | Pierwszy render kart propozycji |
| Rating UI | `feat(rate-recipe): rating UI on proposal cards` (08-08) | 👍/👎 na karcie |
| Ratings page | `feat(manage-rated-recipes): UI — Ratings Page + Island` (08-09) | Nowy komponent, współdzielony typ z `proposals/types.ts` |
| Personalizacja | `feat(personalized-proposal-slots): UI — Slots + Rating Hydration` (08-09) | Hydracja stanu ocen w komponentach slotów |

**Wniosek:** ten sam autor wprowadził oba katalogi w odstępie 3 tygodni — sprzężenie typów (artefakt 2, sekcja 4) jest świadomą decyzją tej samej osoby, nie przypadkową konwergencją dwóch niezależnych torów pracy.

### Obszar 5 — pokrycie testowe (`testing-harness-proposal-units`, `e2e/`)

**Kontrybutor: KSchlagowski** — 7 commitów, 2026-07-22 → 2026-08-08.

| Wątek | Commity | Charakter |
|---|---|---|
| Bootstrap runnera | `chore(testing-harness-proposal-units): Test Runner Bootstrap` (07-22) | Konfiguracja Vitest |
| Testy jednostkowe domeny | `buildColdStartSet two-call invariant`, `provider-edge & auth-gate leak guards` (07-22) | Pokrycie logiki 4-slotowej i granic providera |
| Playwright | `chore(testing-harness): Playwright E2E setup + 10x testing skills` (07-24) | Rusztowanie e2e — **ale bez scenariusza dla US-01** |
| Seed specs | `test(testing-harness): seed spec — publisher credit + working link`, `auth-gate specs + exact label locators` (08-08) | E2E na marginesy (link, auth-gate), nie na główną pętlę |

**Wniosek:** ta sama osoba zbudowała cały harness, ale luka z artefaktu 2 (brak e2e dla propozycje→ocena) jest luką w jej *własnej* robocie, nie efektem nieobecności specjalisty od QA — do zamknięcia jest potrzebna kontynuacja tej samej pracy, nie nowa osoba.

---

## 3. Odpowiedź na pytanie promptu, wprost

Prompt pyta o "linię wsparcia" — kogo zapytać per obszar. W tym repo odpowiedź jest jednolita i nietypowa: **KSchlagowski, dla wszystkich 5 obszarów, bez wyjątku.** Bus factor projektu = 1 na całej powierzchni kodu aplikacyjnego.

To ma dwie konsekwencje praktyczne, różne od typowego zespołowego wyniku tego promptu:

1. **Nie ma do kogo eskalować pytanie kontekstowe** — jedyne źródło "dlaczego to tak zrobiono" to historia commitów i pliki `context/changes/*`/`context/archive/*` (które już notują `Socrates:` kontrargumenty w PRD — to faktyczny substytut pytania współpracownika w tym projekcie).
2. **Priorytet dla przyszłego onboardingu, jeśli dołączy druga osoba:** obszary 1–3 (węzeł orkiestracji, oś domenowa, fundament Supabase) to miejsca, gdzie wiedza jest najgęstsza i najmniej udokumentowana poza samym kodem — to one zasługiwałyby na pierwsze wyjaśnienie ustne/pair-programming przy wdrażaniu kogokolwiek nowego, przed obszarami 4–5, które są bardziej samowyjaśniające się przez typy i nazwy testów.

Agent-commity (Claude Opus 5 / Claude Fable 5 jako `Co-Authored-By`) nie zmieniają tego wniosku — to narzędzie, którym posługuje się KSchlagowski, nie druga linia wsparcia; nie ma pamięci ani kontekstu poza tym, co jest w plikach `context/`.
