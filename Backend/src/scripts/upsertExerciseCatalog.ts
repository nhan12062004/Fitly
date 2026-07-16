import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ExerciseCatalogItem, validateExerciseCatalog } from '../../../shared/exerciseCatalog';

const usage = `Usage: npm run exercises:upsert -- [--file <catalog.json>] [--allow-empty]

Options:
  --file <path>   Catalog JSON file (default: catalog/exercise-catalog.template.json)
  --allow-empty   Permit a valid empty catalog as an explicit no-op
  --help, -h      Show this help text`;

type UpsertCliOptions = {
  fileArgument: string;
  allowEmpty: boolean;
  showHelp: boolean;
};

const parseCliOptions = (args: string[]): UpsertCliOptions => {
  const showHelp = args.includes('--help') || args.includes('-h');
  const recognizedFlags = new Set(['--file', '--allow-empty', '--help', '-h']);
  const unknownFlag = args.find((arg) => arg.startsWith('-') && !recognizedFlags.has(arg));
  if (unknownFlag) throw new Error(`Unknown option: ${unknownFlag}\n\n${usage}`);

  const index = args.indexOf('--file');
  if (index !== -1 && (!args[index + 1] || args[index + 1].startsWith('-'))) {
    throw new Error(`--file requires a catalog path.\n\n${usage}`);
  }

  return {
    fileArgument: index === -1 ? 'catalog/exercise-catalog.template.json' : args[index + 1],
    allowEmpty: args.includes('--allow-empty'),
    showHelp,
  };
};

const toDatabaseRow = (item: ExerciseCatalogItem) => ({
  id: item.id,
  name: item.name,
  body_part: item.body_part,
  target_muscle: item.target_muscle,
  secondary_muscles: item.secondary_muscles,
  equipment: item.equipment,
  training_locations: item.training_locations,
  difficulty: item.difficulty,
  min_experience_months: item.min_experience_months,
  progression_level: item.progression_level,
  movement_pattern: item.movement_pattern,
  goal_type: item.goal_type,
  contraindications: item.contraindications,
  estimated_duration_seconds: item.estimated_duration_seconds,
  calories_per_minute: item.calories_per_minute,
  video_url: item.video_url,
  instructions: item.instructions,
  updated_at: new Date().toISOString(),
});

const main = async () => {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.showHelp) {
    console.log(usage);
    return;
  }

  const { fileArgument, allowEmpty } = options;
  const filePath = path.resolve(process.cwd(), fileArgument);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Unable to read valid JSON from ${filePath}: ${message}`);
  }
  const validation = validateExerciseCatalog(parsed);
  if (!validation.valid) {
    validation.issues.forEach((issue) => console.error(`- ${issue.path}: ${issue.message}`));
    throw new Error('Catalog was not imported because validation failed.');
  }
  if (validation.normalizedItems.length === 0) {
    if (!allowEmpty) {
      throw new Error(
        'Catalog is valid but empty. Refusing to run a no-op import without --allow-empty.',
      );
    }
    console.log('Catalog is valid and empty; --allow-empty accepted an explicit no-op import.');
    return;
  }

  // Load credentials only after local validation so an invalid file never
  // attempts a database connection or writes any row.
  const { supabase } = await import('../config/Supabase.js');
  const rows = validation.normalizedItems.map(toDatabaseRow);
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('exercises')
      .upsert(batch, { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`Upserted ${rows.length} exercise catalog item(s) by stable id.`);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected importer failure';
  console.error(message);
  process.exitCode = 1;
});
