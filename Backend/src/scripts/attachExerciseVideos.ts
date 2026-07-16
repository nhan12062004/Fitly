import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

type CliOptions = {
  file: string;
  bucket: string;
  prefix: string;
  apply: boolean;
};

type VideoObject = { path: string; url: string };
type ExerciseRow = {
  id?: unknown;
  ID?: unknown;
  name?: unknown;
  'Exercise Name (English)'?: unknown;
  'Tên bài tập (Tiếng Việt)'?: unknown;
  name_vi?: unknown;
};
type Mapping = {
  id: string;
  sourceId: string;
  englishName: string;
  vietnameseName: string;
  videoUrl: string | null;
  matchedObjectPath: string | null;
  match: 'id' | 'name' | 'none' | 'ambiguous';
};

const usage = `Usage: npm run exercises:attach-videos -- --bucket <bucket-name> [options]

Options:
  --file <path>     Excel file containing the ID/name columns (required)
  --bucket <name>   Public Supabase Storage bucket containing the videos (required)
  --prefix <path>   Folder inside the bucket (default: root)
  --apply           Update exercises.video_url. Without this flag, only write a preview.
  --help, -h        Show this help text

Matching order: exact normalized exercise ID, then exact normalized English name.
Examples: push-up.mp4, push_up.mp4, or Push Up.webm all match exercise ID push-up.`;

const readOption = (args: string[], flag: string, fallback = ''): string => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value.\n\n${usage}`);
  return value;
};

const parseCliOptions = (args: string[]): CliOptions => {
  const supported = new Set(['--file', '--bucket', '--prefix', '--apply', '--help', '-h']);
  const unknown = args.find((arg) => arg.startsWith('-') && !supported.has(arg));
  if (unknown) throw new Error(`Unknown option: ${unknown}\n\n${usage}`);
  const file = readOption(args, '--file');
  const bucket = readOption(args, '--bucket');
  if (!file) throw new Error(`--file is required.\n\n${usage}`);
  if (!bucket) throw new Error(`--bucket is required.\n\n${usage}`);
  return {
    file,
    bucket,
    prefix: readOption(args, '--prefix').replace(/^\/+|\/+$/g, ''),
    apply: args.includes('--apply'),
  };
};

const normalizeKey = (value: unknown): string => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const basenameWithoutExtension = (objectPath: string): string =>
  path.posix.basename(objectPath).replace(/\.[^.]+$/, '');

const supportedVideo = (objectPath: string): boolean => /\.(mp4|webm|mov|m4v)$/i.test(objectPath);

const listVideos = async (bucket: string, prefix: string): Promise<VideoObject[]> => {
  const { supabase } = await import('../config/Supabase.js');
  const videos: VideoObject[] = [];
  const visit = async (folder: string): Promise<void> => {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Cannot list bucket "${bucket}" at "${folder || '/'}": ${error.message}`);
    for (const item of data || []) {
      const objectPath = folder ? `${folder}/${item.name}` : item.name;
      if (item.id) {
        if (!supportedVideo(objectPath)) continue;
        const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(objectPath);
        videos.push({ path: objectPath, url: publicUrl.publicUrl });
      } else {
        await visit(objectPath);
      }
    }
  };
  await visit(prefix);
  return videos;
};

const uniqueIndex = (videos: VideoObject[]): Map<string, VideoObject | null> => {
  const index = new Map<string, VideoObject | null>();
  videos.forEach((video) => {
    const key = normalizeKey(basenameWithoutExtension(video.path));
    if (!key) return;
    index.set(key, index.has(key) ? null : video);
  });
  return index;
};

type DatabaseExercise = { id: string; name: string | null };

const loadDatabaseExercises = async (): Promise<DatabaseExercise[]> => {
  const { supabase } = await import('../config/Supabase.js');
  const { data, error } = await supabase.from('exercises').select('id, name');
  if (error) throw new Error(`Cannot read exercises: ${error.message}`);
  return (data || []).map((row) => ({ id: String(row.id), name: row.name }));
};

const uniqueExerciseIndex = (exercises: DatabaseExercise[], field: 'id' | 'name'): Map<string, DatabaseExercise | null> => {
  const index = new Map<string, DatabaseExercise | null>();
  exercises.forEach((exercise) => {
    const key = normalizeKey(exercise[field]);
    if (!key) return;
    index.set(key, index.has(key) ? null : exercise);
  });
  return index;
};

const readExercises = (filePath: string): ExerciseRow[] => {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Technical Data'] || workbook.Sheets['100 Exercises'];
  if (!sheet) throw new Error('Excel must contain a "Technical Data" or "100 Exercises" sheet.');
  const rows = XLSX.utils.sheet_to_json<ExerciseRow>(sheet, { defval: '' });
  if (!rows.length) throw new Error('Excel does not contain any exercise rows.');
  return rows;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return;
  }
  const options = parseCliOptions(args);
  const filePath = path.resolve(process.cwd(), options.file);
  const exercises = readExercises(filePath);
  const videos = await listVideos(options.bucket, options.prefix);
  const databaseExercises = await loadDatabaseExercises();
  const byFilename = uniqueIndex(videos);
  const databaseById = uniqueExerciseIndex(databaseExercises, 'id');
  const databaseByName = uniqueExerciseIndex(databaseExercises, 'name');

  const mappings: Mapping[] = exercises.map((row) => {
    const sourceId = String(row.id ?? row.ID ?? '').trim();
    const englishName = String(row.name ?? row['Exercise Name (English)'] ?? '').trim();
    const vietnameseName = String(row.name_vi ?? row['Tên bài tập (Tiếng Việt)'] ?? '').trim();
    const target = databaseById.get(normalizeKey(sourceId))
      ?? databaseByName.get(normalizeKey(vietnameseName))
      ?? databaseByName.get(normalizeKey(englishName));
    const idMatch = byFilename.get(normalizeKey(sourceId));
    const nameMatch = idMatch === undefined ? byFilename.get(normalizeKey(englishName)) : undefined;
    const match = target === null || idMatch === null || nameMatch === null ? 'ambiguous'
      : idMatch ? 'id' : nameMatch ? 'name' : 'none';
    const video = idMatch || nameMatch || null;
    return {
      id: target?.id || '', sourceId, englishName, vietnameseName,
      videoUrl: video?.url || null, matchedObjectPath: video?.path || null, match,
    };
  });

  const previewPath = path.resolve(process.cwd(), 'reports/exercise-video-mapping-preview.json');
  await mkdir(path.dirname(previewPath), { recursive: true });
  await writeFile(previewPath, `${JSON.stringify({ bucket: options.bucket, prefix: options.prefix, mappings }, null, 2)}\n`, 'utf8');
  const matched = mappings.filter((mapping) => mapping.id && mapping.videoUrl);
  const unmatched = mappings.filter((mapping) => mapping.match === 'none');
  const ambiguous = mappings.filter((mapping) => mapping.match === 'ambiguous');
  const missingDatabaseExercise = mappings.filter((mapping) => !mapping.id);
  console.log(`Found ${videos.length} video file(s); matched ${matched.length}/${mappings.length} exercise(s).`);
  console.log(`Preview: ${previewPath}`);
  if (unmatched.length) console.log(`Unmatched IDs: ${unmatched.map((mapping) => mapping.id).join(', ')}`);
  if (ambiguous.length) console.log(`Ambiguous IDs: ${ambiguous.map((mapping) => mapping.id).join(', ')}`);
  if (missingDatabaseExercise.length) console.log(`Database exercises not found: ${missingDatabaseExercise.map((mapping) => mapping.sourceId).join(', ')}`);
  if (!options.apply) {
    console.log('Dry run only. Review the preview, then add --apply to write matched video URLs.');
    return;
  }
  if (ambiguous.length) throw new Error('Refusing to apply while duplicate/ambiguous video filenames exist.');

  const { supabase } = await import('../config/Supabase.js');
  for (const mapping of matched) {
    const { error } = await supabase.from('exercises').update({ video_url: mapping.videoUrl }).eq('id', mapping.id);
    if (error) throw new Error(`Unable to update ${mapping.id}: ${error.message}`);
  }
  console.log(`Updated video_url for ${matched.length} exercise(s).`);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error');
  process.exitCode = 1;
});
