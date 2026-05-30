# Pomysł na aplikację webową "Co jemy?" - MVP

### Główny problem
Nieplanowanie posiłków prowadzi do tracenia czasu przed i podczas zakupów spożywczych, potem do tracenia czasu stojąc przed lodówką myśląc co ugotować oraz ostatecznie do wyrzucania niewykorzystanej żywności. Gdy nie planuje się posiłków często też sięga się po bardziej przetworzone jedzenie, aby przygotować coś bez dużego zaangażowania, nawet gdy się ma ochotę gotować, ale jest się zmęczonym psychicznie. Dzięki korzystaniu z aplikacji "Co jemy?" zyskuje się czas, pieniądze i zdrowie.

### Idea
Idea: Stworzenie aplikacji do proponowania posiłków.
Użytkownik: Osoba, która chce gotować, ale nie chce planować co ugotować.
Proces: Aplikacja wyszukuje w internecie i proponuje różne posiłki. Gdy użytkownik wybierze dany przepis to dostaje link do przepisu. Po powrocie do aplikacji może 
1) poprosić o inne przepisy
2) dać przepisowi łapkę w górę (zatwierdzić, że ugotował i mu smakowało)
3) dać przepisowi łapkę w dół (zatwierdzić, że ugotował i mu nie smakowało, lub że to z założenia nie trafia w jego gusta).
Logika: Na podstawie ocen użytkownika AI ma wyszukiwać przepisy, które będą trafiały w jego gusta. Np. użytkownik może mieć w zapisanych gustach tylko kuchnię polską. Apka będzie proponować trzy posiłki, z czego 1 będzie dobrze oceniony ugotowany niedawno, 2 będzie dobrze oceniony, będzie przypomnieniem po minimum dwóch tygodniach, 3 będzie całkiem nowy w gustach użytkownika - coś innego z kuchni polskiej, 4 będzie losowy jak najbardziej różnorodny do odkrywania nowych smaków (np. kuchnia meksykańska).
Logika w jednym zdaniu: Aplikacja generuje propozycje na posiłki na podstawie prostej klasyfikacji użytkownika (to lubię, a tego nie lubię) .

### Najmniejszy zestaw funkcjonalności
- Rejestracja i logowanie
- Wyszukiwanie w internecie przepisów
- System ocen przepisów
- Pokazywanie przepisów, które użytkownik polubił (programistycznie)
- Pokazywanie przepisów, które mogą się użytkownikowi spodobać (AI sprawdza co user lubi i szuka w internecie podobnych typów dań. Unika pokazywania tych co nie lubi)
- Pokazywanie losowych przepisów (może jakieś api do losowania przepisu, potem AI porównuje to z bazą przepisów użytkownika i wybiera czy szukać dalej, czy wyświetlić)

#### Crud oceny przepisów (Recipe Ratings):

| Operacja   | Co robi                                                                |
| ---------- | ---------------------------------------------------------------------- |
| **Create** | Dodanie oceny 👍/👎 do przepisu po kliknięciu                          |
| **Read**   | Pobranie listy ocenionych przepisów (historia)                         |
| **Update** | Zmiana oceny (👍 → 👎 lub odwrotnie, np. gdy zmieniły się preferencje) |
| **Delete** | Usunięcie oceny, żeby przepis mógł wrócić jako „nowy"                  |

### Co NIE wchodzi w zakres MVP
- przepisywanie przepisów (dajemy tylko linki do innych stron)
- przekalkulowywanie przepisów na inną ilość porcji
- liczenie makroskładników
- sugerowanie co jest zdrowe, a co nie
- zaawansowany system rekomendacji 
- import własnych przepisów
- tworzenie list zakupów
- integracje z innymi platformami
- aplikacja mobilna (w mvp tylko web)

### Kryteria sukcesu
#### Zaangażowanie i retencja użytkowników
- Co najmniej **60% użytkowników, którzy zalogowali się po raz pierwszy, wraca do aplikacji** w ciągu 7 dni — oznacza to, że propozycje posiłków faktycznie rozwiązują problem niezdecydowania.
- Średnio co najmniej **3 oceny (👍/👎) na aktywnego użytkownika tygodniowo** — wskaźnik pokazuje, że użytkownicy aktywnie korzystają z pętli feedbacku, na której opiera się logika rekomendacji
- **70% użytkowników otwiera link do przepisu** co najmniej raz na sesję — potwierdza, że propozycje są wystarczająco trafne, żeby ktoś chciał dowiedzieć się więcej.
#### Trafność rekomendacji
- Po zebraniu co najmniej **10 ocen przez użytkownika**, wskaźnik zatwierdzonych przepisów (👍) rośnie powyżej **50%** — algorytm „uczy się" gustów w akceptowalnym tempie.
- **Mniej niż 20% użytkowników zgłasza**, że aplikacja proponuje ciągle te same potrawy (brak różnorodności) w pierwszym miesiącu — weryfikacja, czy cztery kategorie propozycji (świeże powtórki, przypomnienia, nowości, losowe) działają zgodnie z założeniem.
#### Realizacja głównego problemu
- W ankiecie zadowolenia (np. po 2 tygodniach używania) co najmniej **50% aktywnych użytkowników potwierdza**, że rzadziej stoi bezradnie przed lodówką lub sięga po gotowe/przetworzone jedzenie.
- Użytkownicy deklarują **oszczędność co najmniej 10 minut tygodniowo** na planowanie posiłków (mierzalne w prostej ankiecie wewnątrz aplikacji).
### Stack
Astro 6, React 19, TypeScript, Tailwind CSS 4, Supabase, Cloudflare

