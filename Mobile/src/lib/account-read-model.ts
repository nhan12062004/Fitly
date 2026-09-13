import { supabase } from '@/lib/supabase';

export async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error };
}

/** Local session identity avoids an extra auth HTTP request; RLS still authorizes each query. */
export async function requireSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  return data.session.user;
}

export async function loadAccountProfile() {
  const user = await requireSessionUser();
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, avatar_url, membership_tier, membership_expires_at, ref_code, referral_count, updated_at')
    .eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}
