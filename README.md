# CUTBOARD — 60-Day Cut Tracker

Your personal transformation dashboard. Tracks weight, calories, macros, sleep, steps, deep work, and InBody scans. Adaptive TDEE adjusts your calorie target weekly based on actual weight loss rate.

---

## Deploy in ~10 minutes (free)

### Step 1 — Supabase (your database)

1. Go to [supabase.com](https://supabase.com) → **Start for free** → create an account
2. Click **New project** → give it a name (e.g. `cutboard`) → set a database password → **Create project**
3. Wait ~1 minute for the project to spin up
4. Go to **SQL Editor** (left sidebar) → **New query**
5. Paste the entire contents of `supabase_schema.sql` → click **Run**
6. Go to **Project Settings** → **API**
7. Copy two values — you'll need them in Step 3:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (long string under "Project API keys")

### Step 2 — Push to GitHub

1. Go to [github.com](https://github.com) → **New repository** → name it `cutboard` → **Create repository**
2. On your machine, open a terminal in this folder and run:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/cutboard.git
   git push -u origin main
   ```

### Step 3 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Sign up with GitHub**
2. Click **Add New Project** → import your `cutboard` repo
3. Before clicking Deploy, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` → paste your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` → paste your Supabase anon key
4. Click **Deploy**
5. In ~1 minute you'll get a live URL like `cutboard.vercel.app`

That's it. Share the URL with Adarsh — he signs up with his own email and gets his own isolated data.

---

## Adding features later

1. Make changes to the code
2. `git add . && git commit -m "your change" && git push`
3. Vercel auto-deploys in ~30 seconds

## Running locally (for development)

```bash
# Install dependencies
npm install

# Create your local env file
cp .env.example .env
# Then fill in your Supabase URL and anon key in .env

# Start dev server
npm run dev
# Opens at http://localhost:5173
```

---

## Features

- **Today tab** — weight, sleep, steps, deep work, full meal log with macros, fasting day toggle
- **Nutrition tab** — macro breakdown, 7-day averages, 14-day calorie history chart
- **Progress tab** — weight trend, sleep, steps, deep work charts with target lines
- **InBody tab** — log body composition scans, track BF% and muscle mass over time
- **Adaptive TDEE** — recalculates your calorie target weekly based on actual weight loss rate
- **Separate accounts** — you and Adarsh each sign in with your own email, completely isolated data
