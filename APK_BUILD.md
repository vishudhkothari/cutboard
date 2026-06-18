# Shipping Cutboard as an Android APK (live-URL wrapper)

This packages the app as a **Trusted Web Activity (TWA)** — a thin native Android
shell that renders your deployed Vercel site full-screen. Because the shell loads
the **live URL**, anything you push to Vercel shows up in the app automatically.
**You build the APK once and basically never re-release it.** You only rebuild the
APK if you change the app name, icon, package id, or the website URL.

> iPhone friends: TWA is Android-only. On iOS they open the site in Safari →
> Share → **Add to Home Screen** (it installs as a PWA — same app, no App Store).

---

## 0. Prerequisite — deploy the latest first

PWABuilder reads your **live** site, so make sure the current code is on Vercel:

```bash
git add . && git commit -m "redesign polish + PWA/APK prep" && git push
```

Wait for Vercel to finish, then open your URL (e.g. `https://cutboard.vercel.app`)
and confirm it looks right. Note that exact URL — you'll paste it into PWABuilder.

## 1. Generate the APK on PWABuilder (no local Android tooling needed)

1. Go to **https://www.pwabuilder.com**
2. Paste your Vercel URL → **Start**. It analyzes the manifest (already tuned in
   `public/manifest.webmanifest`) and the service worker. Aim for green scores.
3. Click **Package For Stores** → **Android**.
4. In **Android package options**:
   - **Package ID**: pick a stable reverse-domain id and write it down, e.g.
     `app.cutboard.twa` (it must never change across rebuilds).
   - **App name**: `Cutboard`
   - **Signing key**: **Create new** (or "Use mine" if you have one). PWABuilder
     generates and signs with it. **Download the key and remember the password —
     keep both somewhere safe.** (Only critical if you later go to the Play Store.)
   - Leave the rest at defaults (the manifest supplies icons/colors).
5. **Download** the zip.

The zip contains:
- `*-signed.apk`  → the file you send to friends (sideload)
- `*.aab`         → only needed for the Google Play Store
- `assetlinks.json` → digital-asset-links file (next step)
- signing key + a README with your **SHA-256 fingerprint** and package id

## 2. Wire up Digital Asset Links (removes the browser URL bar)

Without this the app still works but shows a thin address bar at the top. To get a
clean full-screen app:

1. Open the `assetlinks.json` from the PWABuilder zip (it already has your real
   package id + SHA-256 fingerprint filled in).
   - If you'd rather hand-edit, copy `public/.well-known/assetlinks.json.example`
     to `public/.well-known/assetlinks.json` and fill in the two `REPLACE_…` values
     from the PWABuilder README.
2. Put that file at **`public/.well-known/assetlinks.json`** in this repo.
3. Commit + push. Vercel will then serve it at
   `https://<your-domain>/.well-known/assetlinks.json` (verify it loads in a browser).
4. Reinstall the APK on the phone — it now launches full-screen with no URL bar.

## 3. Send it to friends

- Share the `*-signed.apk` (WhatsApp/Drive/email).
- On their Android phone: open the file → Android asks to allow installing from
  this source → **Allow** → **Install**.
- Requires Chrome (or any Chromium browser) installed — virtually all Android
  phones have it; the TWA borrows Chrome's engine to render the site.

## 4. Updating the app later

Just push to Vercel. The shell loads the live site, so changes appear on next app
open — **no new APK, no reinstall.** Rebuild the APK only if you change the app
name, icon, package id, or move to a different URL.

---

### Notes / gotchas
- The app needs internet (it loads from Vercel + talks to Supabase). No offline.
- Keep the **same Package ID** forever — changing it makes a separate app and
  breaks asset-links verification.
- Don't lose the signing key if you ever plan to publish on Google Play (updates
  must be signed with the same key). For pure sideloading it's low-stakes.
- Optional: a real Play Store listing uses the `.aab` and requires a one-time
  $25 Google Play developer account. Not needed to share with friends.
