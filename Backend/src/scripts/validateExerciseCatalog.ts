import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateExerciseCatalog } from '../../../shared/exerciseCatalog';

type CliOptions = {
  file: string;
  expectedCount?: number;
};

const readCliOptions = (args: string[]): CliOptions => {
  let file = 'catalog/exercise-catalog.template.json';
  let expectedCount: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--file' && args[index + 1]) {
      file = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--expected-count' && args[index + 1]) {
      const parsed = Number(args[index + 1]);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error('--expected-count must be a non-negative integer');
      expectedCount = parsed;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log('Usage: npm run exercises:validate -- --file path/to/exercises.json [--expected-count 100]');
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { file, expectedCount };
};

const main = async () => {
  const options = readCliOptions(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), options.file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`Unable to read valid JSON from ${filePath}: ${message}`);
    process.exitCode = 1;
    return;
  }

  const result = validateExerciseCatalog(parsed, { expectedCount: options.expectedCount });
  if (!result.valid) {
    console.error(`Exercise catalog validation failed for ${filePath}:`);
    result.issues.forEach((issue) => console.error(`- ${issue.path}: ${issue.message}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Exercise catalog is valid (${result.normalizedItems.length} item(s)).`);
  Object.entries(result.counts).forEach(([group, values]) => {
    const summary = Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => `${key}=${count}`)
      .join(', ');
    console.log(`${group}: ${summary || 'none'}`);
  });
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected validator failure';
  console.error(message);
  process.exitCode = 1;
});
