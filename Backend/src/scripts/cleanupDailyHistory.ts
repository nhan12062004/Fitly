import { supabase } from '../config/Supabase';

type CleanupTable = {
  name: string;
  primaryColumn: string;
  reason: string;
  optional?: boolean;
};

const PRESERVED_TABLES = [
  'profiles',
  'lifestyle_settings',
  'health_conditions',
  'foods',
  'exercises',
];

const CLEANUP_TABLES: CleanupTable[] = [
  {
    name: 'daily_exercise_set_logs',
    primaryColumn: 'id',
    reason: 'set-by-set workout history',
  },
  {
    name: 'daily_workout_session_exercises',
    primaryColumn: 'id',
    reason: 'daily workout session exercise history',
  },
  {
    name: 'daily_exercise_sessions',
    primaryColumn: 'id',
    reason: 'daily exercise completion history',
  },
  {
    name: 'daily_workout_sessions',
    primaryColumn: 'id',
    reason: 'daily workout session history',
  },
  {
    name: 'daily_meal_logs',
    primaryColumn: 'id',
    reason: 'daily meal logging history',
  },
  {
    name: 'daily_progress_logs',
    primaryColumn: 'id',
    reason: 'daily water, sleep, calories and progress history',
  },
  {
    name: 'weekly_food_items',
    primaryColumn: 'id',
    reason: 'weekly meal plan items',
  },
  {
    name: 'weekly_food_plans',
    primaryColumn: 'id',
    reason: 'weekly meal plans',
  },
  {
    name: 'weekly_plan_exercises',
    primaryColumn: 'id',
    reason: 'weekly workout plan exercise items',
  },
  {
    name: 'weekly_plans',
    primaryColumn: 'id',
    reason: 'weekly workout plans',
  },
  {
    name: 'body_metrics',
    primaryColumn: 'id',
    reason: 'body metric history/profile measurements',
  },
  {
    name: 'meal_feedback',
    primaryColumn: 'id',
    reason: 'historical meal feedback',
  },
  {
    name: 'workout_session_feedback',
    primaryColumn: 'id',
    reason: 'historical workout feedback',
  },
  {
    name: 'ai_chat_messages',
    primaryColumn: 'id',
    reason: 'AI chat history',
  },
  {
    name: 'ai_plan_adjustments',
    primaryColumn: 'id',
    reason: 'AI proposal/apply audit history',
  },
  {
    name: 'user_notifications',
    primaryColumn: 'id',
    reason: 'notification history',
  },
  {
    name: 'telegram_reminder_dispatches',
    primaryColumn: 'reminder_key',
    reason: 'Telegram reminder dispatch history',
  },
  {
    name: 'user_custom_foods',
    primaryColumn: 'id',
    reason: 'history-derived custom foods from user meal photo/voice logs',
  },
  {
    name: 'ai_recommendations',
    primaryColumn: 'id',
    reason: 'generated AI recommendation history if the table exists',
    optional: true,
  },
];

const parseFlags = () => {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has('--apply'),
  };
};

const isMissingTableError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === 'PGRST205'
    || /does not exist|could not find the table|relation .* does not exist/i.test(message);
};

const countRows = async (table: CleanupTable) => {
  const { count, error } = await supabase
    .from(table.name)
    .select(table.primaryColumn, { count: 'exact', head: true });

  if (error) {
    if (table.optional && isMissingTableError(error)) return null;
    throw error;
  }

  return count || 0;
};

const deleteRows = async (table: CleanupTable) => {
  const { data, error: selectError } = await supabase
    .from(table.name)
    .select(table.primaryColumn);

  if (selectError) {
    if (table.optional && isMissingTableError(selectError)) return;
    throw selectError;
  }

  const ids = (data || [])
    .map((row: any) => row?.[table.primaryColumn])
    .filter((value: unknown) => value !== null && value !== undefined);

  for (let index = 0; index < ids.length; index += 500) {
    const batch = ids.slice(index, index + 500);
    const { error } = await supabase
      .from(table.name)
      .delete()
      .in(table.primaryColumn, batch);

    if (error) {
      if (table.optional && isMissingTableError(error)) return;
      throw error;
    }
  }
};

const run = async () => {
  const flags = parseFlags();
  const counts: Array<CleanupTable & { count: number | null }> = [];

  for (const table of CLEANUP_TABLES) {
    const count = await countRows(table);
    counts.push({ ...table, count });
  }

  console.log('Preserved tables:');
  PRESERVED_TABLES.forEach((table) => console.log(`- ${table}`));
  console.log('');
  console.log(flags.apply ? 'Deleting rows from cleanup tables:' : 'Dry run. Rows that would be deleted:');
  counts.forEach((table) => {
    const countText = table.count === null ? 'missing/skipped' : String(table.count);
    console.log(`- ${table.name}: ${countText} (${table.reason})`);
  });

  if (!flags.apply) {
    console.log('');
    console.log('No data was deleted. Re-run with: npm run cleanup:daily-history -- --apply');
    return;
  }

  for (const table of CLEANUP_TABLES) {
    await deleteRows(table);
  }

  console.log('');
  console.log('Cleanup complete. Preserved user profiles, user settings, health settings, food catalog, and exercise catalog.');
};

run().catch((error) => {
  console.error('Failed to cleanup daily history:', error?.message || error);
  process.exit(1);
});
