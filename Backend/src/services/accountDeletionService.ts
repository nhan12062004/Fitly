import type { SupabaseClient } from '@supabase/supabase-js';
import { adminSupabase } from '../config/Supabase';
import { deleteStoreCustomer } from './storeSubscriptionService';

/** Each completed phase is durable; provider failures are safe to retry. */
export async function performAccountDeletion(userId: string, client: SupabaseClient = adminSupabase) {
  const requested = await client.from('account_deletion_requests').upsert({ user_id: userId }, { onConflict:'user_id', ignoreDuplicates:true });
  if (requested.error) throw requested.error;
  const state = await client.from('account_deletion_requests').select('store_deleted').eq('user_id',userId).single();
  if (state.error) throw state.error;
  if (!state.data.store_deleted) {
    await deleteStoreCustomer(userId);
    const marked = await client.from('account_deletion_requests').update({ store_deleted:true }).eq('user_id',userId);
    if (marked.error) throw marked.error;
  }
  // New uploads are blocked once deletion is requested. Repeated listing also
  // handles older accounts with more than one page of legacy avatar files.
  for (let page = 0; page < 100; page += 1) {
    const list = await client.storage.from('avatars').list(userId, { limit:100 });
    if (list.error) throw list.error;
    if (!list.data?.length) break;
    const files = list.data.filter((item) => item.id && !item.name.includes('/')).map((item) => `${userId}/${item.name}`);
    if (!files.length) throw new Error('Nested avatar folders require operator cleanup');
    const removed = await client.storage.from('avatars').remove(files);
    if (removed.error) throw removed.error;
    if (page === 99) throw new Error('Avatar cleanup needs another attempt');
  }
  const deleted = await client.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
}
