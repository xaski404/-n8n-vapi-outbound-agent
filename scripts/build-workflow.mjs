/**
 * Deterministically builds the importable n8n workflow JSON.
 *
 *   node scripts/build-workflow.mjs
 * emits: workflows/vapi-outbound-agent.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const sheetColumnKeys = [
  'phone',
  'full_name',
  'status',
  'call_summary',
  'recording_url',
  'transcript',
  'sessions_per_week',
  'preferred_session_date',
];

const sheetColEnd = String.fromCharCode(64 + sheetColumnKeys.length); // H for 8 cols

const sheetHelpersJs = `
function normalizeSheetPhone(phone) {
  return (phone || '').replace(/\\D/g, '');
}
function phoneKey(phone) {
  return normalizeSheetPhone(phone);
}
function sheetRowValues(sheet) {
  const term = ((sheet.preferred_session_date || sheet.booked_slot || '') + '').trim();
  const preferred = sheet.status === 'odwołanie' ? '' : term;
  return [
    normalizeSheetPhone(sheet.phone),
    sheet.full_name || '', sheet.status || '', sheet.call_summary || '',
    sheet.recording_url || '', sheet.transcript || '',
    sheet.sessions_per_week || '', preferred,
  ];
}
`;

// --- Shared scheduling helpers (ported from code/retellScheduling.ts) ---------
const schedulingHelpersJs = `
function stripDiacritics(value) {
  return value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
}
function normalizeDayToken(value) {
  return stripDiacritics((value || '').toLowerCase().trim());
}
const POLISH_DAYS = {
  niedziela: 0, niedziele: 0, poniedzialek: 1, wtorek: 2, wtorke: 2,
  sroda: 3, srode: 3, czwartek: 4, piatek: 5, sobota: 6,
};
function parsePreferredDays(preferredDay) {
  if (!preferredDay || !String(preferredDay).trim()) return undefined;
  const dows = {};
  String(preferredDay).split(/\\s+(?:albo|lub|or)\\s+|,/i).forEach(function(token) {
    const normalized = normalizeDayToken(String(token).replace(/\\b\\d{1,2}\\b/g, '').trim());
    if (!normalized) return;
    const dow = POLISH_DAYS[normalized] || POLISH_DAYS[normalized.replace(/e$/, 'a')] || POLISH_DAYS[normalized.replace(/a$/, 'e')];
    if (dow !== undefined) dows[dow] = true;
  });
  const list = Object.keys(dows).map(function(k) { return parseInt(k, 10); });
  return list.length ? list : undefined;
}
const POLISH_MONTHS = {
  stycznia: 1, styczen: 1, lutego: 2, luty: 2, marca: 3, marzec: 3, kwietnia: 4, kwiecien: 4,
  maja: 5, maj: 5, czerwca: 6, czerwiec: 6, lipca: 7, lipiec: 7, sierpnia: 8, sierpien: 8,
  wrzesnia: 9, wrzesien: 9, pazdziernika: 10, pazdziernik: 10, listopada: 11, listopad: 11, grudnia: 12, grudzien: 12,
};
function parsePreferredDate(input, now, timezone) {
  var raw = (input || '').trim();
  if (!raw) return undefined;
  var iso = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var dotted = raw.match(/(\\d{1,2})[.\\-/](\\d{1,2})(?:[.\\-/](\\d{2,4}))?/);
  if (dotted) {
    var day = parseInt(dotted[1], 10);
    var month = parseInt(dotted[2], 10);
    var year = dotted[3] ? parseInt(dotted[3], 10) : parseInt(zonedParts(now || new Date(), timezone || 'Europe/Warsaw').ymd.slice(0, 4), 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }
  var normalized = stripDiacritics(raw.toLowerCase());
  var monthMatch = normalized.match(/(\\d{1,2})\\s+([a-z]+)(?:\\s+(\\d{4}))?/);
  if (monthMatch) {
    day = parseInt(monthMatch[1], 10);
    month = POLISH_MONTHS[monthMatch[2]];
    year = monthMatch[3] ? parseInt(monthMatch[3], 10) : parseInt(zonedParts(now || new Date(), timezone || 'Europe/Warsaw').ymd.slice(0, 4), 10);
    if (month && day >= 1 && day <= 31) {
      return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }
  var bareDay = normalized.match(/^(\\d{1,2})$/);
  if (bareDay) {
    day = parseInt(bareDay[1], 10);
    if (day >= 1 && day <= 31) {
      var parts = zonedParts(now || new Date(), timezone || 'Europe/Warsaw');
      year = parseInt(parts.ymd.slice(0, 4), 10);
      month = parseInt(parts.ymd.slice(5, 7), 10);
      var todayDay = parseInt(parts.ymd.slice(8, 10), 10);
      if (day < todayDay) {
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }
  return undefined;
}
function parseTimeOfDay(input) {
  if (!input || !String(input).trim()) return undefined;
  var n = stripDiacritics(String(input).toLowerCase());
  if (/\\b(rano|poran|morning)\\b/.test(n)) return 'rano';
  if (/\\b(poludniu|poludni|popoludniu|popoludni|afternoon)\\b/.test(n)) return 'po_poludniu';
  if (/\\b(wieczor\\w*|evening)\\b/.test(n)) return 'wieczorem';
  return undefined;
}
var POLISH_HOUR_WORDS = {
  osma: 8, dziewiata: 9, dziesiata: 10, jedenasta: 11, dwunasta: 12,
  trzynasta: 13, czternasta: 14, pietnasta: 15, szesnasta: 16,
  siedemnasta: 17, osiemnasta: 18, dziewietnasta: 19, dwudziesta: 20,
};
function parsePreferredTime(input) {
  if (!input || !String(input).trim()) return undefined;
  var n = stripDiacritics(String(input).toLowerCase().trim());
  var hm = n.match(/\\b(\\d{1,2}):(\\d{2})\\b/);
  if (hm) {
    var hour = parseInt(hm[1], 10);
    var minute = parseInt(hm[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour: hour, minute: minute };
  }
  for (var word in POLISH_HOUR_WORDS) {
    if (new RegExp('\\\\b' + word + '\\\\b').test(n)) return { hour: POLISH_HOUR_WORDS[word], minute: 0 };
  }
  var bare = n.match(/\\b(\\d{1,2})\\b/);
  if (bare) {
    var h = parseInt(bare[1], 10);
    if (h >= 0 && h <= 23) return { hour: h, minute: 0 };
  }
  return undefined;
}
function slotMatchesPreferredTime(slot, preferred, timezone) {
  var parts = zonedParts(new Date(slot.start), timezone);
  return parts.hour === preferred.hour && parts.minute === preferred.minute;
}
function slotHourInTimezone(slot, timezone) {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(new Date(slot.start)), 10);
}
function filterSlotsByTimeOfDay(slots, period, timezone) {
  return slots.filter(function(slot) {
    var hour = slotHourInTimezone(slot, timezone);
    if (period === 'rano') return hour < 12;
    if (period === 'po_poludniu') return hour >= 12 && hour < 17;
    return hour >= 17;
  });
}
function mapSlotsForResponse(slots, timezone) {
  timezone = timezone || 'Europe/Warsaw';
  return slots.map(function(s) {
    return { start: formatSlotStartForAgent(s.start, timezone), end: s.end, label: s.labelPl };
  });
}
function formatSlotStartForAgent(iso, timezone) {
  var date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  var parts = zonedParts(date, timezone);
  var ymdParts = parts.ymd.split('-').map(function(n) { return parseInt(n, 10); });
  var utcMs = Date.UTC(ymdParts[0], ymdParts[1] - 1, ymdParts[2], parts.hour, parts.minute, 0);
  var localMs = wallClockToDate(parts.ymd, parts.hour, parts.minute, timezone).getTime();
  var offsetMin = Math.round((utcMs - localMs) / 60000);
  var sign = offsetMin >= 0 ? '+' : '-';
  var abs = Math.abs(offsetMin);
  var offH = String(Math.floor(abs / 60)).padStart(2, '0');
  var offM = String(abs % 60).padStart(2, '0');
  var h = String(parts.hour).padStart(2, '0');
  var m = String(parts.minute).padStart(2, '0');
  return parts.ymd + 'T' + h + ':' + m + ':00' + sign + offH + ':' + offM;
}
function resolveAgentSlotStart(slotStartIso, config, busyBlocks, now) {
  var slot = new Date(slotStartIso);
  if (isNaN(slot.getTime())) return slotStartIso;
  var timezone = config.timezone;
  var parts = zonedParts(slot, timezone);
  var available = getAvailableSlots(config, busyBlocks, now || new Date(), undefined, {
    preferredDateYmd: parts.ymd, preferredDows: undefined, skipOccurrences: 0,
  });
  function matchLocal(hour, minute) {
    return available.find(function(s) {
      var p = zonedParts(new Date(s.start), timezone);
      return p.hour === hour && p.minute === minute;
    });
  }
  var hit = matchLocal(parts.hour, parts.minute);
  if (hit) return hit.start;
  hit = matchLocal(parts.hour - 1, parts.minute);
  if (hit) return hit.start;
  return wallClockToDate(parts.ymd, parts.hour, parts.minute, timezone).toISOString();
}
function parseAvailabilityQuery(preferredDay, preferredDate, now, timezone) {
  var query = {};
  var refNow = now || new Date();
  var tz = timezone || 'Europe/Warsaw';
  if (preferredDate && String(preferredDate).trim()) {
    var ymd = parsePreferredDate(preferredDate, refNow, tz);
    if (ymd) query.preferredDateYmd = ymd;
  }
  if (preferredDay && String(preferredDay).trim()) {
    var normalized = stripDiacritics(String(preferredDay).toLowerCase());
    var dayText = preferredDay;
    if (/\\b(kolejny|nastepny|nastepnego|za tydzien)\\b/.test(normalized)) {
      query.skipOccurrences = 1;
      dayText = String(preferredDay).replace(/\\b(kolejny|następny|nastepny|następnego|nastepnego|za tydzień|za tydzien)\\b/gi, '').trim();
    }
    var dows = parsePreferredDays(dayText);
    if (dows) query.preferredDows = dows;
    if (!query.preferredDateYmd) {
      var dayNum = String(dayText).match(/\\b(\\d{1,2})\\b/);
      if (dayNum) {
        var ymdFromDay = parsePreferredDate(dayNum[1], refNow, tz);
        if (ymdFromDay) query.preferredDateYmd = ymdFromDay;
      }
    }
  }
  return query;
}
function configFromEnv(env) {
  const workDaysRaw = ((env.STUDIO_WORK_DAYS || '1,2,3,4,5') + '').split(',').map(function(d) { return parseInt(d.trim(), 10); });
  return {
    timezone: (env.STUDIO_TIMEZONE || 'Europe/Warsaw') + '',
    openHour: parseInt(env.STUDIO_OPEN_HOUR || '8', 10),
    closeHour: parseInt(env.STUDIO_CLOSE_HOUR || '20', 10),
    workDays: workDaysRaw.filter(function(d) { return !isNaN(d); }),
    durationMinutes: parseInt(env.BOOKING_DURATION_MINUTES || '60', 10),
    slotStepMinutes: 60,
    maxSlotsReturned: 12,
    daysAhead: 42,
  };
}
function parseRetellToolRequest(body) {
  const root = body.body || body;
  const args = root.args || root.arguments || root.parameters || {};
  const call = root.call || {};
  const vars = call.retell_llm_dynamic_variables || {};
  const direction = (call.direction || '') + '';
  const callerPhoneRaw = direction === 'outbound' ? call.to_number : (call.from_number || call.to_number);
  const callerPhone = callerPhoneRaw || vars.phone_number || args.phone || null;
  const callerName = vars.full_name || args.customer_name || args.full_name || null;
  const analysis = call.call_analysis || {};
  return {
    functionName: (root.name || root.function_name || root.tool_name || root.function || 'unknown') + '',
    args: args,
    callId: call.call_id != null ? String(call.call_id) : null,
    callerPhone: callerPhone,
    callerName: callerName,
    direction: direction,
    campaignName: vars.campaign_name || null,
    callSummary: analysis.call_summary || null,
  };
}
function parseCalendarBusyBlocks(freeBusyResponse, calendarId) {
  const calendars = freeBusyResponse.calendars || {};
  const cal = calendars[calendarId] || {};
  const busy = cal.busy || [];
  return busy.filter(function(b) { return b.start && b.end; }).map(function(b) { return { start: b.start, end: b.end }; });
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
function formatSlotLabel(start, timezone) {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(start);
}
function getAvailableSlots(config, busyBlocks, now, preferredDay, availabilityQuery) {
  const slots = [];
  const busy = busyBlocks.map(function(b) { return { start: new Date(b.start), end: new Date(b.end) }; });
  const query = availabilityQuery || parseAvailabilityQuery(preferredDay, undefined, now, config.timezone);
  const preferredDows = query.preferredDows;
  const preferredDateYmd = query.preferredDateYmd;
  const skipOccurrences = query.skipOccurrences || 0;
  const dowOccurrence = {};
  function pushSlot(slotStart) {
    const slotEnd = new Date(slotStart.getTime() + config.durationMinutes * 60000);
    if (slotStart <= now) return;
    const endParts = zonedParts(slotEnd, config.timezone);
    if (endParts.hour > config.closeHour || (endParts.hour === config.closeHour && endParts.minute > 0)) return;
    if (busy.some(function(b) { return overlaps(slotStart, slotEnd, b.start, b.end); })) return;
    slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString(), labelPl: formatSlotLabel(slotStart, config.timezone) });
  }
  if (preferredDateYmd) {
    const dateParts = zonedParts(wallClockToDate(preferredDateYmd, 12, 0, config.timezone), config.timezone);
    if (config.workDays.indexOf(dateParts.dow) === -1) return slots;
    if (preferredDows !== undefined && preferredDows.indexOf(dateParts.dow) === -1) return slots;
    for (let hour = config.openHour; hour < config.closeHour && slots.length < config.maxSlotsReturned; hour += 1) {
      pushSlot(wallClockToDate(preferredDateYmd, hour, 0, config.timezone));
    }
    return slots;
  }
  for (let dayOffset = 0; dayOffset <= config.daysAhead && slots.length < config.maxSlotsReturned; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const parts = zonedParts(day, config.timezone);
    const dow = parts.dow;
    if (config.workDays.indexOf(dow) === -1) continue;
    if (preferredDateYmd && parts.ymd !== preferredDateYmd) continue;
    if (preferredDows !== undefined && preferredDows.indexOf(dow) === -1) continue;
    if (skipOccurrences > 0 && preferredDows !== undefined) {
      dowOccurrence[dow] = (dowOccurrence[dow] || 0) + 1;
      if (dowOccurrence[dow] <= skipOccurrences) continue;
    }
    for (let hour = config.openHour; hour < config.closeHour; hour += 1) {
      const slotStart = new Date(day);
      slotStart.setHours(hour, 0, 0, 0);
      pushSlot(slotStart);
      if (slots.length >= config.maxSlotsReturned) break;
    }
  }
  return slots;
}
function formatAvailabilityResponse(slots, options) {
  options = options || {};
  var timezone = options.timezone || 'Europe/Warsaw';
  var period = options.preferredTimeOfDay;
  var preferredTime = options.preferredTime;
  var periodLabels = { rano: 'rano', po_poludniu: 'po południu', wieczorem: 'wieczorem' };
  if (slots.length === 0) {
    return { available: false, message: 'Brak wolnych terminów w podanym dniu. Spróbuj innego dnia.', slots: [] };
  }
  if (preferredTime) {
    var exact = slots.find(function(s) { return slotMatchesPreferredTime(s, preferredTime, timezone); });
    if (exact) {
      return {
        available: true,
        exact_match: true,
        message: 'Termin ' + exact.labelPl + ' jest wolny — od razu użyj tego slotu (book/reschedule), nie wymieniaj innych godzin.',
        slots: mapSlotsForResponse([exact], timezone),
      };
    }
    var timeLabel = String(preferredTime.hour).padStart(2, '0') + ':' + String(preferredTime.minute).padStart(2, '0');
    return {
      available: true,
      exact_match: false,
      message: 'O ' + timeLabel + ' brak wolnego terminu. Inne wolne godziny tego dnia: ' + slots.map(function(s) { return s.labelPl; }).join('; '),
      slots: mapSlotsForResponse(slots, timezone),
    };
  }
  if (!period) {
    return {
      available: true,
      message: 'Dostępne terminy: ' + slots.map(function(s) { return s.labelPl; }).join('; '),
      slots: mapSlotsForResponse(slots, timezone),
    };
  }
  var preferred = filterSlotsByTimeOfDay(slots, period, timezone);
  if (preferred.length > 0) {
    return {
      available: true,
      preferred_time_of_day: period,
      preferred_period_available: true,
      message: 'Dostępne terminy (' + periodLabels[period] + '): ' + preferred.map(function(s) { return s.labelPl; }).join('; '),
      slots: mapSlotsForResponse(preferred, timezone),
    };
  }
  return {
    available: true,
    preferred_time_of_day: period,
    preferred_period_available: false,
    message: 'Brak wolnych terminów ' + periodLabels[period] + ' w tym dniu. Inne dostępne godziny tego samego dnia: ' + slots.map(function(s) { return s.labelPl; }).join('; '),
    slots: mapSlotsForResponse(slots, timezone),
  };
}
function validateBookingSlot(slotStartIso, config, busyBlocks, now) {
  const start = new Date(slotStartIso);
  if (isNaN(start.getTime())) return { valid: false, error: 'Nieprawidłowy format daty terminu.' };
  if (start <= now) return { valid: false, error: 'Termin musi być w przyszłości.' };
  const end = new Date(start.getTime() + config.durationMinutes * 60000);
  const startParts = zonedParts(start, config.timezone);
  const endParts = zonedParts(end, config.timezone);
  if (startParts.hour < config.openHour || endParts.hour > config.closeHour || (endParts.hour === config.closeHour && endParts.minute > 0)) {
    return { valid: false, error: 'Termin poza godzinami otwarcia studia.' };
  }
  if (config.workDays.indexOf(startParts.dow) === -1) return { valid: false, error: 'Studio nie pracuje tego dnia.' };
  const busy = busyBlocks.map(function(b) { return { start: new Date(b.start), end: new Date(b.end) }; });
  if (busy.some(function(b) { return overlaps(start, end, b.start, b.end); })) {
    return { valid: false, error: 'Ten termin jest już zajęty.' };
  }
  return { valid: true };
}
function buildCalendarEvent(booking, config) {
  const start = new Date(booking.slotStart);
  const end = new Date(start.getTime() + config.durationMinutes * 60000);
  const label = booking.direction === 'outbound' ? 'Trening próbny' : 'Trening';
  const summaryBlock = booking.conversationSummary || booking.notes || booking.callSummary || '';
  const description = [
    'Telefon: ' + booking.customerPhone,
    booking.direction ? 'Kierunek: ' + (booking.direction === 'outbound' ? 'outbound (lead Meta)' : 'inbound (recepcja)') : '',
    booking.campaignName ? 'Kampania: ' + booking.campaignName : '',
    booking.goal ? 'Cel treningu: ' + booking.goal : '',
    booking.experienceLevel ? 'Doświadczenie: ' + booking.experienceLevel : '',
    booking.sessionsPerWeek ? 'Treningi/tydz.: ' + booking.sessionsPerWeek : '',
    summaryBlock ? 'Podsumowanie rozmowy:\\n' + summaryBlock : '',
    'Zarezerwowano przez Voice AI (Retell)',
  ].filter(Boolean).join('\\n\\n');
  return {
    summary: label + ' — ' + booking.customerName,
    description: description,
    start: { dateTime: start.toISOString(), timeZone: config.timezone },
    end: { dateTime: end.toISOString(), timeZone: config.timezone },
    extendedProperties: {
      private: {
        customer_phone: (booking.customerPhone || '').replace(/\\s/g, '').trim(),
        booked_slot: booking.slotStart,
      },
    },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }] },
  };
}
function normalizePhone(phone) {
  return (phone || '').replace(/\\s/g, '').trim();
}
const WEEKDAY_TO_DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function zonedParts(date, timezone) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const hour = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(date), 10);
  const minute = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, minute: '2-digit' }).format(date), 10);
  return { dow: WEEKDAY_TO_DOW[weekday] != null ? WEEKDAY_TO_DOW[weekday] : date.getDay(), hour: hour, minute: minute, ymd: ymd };
}
function wallClockToDate(ymd, hour, minute, timezone) {
  const parts = ymd.split('-').map(function(v) { return parseInt(v, 10); });
  var utcMs = Date.UTC(parts[0], parts[1] - 1, parts[2], hour, minute, 0);
  for (var attempt = 0; attempt < 4; attempt++) {
    var zoned = zonedParts(new Date(utcMs), timezone);
    if (zoned.ymd === ymd && zoned.hour === hour && zoned.minute === minute) return new Date(utcMs);
    var desiredMinutes = hour * 60 + minute;
    var actualMinutes = zoned.hour * 60 + zoned.minute;
    var deltaMinutes = desiredMinutes - actualMinutes;
    if (zoned.ymd > ymd) deltaMinutes -= 24 * 60;
    if (zoned.ymd < ymd) deltaMinutes += 24 * 60;
    utcMs += deltaMinutes * 60000;
  }
  return new Date(utcMs);
}
function resolveFutureSlotStart(slotStartIso, now, timezone) {
  const slot = new Date(slotStartIso);
  if (isNaN(slot.getTime())) return slotStartIso;
  if (slot.getTime() >= now.getTime() - 2 * 60 * 60000) return slotStartIso;
  const target = zonedParts(slot, timezone);
  for (let dayOffset = 0; dayOffset <= 21; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const parts = zonedParts(day, timezone);
    if (parts.dow !== target.dow) continue;
    const candidate = wallClockToDate(parts.ymd, target.hour, target.minute, timezone);
    if (candidate.getTime() >= now.getTime() - 2 * 60 * 60000) return candidate.toISOString();
  }
  return slotStartIso;
}
function resolveCancelSlotStart(slotStartIso, now, timezone) {
  const slot = new Date(slotStartIso);
  if (isNaN(slot.getTime())) return slotStartIso;
  const refNow = now || new Date();
  const tz = timezone || 'Europe/Warsaw';
  const target = zonedParts(slot, tz);
  let nearest = null;
  for (let dayOffset = 0; dayOffset <= 49; dayOffset++) {
    const day = new Date(refNow);
    day.setDate(day.getDate() + dayOffset);
    const parts = zonedParts(day, tz);
    if (parts.dow !== target.dow) continue;
    const candidate = wallClockToDate(parts.ymd, target.hour, target.minute, tz);
    if (candidate.getTime() >= refNow.getTime() - 2 * 60 * 60000) { nearest = candidate; break; }
  }
  if (!nearest) return resolveFutureSlotStart(slotStartIso, refNow, tz);
  if (slot.getTime() < refNow.getTime() - 2 * 60 * 60000) return nearest.toISOString();
  if (slot.getTime() > nearest.getTime() + 7 * 24 * 60 * 60000) return nearest.toISOString();
  return slot.toISOString();
}
function buildEventsListUrl(calendarId, phone, slotStart, config, now) {
  const cfg = config || { daysAhead: 14, durationMinutes: 60, timezone: 'Europe/Warsaw' };
  const refNow = now || new Date();
  var timeMinVal = refNow.toISOString();
  var timeMaxObj = new Date(refNow);
  timeMaxObj.setDate(timeMaxObj.getDate() + cfg.daysAhead + 7);
  var timeMaxVal = timeMaxObj.toISOString();
  if (slotStart) {
    var resolvedSlot = resolveFutureSlotStart(slotStart, refNow, cfg.timezone || 'Europe/Warsaw');
    var slot = new Date(resolvedSlot);
    if (!isNaN(slot.getTime())) {
      var toleranceMs = 48 * 60 * 60000;
      timeMinVal = new Date(Math.max(refNow.getTime(), slot.getTime() - toleranceMs)).toISOString();
      timeMaxVal = new Date(slot.getTime() + toleranceMs).toISOString();
    }
  }
  if (new Date(timeMaxVal).getTime() < new Date(timeMinVal).getTime()) {
    timeMinVal = refNow.toISOString();
    timeMaxObj = new Date(refNow);
    timeMaxObj.setDate(timeMaxObj.getDate() + cfg.daysAhead + 7);
    timeMaxVal = timeMaxObj.toISOString();
  }
  var qs = 'timeMin=' + encodeURIComponent(timeMinVal)
    + '&timeMax=' + encodeURIComponent(timeMaxVal)
    + '&singleEvents=true&orderBy=startTime&maxResults=50';
  var normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) qs += '&q=' + encodeURIComponent(normalizedPhone);
  return 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?' + qs;
}
function eventStartMs(event) {
  const startStr = (event.start && (event.start.dateTime || event.start.date)) || '';
  if (!startStr) return null;
  const ms = new Date(startStr).getTime();
  return isNaN(ms) ? null : ms;
}
function eventMatchesCustomer(event, phone, customerName) {
  const normalizedPhone = normalizePhone(phone);
  const nameTokens = (customerName || '').toLowerCase().split(/\\s+/).map(function(t) {
    return stripDiacritics(t);
  }).filter(function(t) { return t.length > 2; });
  const privPhone = event.extendedProperties && event.extendedProperties.private && event.extendedProperties.private.customer_phone;
  if (privPhone && normalizePhone(privPhone) === normalizedPhone) return true;
  if (event.description && normalizedPhone && event.description.indexOf(normalizedPhone) >= 0) return true;
  if (nameTokens.length > 0) {
    const hay = stripDiacritics(((event.summary || '') + ' ' + (event.description || '')).toLowerCase());
    for (let i = 0; i < nameTokens.length; i++) {
      if (hay.indexOf(nameTokens[i]) >= 0) return true;
    }
  }
  return false;
}
function selectAppointmentsForList(rows, timezone, maxTotal, maxPerDay) {
  maxTotal = maxTotal || 12;
  maxPerDay = maxPerDay || 2;
  var sorted = rows.slice().sort(function(a, b) { return a.startMs - b.startMs; });
  var byDay = {};
  sorted.forEach(function(row) {
    var day = zonedParts(new Date(row.startMs), timezone).ymd;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(row);
  });
  var dayKeys = Object.keys(byDay);
  if (dayKeys.length <= 1) return sorted.slice(0, maxTotal);
  dayKeys.sort();
  var selected = [];
  for (var round = 0; round < maxPerDay && selected.length < maxTotal; round++) {
    for (var i = 0; i < dayKeys.length; i++) {
      var dayRows = byDay[dayKeys[i]];
      if (round < dayRows.length) {
        selected.push(dayRows[round]);
        if (selected.length >= maxTotal) break;
      }
    }
  }
  return selected.sort(function(a, b) { return a.startMs - b.startMs; });
}
function formatListAppointmentsResponse(listResponse, phone, customerName, config, now, maxReturned) {
  const refNow = now || new Date();
  const tz = (config && config.timezone) || 'Europe/Warsaw';
  const limit = maxReturned || 12;
  const items = (listResponse.items || []).filter(function(event) {
    return eventMatchesCustomer(event, phone, customerName);
  });
  const upcoming = selectAppointmentsForList(items.map(function(event) {
    return { event: event, startMs: eventStartMs(event) };
  }).filter(function(row) {
    return row.startMs != null && row.startMs >= refNow.getTime() - 60000;
  }), tz, limit, 2);
  const appointments = upcoming.map(function(row) {
    const startIso = (row.event.start && (row.event.start.dateTime || row.event.start.date)) || '';
    return {
      eventId: row.event.id,
      slot_start: startIso,
      label: startIso ? formatSlotLabel(new Date(startIso), tz) : '',
      summary: row.event.summary || '',
    };
  });
  if (appointments.length === 0) {
    return { found: false, message: 'Nie widzę nadchodzących wizyt na ten numer telefonu.', appointments: [] };
  }
  const labels = appointments.map(function(a) { return a.label; });
  const byDay = {};
  appointments.forEach(function(a) {
    const m = a.label.match(/^[^,]+,\s*\d+\s+\S+/);
    const day = m ? m[0] : a.label.split(' ').slice(0, 2).join(' ');
    const hour = a.label.replace(/^.*?\s(\d{1,2}:\d{2})$/, '$1');
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(hour);
  });
  const dayKeys = Object.keys(byDay);
  var message;
  if (dayKeys.length === 1) {
    var day = dayKeys[0];
    var hours = byDay[day];
    message = hours.length > 3
      ? hours.length + ' wizyt w ' + day + ' — podaj godzinę wizyty do przesunięcia'
      : 'Wizyty w ' + day + ': ' + hours.join(', ');
  } else {
    message = 'Nadchodzące wizyty: ' + labels.join('; ');
  }
  return {
    found: true,
    message: message,
    appointments: appointments,
  };
}
function findMatchingCalendarEvent(listResponse, phone, slotStart, customerName, now, timezone) {
  const items = listResponse.items || [];
  const refNow = now || new Date();
  const tz = timezone || 'Europe/Warsaw';
  const candidates = items.filter(function(event) {
    return eventMatchesCustomer(event, phone, customerName);
  });
  if (candidates.length === 0) return null;
  if (!slotStart) return candidates[0];
  const resolvedSlot = resolveFutureSlotStart(slotStart, refNow, tz);
  const target = new Date(resolvedSlot).getTime();
  if (isNaN(target)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const startMs = eventStartMs(candidates[i]);
    if (startMs == null) continue;
    const delta = Math.abs(startMs - target);
    if (delta < bestDelta) { bestDelta = delta; best = candidates[i]; }
  }
  const toleranceMs = 3 * 60 * 60 * 1000;
  if (best && bestDelta <= toleranceMs) return best;
  return null;
}
function buildDeleteEventUrl(calendarId, eventId) {
  return 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId);
}
function buildPatchEventUrl(calendarId, eventId) {
  return buildDeleteEventUrl(calendarId, eventId);
}`;

const parseMetaLeadCode = `// Auto-ported from code/parseMetaLead.ts — keep in sync.
function toE164(raw, defaultCountryCode = '+48') {
  const trimmed = (raw ?? '').toString().trim();
  if (!trimmed) throw new Error('phone_number is empty');
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/[^\\d+]/g, '');
    if (!/^\\+\\d{7,15}$/.test(digits)) throw new Error('Invalid E.164 phone: ' + raw);
    return digits;
  }
  const digitsOnly = trimmed.replace(/\\D/g, '');
  if (digitsOnly.length < 7) throw new Error('Phone too short: ' + raw);
  if (digitsOnly.startsWith('00')) return '+' + digitsOnly.slice(2);
  return defaultCountryCode + digitsOnly;
}
function splitName(fullName) {
  const parts = (fullName ?? '').toString().trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Lead' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
function assertRequired(p) {
  const required = ['full_name', 'phone_number'];
  const missing = required.filter((k) => !p[k] || p[k].toString().trim() === '');
  if (missing.length) throw new Error('Missing required Meta fields: ' + missing.join(', '));
}
const DEFAULT_CAMPAIGN = 'skibidi essaa six seven musztarda';
const output = items.map((item) => {
  const body = item.json.body ?? item.json;
  assertRequired(body);
  const name = splitName(body.full_name);
  const lead = {
    fullName: body.full_name.trim(),
    firstName: name.firstName,
    lastName: name.lastName,
    phoneE164: toE164(body.phone_number),
    campaignName: (body.campaign_name && body.campaign_name.toString().trim()) || DEFAULT_CAMPAIGN,
    leadgenId: body.leadgen_id ?? null,
    sourcedAt: new Date().toISOString(),
  };
  return { json: { ...lead, _meta: body } };
});
return output;`;

const mapRetellToSheetsCode = `${sheetHelpersJs}
// Auto-ported from code/mapRetellToSheets.ts — keep in sync.
const HOUR_WORD_TO_DIGIT = [
  ['dwudziestej', '20'], ['dziewiętnastej', '19'], ['osiemnastej', '18'],
  ['siedemnastej', '17'], ['szesnastej', '16'], ['piętnastej', '15'],
  ['czternastej', '14'], ['trzynastej', '13'], ['dwunastej', '12'],
  ['jedenastej', '11'], ['dziesiątej', '10'], ['dziewiątej', '9'],
  ['siódmej', '7'], ['szóstej', '6'], ['piątej', '5'], ['czwartej', '4'],
  ['trzeciej', '3'], ['drugiej', '2'], ['pierwszej', '1'], ['ósmej', '8'],
];
const EN_MONTH_TO_PL = { january:'stycznia', february:'lutego', march:'marca', april:'kwietnia', may:'maja', june:'czerwca', july:'lipca', august:'sierpnia', september:'września', october:'października', november:'listopada', december:'grudnia' };
const EN_WEEKDAY_TO_PL = { monday:'poniedziałek', tuesday:'wtorek', wednesday:'środa', thursday:'czwartek', friday:'piątek', saturday:'sobota', sunday:'niedziela' };
function normalizePreferredSessionDate(value) {
  let result = (value || '').trim();
  if (!result) return result;
  result = result.replace(/wpół do szesnastej/gi, 'o 15:30');
  result = result.replace(/piętnasta trzydzieści/gi, 'o 15:30');
  for (const pair of HOUR_WORD_TO_DIGIT) {
    const pattern = new RegExp('o\\\\s+' + pair[0], 'gi');
    result = result.replace(pattern, 'o ' + pair[1]);
  }
  return result.replace(/\\s+/g, ' ').trim();
}
function formatEnglishSummaryDate(summary) {
  const match = summary.match(/\\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s+([A-Za-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+at\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)?)?/i);
  if (!match) return '';
  const weekday = EN_WEEKDAY_TO_PL[match[1].toLowerCase()] || match[1].toLowerCase();
  const month = EN_MONTH_TO_PL[match[2].toLowerCase()] || match[2].toLowerCase();
  let hour = match[4] ? parseInt(match[4], 10) : null;
  const minute = match[5] || '00';
  const ampm = match[6] ? match[6].toUpperCase() : '';
  if (hour != null && ampm === 'PM' && hour < 12) hour += 12;
  if (hour != null && ampm === 'AM' && hour === 12) hour = 0;
  if (hour != null) return weekday + ', ' + match[3] + ' ' + month + ' ' + String(hour).padStart(2, '0') + ':' + minute;
  return weekday + ', ' + match[3] + ' ' + month;
}
function inferFromSummary(summary) {
  const text = (summary || '').trim();
  if (!text) return {};
  const lower = text.toLowerCase();
  const result = {};
  const nameMatch = text.match(/\\b(?:for|dla|klienta?|customer|user|użytkownik(?:a)?)\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)/) ||
    text.match(/\\b([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)\\s+(?:booked|umówił|zapisał)/i);
  if (nameMatch) result.name = nameMatch[1].trim();
  if (/\\b(cancelled|canceled|odwoła|anulowa|odwołan)/i.test(lower) || /\\b(cancel|odwoł).*?(appointment|trening|wizyt|termin)/i.test(lower)) result.status = 'odwołanie';
  else if (/\\b(reschedul|przeło|przesun)/i.test(lower)) result.status = 'przełożono';
  else if (/\\b(book|schedul|umów|zapis|potwierdz).*?(appointment|trening|wizyt|termin|session)/i.test(lower) ||
    /\\b(appointment|trening|wizyt|session).*?(book|schedul|umów|confirm)/i.test(lower)) result.status = 'umówiono';
  result.term = formatEnglishSummaryDate(text);
  return result;
}
function outcomeToStatus(outcome, callSuccessful, preferredSessionDate, bookedSlot, disconnectionReason, inVoicemail, hasTranscript, summaryHint) {
  const o = (outcome ?? '').toLowerCase().trim();
  switch (o) {
    case 'interested': case 'zainteresowany': case 'pytanie': return 'zainteresowany';
    case 'umówiono': case 'umowiono': return 'umówiono';
    case 'odwołanie': case 'odwolanie': return 'odwołanie';
    case 'przełożono': case 'przelozono': return 'przełożono';
    case 'not_interested': case 'niezainteresowany': return 'niezainteresowany';
    case 'callback': case 'nieodebrane': case 'no_answer': case 'voicemail': return 'brak odpowiedzi';
    default: break;
  }
  const r = (disconnectionReason || '').toLowerCase();
  if (summaryHint) return summaryHint;
  if (inVoicemail || r.indexOf('no_answer') >= 0 || r.indexOf('voicemail') >= 0 || r.indexOf('dial_no') >= 0) return 'brak odpowiedzi';
  if (bookedSlot) return 'umówiono';
  if (callSuccessful && preferredSessionDate) return 'zainteresowany';
  if (callSuccessful && hasTranscript) return 'zainteresowany';
  if (o) return 'zainteresowany';
  return 'brak odpowiedzi';
}
function resolveDirection(callDirection) {
  return callDirection === 'outbound' ? 'outbound' : 'inbound';
}
function resolveSource(direction, metadata, vars) {
  const metaSource = ((metadata && metadata.source) || '').toString().toLowerCase();
  if (metaSource === 'meta_lead_ad') return 'meta_lead_ad';
  if (metaSource === 'callback') return 'callback';
  if (vars && vars.campaign_name && vars.campaign_name.trim()) return 'meta_lead_ad';
  if (direction === 'inbound') return 'inbound_call';
  return 'unknown';
}
function resolvePhone(direction, call, vars) {
  const fromCall = direction === 'outbound' ? call.to_number : (call.from_number || call.to_number);
  const raw = fromCall || (vars && vars.phone_number) || '';
  return raw ? normalizeSheetPhone(String(raw)) : '';
}
function resolveFullName(vars, custom, summaryName) {
  const fromCustom = custom.customer_name != null ? String(custom.customer_name) : (custom.full_name != null ? String(custom.full_name) : '');
  return (vars.full_name && vars.full_name.trim()) || fromCustom.trim() || (summaryName && summaryName.trim()) || 'Nieznany kontakt';
}
const output = items.map((item) => {
  const root = item.json.body ?? item.json;
  const event = root.event ?? '';
  const env = (typeof $env !== 'undefined' && $env) ? $env : {};
  if (event !== 'call_analyzed') {
    return { json: { skipped: true, reason: 'Ignored event: ' + (event || 'unknown') } };
  }
  const call = root.call || {};
  const vars = call.retell_llm_dynamic_variables || {};
  const analysis = call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const metadata = call.metadata || {};
  const summary = analysis.call_summary || '';
  const inferred = inferFromSummary(summary);
  const direction = resolveDirection(call.direction);
  const source = resolveSource(direction, metadata, vars);
  const phone = resolvePhone(direction, call, vars);
  const fullName = resolveFullName(vars, custom, inferred.name);
  let preferredSessionDate = normalizePreferredSessionDate(custom.preferred_session_date != null ? String(custom.preferred_session_date) : '');
  const bookedSlot = custom.booked_slot != null ? String(custom.booked_slot) : (custom.booked_appointment != null ? String(custom.booked_appointment) : '');
  const outcomeRaw = (custom.outcome != null ? String(custom.outcome) : '').toLowerCase().trim();
  let finalBookedSlot = bookedSlot;
  if (outcomeRaw === 'odwołanie' || outcomeRaw === 'odwolanie') finalBookedSlot = '';
  if (!preferredSessionDate && !finalBookedSlot && inferred.term) preferredSessionDate = inferred.term;
  const status = outcomeToStatus(custom.outcome != null ? String(custom.outcome) : '', analysis.call_successful, preferredSessionDate, finalBookedSlot, call.disconnection_reason, analysis.in_voicemail, Boolean((call.transcript || '').trim()), inferred.status);
  const termColumn = status === 'odwołanie' ? '' : normalizePreferredSessionDate(finalBookedSlot || preferredSessionDate);
  const transcript = call.transcript || '';
  const upsertKey = phone || (call.call_id ? 'call:' + call.call_id : '');
  const sheet = {
    phone: phone, full_name: fullName, status: status,
    direction: direction, source: source,
    call_summary: summary, recording_url: call.recording_url || '',
    transcript: transcript,
    sessions_per_week: custom.sessions_per_week != null ? String(custom.sessions_per_week) : '',
    preferred_session_date: termColumn, booked_slot: finalBookedSlot,
    goal: custom.goal != null ? String(custom.goal) : '',
    experience_level: custom.experience_level != null ? String(custom.experience_level) : '',
    updated_at: new Date().toISOString(),
  };
  return {
    json: {
      skipped: false, sheet: sheet, upsertKey: upsertKey,
      retellCallId: call.call_id || null, disconnectionReason: call.disconnection_reason || null,
      sheetsDocumentId: ((env.GOOGLE_SHEETS_DOCUMENT_ID || '') + ''),
      sheetsSheetName: ((env.GOOGLE_SHEETS_SHEET_NAME || 'Leads') + ''),
      rowValues: sheetRowValues(sheet),
    },
  };
});
return output;`;

const prepareSheetsUpsertCode = `${sheetHelpersJs}
// Find existing row by phone for upsert.
const mapped = $('Map Retell to Sheets').first().json;
const tabJson = $('Get Sheet Tab Name').first().json;
if (!tabJson.sheets || !tabJson.sheets[0]) {
  return [{ json: { skipped: true, reason: 'Nie udało się odczytać zakładki arkusza (OAuth?)', upsertMode: 'append' } }];
}
const tabTitle = tabJson.sheets[0].properties.title;
const phoneData = $('Get Phone Column').first().json;
const rows = phoneData.values || [];
const phone = mapped.upsertKey;
let rowNumber = 0;
for (let i = 1; i < rows.length; i++) {
  if (rows[i] && phoneKey(rows[i][0]) === phoneKey(phone)) { rowNumber = i + 1; break; }
}
const sheet = mapped.sheet;
const rowValues = mapped.rowValues || sheetRowValues(sheet);
return [{
  json: {
    skipped: mapped.skipped,
    sheet: mapped.sheet,
    upsertKey: mapped.upsertKey,
    retellCallId: mapped.retellCallId,
    disconnectionReason: mapped.disconnectionReason,
    sheetsDocumentId: mapped.sheetsDocumentId,
    sheetsSheetName: mapped.sheetsSheetName,
    tabTitle: tabTitle,
    upsertMode: rowNumber > 0 ? 'update' : 'append',
    rowNumber: rowNumber,
    rowValues: rowValues,
    colEnd: '${sheetColEnd}',
  },
}];`;

const buildBookSheetsRowCode = `${sheetHelpersJs}
const prep = $('Prepare Booking').first().json;
const validated = $('Validate Booking').first().json;
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const phone = normalizeSheetPhone(prep.customerPhone || '');
if (!phone) {
  return [{ json: { skipped: true, reason: 'Brak telefonu — pomijam Sheets' } }];
}
const term = validated.label || '';
const sheet = {
  phone: phone,
  full_name: prep.customerName || 'Nieznany kontakt',
  status: 'umówiono',
  call_summary: prep.conversationSummary || '',
  recording_url: '', transcript: '',
  sessions_per_week: prep.sessionsPerWeek || '',
  preferred_session_date: term,
  booked_slot: term,
};
return [{
  json: {
    skipped: false,
    sheet: sheet,
    upsertKey: phone,
    rowValues: sheetRowValues(sheet),
    sheetsDocumentId: ((env.GOOGLE_SHEETS_DOCUMENT_ID || '') + ''),
    sheetsSheetName: ((env.GOOGLE_SHEETS_SHEET_NAME || 'Leads') + ''),
  },
}];`;

const buildCancelSheetsRowCode = `${sheetHelpersJs}
const prep = $('Prepare Cancel').first().json;
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const phone = normalizeSheetPhone(prep.customerPhone || '');
if (!phone) {
  return [{ json: { skipped: true, reason: 'Brak telefonu — pomijam Sheets' } }];
}
const sheet = {
  phone: phone,
  full_name: prep.customerName || 'Nieznany kontakt',
  status: 'odwołanie',
  call_summary: prep.conversationSummary || prep.reason || '',
  recording_url: '', transcript: '',
  sessions_per_week: '', preferred_session_date: '',
  booked_slot: '',
};
return [{
  json: {
    skipped: false,
    sheet: sheet,
    upsertKey: phone,
    rowValues: sheetRowValues(sheet),
    sheetsDocumentId: ((env.GOOGLE_SHEETS_DOCUMENT_ID || '') + ''),
    sheetsSheetName: ((env.GOOGLE_SHEETS_SHEET_NAME || 'Leads') + ''),
  },
}];`;

const buildRescheduleSheetsRowCode = `${sheetHelpersJs}
const prep = $('Prepare Reschedule').first().json;
const validated = $('Validate Reschedule').first().json;
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const phone = normalizeSheetPhone(prep.customerPhone || '');
if (!phone) {
  return [{ json: { skipped: true, reason: 'Brak telefonu — pomijam Sheets' } }];
}
const term = validated.label || '';
const sheet = {
  phone: phone,
  full_name: prep.customerName || 'Nieznany kontakt',
  status: 'przełożono',
  call_summary: prep.conversationSummary || '',
  recording_url: '', transcript: '',
  sessions_per_week: prep.sessionsPerWeek || '',
  preferred_session_date: term,
  booked_slot: term,
};
return [{
  json: {
    skipped: false,
    sheet: sheet,
    upsertKey: phone,
    rowValues: sheetRowValues(sheet),
    sheetsDocumentId: ((env.GOOGLE_SHEETS_DOCUMENT_ID || '') + ''),
    sheetsSheetName: ((env.GOOGLE_SHEETS_SHEET_NAME || 'Leads') + ''),
  },
}];`;

const prepareSheetsUpsertSyncCode = `${sheetHelpersJs}
const mapped = $('Sheets sync ready?').first().json;
if (mapped.skipped || !mapped.upsertKey || !mapped.sheetsDocumentId) {
  return [{ json: Object.assign({}, mapped, { skipped: true }) }];
}
const tabTitle = $('Get Sheet Tab (Sync)').first().json.sheets[0].properties.title;
const phoneData = items[0].json;
const rows = phoneData.values || [];
let rowNumber = 0;
for (let i = 1; i < rows.length; i++) {
  if (rows[i] && phoneKey(rows[i][0]) === phoneKey(mapped.upsertKey)) { rowNumber = i + 1; break; }
}
const rowValues = mapped.rowValues || sheetRowValues(mapped.sheet);
return [{
  json: Object.assign({}, mapped, {
    tabTitle: tabTitle,
    upsertMode: rowNumber > 0 ? 'update' : 'append',
    rowNumber: rowNumber,
    rowValues: rowValues,
    colEnd: '${sheetColEnd}',
    skipped: false,
  }),
}];`;

const mergeSheetsRowSyncCode = `${sheetHelpersJs}
const mapped = $('Prepare Sheets Upsert (Sync)').first().json;
const existing = items[0].json;
const existingValues = (existing.values && existing.values[0]) || [];
const keys = ${JSON.stringify(sheetColumnKeys)};
const existingRow = {};
keys.forEach(function(k, i) { if (existingValues[i]) existingRow[k] = existingValues[i]; });
const incoming = mapped.sheet;
const merged = Object.assign({}, incoming);
['transcript', 'recording_url', 'call_summary'].forEach(function(k) {
  if (!incoming[k] && existingRow[k]) merged[k] = existingRow[k];
});
if (existingRow.full_name && incoming.full_name === 'Nieznany kontakt') merged.full_name = existingRow.full_name;
merged.status = incoming.status;
merged.preferred_session_date = incoming.preferred_session_date || incoming.booked_slot || '';
merged.booked_slot = incoming.booked_slot;
const rowValues = sheetRowValues(merged);
return [{ json: Object.assign({}, mapped, { sheet: merged, rowValues: rowValues }) }];`;

const prepareAvailabilityCode = `${schedulingHelpersJs}
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const config = configFromEnv(env);
const calendarId = ((env.GOOGLE_CALENDAR_ID || 'primary') + '').trim();
const req = parseRetellToolRequest(items[0].json);
const now = new Date();
const preferredDay = req.args.preferred_day || null;
const preferredDate = req.args.preferred_date || req.args.preferredDate || null;
const preferredTimeOfDay = req.args.preferred_time_of_day || req.args.preferredTimeOfDay || null;
const preferredTime = req.args.preferred_time || req.args.preferredTime || null;
const query = parseAvailabilityQuery(preferredDay, preferredDate, now, config.timezone);
let daysAhead = config.daysAhead;
if (query.preferredDateYmd) {
  const target = new Date(query.preferredDateYmd + 'T12:00:00');
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / 86400000);
  if (diffDays + 1 > daysAhead) daysAhead = diffDays + 1;
}
const timeMax = new Date(now);
timeMax.setDate(timeMax.getDate() + daysAhead);
return [{
  json: {
    freeBusyBody: {
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: config.timezone,
      items: [{ id: calendarId }],
    },
    calendarId: calendarId,
    preferredDay: preferredDay,
    preferredDate: preferredDate,
    preferredTimeOfDay: preferredTimeOfDay,
    preferredTime: preferredTime,
    preferredDateYmd: query.preferredDateYmd || null,
    preferredDows: query.preferredDows || null,
    skipOccurrences: query.skipOccurrences || 0,
    configJson: JSON.stringify(config),
  },
}];`;

const mergeAvailabilityCode = `${schedulingHelpersJs}
const prep = $('Prepare Availability').first().json;
const config = JSON.parse(prep.configJson);
let busyBlocks = [];
try {
  const fb = items[0].json;
  if (fb && fb.calendars) {
    busyBlocks = parseCalendarBusyBlocks(fb, prep.calendarId);
  }
} catch (e) { busyBlocks = []; }
const query = prep.preferredDateYmd
  ? { preferredDateYmd: prep.preferredDateYmd, preferredDows: prep.preferredDows || undefined, skipOccurrences: prep.skipOccurrences || 0 }
  : parseAvailabilityQuery(prep.preferredDay, prep.preferredDate, new Date(), config.timezone);
const slots = getAvailableSlots(config, busyBlocks, new Date(), prep.preferredDay, query);
const period = parseTimeOfDay(prep.preferredTimeOfDay);
const preferredTime = parsePreferredTime(prep.preferredTime);
return [{ json: formatAvailabilityResponse(slots, { preferredTimeOfDay: period, preferredTime: preferredTime, timezone: config.timezone }) }];`;

const prepareBookingCode = `${schedulingHelpersJs}
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const config = configFromEnv(env);
const calendarId = ((env.GOOGLE_CALENDAR_ID || 'primary') + '').trim();
const req = parseRetellToolRequest(items[0].json);
const slotStart = req.args.slot_start || req.args.slotStart;
const customerName = req.args.customer_name || req.args.customerName || req.callerName || 'Klient';
const customerPhone = req.callerPhone || req.args.phone || '';
const notes = req.args.notes || req.args.conversation_summary || '';
const goal = req.args.goal || '';
const experienceLevel = req.args.experience_level || req.args.experienceLevel || '';
const sessionsPerWeek = req.args.sessions_per_week || req.args.sessionsPerWeek || '';
const conversationSummary = req.args.conversation_summary || notes || req.callSummary || '';
if (!slotStart) {
  return [{ json: { error: true, message: 'Brak parametru slot_start.' } }];
}
const now = new Date();
const timeMin = new Date(now);
const timeMax = new Date(slotStart);
timeMax.setHours(timeMax.getHours() + config.durationMinutes + 1);
return [{
  json: {
    freeBusyBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: config.timezone,
      items: [{ id: calendarId }],
    },
    calendarId: calendarId,
    slotStart: String(slotStart),
    customerName: String(customerName),
    customerPhone: String(customerPhone),
    notes: String(notes),
    goal: String(goal),
    experienceLevel: String(experienceLevel),
    sessionsPerWeek: String(sessionsPerWeek),
    conversationSummary: String(conversationSummary),
    direction: req.direction || '',
    campaignName: req.campaignName || '',
    callId: req.callId || '',
    configJson: JSON.stringify(config),
  },
}];`;

const validateAndBookCode = `${schedulingHelpersJs}
const prep = $('Prepare Booking').first().json;
const config = JSON.parse(prep.configJson);
const busyBlocks = parseCalendarBusyBlocks($('Calendar FreeBusy (Book)').first().json, prep.calendarId);
const resolvedSlot = resolveAgentSlotStart(prep.slotStart, config, busyBlocks, new Date());
const validation = validateBookingSlot(resolvedSlot, config, busyBlocks, new Date());
if (!validation.valid) {
  return [{ json: { success: false, message: validation.error } }];
}
const eventBody = buildCalendarEvent({
  slotStart: resolvedSlot,
  customerName: prep.customerName,
  customerPhone: prep.customerPhone,
  notes: prep.notes,
  goal: prep.goal,
  experienceLevel: prep.experienceLevel,
  sessionsPerWeek: prep.sessionsPerWeek,
  conversationSummary: prep.conversationSummary,
  direction: prep.direction,
  campaignName: prep.campaignName,
  callId: prep.callId,
}, config);
const slotLabel = formatSlotLabel(new Date(resolvedSlot), config.timezone);
return [{
  json: {
    success: true,
    calendarId: prep.calendarId,
    eventBody: eventBody,
    message: 'Termin zarezerwowany: ' + slotLabel,
    booked_slot: resolvedSlot,
    label: slotLabel,
  },
}];`;

const prepareListCode = `${schedulingHelpersJs}
try {
  const env = (typeof $env !== 'undefined' && $env) ? $env : {};
  const config = configFromEnv(env);
  const calendarId = ((env.GOOGLE_CALENDAR_ID || 'primary') + '').trim();
  const req = parseRetellToolRequest(items[0].json);
  const customerName = req.args.customer_name || req.args.customerName || req.callerName || '';
  const customerPhone = req.callerPhone || req.args.phone || '';
  if (!customerPhone) {
    return [{ json: { error: true, message: 'Brak numeru telefonu klienta.' } }];
  }
  return [{
    json: {
      eventsListUrl: buildEventsListUrl(calendarId, customerPhone, undefined, config),
      customerPhone: String(customerPhone),
      customerName: String(customerName),
      configJson: JSON.stringify(config),
    },
  }];
} catch (err) {
  return [{ json: { error: true, message: 'Prepare List error: ' + (err.message || String(err)) } }];
}`;

const formatListCode = `${schedulingHelpersJs}
try {
  const prep = $('Prepare List').first().json;
  const listResp = items[0].json;
  const config = JSON.parse(prep.configJson || '{}');
  const result = formatListAppointmentsResponse(listResp, prep.customerPhone, prep.customerName || undefined, config);
  return [{ json: result }];
} catch (err) {
  return [{ json: { found: false, message: 'List error: ' + (err.message || String(err)), appointments: [] } }];
}`;

const prepareCancelCode = `${schedulingHelpersJs}
try {
  const env = (typeof $env !== 'undefined' && $env) ? $env : {};
  const config = configFromEnv(env);
  const calendarId = ((env.GOOGLE_CALENDAR_ID || 'primary') + '').trim();
  const req = parseRetellToolRequest(items[0].json);
  const slotStart = req.args.slot_start || req.args.slotStart;
  const customerName = req.args.customer_name || req.args.customerName || req.callerName || 'Klient';
  const customerPhone = req.callerPhone || req.args.phone || '';
  const reason = req.args.reason || '';
  if (!slotStart) {
    return [{ json: { error: true, message: 'Brak parametru slot_start (termin odwoływanej wizyty).' } }];
  }
  if (!customerPhone) {
    return [{ json: { error: true, message: 'Brak numeru telefonu klienta.' } }];
  }
  const resolvedSlot = resolveCancelSlotStart(String(slotStart), new Date(), config.timezone);
  return [{
    json: {
      eventsListUrl: buildEventsListUrl(calendarId, customerPhone, resolvedSlot, config),
      calendarId: calendarId,
      customerPhone: String(customerPhone),
      customerName: String(customerName),
      slotStart: resolvedSlot,
      reason: String(reason),
      configJson: JSON.stringify(config),
    },
  }];
} catch (err) {
  return [{ json: { error: true, message: 'Prepare Cancel error: ' + (err.message || String(err)) } }];
}`;

const resolveCancelCode = `${schedulingHelpersJs}
try {
  const prep = $('Prepare Cancel').first().json;
  const listResp = items[0].json;
  const config = JSON.parse(prep.configJson || '{}');
  const match = findMatchingCalendarEvent(listResp, prep.customerPhone, prep.slotStart, prep.customerName, new Date(), config.timezone || 'Europe/Warsaw');
  if (!match || !match.id) {
    return [{ json: { success: false, message: 'Nie znaleziono wizyty w kalendarzu. Sprawdź termin i numer telefonu.' } }];
  }
  const slotLabel = formatSlotLabel(new Date(prep.slotStart), config.timezone || 'Europe/Warsaw');
  return [{
    json: {
      success: true,
      eventId: match.id,
      deleteUrl: buildDeleteEventUrl(prep.calendarId, match.id),
      message: 'Wizyta odwołana: ' + slotLabel,
      cancelled_slot: prep.slotStart,
      label: slotLabel,
    },
  }];
} catch (err) {
  return [{ json: { success: false, message: 'Resolve Cancel error: ' + (err.message || String(err)) } }];
}`;

const formatCancelAckCode = `try {
  const resolved = $('Resolve Cancel').first().json;
  return [{ json: {
    success: true,
    message: resolved.message || 'Wizyta odwołana',
    cancelled_slot: resolved.cancelled_slot,
    label: resolved.label,
    eventId: resolved.eventId,
  } }];
} catch (err) {
  return [{ json: { success: false, message: 'Format Cancel Ack error: ' + (err.message || String(err)) } }];
}`;

const formatBookAckCode = `try {
  const validated = $('Validate Booking').first().json;
  const created = items[0]?.json || {};
  return [{ json: {
    success: true,
    message: validated.message || 'Termin zapisany',
    booked_slot: validated.booked_slot,
    label: validated.label,
    eventId: created.id || null,
  } }];
} catch (err) {
  return [{ json: { success: false, message: 'Format Book Ack error: ' + (err.message || String(err)) } }];
}`;

const prepareRescheduleCode = `${schedulingHelpersJs}
try {
  const env = (typeof $env !== 'undefined' && $env) ? $env : {};
  const config = configFromEnv(env);
  const calendarId = ((env.GOOGLE_CALENDAR_ID || 'primary') + '').trim();
  const req = parseRetellToolRequest(items[0].json);
  const oldSlotStart = req.args.old_slot_start || req.args.oldSlotStart;
  const newSlotStart = req.args.new_slot_start || req.args.newSlotStart;
  const customerName = req.args.customer_name || req.args.customerName || req.callerName || 'Klient';
  const customerPhone = req.callerPhone || req.args.phone || '';
  const notes = req.args.notes || req.args.conversation_summary || '';
  const goal = req.args.goal || '';
  const experienceLevel = req.args.experience_level || req.args.experienceLevel || '';
  const sessionsPerWeek = req.args.sessions_per_week || req.args.sessionsPerWeek || '';
  const conversationSummary = req.args.conversation_summary || notes || req.callSummary || '';
  if (!oldSlotStart || !newSlotStart) {
    return [{ json: { error: true, message: 'Wymagane parametry: old_slot_start i new_slot_start.' } }];
  }
  if (!customerPhone) {
    return [{ json: { error: true, message: 'Brak numeru telefonu klienta.' } }];
  }
  const resolvedOldSlot = resolveCancelSlotStart(String(oldSlotStart), new Date(), config.timezone);
  const now = new Date();
  const timeMin = new Date(now);
  const timeMax = new Date(newSlotStart);
  timeMax.setHours(timeMax.getHours() + config.durationMinutes + 1);
  return [{
    json: {
      eventsListUrl: buildEventsListUrl(calendarId, customerPhone, resolvedOldSlot, config),
      freeBusyBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: config.timezone,
        items: [{ id: calendarId }],
      },
      calendarId: calendarId,
      oldSlotStart: resolvedOldSlot,
      newSlotStart: String(newSlotStart),
      customerName: String(customerName),
      customerPhone: String(customerPhone),
      notes: String(notes),
      goal: String(goal),
      experienceLevel: String(experienceLevel),
      sessionsPerWeek: String(sessionsPerWeek),
      conversationSummary: String(conversationSummary),
      direction: req.direction || '',
      campaignName: req.campaignName || '',
      configJson: JSON.stringify(config),
    },
  }];
} catch (err) {
  return [{ json: { error: true, message: 'Prepare Reschedule error: ' + (err.message || String(err)) } }];
}`;

const resolveRescheduleCode = `${schedulingHelpersJs}
try {
  const prep = $('Prepare Reschedule').first().json;
  const listResp = items[0].json;
  const config = JSON.parse(prep.configJson || '{}');
  const match = findMatchingCalendarEvent(listResp, prep.customerPhone, prep.oldSlotStart, prep.customerName, new Date(), config.timezone || 'Europe/Warsaw');
  if (!match || !match.id) {
    return [{ json: { success: false, message: 'Nie znaleziono wizyty do przełożenia. Sprawdź stary termin.' } }];
  }
  return [{
    json: {
      success: true,
      eventId: match.id,
      patchUrl: buildPatchEventUrl(prep.calendarId, match.id),
      freeBusyBody: prep.freeBusyBody,
      calendarId: prep.calendarId,
      oldSlotStart: prep.oldSlotStart,
      newSlotStart: prep.newSlotStart,
      customerName: prep.customerName,
      customerPhone: prep.customerPhone,
      notes: prep.notes,
      goal: prep.goal,
      experienceLevel: prep.experienceLevel,
      sessionsPerWeek: prep.sessionsPerWeek,
      conversationSummary: prep.conversationSummary,
      direction: prep.direction,
      campaignName: prep.campaignName,
      configJson: prep.configJson,
    },
  }];
} catch (err) {
  return [{ json: { success: false, message: 'Resolve Reschedule error: ' + (err.message || String(err)) } }];
}`;

const validateRescheduleCode = `${schedulingHelpersJs}
const prep = $('Resolve Reschedule').first().json;
const config = JSON.parse(prep.configJson);
const busyBlocks = parseCalendarBusyBlocks($('Calendar FreeBusy (Reschedule)').first().json, prep.calendarId);
const resolvedNewSlot = resolveAgentSlotStart(prep.newSlotStart, config, busyBlocks, new Date());
const validation = validateBookingSlot(resolvedNewSlot, config, busyBlocks, new Date());
if (!validation.valid) {
  return [{ json: { success: false, message: validation.error } }];
}
const patchBody = buildCalendarEvent({
  slotStart: resolvedNewSlot,
  customerName: prep.customerName,
  customerPhone: prep.customerPhone,
  notes: prep.notes,
  goal: prep.goal,
  experienceLevel: prep.experienceLevel,
  sessionsPerWeek: prep.sessionsPerWeek,
  conversationSummary: prep.conversationSummary,
  direction: prep.direction,
  campaignName: prep.campaignName,
}, config);
const newLabel = formatSlotLabel(new Date(resolvedNewSlot), config.timezone);
const oldLabel = formatSlotLabel(new Date(prep.oldSlotStart), config.timezone);
return [{
  json: {
    success: true,
    patchUrl: prep.patchUrl,
    patchBody: patchBody,
    message: 'Wizyta przełożona na: ' + newLabel,
    booked_slot: resolvedNewSlot,
    old_slot: prep.oldSlotStart,
    label: newLabel,
    old_label: oldLabel,
  },
}];`;

const formatRescheduleAckCode = `try {
  const validated = $('Validate Reschedule').first().json;
  const resolved = $('Resolve Reschedule').first().json;
  return [{ json: {
    success: true,
    message: validated.message || 'Wizyta przełożona',
    booked_slot: validated.booked_slot,
    old_slot: validated.old_slot,
    label: validated.label,
    old_label: validated.old_label,
    eventId: resolved.eventId,
  } }];
} catch (err) {
  return [{ json: { success: false, message: 'Format Reschedule Ack error: ' + (err.message || String(err)) } }];
}`;

const buildRetellPayloadCode = `const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const lead = items[0].json;
const retellKey = ((env.RETELL_API_KEY || '') + '').trim();
const fromNumber = ((env.RETELL_FROM_NUMBER || '+48324412887') + '').trim();
const agentId = ((env.RETELL_OUTBOUND_AGENT_ID || env.RETELL_AGENT_ID || '') + '').trim();
return [{
  json: {
    retellAuthHeader: 'Bearer ' + retellKey,
    retellBody: {
      from_number: fromNumber,
      to_number: lead.phoneE164,
      override_agent_id: agentId,
      metadata: { source: 'meta_lead_ad', leadgen_id: lead.leadgenId },
      retell_llm_dynamic_variables: {
        full_name: lead.fullName,
        phone_number: lead.phoneE164,
        campaign_name: lead.campaignName,
      },
    },
  },
}];`;

const emitProcessedAckCode = `const mapped = $('Map Retell to Sheets').first().json;
if (mapped.skipped) {
  return [{ json: { status: 'skipped', phone: null, direction: null, sheetsSynced: false, reason: mapped.reason || null } }];
}
let sheetsSynced = false;
let reason = null;
try {
  const prep = $('Prepare Sheets Upsert').first().json;
  const nodeName = prep.upsertMode === 'update' ? 'Update Sheets Row' : 'Append Sheets Row';
  const result = $(nodeName).first().json;
  if (result && result.error) reason = String(result.error.message || result.error);
  else if (result && (result.updatedCells != null || result.updates || result.spreadsheetId)) sheetsSynced = true;
  else if (result) sheetsSynced = true;
  else reason = 'Brak odpowiedzi z Google Sheets';
} catch (e) {
  reason = String(e.message || e);
}
return [{
  json: {
    status: sheetsSynced ? 'processed' : 'sheets_error',
    phone: (mapped.sheet && mapped.sheet.phone) || mapped.upsertKey || null,
    direction: (mapped.sheet && mapped.sheet.direction) || null,
    sheetsSynced: sheetsSynced,
    reason: sheetsSynced ? null : reason,
  },
}];`;

const wf = {
  name: 'Retell Voice Agent — Obsługa klienta + Kalendarz + CRM',
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
  nodes: [
    // ======================== FLOW A: outbound dispatch =====================
    {
      parameters: { httpMethod: 'POST', path: 'meta-lead-inbound', responseMode: 'responseNode', options: {} },
      id: 'webhook-meta', name: 'Webhook — Meta Lead', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, -120], webhookId: 'meta-lead-inbound',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseMetaLeadCode },
      id: 'code-parse-meta', name: 'Parse Meta Lead', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, -120],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildRetellPayloadCode },
      id: 'code-build-retell', name: 'Build Retell Payload', type: 'n8n-nodes-base.code', typeVersion: 2, position: [170, -120],
    },
    {
      parameters: {
        method: 'POST', url: 'https://api.retellai.com/v2/create-phone-call', authentication: 'none',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ $json.retellAuthHeader }}' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.retellBody }}',
        options: { response: { response: { neverError: true, fullResponse: true, responseFormat: 'json' } } },
      },
      id: 'http-retell', name: 'Dispatch Retell Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [390, -120], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "status": "accepted", "httpStatus": ($json.statusCode || null), "retellCallId": (($json.body && $json.body.call_id) || null), "retellError": (($json.body && ($json.body.message || $json.body.error)) || null), "lead": $(\'Parse Meta Lead\').first().json.fullName } }}',
        options: { responseCode: 202 },
      },
      id: 'respond-meta', name: 'Ack Meta', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [610, -120],
    },

    // ======================== FLOW B: post-call CRM =========================
    {
      parameters: { httpMethod: 'POST', path: 'retell-call-analyzed', responseMode: 'responseNode', options: {} },
      id: 'webhook-retell', name: 'Webhook — Retell Call Analyzed', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, 200], webhookId: 'retell-call-analyzed',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: mapRetellToSheetsCode },
      id: 'code-map-sheets', name: 'Map Retell to Sheets', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, 200],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            { id: 'call-analyzed', leftValue: '={{ $("Map Retell to Sheets").first().json.skipped }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } },
            { id: 'has-doc', leftValue: '={{ $("Map Retell to Sheets").first().json.sheetsDocumentId }}', rightValue: '', operator: { type: 'string', operation: 'notEquals' } },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-end-of-call', name: 'Call analyzed?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [280, 200],
    },
    {
      parameters: {
        method: 'GET',
        url: '=https://sheets.googleapis.com/v4/spreadsheets/{{ $("Map Retell to Sheets").first().json.sheetsDocumentId }}?fields=sheets.properties.title',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-get-tab', name: 'Get Sheet Tab Name', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [420, 140],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput',
    },
    {
      parameters: {
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $("Map Retell to Sheets").first().json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + ($json.sheets[0].properties.title) + "\'!A:A") }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-get-phones', name: 'Get Phone Column', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [580, 140],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareSheetsUpsertCode },
      id: 'code-prepare-upsert', name: 'Prepare Sheets Upsert', type: 'n8n-nodes-base.code', typeVersion: 2, position: [740, 140],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'upsert-update', leftValue: '={{ $json.upsertMode }}', rightValue: 'update', operator: { type: 'string', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-upsert-mode', name: 'Row exists?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [900, 140],
    },
    {
      parameters: {
        method: 'PUT',
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + $json.tabTitle + "\'!A" + $json.rowNumber + ":" + $json.colEnd + $json.rowNumber) + "?valueInputOption=USER_ENTERED" }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ { "values": [$json.rowValues] } }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-update', name: 'Update Sheets Row', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1080, 80],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + $json.tabTitle + "\'!A:" + $json.colEnd) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS" }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ { "values": [$json.rowValues] } }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-append', name: 'Append Sheets Row', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1080, 200],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: emitProcessedAckCode },
      id: 'code-emit-ack', name: 'Build Webhook Ack', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1260, 200],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json }}',
        options: { responseCode: 200 },
      },
      id: 'respond-retell', name: 'Ack Retell', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [500, 200],
    },

    // ===================== FLOW C: check availability =======================
    {
      parameters: { httpMethod: 'POST', path: 'retell-check-availability', responseMode: 'responseNode', options: {} },
      id: 'webhook-availability', name: 'Webhook — Check Availability', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, 520], webhookId: 'retell-check-availability',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareAvailabilityCode },
      id: 'code-prepare-availability', name: 'Prepare Availability', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, 520],
    },
    {
      parameters: {
        method: 'POST', url: 'https://www.googleapis.com/calendar/v3/freeBusy',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.freeBusyBody }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-freebusy-check', name: 'Calendar FreeBusy (Check)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [280, 520], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: mergeAvailabilityCode },
      id: 'code-merge-availability', name: 'Merge Availability', type: 'n8n-nodes-base.code', typeVersion: 2, position: [500, 520],
    },
    {
      parameters: {
        respondWith: 'json', responseBody: '={{ $json }}', options: { responseCode: 200 },
      },
      id: 'respond-availability', name: 'Ack Availability', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [720, 520],
    },

    // ======================== FLOW D: book appointment ======================
    {
      parameters: { httpMethod: 'POST', path: 'retell-book-appointment', responseMode: 'responseNode', options: {} },
      id: 'webhook-book', name: 'Webhook — Book Appointment', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, 760], webhookId: 'retell-book-appointment',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareBookingCode },
      id: 'code-prepare-booking', name: 'Prepare Booking', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, 760],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'has-slot', leftValue: '={{ $json.error }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-book-params', name: 'Booking params OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [200, 760],
    },
    {
      parameters: {
        method: 'POST', url: 'https://www.googleapis.com/calendar/v3/freeBusy',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.freeBusyBody }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-freebusy-book', name: 'Calendar FreeBusy (Book)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [400, 760], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: validateAndBookCode },
      id: 'code-validate-book', name: 'Validate Booking', type: 'n8n-nodes-base.code', typeVersion: 2, position: [500, 760],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'book-ok', leftValue: '={{ $json.success }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-book-valid', name: 'Booking valid?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [680, 760],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent($json.calendarId) + "/events" }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.eventBody }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-create-event', name: 'Create Calendar Event', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [880, 700], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: formatBookAckCode },
      id: 'code-format-book-ack', name: 'Format Book Ack', type: 'n8n-nodes-base.code', typeVersion: 2, position: [990, 700],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json }}',
        options: { responseCode: 200 },
      },
      id: 'respond-book-ok', name: 'Ack Booking OK', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1100, 700],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "success": false, "message": ($json.message || "Rezerwacja nieudana") } }}',
        options: { responseCode: 200 },
      },
      id: 'respond-book-fail', name: 'Ack Booking Fail', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [880, 820],
    },

    // =================== FLOW D2: list my appointments ===================
    {
      parameters: { httpMethod: 'POST', path: 'retell-list-appointments', responseMode: 'responseNode', options: {} },
      id: 'webhook-list', name: 'Webhook — List Appointments', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, 880], webhookId: 'retell-list-appointments',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareListCode },
      id: 'code-prepare-list', name: 'Prepare List', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, 880],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'list-params', leftValue: '={{ $json.error }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-list-params', name: 'List params OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [200, 880],
    },
    {
      parameters: {
        method: 'GET', url: '={{ $json.eventsListUrl }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-list-appts', name: 'List Events (My Appointments)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [400, 880], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: formatListCode },
      id: 'code-format-list', name: 'Format List', type: 'n8n-nodes-base.code', typeVersion: 2, position: [500, 880],
    },
    {
      parameters: {
        respondWith: 'json', responseBody: '={{ $json }}', options: { responseCode: 200 },
      },
      id: 'respond-list', name: 'Ack List', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [720, 880],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "found": false, "message": ($json.message || "Nie udało się pobrać listy wizyt"), "appointments": [] } }}',
        options: { responseCode: 200 },
      },
      id: 'respond-list-fail', name: 'Ack List Fail', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [400, 980],
    },

    // ===================== FLOW E: cancel appointment ======================
    {
      parameters: { httpMethod: 'POST', path: 'retell-cancel-appointment', responseMode: 'responseNode', options: {} },
      id: 'webhook-cancel', name: 'Webhook — Cancel Appointment', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, 1000], webhookId: 'retell-cancel-appointment',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareCancelCode },
      id: 'code-prepare-cancel', name: 'Prepare Cancel', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, 1000],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'cancel-params', leftValue: '={{ $json.error }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-cancel-params', name: 'Cancel params OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [200, 1000],
    },
    {
      parameters: {
        method: 'GET', url: '={{ $json.eventsListUrl }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-list-cancel', name: 'List Events (Cancel)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [400, 1000], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: resolveCancelCode },
      id: 'code-resolve-cancel', name: 'Resolve Cancel', type: 'n8n-nodes-base.code', typeVersion: 2, position: [500, 1000],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'cancel-found', leftValue: '={{ $json.success }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-cancel-found', name: 'Cancel event found?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [680, 1000],
    },
    {
      parameters: {
        method: 'DELETE', url: '={{ $json.deleteUrl }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        options: { response: { response: { responseFormat: 'text' } } },
      },
      id: 'cal-delete-event', name: 'Delete Calendar Event', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [880, 940], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: formatCancelAckCode },
      id: 'code-format-cancel-ack', name: 'Format Cancel Ack', type: 'n8n-nodes-base.code', typeVersion: 2, position: [990, 940],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json }}',
        options: { responseCode: 200 },
      },
      id: 'respond-cancel-ok', name: 'Ack Cancel OK', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1100, 940],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "success": false, "message": ($json.message || "Odwołanie nieudane") } }}',
        options: { responseCode: 200 },
      },
      id: 'respond-cancel-fail', name: 'Ack Cancel Fail', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [880, 1060],
    },

    // ===================== FLOW F: reschedule appointment ==================
    {
      parameters: { httpMethod: 'POST', path: 'retell-reschedule-appointment', responseMode: 'responseNode', options: {} },
      id: 'webhook-reschedule', name: 'Webhook — Reschedule Appointment', type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [-160, 1240], webhookId: 'retell-reschedule-appointment',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareRescheduleCode },
      id: 'code-prepare-reschedule', name: 'Prepare Reschedule', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, 1240],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'resched-params', leftValue: '={{ $json.error }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-reschedule-params', name: 'Reschedule params OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [200, 1240],
    },
    {
      parameters: {
        method: 'GET', url: '={{ $json.eventsListUrl }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-list-reschedule', name: 'List Events (Reschedule)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [400, 1240], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: resolveRescheduleCode },
      id: 'code-resolve-reschedule', name: 'Resolve Reschedule', type: 'n8n-nodes-base.code', typeVersion: 2, position: [500, 1240],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'resched-found', leftValue: '={{ $json.success }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-reschedule-found', name: 'Reschedule event found?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [680, 1240],
    },
    {
      parameters: {
        method: 'POST', url: 'https://www.googleapis.com/calendar/v3/freeBusy',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.freeBusyBody }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-freebusy-reschedule', name: 'Calendar FreeBusy (Reschedule)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [880, 1240], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: validateRescheduleCode },
      id: 'code-validate-reschedule', name: 'Validate Reschedule', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1000, 1240],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'resched-valid', leftValue: '={{ $json.success }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-reschedule-valid', name: 'Reschedule valid?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1180, 1240],
    },
    {
      parameters: {
        method: 'PATCH', url: '={{ $json.patchUrl }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.patchBody }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'cal-patch-event', name: 'Patch Calendar Event', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1380, 1180], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: formatRescheduleAckCode },
      id: 'code-format-reschedule-ack', name: 'Format Reschedule Ack', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1490, 1180],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json }}',
        options: { responseCode: 200 },
      },
      id: 'respond-reschedule-ok', name: 'Ack Reschedule OK', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1600, 1180],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "success": false, "message": ($json.message || "Przełożenie nieudane") } }}',
        options: { responseCode: 200 },
      },
      id: 'respond-reschedule-fail', name: 'Ack Reschedule Fail', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1380, 1300],
    },

    // ===================== FLOW F: appointment → Google Sheets (live sync) =====
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildBookSheetsRowCode },
      id: 'code-book-sheets', name: 'Build Book Sheets Row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 620],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildCancelSheetsRowCode },
      id: 'code-cancel-sheets', name: 'Build Cancel Sheets Row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 860],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildRescheduleSheetsRowCode },
      id: 'code-reschedule-sheets', name: 'Build Reschedule Sheets Row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1600, 1100],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'sync-ready', leftValue: '={{ $json.skipped }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-sheets-sync-ready', name: 'Sheets sync ready?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1280, 760],
    },
    {
      parameters: {
        method: 'GET',
        url: '=https://sheets.googleapis.com/v4/spreadsheets/{{ $json.sheetsDocumentId }}?fields=sheets.properties.title',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-get-tab-sync', name: 'Get Sheet Tab (Sync)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1460, 700],
    },
    {
      parameters: {
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + ($("Sheets sync ready?").first().json.sheetsDocumentId) + "/values/" + encodeURIComponent("\'" + ($json.sheets[0].properties.title) + "\'!A:A") }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-get-phones-sync', name: 'Get Phone Column (Sync)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1640, 700],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareSheetsUpsertSyncCode },
      id: 'code-prepare-upsert-sync', name: 'Prepare Sheets Upsert (Sync)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1820, 700],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'sync-update', leftValue: '={{ $json.upsertMode }}', rightValue: 'update', operator: { type: 'string', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-sync-upsert-mode', name: 'Sync row exists?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [2000, 700],
    },
    {
      parameters: {
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + $json.tabTitle + "\'!A" + $json.rowNumber + ":" + $json.colEnd + $json.rowNumber) }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-get-existing-sync', name: 'Get Existing Row (Sync)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2180, 640],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: mergeSheetsRowSyncCode },
      id: 'code-merge-sync', name: 'Merge Sheets Row (Sync)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2360, 640],
    },
    {
      parameters: {
        method: 'PUT',
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + $json.tabTitle + "\'!A" + $json.rowNumber + ":" + $json.colEnd + $json.rowNumber) + "?valueInputOption=USER_ENTERED" }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ { "values": [$json.rowValues] } }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-update-sync', name: 'Update Sheets Row (Sync)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2540, 640], retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + $json.tabTitle + "\'!A:" + $json.colEnd) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS" }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ { "values": [$json.rowValues] } }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-append-sync', name: 'Append Sheets Row (Sync)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2180, 780], retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput',
    },
  ],
  connections: {
    'Webhook — Meta Lead': { main: [[{ node: 'Parse Meta Lead', type: 'main', index: 0 }]] },
    'Parse Meta Lead': { main: [[{ node: 'Build Retell Payload', type: 'main', index: 0 }]] },
    'Build Retell Payload': { main: [[{ node: 'Dispatch Retell Call', type: 'main', index: 0 }]] },
    'Dispatch Retell Call': { main: [[{ node: 'Ack Meta', type: 'main', index: 0 }]] },
    'Webhook — Retell Call Analyzed': { main: [[{ node: 'Map Retell to Sheets', type: 'main', index: 0 }]] },
    'Map Retell to Sheets': { main: [[{ node: 'Call analyzed?', type: 'main', index: 0 }]] },
    'Call analyzed?': {
      main: [
        [{ node: 'Get Sheet Tab Name', type: 'main', index: 0 }],
        [{ node: 'Build Webhook Ack', type: 'main', index: 0 }],
      ],
    },
    'Get Sheet Tab Name': { main: [[{ node: 'Get Phone Column', type: 'main', index: 0 }]] },
    'Get Phone Column': { main: [[{ node: 'Prepare Sheets Upsert', type: 'main', index: 0 }]] },
    'Prepare Sheets Upsert': { main: [[{ node: 'Row exists?', type: 'main', index: 0 }]] },
    'Row exists?': {
      main: [
        [{ node: 'Update Sheets Row', type: 'main', index: 0 }],
        [{ node: 'Append Sheets Row', type: 'main', index: 0 }],
      ],
    },
    'Update Sheets Row': { main: [[{ node: 'Build Webhook Ack', type: 'main', index: 0 }]] },
    'Append Sheets Row': { main: [[{ node: 'Build Webhook Ack', type: 'main', index: 0 }]] },
    'Build Webhook Ack': { main: [[{ node: 'Ack Retell', type: 'main', index: 0 }]] },
    'Ack Retell': { main: [[]] },
    'Webhook — Check Availability': { main: [[{ node: 'Prepare Availability', type: 'main', index: 0 }]] },
    'Prepare Availability': { main: [[{ node: 'Calendar FreeBusy (Check)', type: 'main', index: 0 }]] },
    'Calendar FreeBusy (Check)': { main: [[{ node: 'Merge Availability', type: 'main', index: 0 }]] },
    'Merge Availability': { main: [[{ node: 'Ack Availability', type: 'main', index: 0 }]] },
    'Webhook — Book Appointment': { main: [[{ node: 'Prepare Booking', type: 'main', index: 0 }]] },
    'Prepare Booking': { main: [[{ node: 'Booking params OK?', type: 'main', index: 0 }]] },
    'Booking params OK?': {
      main: [
        [{ node: 'Calendar FreeBusy (Book)', type: 'main', index: 0 }],
        [{ node: 'Ack Booking Fail', type: 'main', index: 0 }],
      ],
    },
    'Calendar FreeBusy (Book)': { main: [[{ node: 'Validate Booking', type: 'main', index: 0 }]] },
    'Validate Booking': { main: [[{ node: 'Booking valid?', type: 'main', index: 0 }]] },
    'Booking valid?': {
      main: [
        [{ node: 'Create Calendar Event', type: 'main', index: 0 }],
        [{ node: 'Ack Booking Fail', type: 'main', index: 0 }],
      ],
    },
    'Create Calendar Event': {
      main: [[
        { node: 'Format Book Ack', type: 'main', index: 0 },
      ]],
    },
    'Format Book Ack': {
      main: [[
        { node: 'Ack Booking OK', type: 'main', index: 0 },
        { node: 'Build Book Sheets Row', type: 'main', index: 0 },
      ]],
    },
    'Build Book Sheets Row': { main: [[{ node: 'Sheets sync ready?', type: 'main', index: 0 }]] },
    'Webhook — List Appointments': { main: [[{ node: 'Prepare List', type: 'main', index: 0 }]] },
    'Prepare List': { main: [[{ node: 'List params OK?', type: 'main', index: 0 }]] },
    'List params OK?': {
      main: [
        [{ node: 'List Events (My Appointments)', type: 'main', index: 0 }],
        [{ node: 'Ack List Fail', type: 'main', index: 0 }],
      ],
    },
    'List Events (My Appointments)': { main: [[{ node: 'Format List', type: 'main', index: 0 }]] },
    'Format List': { main: [[{ node: 'Ack List', type: 'main', index: 0 }]] },
    'Webhook — Cancel Appointment': { main: [[{ node: 'Prepare Cancel', type: 'main', index: 0 }]] },
    'Prepare Cancel': { main: [[{ node: 'Cancel params OK?', type: 'main', index: 0 }]] },
    'Cancel params OK?': {
      main: [
        [{ node: 'List Events (Cancel)', type: 'main', index: 0 }],
        [{ node: 'Ack Cancel Fail', type: 'main', index: 0 }],
      ],
    },
    'List Events (Cancel)': { main: [[{ node: 'Resolve Cancel', type: 'main', index: 0 }]] },
    'Resolve Cancel': { main: [[{ node: 'Cancel event found?', type: 'main', index: 0 }]] },
    'Cancel event found?': {
      main: [
        [{ node: 'Delete Calendar Event', type: 'main', index: 0 }],
        [{ node: 'Ack Cancel Fail', type: 'main', index: 0 }],
      ],
    },
    'Delete Calendar Event': {
      main: [[
        { node: 'Format Cancel Ack', type: 'main', index: 0 },
      ]],
    },
    'Format Cancel Ack': {
      main: [[
        { node: 'Ack Cancel OK', type: 'main', index: 0 },
        { node: 'Build Cancel Sheets Row', type: 'main', index: 0 },
      ]],
    },
    'Build Cancel Sheets Row': { main: [[{ node: 'Sheets sync ready?', type: 'main', index: 0 }]] },
    'Webhook — Reschedule Appointment': { main: [[{ node: 'Prepare Reschedule', type: 'main', index: 0 }]] },
    'Prepare Reschedule': { main: [[{ node: 'Reschedule params OK?', type: 'main', index: 0 }]] },
    'Reschedule params OK?': {
      main: [
        [{ node: 'List Events (Reschedule)', type: 'main', index: 0 }],
        [{ node: 'Ack Reschedule Fail', type: 'main', index: 0 }],
      ],
    },
    'List Events (Reschedule)': { main: [[{ node: 'Resolve Reschedule', type: 'main', index: 0 }]] },
    'Resolve Reschedule': { main: [[{ node: 'Reschedule event found?', type: 'main', index: 0 }]] },
    'Reschedule event found?': {
      main: [
        [{ node: 'Calendar FreeBusy (Reschedule)', type: 'main', index: 0 }],
        [{ node: 'Ack Reschedule Fail', type: 'main', index: 0 }],
      ],
    },
    'Calendar FreeBusy (Reschedule)': { main: [[{ node: 'Validate Reschedule', type: 'main', index: 0 }]] },
    'Validate Reschedule': { main: [[{ node: 'Reschedule valid?', type: 'main', index: 0 }]] },
    'Reschedule valid?': {
      main: [
        [{ node: 'Patch Calendar Event', type: 'main', index: 0 }],
        [{ node: 'Ack Reschedule Fail', type: 'main', index: 0 }],
      ],
    },
    'Patch Calendar Event': {
      main: [[
        { node: 'Format Reschedule Ack', type: 'main', index: 0 },
      ]],
    },
    'Format Reschedule Ack': {
      main: [[
        { node: 'Ack Reschedule OK', type: 'main', index: 0 },
        { node: 'Build Reschedule Sheets Row', type: 'main', index: 0 },
      ]],
    },
    'Build Reschedule Sheets Row': { main: [[{ node: 'Sheets sync ready?', type: 'main', index: 0 }]] },
    'Sheets sync ready?': {
      main: [
        [{ node: 'Get Sheet Tab (Sync)', type: 'main', index: 0 }],
        [],
      ],
    },
    'Get Sheet Tab (Sync)': { main: [[{ node: 'Get Phone Column (Sync)', type: 'main', index: 0 }]] },
    'Get Phone Column (Sync)': { main: [[{ node: 'Prepare Sheets Upsert (Sync)', type: 'main', index: 0 }]] },
    'Prepare Sheets Upsert (Sync)': { main: [[{ node: 'Sync row exists?', type: 'main', index: 0 }]] },
    'Sync row exists?': {
      main: [
        [{ node: 'Get Existing Row (Sync)', type: 'main', index: 0 }],
        [{ node: 'Append Sheets Row (Sync)', type: 'main', index: 0 }],
      ],
    },
    'Get Existing Row (Sync)': { main: [[{ node: 'Merge Sheets Row (Sync)', type: 'main', index: 0 }]] },
    'Merge Sheets Row (Sync)': { main: [[{ node: 'Update Sheets Row (Sync)', type: 'main', index: 0 }]] },
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
  tags: [{ name: 'retell' }, { name: 'google-sheets' }, { name: 'google-calendar' }, { name: 'voice-agent' }, { name: 'inbound' }],
};

mkdirSync(join(root, 'workflows'), { recursive: true });
const out = join(root, 'workflows', 'vapi-outbound-agent.json');
writeFileSync(out, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('Wrote', out);
