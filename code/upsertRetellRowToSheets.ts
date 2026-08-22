/**
 * n8n Code node — upsert call_analyzed row via Google Sheets API.
 * Uses httpRequestWithAuthentication (credential must be on this node).
 */

import { normalizeSheetPhone, sheetRowToValues } from './sheetColumns';
import type { VoiceLeadSheetRow } from './types';

interface MappedPayload {
  skipped?: boolean;
  sheetsDocumentId?: string;
  upsertKey?: string;
  sheet?: VoiceLeadSheetRow;
  rowValues?: string[];
}

export async function upsertRetellRowToSheets(
  mapped: MappedPayload,
  request: (method: string, url: string, body?: { values: string[][] }) => Promise<unknown>,
): Promise<{ sheetsSynced: boolean; upsertMode?: string; rowNumber?: number; phone?: string; reason?: string }> {
  if (mapped.skipped || !mapped.sheetsDocumentId || !mapped.upsertKey) {
    return { sheetsSynced: false, reason: 'skipped' };
  }

  const docId = mapped.sheetsDocumentId;
  const rowValues = mapped.rowValues ?? sheetRowToValues(mapped.sheet!);
  const phoneKey = normalizeSheetPhone;

  const meta = (await request(
    'GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${docId}?fields=sheets.properties.title`,
  )) as { sheets: Array<{ properties: { title: string } }> };

  const tabTitle = meta.sheets[0]?.properties?.title;
  if (!tabTitle) return { sheetsSynced: false, reason: 'Brak zakładki w arkuszu' };

  const colA = (await request(
    'GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/${encodeURIComponent(`'${tabTitle}'!A:A`)}`,
  )) as { values?: string[][] };

  const rows = colA.values ?? [];
  let rowNumber = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0] && phoneKey(rows[i][0]) === phoneKey(mapped.upsertKey!)) {
      rowNumber = i + 1;
      break;
    }
  }

  const range = encodeURIComponent(`'${tabTitle}'!A${rowNumber > 0 ? `${rowNumber}:H${rowNumber}` : ':H'}`);
  if (rowNumber > 0) {
    await request(
      'PUT',
      `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/${range}?valueInputOption=USER_ENTERED`,
      { values: [rowValues] },
    );
  } else {
    await request(
      'POST',
      `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { values: [rowValues] },
    );
  }

  return {
    sheetsSynced: true,
    upsertMode: rowNumber > 0 ? 'update' : 'append',
    rowNumber: rowNumber || undefined,
    phone: mapped.upsertKey,
  };
}
