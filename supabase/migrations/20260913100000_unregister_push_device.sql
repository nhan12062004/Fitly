create function public.unregister_mobile_push_device(p_expo_push_token text) returns void
language sql security definer set search_path = '' as $$
  update public.mobile_push_devices
  set enabled = false, disabled_at = now(), updated_at = now()
  where user_id = (select auth.uid()) and expo_push_token = p_expo_push_token;
$$;
revoke all on function public.unregister_mobile_push_device(text) from public, anon;
grant execute on function public.unregister_mobile_push_device(text) to authenticated;
