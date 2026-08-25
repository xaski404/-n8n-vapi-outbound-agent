/**
 * Scheduling helpers for Retell custom-function webhooks.
 * Used by n8n Code nodes: check availability + book appointment.
 */

export interface StudioScheduleConfig {
  timezone: string;
  openHour: number;
  closeHour: number;
  workDays: number[]; // 0=Sun … 6=Sat
  durationMinutes: number;
  slotStepMinutes: number;
  maxSlotsReturned: number;
  daysAhead: number;
}

export interface RetellToolRequest {
  functionName: string;
  args: Record<string, unknown>;
  callId: string | null;
  callerPhone: string | null;
  callerName: string | null;
  direction?: string;
  campaignName?: string | null;
  callSummary?: string | null;
}

export interface TimeSlot {
  start: string; // ISO-8601
  end: string;
  labelPl: string;
}

export interface CalendarBusyBlock {
  start: string;
  end: string;
}

export interface BookingRequest {
  slotStart: string;
  customerName: string;
  customerPhone: string;
  notes?: string;
  goal?: string;
  experienceLevel?: string;
  sessionsPerWeek?: string;
  conversationSummary?: string;
  direction?: 'inbound' | 'outbound' | string;
  campaignName?: string;
  callId?: string | null;
}

export interface CalendarEventPayload {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties?: { private: Record<string, string> };
  attendees?: Array<{ email?: string; displayName?: string }>;
  reminders: { useDefault: false; overrides: Array<{ method: string; minutes: number }> };
}

export interface CalendarListEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CancelAppointmentRequest {
  customerPhone: string;
  customerName: string;
  slotStart: string;
  reason?: string;
}

export interface RescheduleAppointmentRequest extends BookingRequest {
  oldSlotStart: string;
}

const POLISH_DAYS: Record<string, number> = {
  niedziela: 0,
  niedziele: 0,
  poniedzialek: 1,
  wtorek: 2,
  wtorke: 2,
  sroda: 3,
  srode: 3,
  czwartek: 4,
  piatek: 5,
  sobota: 6,
};

const POLISH_MONTHS: Record<string, number> = {
  stycznia: 1,
  styczen: 1,
  lutego: 2,
  luty: 2,
  marca: 3,
  marzec: 3,
  kwietnia: 4,
  kwiecien: 4,
  maja: 5,
  maj: 5,
  czerwca: 6,
  czerwiec: 6,
  lipca: 7,
  lipiec: 7,
  sierpnia: 8,
  sierpien: 8,
  wrzesnia: 9,
  wrzesien: 9,
  pazdziernika: 10,
  pazdziernik: 10,
  listopada: 11,
  listopad: 11,
  grudnia: 12,
  grudzien: 12,
};

export interface AvailabilityQuery {
  preferredDows?: number[];
  preferredDateYmd?: string;
  skipOccurrences?: number;
}

function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

function normalizeDayToken(value: string): string {
  return stripDiacritics(value.toLowerCase().trim());
}

/** Parse one or more Polish weekday tokens, e.g. "środę albo wtorek". */
export function parsePreferredDays(preferredDay?: string): number[] | undefined {
  if (!preferredDay?.trim()) return undefined;

  const dows = new Set<number>();
  for (const token of preferredDay.split(/\s+(?:albo|lub|or)\s+|,/i)) {
    const normalized = normalizeDayToken(token.replace(/\b\d{1,2}\b/g, '').trim());
    if (!normalized) continue;

    const dow =
      POLISH_DAYS[normalized] ??
      POLISH_DAYS[normalized.replace(/e$/, 'a')] ??
      POLISH_DAYS[normalized.replace(/a$/, 'e')];

    if (dow !== undefined) dows.add(dow);
  }

  return dows.size > 0 ? [...dows] : undefined;
}

/** Parse a calendar date from ISO or Polish phrasing, e.g. "28 sierpnia", "2026-08-28", "28.08". */
export function parsePreferredDate(
  input: string,
  now: Date = new Date(),
  timezone = 'Europe/Warsaw',
): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dotted = raw.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/);
  if (dotted) {
    const day = parseInt(dotted[1], 10);
    const month = parseInt(dotted[2], 10);
    let year = dotted[3] ? parseInt(dotted[3], 10) : parseInt(zonedParts(now, timezone).ymd.slice(0, 4), 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const normalized = stripDiacritics(raw.toLowerCase());
  const monthMatch = normalized.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (monthMatch) {
    const day = parseInt(monthMatch[1], 10);
    const month = POLISH_MONTHS[monthMatch[2]];
    let year = monthMatch[3]
      ? parseInt(monthMatch[3], 10)
      : parseInt(zonedParts(now, timezone).ymd.slice(0, 4), 10);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const bareDay = normalized.match(/^(\d{1,2})$/);
  if (bareDay) {
    const day = parseInt(bareDay[1], 10);
    if (day >= 1 && day <= 31) {
      const parts = zonedParts(now, timezone);
      let year = parseInt(parts.ymd.slice(0, 4), 10);
      let month = parseInt(parts.ymd.slice(5, 7), 10);
      const todayDay = parseInt(parts.ymd.slice(8, 10), 10);
      if (day < todayDay) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return undefined;
}

/** Combine preferred_day / preferred_date into slot filters for getAvailableSlots. */
export function parseAvailabilityQuery(
  preferredDay?: string,
  preferredDate?: string,
  now: Date = new Date(),
  timezone = 'Europe/Warsaw',
): AvailabilityQuery {
  const query: AvailabilityQuery = {};

  if (preferredDate?.trim()) {
    const ymd = parsePreferredDate(preferredDate, now, timezone);
    if (ymd) query.preferredDateYmd = ymd;
  }

  if (preferredDay?.trim()) {
    const normalized = stripDiacritics(preferredDay.toLowerCase());
    let dayText = preferredDay;
    if (/\b(kolejny|nastepny|nastepnego|za tydzien)\b/.test(normalized)) {
      query.skipOccurrences = 1;
      dayText = preferredDay.replace(
        /\b(kolejny|następny|nastepny|następnego|nastepnego|za tydzień|za tydzien)\b/gi,
        '',
      ).trim();
    }
    const dows = parsePreferredDays(dayText);
    if (dows) query.preferredDows = dows;

    if (!query.preferredDateYmd) {
      const dayNum = dayText.match(/\b(\d{1,2})\b/);
      if (dayNum) {
        const ymd = parsePreferredDate(dayNum[1], now, timezone);
        if (ymd) query.preferredDateYmd = ymd;
      }
    }
  }

  return query;
}

export type TimeOfDay = 'rano' | 'po_poludniu' | 'wieczorem';

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  rano: 'rano',
  po_poludniu: 'po południu',
  wieczorem: 'wieczorem',
};

/** Parse preferred time-of-day from agent args or Polish speech. */
export function parseTimeOfDay(input?: string | null): TimeOfDay | undefined {
  if (!input?.trim()) return undefined;
  const n = stripDiacritics(input.toLowerCase());
  if (/\b(rano|poran|morning)\b/.test(n)) return 'rano';
  if (/\b(poludniu|poludni|popoludniu|popoludni|afternoon)\b/.test(n)) return 'po_poludniu';
  if (/\b(wieczor\w*|evening)\b/.test(n)) return 'wieczorem';
  return undefined;
}

const POLISH_HOUR_WORDS: Record<string, number> = {
  osma: 8,
  dziewiata: 9,
  dziesiata: 10,
  jedenasta: 11,
  dwunasta: 12,
  trzynasta: 13,
  czternasta: 14,
  pietnasta: 15,
  szesnasta: 16,
  siedemnasta: 17,
  osiemnasta: 18,
  dziewietnasta: 19,
  dwudziesta: 20,
};

/** Parse concrete clock time, e.g. 12:00, 15, dwunasta, o pietnastej. */
export function parsePreferredTime(input?: string | null): { hour: number; minute: number } | undefined {
  if (!input?.trim()) return undefined;
  const n = stripDiacritics(input.toLowerCase().trim());

  const hm = n.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const hour = parseInt(hm[1], 10);
    const minute = parseInt(hm[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }

  for (const [word, hour] of Object.entries(POLISH_HOUR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(n)) return { hour, minute: 0 };
  }

  const bare = n.match(/\b(\d{1,2})\b/);
  if (bare) {
    const hour = parseInt(bare[1], 10);
    if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
  }

  return undefined;
}

function slotMatchesPreferredTime(
  slot: TimeSlot,
  preferred: { hour: number; minute: number },
  timezone: string,
): boolean {
  const parts = zonedParts(new Date(slot.start), timezone);
  return parts.hour === preferred.hour && parts.minute === preferred.minute;
}

function slotHourInTimezone(slot: TimeSlot, timezone: string): number {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
      new Date(slot.start),
    ),
    10,
  );
}

/** Filter slots by rano (<12), po południu (12–16), wieczorem (≥17). */
export function filterSlotsByTimeOfDay(
  slots: TimeSlot[],
  period: TimeOfDay,
  timezone: string,
): TimeSlot[] {
  return slots.filter((slot) => {
    const hour = slotHourInTimezone(slot, timezone);
    if (period === 'rano') return hour < 12;
    if (period === 'po_poludniu') return hour >= 12 && hour < 17;
    return hour >= 17;
  });
}

function mapSlotsForResponse(
  slots: TimeSlot[],
  timezone: string,
): Array<{ start: string; end: string; label: string }> {
  return slots.map((s) => ({
    start: formatSlotStartForAgent(s.start, timezone),
    end: s.end,
    label: s.labelPl,
  }));
}

/** ISO with local offset so agent copies hour matching label (avoids 19:00 → 20:00 UTC mistakes). */
export function formatSlotStartForAgent(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = zonedParts(date, timezone);
  const [y, mo, d] = parts.ymd.split('-').map((n) => parseInt(n, 10));
  const utcMs = Date.UTC(y, mo - 1, d, parts.hour, parts.minute, 0);
  const localMs = wallClockToDate(parts.ymd, parts.hour, parts.minute, timezone).getTime();
  const offsetMin = Math.round((utcMs - localMs) / 60_000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  const h = String(parts.hour).padStart(2, '0');
  const m = String(parts.minute).padStart(2, '0');
  return `${parts.ymd}T${h}:${m}:00${sign}${offH}:${offM}`;
}

/**
 * Snap LLM-provided slot to a real available slot on that day.
 * Fixes common UTC offset error (client asks 19:00, agent sends instant that reads 20:00 local).
 */
export function resolveAgentSlotStart(
  slotStartIso: string,
  config: StudioScheduleConfig,
  busyBlocks: CalendarBusyBlock[],
  now: Date = new Date(),
): string {
  const slot = new Date(slotStartIso);
  if (Number.isNaN(slot.getTime())) return slotStartIso;

  const timezone = config.timezone;
  const parts = zonedParts(slot, timezone);
  const available = getAvailableSlots(config, busyBlocks, now, undefined, {
    preferredDateYmd: parts.ymd,
    preferredDows: undefined,
    skipOccurrences: 0,
  });

  const matchLocal = (hour: number, minute: number) =>
    available.find((s) => {
      const p = zonedParts(new Date(s.start), timezone);
      return p.hour === hour && p.minute === minute;
    });

  let hit = matchLocal(parts.hour, parts.minute);
  if (hit) return hit.start;

  // LLM often sends UTC one hour late → decoded local hour is 1 too high (19:00 chosen → 20:00 booked)
  hit = matchLocal(parts.hour - 1, parts.minute);
  if (hit) return hit.start;

  return wallClockToDate(parts.ymd, parts.hour, parts.minute, timezone).toISOString();
}

function formatSlotLabel(start: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('pl-PL', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(start);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function defaultStudioConfig(overrides: Partial<StudioScheduleConfig> = {}): StudioScheduleConfig {
  return {
    timezone: 'Europe/Warsaw',
    openHour: 8,
    closeHour: 20,
    workDays: [1, 2, 3, 4, 5],
    durationMinutes: 60,
    slotStepMinutes: 60,
    maxSlotsReturned: 12,
    daysAhead: 42,
    ...overrides,
  };
}

/** Parse Retell custom-function webhook body. */
export function parseRetellToolRequest(body: Record<string, unknown>): RetellToolRequest {
  const root = (body.body as Record<string, unknown> | undefined) ?? body;
  const args =
    (root.args as Record<string, unknown> | undefined) ??
    (root.arguments as Record<string, unknown> | undefined) ??
    (root.parameters as Record<string, unknown> | undefined) ??
    {};

  const call = (root.call as Record<string, unknown> | undefined) ?? {};
  const vars = (call.retell_llm_dynamic_variables as Record<string, string> | undefined) ?? {};

  const functionName = String(
    root.name ?? root.function_name ?? root.tool_name ?? root.function ?? 'unknown',
  );

  const direction = String(call.direction ?? '');
  const callerPhoneRaw =
    direction === 'outbound'
      ? call.to_number?.toString()
      : (call.from_number ?? call.to_number)?.toString();
  const callerPhone =
    callerPhoneRaw ??
    vars.phone_number ??
    (args.phone as string | undefined) ??
    null;

  const callerName =
    vars.full_name ??
    (args.customer_name as string | undefined) ??
    (args.full_name as string | undefined) ??
    null;

  const analysis = (call.call_analysis as Record<string, unknown> | undefined) ?? {};

  return {
    functionName,
    args,
    callId: call.call_id != null ? String(call.call_id) : null,
    callerPhone,
    callerName,
    direction,
    campaignName: vars.campaign_name ?? null,
    callSummary:
      typeof analysis.call_summary === 'string' ? analysis.call_summary : null,
  };
}

/** Extract busy blocks from Google Calendar freeBusy API response. */
export function parseCalendarBusyBlocks(
  freeBusyResponse: Record<string, unknown>,
  calendarId: string,
): CalendarBusyBlock[] {
  const calendars = (freeBusyResponse.calendars as Record<string, unknown> | undefined) ?? {};
  const cal = (calendars[calendarId] as Record<string, unknown> | undefined) ?? {};
  const busy = (cal.busy as Array<{ start?: string; end?: string }> | undefined) ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: b.start!, end: b.end! }));
}

/** Generate candidate slots within business hours, excluding busy blocks. */
export function getAvailableSlots(
  config: StudioScheduleConfig,
  busyBlocks: CalendarBusyBlock[],
  now: Date = new Date(),
  preferredDay?: string,
  availabilityQuery?: AvailabilityQuery,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const busy = busyBlocks.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  const query = availabilityQuery ?? parseAvailabilityQuery(preferredDay, undefined, now, config.timezone);
  const preferredDows = query.preferredDows;
  const preferredDateYmd = query.preferredDateYmd;
  const skipOccurrences = query.skipOccurrences ?? 0;
  const dowOccurrence: Record<number, number> = {};

  const pushSlot = (slotStart: Date) => {
    const slotEnd = new Date(slotStart.getTime() + config.durationMinutes * 60_000);
    if (slotStart <= now) return;
    const endParts = zonedParts(slotEnd, config.timezone);
    if (endParts.hour > config.closeHour || (endParts.hour === config.closeHour && endParts.minute > 0)) {
      return;
    }
    if (busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end))) return;
    slots.push({
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      labelPl: formatSlotLabel(slotStart, config.timezone),
    });
  };

  if (preferredDateYmd) {
    const dateParts = zonedParts(wallClockToDate(preferredDateYmd, 12, 0, config.timezone), config.timezone);
    if (!config.workDays.includes(dateParts.dow)) return slots;
    if (preferredDows !== undefined && !preferredDows.includes(dateParts.dow)) return slots;

    for (let hour = config.openHour; hour < config.closeHour && slots.length < config.maxSlotsReturned; hour += config.slotStepMinutes / 60) {
      const h = Math.floor(hour);
      const m = Math.round((hour - h) * 60);
      pushSlot(wallClockToDate(preferredDateYmd, h, m, config.timezone));
    }
    return slots;
  }

  const baseYmd = zonedParts(now, config.timezone).ymd;
  for (let dayOffset = 0; dayOffset <= config.daysAhead && slots.length < config.maxSlotsReturned; dayOffset++) {
    const ymd = addDaysToYmd(baseYmd, dayOffset);
    const parts = zonedParts(wallClockToDate(ymd, 12, 0, config.timezone), config.timezone);
    const dow = parts.dow;

    if (!config.workDays.includes(dow)) continue;
    if (preferredDateYmd && ymd !== preferredDateYmd) continue;
    if (preferredDows !== undefined && !preferredDows.includes(dow)) continue;
    if (skipOccurrences > 0 && preferredDows !== undefined) {
      dowOccurrence[dow] = (dowOccurrence[dow] ?? 0) + 1;
      if (dowOccurrence[dow] <= skipOccurrences) continue;
    }

    for (let hour = config.openHour; hour < config.closeHour; hour += config.slotStepMinutes / 60) {
      const h = Math.floor(hour);
      const m = Math.round((hour - h) * 60);
      pushSlot(wallClockToDate(ymd, h, m, config.timezone));
      if (slots.length >= config.maxSlotsReturned) break;
    }
  }

  return slots;
}

function bookingTitle(booking: BookingRequest): string {
  const label = booking.direction === 'outbound' ? 'Trening próbny' : 'Trening';
  return `${label} — ${booking.customerName}`;
}

function buildEventDescription(booking: BookingRequest): string {
  const summaryBlock =
    booking.conversationSummary ??
    booking.notes ??
    booking.callSummary ??
    '';

  return [
    `Telefon: ${booking.customerPhone}`,
    booking.direction
      ? `Kierunek: ${booking.direction === 'outbound' ? 'outbound (lead Meta)' : 'inbound (recepcja)'}`
      : '',
    booking.campaignName ? `Kampania: ${booking.campaignName}` : '',
    booking.goal ? `Cel treningu: ${booking.goal}` : '',
    booking.experienceLevel ? `Doświadczenie: ${booking.experienceLevel}` : '',
    booking.sessionsPerWeek ? `Treningi/tydz.: ${booking.sessionsPerWeek}` : '',
    summaryBlock ? `Podsumowanie rozmowy:\n${summaryBlock}` : '',
    'Zarezerwowano przez Voice AI (Retell)',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Normalize phone for matching (strip spaces, keep leading +). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\s/g, '').trim();
}

/** Digits-only phone for fuzzy matching (+48… vs 48… vs local 9 digits). */
export function phoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

function phonesMatch(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 9 && db.length >= 9 && da.slice(-9) === db.slice(-9)) return true;
  return false;
}

/** Common stored/search forms for customer_phone (+48…, digits-only, local 9). */
export function phoneSearchVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  const digits = phoneDigits(phone);
  const variants = new Set<string>();
  if (normalized) variants.add(normalized);
  if (digits) {
    variants.add(digits);
    if (digits.startsWith('48') && digits.length >= 11) variants.add(`+${digits}`);
    if (digits.length >= 9) variants.add(digits.slice(-9));
  }
  return [...variants];
}

const WEEKDAY_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date: Date, timezone: string): { dow: number; hour: number; minute: number; ymd: string } {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const hour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(date),
    10,
  );
  const minute = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, minute: '2-digit' }).format(date),
    10,
  );
  return { dow: WEEKDAY_TO_DOW[weekday] ?? date.getDay(), hour, minute, ymd };
}

function addDaysToYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map((part) => parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function wallClockToDate(ymd: string, hour: number, minute: number, timezone: string): Date {
  const [year, month, day] = ymd.split('-').map((part) => parseInt(part, 10));
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = zonedParts(new Date(utcMs), timezone);
    if (parts.ymd === ymd && parts.hour === hour && parts.minute === minute) {
      return new Date(utcMs);
    }

    const desiredMinutes = hour * 60 + minute;
    const actualMinutes = parts.hour * 60 + parts.minute;
    let deltaMinutes = desiredMinutes - actualMinutes;

    if (parts.ymd > ymd) deltaMinutes -= 24 * 60;
    if (parts.ymd < ymd) deltaMinutes += 24 * 60;

    utcMs += deltaMinutes * 60_000;
  }

  return new Date(utcMs);
}

/** When the LLM sends a past/wrong calendar date but correct weekday+time, roll forward. */
export function resolveFutureSlotStart(
  slotStartIso: string,
  now: Date = new Date(),
  timezone = 'Europe/Warsaw',
): string {
  const slot = new Date(slotStartIso);
  if (Number.isNaN(slot.getTime())) return slotStartIso;
  if (slot.getTime() >= now.getTime() - 2 * 60 * 60_000) return slotStartIso;

  const target = zonedParts(slot, timezone);

  for (let dayOffset = 0; dayOffset <= 21; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const parts = zonedParts(day, timezone);
    if (parts.dow !== target.dow) continue;

    const candidate = wallClockToDate(parts.ymd, target.hour, target.minute, timezone);
    if (candidate.getTime() >= now.getTime() - 2 * 60 * 60_000) {
      return candidate.toISOString();
    }
  }

  return slotStartIso;
}

/** Cancel/reschedule: nearest future weekday+time; snap if LLM sends a far-future same weekday. */
export function resolveCancelSlotStart(
  slotStartIso: string,
  now: Date = new Date(),
  timezone = 'Europe/Warsaw',
): string {
  const slot = new Date(slotStartIso);
  if (Number.isNaN(slot.getTime())) return slotStartIso;

  const target = zonedParts(slot, timezone);
  let nearest: Date | null = null;

  for (let dayOffset = 0; dayOffset <= 49; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const parts = zonedParts(day, timezone);
    if (parts.dow !== target.dow) continue;
    const candidate = wallClockToDate(parts.ymd, target.hour, target.minute, timezone);
    if (candidate.getTime() >= now.getTime() - 2 * 60 * 60_000) {
      nearest = candidate;
      break;
    }
  }

  if (!nearest) return resolveFutureSlotStart(slotStartIso, now, timezone);

  if (slot.getTime() < now.getTime() - 2 * 60 * 60_000) {
    return nearest.toISOString();
  }

  // "piątek o trzynastej" without month — LLM often sends wrong month; prefer nearest occurrence
  if (slot.getTime() > nearest.getTime() + 7 * 24 * 60 * 60_000) {
    return nearest.toISOString();
  }

  return slot.toISOString();
}

/** Build Google Calendar events.list URL to find appointments by phone (+ optional slot).
 *  Uses a ±48h window around slotStart so that off-by-one-day errors from ASR
 *  still find the correct event. Falls back to a forward-looking window when slot is in the past. */
export function buildEventsListUrl(
  calendarId: string,
  phone: string,
  slotStart?: string,
  config: StudioScheduleConfig = defaultStudioConfig(),
  now: Date = new Date(),
): string {
  let timeMin = now.toISOString();
  let timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + config.daysAhead + 7);

  if (slotStart) {
    const resolvedSlot = resolveFutureSlotStart(slotStart, now, config.timezone);
    const slot = new Date(resolvedSlot);
    if (!Number.isNaN(slot.getTime())) {
      const toleranceMs = 48 * 60 * 60_000;
      timeMin = new Date(Math.max(now.getTime(), slot.getTime() - toleranceMs)).toISOString();
      timeMax = new Date(slot.getTime() + toleranceMs);
    }
  }

  if (timeMax.getTime() < new Date(timeMin).getTime()) {
    timeMin = now.toISOString();
    timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + config.daysAhead + 7);
  }

  let qs =
    `timeMin=${encodeURIComponent(timeMin)}` +
    `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
    `&singleEvents=true&orderBy=startTime&maxResults=250` +
    `&fields=${encodeURIComponent('items(id,summary,description,start,end,extendedProperties)')}`;

  // Client-side phone matching (phonesMatch) — do not use Google q= here; it skips
  // events whose phone lives only in extendedProperties.private.customer_phone.
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs}`;
}

function eventStartMs(event: CalendarListEvent): number | null {
  const startStr = event.start?.dateTime ?? event.start?.date;
  if (!startStr) return null;
  const ms = new Date(startStr).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Pick the best matching event for cancel/reschedule. */
export function findMatchingCalendarEvent(
  listResponse: Record<string, unknown>,
  phone: string,
  slotStart?: string,
  customerName?: string,
  now: Date = new Date(),
  timezone = 'Europe/Warsaw',
): CalendarListEvent | null {
  const items = (listResponse.items as CalendarListEvent[] | undefined) ?? [];
  const candidates = items.filter((event) => eventMatchesCustomer(event, phone, customerName));

  if (candidates.length === 0) return null;
  if (!slotStart) return candidates[0];

  const resolvedSlot = resolveFutureSlotStart(slotStart, now, timezone);
  const target = new Date(resolvedSlot).getTime();
  if (Number.isNaN(target)) return null;

  let best: CalendarListEvent | null = null;
  let bestDelta = Infinity;

  for (const event of candidates) {
    const startMs = eventStartMs(event);
    if (startMs == null) continue;
    const delta = Math.abs(startMs - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = event;
    }
  }

  const toleranceMs = 3 * 60 * 60 * 1000;
  if (best && bestDelta <= toleranceMs) return best;

  return null;
}

function eventMatchesCustomer(
  event: CalendarListEvent,
  phone: string,
  customerName?: string,
): boolean {
  const normalizedPhone = normalizePhone(phone);
  const nameTokens = (customerName ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => stripDiacritics(t))
    .filter((t) => t.length > 2);

  const privPhone = event.extendedProperties?.private?.customer_phone;
  if (privPhone && phonesMatch(privPhone, phone)) return true;
  const telLine = event.description?.match(/Telefon:\s*([+\d\s()-]+)/i)?.[1];
  if (telLine && phonesMatch(telLine, phone)) return true;
  if (event.description) {
    const descDigits = phoneDigits(event.description);
    const want = phoneDigits(phone);
    if (want && (descDigits.includes(want) || (want.length >= 9 && descDigits.includes(want.slice(-9))))) {
      return true;
    }
  }
  if (normalizedPhone && event.description?.includes(normalizedPhone)) return true;
  if (nameTokens.length > 0) {
    const hay = stripDiacritics(`${event.summary ?? ''} ${event.description ?? ''}`.toLowerCase());
    if (nameTokens.some((t) => hay.includes(t))) return true;
  }
  return false;
}

export function slotLabelFromIso(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatSlotLabel(date, timezone);
}

/** Prefer appointments across days so test duplicates on one day do not hide Friday etc. */
export function selectAppointmentsForList<T extends { startMs: number }>(
  rows: T[],
  timezone: string,
  maxTotal = 12,
  maxPerDay = 2,
): T[] {
  const sorted = [...rows].sort((a, b) => a.startMs - b.startMs);
  const byDay = new Map<string, T[]>();
  for (const row of sorted) {
    const day = zonedParts(new Date(row.startMs), timezone).ymd;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(row);
  }
  if (byDay.size <= 1) {
    return sorted.slice(0, maxTotal);
  }

  const days = [...byDay.keys()].sort();
  const selected: T[] = [];
  for (let round = 0; round < maxPerDay && selected.length < maxTotal; round++) {
    for (const day of days) {
      const dayRows = byDay.get(day)!;
      if (round < dayRows.length) {
        selected.push(dayRows[round]);
        if (selected.length >= maxTotal) break;
      }
    }
  }
  return selected.sort((a, b) => a.startMs - b.startMs);
}

/** Upcoming appointments for caller phone (cancel/reschedule disambiguation). */
export function formatListAppointmentsResponse(
  listResponse: Record<string, unknown>,
  phone: string,
  customerName: string | undefined,
  config: StudioScheduleConfig,
  now: Date = new Date(),
  maxReturned = 12,
): Record<string, unknown> {
  if ((listResponse as { error?: { message?: string } }).error?.message) {
    return {
      found: false,
      message: `Błąd kalendarza: ${(listResponse as { error: { message: string } }).error.message}`,
      appointments: [],
    };
  }

  const rawItems = (listResponse.items as CalendarListEvent[] | undefined) ?? [];
  const items = rawItems.filter((event) => eventMatchesCustomer(event, phone, customerName));

  const upcoming = selectAppointmentsForList(
    items
      .map((event) => ({ event, startMs: eventStartMs(event)! }))
      .filter((row) => row.startMs != null && row.startMs >= now.getTime() - 60_000),
    config.timezone,
    maxReturned,
    2,
  );

  const appointments = upcoming.map(({ event }) => {
    const startIso = event.start?.dateTime ?? event.start?.date ?? '';
    return {
      eventId: event.id,
      slot_start: startIso,
      label: startIso ? slotLabelFromIso(startIso, config.timezone) : '',
      summary: event.summary ?? '',
    };
  });

  if (appointments.length === 0) {
    return {
      found: false,
      message: 'Nie widzę nadchodzących wizyt na ten numer telefonu.',
      appointments: [],
    };
  }

  const labels = appointments.map((a) => a.label);
  const dayKey = (label: string) => {
    const m = label.match(/^[^,]+,\s*\d+\s+\S+/);
    return m ? m[0] : label.split(' ').slice(0, 2).join(' ');
  };
  const byDay = new Map<string, string[]>();
  for (const a of appointments) {
    const day = dayKey(a.label);
    const hour = a.label.replace(/^.*?\s(\d{1,2}:\d{2})$/, '$1');
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(hour);
  }
  let message: string;
  if (byDay.size === 1) {
    const [day, hours] = [...byDay.entries()][0];
    message =
      hours.length > 3
        ? `${hours.length} wizyt w ${day} — podaj godzinę wizyty do przesunięcia`
        : `Wizyty w ${day}: ${hours.join(', ')}`;
  } else {
    message = `Nadchodzące wizyty: ${labels.join('; ')}`;
  }

  return {
    found: true,
    message,
    appointments,
  };
}

export function buildDeleteEventUrl(calendarId: string, eventId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

export function buildPatchEventUrl(calendarId: string, eventId: string): string {
  return buildDeleteEventUrl(calendarId, eventId);
}

/** Build Google Calendar event payload with CRM context from the call. */
export function buildCalendarEvent(
  booking: BookingRequest,
  config: StudioScheduleConfig,
): CalendarEventPayload {
  const start = new Date(booking.slotStart);
  const end = new Date(start.getTime() + config.durationMinutes * 60_000);

  return {
    summary: bookingTitle(booking),
    description: buildEventDescription(booking),
    start: { dateTime: start.toISOString(), timeZone: config.timezone },
    end: { dateTime: end.toISOString(), timeZone: config.timezone },
    extendedProperties: {
      private: {
        customer_phone: normalizePhone(booking.customerPhone),
        booked_slot: booking.slotStart,
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 1440 },
      ],
    },
  };
}

export interface AvailabilityResponseOptions {
  preferredTimeOfDay?: TimeOfDay;
  preferredTime?: { hour: number; minute: number };
  timezone?: string;
}

/** Format slots as JSON Retell agent can read aloud. */
export function formatAvailabilityResponse(
  slots: TimeSlot[],
  options: AvailabilityResponseOptions = {},
): Record<string, unknown> {
  const timezone = options.timezone ?? 'Europe/Warsaw';
  const period = options.preferredTimeOfDay;
  const preferredTime = options.preferredTime;

  if (slots.length === 0) {
    return {
      available: false,
      message:
        'Brak wolnych terminów w tym dniu. Powiedz: „Niestety tego dnia nie mam już wolnych terminów.” i zapytaj jaki inny dzień klientowi pasuje — potem check_availability z nowym preferred_day lub preferred_date.',
      slots: [],
    };
  }

  if (preferredTime) {
    const exact = slots.find((s) => slotMatchesPreferredTime(s, preferredTime, timezone));
    if (exact) {
      return {
        available: true,
        exact_match: true,
        message: `Termin ${exact.labelPl} jest wolny — od razu użyj tego slotu (book/reschedule), nie wymieniaj innych godzin.`,
        slots: mapSlotsForResponse([exact], timezone),
      };
    }
    const timeLabel = `${String(preferredTime.hour).padStart(2, '0')}:${String(preferredTime.minute).padStart(2, '0')}`;
    return {
      available: true,
      exact_match: false,
      message: `O ${timeLabel} brak wolnego terminu. Zaproponuj max 2–3 inne godziny tego samego dnia z slots[]. Gdy klientowi nie pasują — zapytaj jaki inny dzień mu odpowiada.`,
      slots: mapSlotsForResponse(slots, timezone),
    };
  }

  if (!period) {
    return {
      available: true,
      message: `Dostępne terminy: ${slots.map((s) => s.labelPl).join('; ')}`,
      slots: mapSlotsForResponse(slots, timezone),
    };
  }

  const preferred = filterSlotsByTimeOfDay(slots, period, timezone);
  if (preferred.length > 0) {
    return {
      available: true,
      preferred_time_of_day: period,
      preferred_period_available: true,
      message: `Dostępne terminy (${TIME_OF_DAY_LABELS[period]}): ${preferred.map((s) => s.labelPl).join('; ')}`,
      slots: mapSlotsForResponse(preferred, timezone),
    };
  }

  const periodLabel = TIME_OF_DAY_LABELS[period];
  return {
    available: true,
    preferred_time_of_day: period,
    preferred_period_available: false,
    same_day_alternatives: true,
    message: `Brak terminów ${periodLabel} w tym dniu. Powiedz to klientowi i zaproponuj max 2–3 inne godziny TEGO SAMEGO dnia z slots[]. Gdy żadna nie pasuje — zapytaj jaki inny dzień mu odpowiada.`,
    slots: mapSlotsForResponse(slots, timezone),
  };
}

/** Validate booking slot is in the future and within business rules. */
export function validateBookingSlot(
  slotStartIso: string,
  config: StudioScheduleConfig,
  busyBlocks: CalendarBusyBlock[],
  now: Date = new Date(),
): { valid: boolean; error?: string } {
  const start = new Date(slotStartIso);
  if (Number.isNaN(start.getTime())) {
    return { valid: false, error: 'Nieprawidłowy format daty terminu.' };
  }
  if (start <= now) {
    return { valid: false, error: 'Termin musi być w przyszłości.' };
  }

  const end = new Date(start.getTime() + config.durationMinutes * 60_000);
  const startParts = zonedParts(start, config.timezone);
  const endParts = zonedParts(end, config.timezone);
  if (startParts.hour < config.openHour || endParts.hour > config.closeHour || (endParts.hour === config.closeHour && endParts.minute > 0)) {
    return { valid: false, error: 'Termin poza godzinami otwarcia studia.' };
  }
  if (!config.workDays.includes(startParts.dow)) {
    return { valid: false, error: 'Studio nie pracuje tego dnia.' };
  }

  const busy = busyBlocks.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  if (busy.some((b) => overlaps(start, end, b.start, b.end))) {
    return { valid: false, error: 'Ten termin jest już zajęty.' };
  }

  return { valid: true };
}

export function configFromEnv(env: Record<string, string | undefined>): StudioScheduleConfig {
  const workDaysRaw = (env.STUDIO_WORK_DAYS ?? '1,2,3,4,5').split(',').map((d) => parseInt(d.trim(), 10));
  return defaultStudioConfig({
    timezone: env.STUDIO_TIMEZONE ?? 'Europe/Warsaw',
    openHour: parseInt(env.STUDIO_OPEN_HOUR ?? '8', 10),
    closeHour: parseInt(env.STUDIO_CLOSE_HOUR ?? '20', 10),
    workDays: workDaysRaw.filter((d) => !Number.isNaN(d)),
    durationMinutes: parseInt(env.BOOKING_DURATION_MINUTES ?? '60', 10),
  });
}
