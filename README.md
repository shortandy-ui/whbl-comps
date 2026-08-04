# WHBL Comps

Knockout competition manager for Welwyn Hatfield Bowls League — 8 tournaments
(John Brown Trophy, Jubilee Cup, Open Singles, Ladies, Jock Hunter, Pairs,
Triples, Fours), random draws with automatic byes, a two-sided bracket view
converging on the Final, and self-service score entry.

Built as a Vite + React app with an Azure Functions API and Azure Blob
Storage backend — the same low-cost pattern as the league-tables site
(Static Web Apps Free plan + a Standard/LRS storage account).

## Project layout

```
src/            React app (this is the same app you saw as a Claude artifact)
api/            Azure Functions API — one generic key/value endpoint (/api/kv)
                backed by Blob Storage, used for both tournament data and
                the admin password
staticwebapp.config.json   Azure Static Web Apps routing config
.github/workflows/         GitHub Actions deploy workflow
```

## 1. Push to GitHub

```bash
cd whbl-comps
git init
git add .
git commit -m "Initial WHBL Comps app"
git branch -M main
git remote add origin https://github.com/<your-org>/whbl-comps.git
git push -u origin main
```

## 2. Create the Azure resources

You'll need two things, same as the league-tables site:

1. **A storage account** (Standard/LRS is fine and cheap) — this is where
   tournament data and the admin password live. Grab its connection string
   from **Access keys** in the Azure portal.
2. **A Static Web App** (Free plan) — when creating it in the Azure portal,
   point it at your GitHub repo and set:
   - **App location**: `/`
   - **Api location**: `api`
   - **Output location**: `dist`

   Creating the Static Web App this way automatically adds the
   `AZURE_STATIC_WEB_APPS_API_TOKEN` secret to your GitHub repo and will
   trigger the included GitHub Actions workflow on push.

3. In the Static Web App's **Configuration** (Environment variables) in the
   Azure portal, add:
   - `AZURE_STORAGE_CONNECTION_STRING` = the connection string from step 1

   This is what lets the API functions read/write to Blob Storage in
   production.

## 3. Deploy

Push to `main` (or merge a PR into it) — the GitHub Actions workflow builds
the site and deploys both the frontend and the `api` folder as Azure
Functions automatically.

## Local development

```bash
npm install
cd api && npm install && cd ..
cp api/local.settings.json.example api/local.settings.json
# edit api/local.settings.json with your storage connection string
```

Run the API and frontend in two terminals:

```bash
cd api && npm start        # Azure Functions Core Tools, http://localhost:7071
npm run dev                 # Vite dev server, proxies /api to the above
```

## Admin access

Default admin password is `bowlsadmin` — change it from inside the app's
admin panel once deployed (Admin → Change admin password). It's stored as a
blob in the same storage account as the tournament data, so it's not
suitable for anything beyond keeping casual visitors out of the setup
screens.

## Notes

- All tournament data is public/shared by design — anyone with the site URL
  can view brackets and enter their own match scores, matching the brief
  that players report their own results.
- The "Remove all data for next year" button only clears one tournament at
  a time and requires typing RESET plus a confirm dialog.
