# CUTIQ

A focused cutting app: one daily calorie target, dynamic step adjustments, weight
trends and an automatic transition to maintenance after the goal is achieved.

```
food target = baseline maintenance + step adjustment − planned deficit
```

## Run

Node 20.19+ or 22.12+ is required by Vite 7.

```powershell
npm.cmd install
npm.cmd run dev
```

With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`, the app uses
the existing Supabase account and `user_data` table. The checked-in
`supabase_schema.sql` provides the table and per-user RLS. Existing deployments do
not require a schema change. Old rows and Storage objects are preserved.

Without backend configuration, data is saved in this browser's local storage.
Export backups regularly; local mode does not synchronize between devices.

For an isolated local preview even when Supabase is configured:

```powershell
$env:VITE_DEMO='1'
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

This mode uses separate `cutiq:v2:demo` local storage and never signs in to an account.
The browser smoke test below requires this server. In a different terminal:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:browser
```

The browser test uses headless Microsoft Edge by default. Set `BROWSER_CHANNEL`
to `chrome` when appropriate. It creates an isolated browser context and writes
screenshots to ignored `artifacts/`. It does not modify a real browser profile.

`npm.cmd run test:cloud` exercises mocked authentication, account migration and save
failures against an account-mode preview at port 5174 (or `TEST_URL`). Build that
preview with `VITE_DEMO=0`, `VITE_SUPABASE_URL=https://cutiq-test.invalid`, and
`VITE_SUPABASE_ANON_KEY=test-public-anon-key`. All external HTTP is intercepted;
the test never sends requests to a real account. Use a separate output directory
such as `artifacts/cloud-preview` for this fixture build.

To build for deployment, disable demo mode and provide real Supabase variables.
An explicit environment value overrides a local file's demo flag. On PowerShell:

```powershell
$env:VITE_DEMO='0'
npm.cmd run build
```

## Structure

- `src/lib/cutEngine.js`: pure energy, trend, calibration, phase and pace model.
- `src/lib/data.js`: versioned state validation and non-destructive migration.
- `src/lib/repository.js`: local/account persistence, write conflicts and export.
- `src/App.jsx` and `src/Workspace.jsx`: account lifecycle, one day draft and one
  computed plan shared by the active view.
- `src/components/`: Today editor, Progress, Plan, profile and authentication UI.
- `legacy/`: preserved previous application, workout tracker and supporting code;
  unused by the active build.
- [Audit](docs/REBUILD-AUDIT.md): original architecture, findings and changes.
- [Model and research](docs/MODEL.md): equations, evidence, product assumptions and limitations.

The first v2 account load imports old measurements and meals and asks you to review
the goal. Imported days remain incomplete until confirmed. New data is stored under
the separate `cutiq:v2` key; previous setup, logs, workouts, recipes and photos are
not erased. Stale-tab/device writes fail visibly instead of silently overwriting
newer data.

Export includes an unsaved day draft, which can be useful after a failed save or a
write conflict. Importing a backup through the interface is not currently supported;
the JSON export remains directly inspectable and can be restored through the stored
v2 state format.

The app estimates energy balance. It cannot promise exact calorie expenditure,
fat loss or a guaranteed completion date.
