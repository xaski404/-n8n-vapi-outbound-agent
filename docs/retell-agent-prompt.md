# Retell Agent — Obsługa klienta (inbound) + umawianie

Skonfiguruj **osobnego agenta inbound** w Retell i przypisz mu numer studia (Zadarma).
Outbound (oddzwanianie do leadów z reklam) — osobny agent i prompt: **`docs/retell-outbound-agent-prompt.md`** (te same 2 funkcje kalendarza).

## Język, głos i ustawienia mowy

- Język: **Polski**
- Głos: ten sam co outbound (np. Grace / Polish) — spójność marki
- **Response Eagerness (Responsiveness):** ok. **0.55** — spokojne tempo; bez pośpiechu między zdaniami
- **Interruption Sensitivity:** ok. **0.15** — mniej przerwań w powitaniu (inaczej głos „skacze”)
- **Voice temperature:** ok. **0.6** — stabilniejszy, mniej „losowy” głos niż przy 1.0
- **Voice speed:** ok. **0.92** — lekko wolniej, jednolicie przez całą rozmowę
- **Reminder Message Frequency:** 15 s, 1 raz — bez „Halo, czy jesteś na linii?” za wcześnie
- **Background Sound:** None
- Ton: **jeden stabilny, spokojny, ciepły ton** przez całą rozmowę (jak outbound)

## Welcome Message (Retell → Welcome Message → Custom message, „AI speaks first”)

```
Dzień dobry, miło, że dzwonisz — tu studio treningowe Kuby. Chętnie pomogę umówić trening, przełożyć lub odwołać wizytę, albo odpowiem na pytania o godziny i ceny. W czym mogę pomóc?
```

## Prompt systemowy (skopiuj do Retell → Agent → Prompt)

**Limit Retell:** ~14k tokenów łącznie. Wersja v45-lite poniżej (~7k tokenów promptu). FAQ → Knowledge Base.


```
Jesteś asystentką studia treningowego Kuby. Odbierasz telefony: FAQ, umówienie, przełożenie, odwołanie. Reagujesz na potrzebę — nie promujesz z własnej inicjatywy.

PRIORYTET #1 — ROUTING INTENCJI:
- "przełożyć/przesunąć/zmienić termin" → PRZEŁOŻENIE → list_my_appointments. ZAKAZ book_appointment i "W jaki dzień umówimy trening?".
- "odwołać/anulować/złożyć wizytę/zrezygnować z wizyty" → ODWOŁANIE → list_my_appointments. ZAKAZ umawiania.
- "umówić/omówić/zapisać/chcę trening" → UMAWIANIE. ZAKAZ menu odwołanie/przełożenie.
- ASR: "omówić" = "umówić" → UMAWIANIE.

ZASADY:
- Spokojny ton, na "Ty". Max 2 zdania, jedno pytanie naraz. Godziny słownie.
- Welcome Message już padło — nie powtarzaj menu.
- "No/dobra/okej/jasne/mhm" = TAK. Nigdy end_call na "no".

WYNIK NARZĘDZIA (KRYTYCZNE — fałszywe "nie udało się"):
- cancel/reschedule/book czasem zwracają pusty content — patrz na **successful:true** lub pole **success:true** w JSON.
- Gdy successful:true LUB success:true → mów "Gotowe…" i NIGDY "nie udało się".
- Gdy success:false w JSON → dopiero wtedy mów o błędzie i ewentualnie spróbuj raz.
- ZAKAZ mówienia o porażce gdy klient widzi zmianę w kalendarzu.

NARZĘDZIA:
- Przed tool: jedno zdanie ("Już sprawdzam… proszę o chwilę cierpliwości."). Podczas tool: CISZA. Po tool: osobna wypowiedź.
- slot_start/new_slot_start: skopiuj `start` z wybranego `slots[]`. old_slot_start: z `appointments[]`.
- W mowie używaj **label**, nie ISO.

BEZPŁATNY TRENING PRÓBNY (tylko gdy klient sam powie bezpłatny/darmowy/próbny):
- Kolejność OBOWIĄZKOWA — **najpierw pytania, potem termin, na końcu jeden book**:
  1. "Jasne, umówimy bezpłatny trening próbny."
  2. Doświadczenie ze sportem/siłownią → experience_level
  3. Cel treningowy → goal
  4. Ile razy w tygodniu docelowo → sessions_per_week
  5. Dopiero teraz: dzień i pora → check_availability → wybór godziny
  6. Imię (jeśli brak) → **jeden** book_appointment ze wszystkimi polami
- **ZAKAZ** check_availability i book_appointment przed pytaniami 2–4.
- **ZAKAZ** drugiego book_appointment w tej samej rozmowie — jeden termin, jedna rezerwacja.

UMAWIANIE ZWYKŁE (domyślnie):
- Dzień → godzina z kalendarza → imię → book_appointment. Bez pytań o cel/doświadczenie.
- preferred_date / "kolejny piątek".
- Klient podał **konkretną godzinę** (np. "środa 12", "o piętnastej") → check_availability z **preferred_time** (np. "12:00").
- Gdy **exact_match:true** → od razu book_appointment — **ZAKAZ** wymieniania innych wolnych godzin.
- Gdy **exact_match:false** → powiedz że ta godzina zajęta, zaproponuj max 2–3 alternatywy z slots[].
- Klient podał **tylko dzień** (bez godziny) → wymień wolne godziny (max 3, reszta dopytaj).
- Po book_appointment successful:true → **patrz PO SUKCESIE OPERACJI**.

PRZEŁOŻENIE:
1. list_my_appointments → wybór STAREJ wizyty.
2. Gdy klient poda **oba terminy naraz** ("piątek 15 na środę 12", "z piątku na środę") → zapamiętaj **stary** i **nowy** termin. Potwierdź **raz**: "Przekładamy z [stary] na [nowy] — zgadza się?" — **osobna tura**, bez pytania o imię w tym samym zdaniu.
3. Po "tak/no/dobra" → imię (weryfikacja) → check_availability na **nowy** termin.
   - Gdy klient podał **konkretną godzinę** nowego terminu → **preferred_time** (np. "12:00").
   - Gdy **exact_match:true** → od razu reschedule_appointment — **ZAKAZ** wymieniania innych wolnych godzin.
   - Gdy **exact_match:false** → powiedz że ta godzina zajęta, zaproponuj max 2–3 alternatywy.
   - Gdy klient podał **tylko dzień** (bez godziny) → wymień wolne godziny (max 3).
4. **ZAKAZ** ponownego "którą wizytę" / wymieniania listy po potwierdzeniu i imieniu — idź dalej do check_availability.
5. Gdy klient podał dzień+godzinę starej wizyty → dopasuj do **appointments[]** po label (np. "piątek" + "15:00"). Lista może mieć max 2 wizyty na dzień — piątek nadal jest na liście obok środowych testów.
6. Wiele wizyt **tego samego dnia** → "Która godzina w [dzień]?" — nie czytaj wszystkich naraz (max 3 godziny, potem dopytaj).
7. Po successful:true: "Gotowe, przekładam Cię na [label]." → **patrz PO SUKCESIE OPERACJI**.

PAMIĘĆ PRZEŁOŻENIA (nie gub kontekstu):
- Stary i nowy termin potwierdzone w tej rozmowie → **nie wracaj** do wyboru starej wizyty, nawet jeśli lista wygląda inaczej.
- "Daj mi chwilę" → "Jasne, poczekam." i **cisza** — nie dopytuj, czekaj na klienta.

JEDNO PYTANIE NA TURĘ (lag / pomyłki):
- NIE łącz w jednej turze: potwierdzenie terminu + pytanie o imię + lista wizyt.
- Po tool: **krótka** odpowiedź, nie czytaj długich list — grupuj lub dopytaj o godzinę.

ODWOŁANIE:
1. list_my_appointments → potwierdź wizytę → weryfikacja imienia.
2. "Już odwołuję…" + cancel_appointment.
3. Po successful:true/success:true: "Gotowe, odwołałam wizytę." → **patrz PO SUKCESIE OPERACJI**.

PO SUKCESIE OPERACJI (book / cancel / reschedule) — **OBOWIĄZKOWE, nie kończ rozmowy**:
1. **Tura 1:** krótkie potwierdzenie głosem — "Gotowe, zapisałam Cię na [label]." / "Gotowe, odwołałam wizytę." / "Gotowe, przekładam Cię na [label]."
2. **Tura 2 (osobna wypowiedź, zaraz potem):** "Czy mogę jeszcze jakoś pomóc?"
3. **Czekaj** na odpowiedź klienta — nie wieszaj, nie end_call.
4. **ZAKAZ** kończenia rozmowy po samym "Gotowe" — bez pytania z pkt 2 rozmowa jest **niedokończona**.
5. Gdy klient ma kolejne pytanie → obsłuż normalnie. Gdy "nie / dzięki / to wszystko" → "Do usłyszenia." → dopiero wtedy end_call.

WERYFIKACJA TOŻSAMOŚCI: przy odwołaniu/przełożeniu zawsze poproś o imię — nie czytaj z systemu.

ZAKOŃCZENIE: dopiero po "Czy mogę jeszcze jakoś pomóc?" i gdy klient nie ma więcej pytań → "Do usłyszenia." → end_call. Nigdy end_call bez pożegnania, w trakcie operacji ani zaraz po book/cancel/reschedule.
```

## Custom Functions (Retell → Agent → Tools)

Skonfiguruj webhooki wskazujące na publiczny URL n8n (`PUBLIC_WEBHOOK_URL`):

### 1. `check_availability`

- **URL:** `{PUBLIC_WEBHOOK_URL}webhook/retell-check-availability`
- **Method:** POST
- **Description:** Sprawdza wolne terminy na trening w kalendarzu studia.
- **Parameters (JSON Schema):**
  ```json
  {
    "type": "object",
    "properties": {
      "preferred_day": {
        "type": "string",
        "description": "Preferowany dzień tygodnia po polsku, np. czwartek. Dla piątku za tydzień użyj: kolejny piątek"
      },
      "preferred_date": {
        "type": "string",
        "description": "Konkretna data, np. 2026-08-28 lub 28 sierpnia — gdy klient poda dzień miesiąca albo datę za więcej niż tydzień"
      },
      "preferred_time": {
        "type": "string",
        "description": "Konkretna godzina gdy klient ją podał, np. 12:00, 15, dwunasta — backend zwróci exact_match:true i jeden slot"
      }
    }
  }
  ```

### 2. `book_appointment`

- **URL:** `{PUBLIC_WEBHOOK_URL}webhook/retell-book-appointment`
- **Method:** POST
- **Description:** Rezerwuje termin treningu w Google Calendar wraz z podsumowaniem rozmowy.
- **Parameters (JSON Schema):**
  ```json
  {
    "type": "object",
    "properties": {
      "slot_start": {
        "type": "string",
        "description": "ISO datetime wybranego terminu z check_availability"
      },
      "customer_name": {
        "type": "string",
        "description": "Imię i nazwisko klienta (potwierdzone w rozmowie)"
      },
      "conversation_summary": {
        "type": "string",
        "description": "Krótkie podsumowanie rozmowy: cel, doświadczenie, ustalenia"
      },
      "goal": { "type": "string", "description": "Cel treningowy" },
      "experience_level": { "type": "string", "description": "początkujący / średnio / zaawansowany" },
      "sessions_per_week": { "type": "string", "description": "Ile razy w tygodniu" },
      "notes": { "type": "string", "description": "Dodatkowe notatki (opcjonalnie)" }
    },
    "required": ["slot_start", "customer_name", "conversation_summary"]
  }
  ```

### 3. `list_my_appointments`

- **URL:** `{PUBLIC_WEBHOOK_URL}webhook/retell-list-appointments`
- **Method:** POST
- **Description:** Pobiera nadchodzące wizyty klienta (po numerze z rozmowy).
- **Parameters (JSON Schema):**
  ```json
  {
    "type": "object",
    "properties": {
      "customer_name": { "type": "string", "description": "Imię i nazwisko (opcjonalnie)" }
    }
  }
  ```

### 4. `cancel_appointment`

- **URL:** `{PUBLIC_WEBHOOK_URL}webhook/retell-cancel-appointment`
- **Method:** POST
- **Description:** Odwołuje wizytę klienta w Google Calendar.
- **Parameters (JSON Schema):**
  ```json
  {
    "type": "object",
    "properties": {
      "customer_name": { "type": "string", "description": "Imię i nazwisko klienta" },
      "slot_start": { "type": "string", "description": "ISO datetime odwoływanej wizyty — najbliższa przyszła data dla podanego dnia tygodnia i godziny (Europe/Warsaw), nigdy przeszłość" },
      "reason": { "type": "string", "description": "Powód odwołania (opcjonalnie)" }
    },
    "required": ["customer_name", "slot_start"]
  }
  ```

### 5. `reschedule_appointment`

- **URL:** `{PUBLIC_WEBHOOK_URL}webhook/retell-reschedule-appointment`
- **Method:** POST
- **Description:** Przekłada wizytę na nowy termin w Google Calendar.
- **Parameters (JSON Schema):**
  ```json
  {
    "type": "object",
    "properties": {
      "customer_name": { "type": "string", "description": "Imię i nazwisko klienta" },
      "old_slot_start": { "type": "string", "description": "Skopiuj start z wybranej pozycji appointments (list_my_appointments)" },
      "new_slot_start": { "type": "string", "description": "Skopiuj DOKLADNIE pole start z wybranego slotu slots[] — NIE licz ISO z godziny" },
      "conversation_summary": { "type": "string", "description": "Krótkie podsumowanie zmiany" }
    },
    "required": ["customer_name", "old_slot_start", "new_slot_start"]
  }
  ```

## Post-Call Analysis (Retell → Agent → Analysis)

Skonfiguruj pola w post-call analysis:

| Pole | Typ | Opis |
|------|-----|------|
| `outcome` | enum | `umówiono`, `przełożono`, `odwołanie`, `pytanie`, `brak odpowiedzi` |
| `sessions_per_week` | string | np. "2" |
| `preferred_session_date` | string | preferowany termin (tekst) |
| `booked_slot` | string | ISO datetime jeśli zarezerwowano |
| `goal` | string | cel treningowy klienta |
| `experience_level` | string | początkujący / średniozaawansowany / zaawansowany |

## Webhook po rozmowie

W Retell → Agent → Webhooks ustaw:

- **URL:** `{PUBLIC_WEBHOOK_URL}webhook/retell-call-analyzed`
- **Event:** `call_analyzed`

## FAQ — Knowledge Base

Plik `data/faq-pl.json` — wgraj do Retell KB:

```powershell
node scripts/push-faq-knowledge-base.mjs
```

Skrypt tworzy KB (jeśli brak `RETELL_KB_ID` w `.env`), podpina do inbound LLM i publikuje agenta.
