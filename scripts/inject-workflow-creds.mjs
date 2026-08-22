/**
 * Injects Google OAuth credential refs into workflow JSON before n8n import.
 * Usage: node scripts/inject-workflow-creds.mjs <src.json> <live.json> <wfId> <out.json> [creds-export.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [srcPath, livePath, wfId, outPath, credsPath] = process.argv.slice(2);
const src = JSON.parse(readFileSync(srcPath, 'utf8'));
const live = JSON.parse(readFileSync(livePath, 'utf8'))[0];

let sheetsCredRef = null;
let calendarCredRef = null;

const liveSheetsNode = live.nodes.find((n) => n.credentials?.googleSheetsOAuth2Api);
const liveCalendarNode = live.nodes.find((n) => n.credentials?.googleCalendarOAuth2Api);
if (liveSheetsNode) sheetsCredRef = liveSheetsNode.credentials.googleSheetsOAuth2Api;
if (liveCalendarNode) calendarCredRef = liveCalendarNode.credentials.googleCalendarOAuth2Api;

if ((!sheetsCredRef || !calendarCredRef) && credsPath && existsSync(credsPath)) {
  const exported = JSON.parse(readFileSync(credsPath, 'utf8'));
  if (!sheetsCredRef) {
    const c = exported.find((x) => x.type === 'googleSheetsOAuth2Api');
    if (c) sheetsCredRef = { id: c.id, name: c.name };
  }
  if (!calendarCredRef) {
    const c = exported.find((x) => x.type === 'googleCalendarOAuth2Api');
    if (c) calendarCredRef = { id: c.id, name: c.name };
  }
}

function needsSheetsCred(node) {
  if (node.type === 'n8n-nodes-base.code' && /Sync.*Sheets|Sheets Row/i.test(node.name ?? '')) {
    return true;
  }
  if (node.type !== 'n8n-nodes-base.httpRequest') return false;
  if (node.parameters?.nodeCredentialType === 'googleSheetsOAuth2Api') return true;
  return /Sheet|Sheets|\(Sync\)|Phone Column/i.test(node.name ?? '');
}

for (const node of src.nodes) {
  if (needsSheetsCred(node) && sheetsCredRef) {
    node.credentials = { googleSheetsOAuth2Api: sheetsCredRef };
  }
  const needsCalendar =
    node.parameters?.nodeCredentialType === 'googleCalendarOAuth2Api' ||
    (node.name ?? '').includes('Calendar');
  if (needsCalendar && calendarCredRef) {
    node.credentials = { googleCalendarOAuth2Api: calendarCredRef };
  }
}

src.id = wfId;
src.active = true;
writeFileSync(outPath, JSON.stringify(src));

if (!sheetsCredRef) {
  console.error('WARN: Brak Google Sheets OAuth — dodaj credential w n8n UI (Credentials → Google Sheets OAuth2)');
  process.exit(2);
}

console.log(`Sheets credential: ${sheetsCredRef.name} (${sheetsCredRef.id})`);
if (calendarCredRef) console.log(`Calendar credential: ${calendarCredRef.name} (${calendarCredRef.id})`);
