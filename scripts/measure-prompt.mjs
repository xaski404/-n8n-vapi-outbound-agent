import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const docFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'retell-agent-prompt.md');

function extractFencedBlockAfter(md, heading) {
  const idx = md.indexOf(heading);
  if (idx === -1) throw new Error(`Nie znaleziono: ${heading}`);
  const rest = md.slice(idx + heading.length);
  const open = rest.indexOf('```');
  const afterOpen = rest.indexOf('\n', open) + 1;
  const close = rest.indexOf('```', afterOpen);
  return rest.slice(afterOpen, close).trim();
}

const md = readFileSync(docFile, 'utf8');
const prompt = extractFencedBlockAfter(md, '## Prompt systemowy');
console.log('chars:', prompt.length);
console.log('est tokens (~/2.95):', Math.round(prompt.length / 2.95));
console.log('est tokens (~/3.5):', Math.round(prompt.length / 3.5));
