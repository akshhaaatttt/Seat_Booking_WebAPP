import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// schema.sql is data, not TypeScript, so tsc does not emit it. The compiled
// server reads it at boot to apply the schema, so it has to travel to dist/.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'src', 'db', 'schema.sql');
const target = join(root, 'dist', 'db', 'schema.sql');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copied schema.sql -> ${target}`);
