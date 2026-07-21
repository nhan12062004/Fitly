import { parseRecipeCliOptions, printRecipeValidationSummary, validateCatalogFromOptions } from './recipeCatalogCli';

const main = async () => {
  const options = parseRecipeCliOptions(process.argv.slice(2), 'validate');
  const { validation } = await validateCatalogFromOptions(options);
  printRecipeValidationSummary(validation.summary);
  if (!validation.valid) process.exitCode = 1;
};
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
