import { readFile } from 'node:fs/promises';
import path from 'node:path';

type CliOptions = {
  sqlFile: string;
  videoMappingFile: string;
  apply: boolean;
};

type VideoMappingFile = {
  mappings: Array<{ id: string; videoUrl: string | null; match: string }>;
};

type CatalogRow = Record<string, unknown> & { id: string; video_url: string };

const columns = [
  'id', 'name', 'body_part', 'target_muscle', 'secondary_muscles', 'equipment',
  'training_locations', 'difficulty', 'min_experience_months', 'progression_level',
  'movement_pattern', 'goal_type', 'contraindications', 'estimated_duration_seconds',
  'calories_per_minute', 'image_url', 'gif_url', 'instructions',
] as const;

const usage = `Usage: npx tsx src/scripts/importVerifiedSqlExerciseCatalog.ts --sql <catalog.sql> --video-mapping <mapping.json> [--apply]

Without --apply, validates the 100-item catalog and video mapping without writing to Supabase.`;

const readOption = (args: string[], flag: string): string => {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('-')) {
    throw new Error(`${flag} is required.\n\n${usage}`);
  }
  return args[index + 1];
};

const parseCliOptions = (args: string[]): CliOptions => {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
  const supported = new Set(['--sql', '--video-mapping', '--apply']);
  const unknown = args.find((arg) => arg.startsWith('-') && !supported.has(arg));
  if (unknown) throw new Error(`Unknown argument: ${unknown}\n\n${usage}`);
  return {
    sqlFile: readOption(args, '--sql'),
    videoMappingFile: readOption(args, '--video-mapping'),
    apply: args.includes('--apply'),
  };
};

const splitSqlValues = (input: string): string[] => {
  const values: string[] = [];
  let token = '';
  let arrayDepth = 0;
  let inQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    if (!inQuote && input.startsWith('$fitly$', index)) {
      const end = input.indexOf('$fitly$', index + '$fitly$'.length);
      if (end === -1) throw new Error('Unterminated $fitly$ JSON value.');
      const rawJson = input.slice(index, end + '$fitly$'.length);
      token += rawJson;
      index = end + '$fitly$'.length - 1;
      continue;
    }

    const character = input[index];
    if (character === "'") {
      token += character;
      if (inQuote && input[index + 1] === "'") {
        token += input[index + 1];
        index += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (!inQuote && character === '[') arrayDepth += 1;
    if (!inQuote && character === ']') arrayDepth -= 1;
    if (!inQuote && character === ',' && arrayDepth === 0) {
      values.push(token.trim());
      token = '';
      continue;
    }
    token += character;
  }
  if (inQuote || arrayDepth !== 0) throw new Error('Malformed SQL value list.');
  values.push(token.trim());
  return values;
};

const unquoteSqlString = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    throw new Error(`Expected a SQL string literal, received: ${trimmed.slice(0, 80)}`);
  }
  return trimmed.slice(1, -1).replace(/''/g, "'");
};

const parseSqlValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed === 'NULL') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("'")) return unquoteSqlString(trimmed);

  const array = /^ARRAY\[([\s\S]*)\]::text\[\]$/.exec(trimmed);
  if (array) {
    const contents = array[1].trim();
    return contents ? splitSqlValues(contents).map(unquoteSqlString) : [];
  }

  const json = /^\$fitly\$([\s\S]*)\$fitly\$::jsonb$/.exec(trimmed);
  if (json) return JSON.parse(json[1]);

  throw new Error(`Unsupported SQL value: ${trimmed.slice(0, 80)}`);
};

const parseCatalogSql = (sql: string): Array<Record<string, unknown>> => {
  const pattern = /INSERT INTO public\.exercises \([\s\S]*?\) VALUES \(([\s\S]*?)\)\s*ON CONFLICT \(id\) DO UPDATE SET/g;
  const rows: Array<Record<string, unknown>> = [];
  for (const match of sql.matchAll(pattern)) {
    const values = splitSqlValues(match[1]);
    if (values.length !== columns.length) {
      throw new Error(`Expected ${columns.length} values per exercise, received ${values.length}.`);
    }
    rows.push(Object.fromEntries(columns.map((column, index) => [column, parseSqlValue(values[index])])))
  }
  return rows;
};

const validateRows = (rows: Array<Record<string, unknown>>, videoMapping: VideoMappingFile): CatalogRow[] => {
  if (rows.length !== 100) throw new Error(`Expected exactly 100 catalog rows, found ${rows.length}.`);
  const urls = new Map<string, string>();
  videoMapping.mappings.forEach((mapping) => {
    if (mapping.id && mapping.videoUrl && /^https:\/\//.test(mapping.videoUrl) && mapping.match !== 'none' && mapping.match !== 'ambiguous') {
      urls.set(mapping.id, mapping.videoUrl);
    }
  });
  if (urls.size !== 100) throw new Error(`Expected 100 unambiguous video mappings, found ${urls.size}.`);

  const ids = new Set<string>();
  return rows.map((row, index) => {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Row ${index + 1} has invalid id: ${id}`);
    if (ids.has(id)) throw new Error(`Duplicate exercise id: ${id}`);
    ids.add(id);
    const videoUrl = urls.get(id);
    if (!videoUrl) throw new Error(`No verified video URL for: ${id}`);
    if (typeof row.name !== 'string' || !row.name.trim()) throw new Error(`Missing name for: ${id}`);
    if (!Array.isArray(row.instructions)) {
      const instructions = row.instructions as Record<string, unknown> | null;
      if (!instructions || !Array.isArray(instructions.steps) || instructions.steps.length < 2) {
        throw new Error(`Invalid instructions for: ${id}`);
      }
    }
    const { image_url: _imageUrl, gif_url: _gifUrl, ...catalogRow } = row;
    return { ...catalogRow, id, video_url: videoUrl } as CatalogRow;
  });
};

const main = async () => {
  const options = parseCliOptions(process.argv.slice(2));
  const [sql, mappingText] = await Promise.all([
    readFile(path.resolve(process.cwd(), options.sqlFile), 'utf8'),
    readFile(path.resolve(process.cwd(), options.videoMappingFile), 'utf8'),
  ]);
  const rows = validateRows(parseCatalogSql(sql), JSON.parse(mappingText) as VideoMappingFile);
  console.log(`Validated ${rows.length} exercises with ${rows.length} verified video URLs.`);
  if (!options.apply) {
    console.log('Dry run only. Add --apply to upsert the catalog.');
    return;
  }

  const { supabase } = await import('../config/Supabase.js');
  const { error } = await supabase.from('exercises').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Unable to import catalog: ${error.message}`);

  const { data, error: verificationError } = await supabase
    .from('exercises')
    .select('id, video_url')
    .order('id');
  if (verificationError) throw new Error(`Unable to verify catalog: ${verificationError.message}`);
  const imported = data || [];
  const missingVideo = imported.filter((row) => !row.video_url);
  if (imported.length !== 100 || missingVideo.length > 0) {
    throw new Error(`Import verification failed: ${imported.length} exercise(s), ${missingVideo.length} missing video URL(s).`);
  }
  console.log(`Imported and verified ${imported.length} exercises; every exercise has a video_url.`);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected importer failure');
  process.exitCode = 1;
});
