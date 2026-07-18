# Daily Log

A small calorie and weight tracker. No login, no separate database for your
history, everything is stored in your browser's localStorage, which is why
it's meant for a single person's own use on their own device/browser.

Meal entry uses the Anthropic API to estimate calories from a plain-language
description ("two eggs, toast, and bacon"), so you need your own Anthropic API
key to run this.

## Get an API key

1. Go to https://console.anthropic.com and sign up or log in
2. Create an API key under Settings > API Keys
3. Add billing, the estimate calls are tiny (a Haiku call per meal logged),
   so cost should be a fraction of a cent per entry, but the key won't work
   without billing set up

## Run locally

```
npm install
cp .env.local.example .env.local
# then edit .env.local and paste your real key in
npm run dev
```

Then open http://localhost:3000

## Deploy to Vercel

**Option A: via GitHub (recommended)**
1. Push this folder to a new GitHub repo:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```
2. Go to https://vercel.com/new and import that repo.
3. Before deploying (or right after, then redeploy), go to the project's
   Settings > Environment Variables and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from the Anthropic console
4. Deploy. Vercel auto-detects Next.js, no other config needed.

**Option B: via Vercel CLI**
```
npm install -g vercel
vercel
vercel env add ANTHROPIC_API_KEY
```
Follow the prompts, then `vercel --prod` to push it live.

## Notes

- Data lives in your browser's localStorage only. Clearing site data/cookies
  for the deployed URL, or opening it in a different browser/device, will not
  carry your history over.
- The "Expectation" chart needs at least 2 weigh-ins to compute a real
  projection, since it's based on a regression of your actual logged weights,
  not an assumed calorie deficit.
- To log a meal: describe it in plain words (e.g. `two eggs, toast, and
  bacon`) and press Enter. The AI estimate is a helpful guess, not a lab
  measurement, and it can be off, especially for restaurant food where
  portion sizes vary.
- Your `ANTHROPIC_API_KEY` stays server-side (used only inside the
  `/api/estimate` route), it's never sent to the browser.

