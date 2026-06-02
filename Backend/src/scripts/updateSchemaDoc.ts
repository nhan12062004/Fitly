import fs from 'node:fs/promises';
import path from 'node:path';
import { supabase } from '../config/Supabase';

const run = async () => {
  const now = new Date().toISOString();
  const targetPath = path.resolve(process.cwd(), '..', 'docs', 'database_schema.md');

  const structureRes = await supabase.rpc('export_public_tables_structure');

  if (structureRes.error) {
    throw new Error(`export_public_tables_structure failed: ${structureRes.error.message}`);
  }

  const structureLines = (structureRes.data || [])
    .map((row: any) => String(row.sql_line || '').trimEnd())
    .filter(Boolean);

  const content = [
    `-- AUTO-GENERATED from Supabase on ${now}`,
    '-- Source RPC: export_public_tables_structure',
    '-- Note: schema only. Data snapshots are intentionally excluded to avoid leaking sensitive records.',
    '',
    ...structureLines,
    ''
  ].join('\n');

  await fs.writeFile(targetPath, content, 'utf8');
  console.log(`Updated schema doc: ${targetPath}`);
  console.log(`Tables SQL lines: ${structureLines.length}`);
};

run().catch((error) => {
  console.error('Failed to update docs/database_schema.md:', error);
  process.exit(1);
});
