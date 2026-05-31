do $$
declare
  v_admin_id uuid := '00000000-0000-0000-0000-000000000001';
  v_email text := 'admin@example.com';
begin
  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin
  )
  values (
    v_admin_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt('Admin123!ChangeMe', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('full_name', 'Test Admin'),
    false
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_admin_id::text,
    v_admin_id,
    v_email,
    jsonb_build_object(
      'sub', v_admin_id::text,
      'email', v_email,
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_id) do nothing;

  insert into public.profiles (id, role, full_name, phone)
  values (v_admin_id, 'admin', 'Test Admin', null)
  on conflict (id) do update
  set role = excluded.role,
      full_name = excluded.full_name;
end $$;
