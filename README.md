# Pharmacy Ordering Platform

Arabic-first B2B pharmacy ordering platform built with React, TypeScript, Vite, Capacitor, and Supabase.

## Local Development

```bash
npm install
npm run dev
```

Create `.env` from `.env.example` and set:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Build Commands

Build the web app:

```bash
npm run build
```

Sync the web build into Capacitor native projects:

```bash
npx cap sync
```

Build and run Android from this Windows workspace:

```bash
npm run build
npx cap sync android
npx cap open android
```

In Android Studio, select an emulator or connected device and run the `app` configuration. For a command-line debug build:

```bash
cd android
gradlew.bat assembleDebug
```

Build iOS on a Mac:

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode, select the `App` target, choose a simulator or signing team/device, then build/run.

## Native App Notes

- Android currently requests only `android.permission.INTERNET`, which is required for Supabase network access.
- In-app notifications are implemented in the database/app. Push notification storage is prepared through `device_push_tokens`; adding native push later should use Capacitor Push Notifications and store platform tokens there.
- Android app icon foreground/background colors are branded under `android/app/src/main/res/`.
- Capacitor splash assets are present in the generated Android and iOS projects and are synced with the web build through `npx cap sync`.

## Supabase Migrations

All database changes must go through versioned SQL files in `supabase/migrations/`.
Do not run destructive SQL directly against production.

Apply migrations with the Supabase CLI:

```bash
supabase db push
```

The Phase 1 schema enables Row Level Security on every application table and includes soft-delete fields on `warehouses`, `products`, and `offers`.

## Daily Offer Price Snapshots

The migration registers a `pg_cron` job named `daily-offer-price-snapshot`:

```sql
select public.snapshot_offer_prices();
```

It runs daily at `00:15` database time and inserts one snapshot per active offer per day into `offer_price_history`.

If `pg_cron` is not available in the target Supabase environment, keep the `public.snapshot_offer_prices()` function and trigger it from a scheduled Supabase Edge Function once daily using the service role key stored as an environment secret.

## Backups And Recovery

Supabase automated daily backups are available on paid plans. Before production launch, verify backups are enabled in the Supabase dashboard for the project:

1. Open the Supabase project dashboard.
2. Go to `Project Settings` -> `Database` -> `Backups`.
3. Confirm Point-in-Time Recovery or daily backups meet the recovery needs for pricing and order data.

To restore from a Supabase backup, use the dashboard restore workflow for the selected backup point, validate the restored database in a non-production project first, then promote or migrate as required by the incident plan.

Rollback policy:

- Schema rollback means reverting or superseding the versioned migration that introduced the change.
- Business-critical pricing data must not be modified by ad hoc destructive SQL.
- Historical orders depend on snapshot fields and soft-deleted catalog rows; do not hard-delete referenced `warehouses`, `products`, or `offers`.
