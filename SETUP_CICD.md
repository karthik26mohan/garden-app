# CI/CD Setup Walkthrough

Goal: every push to `main` deploys to production; every PR gets a preview URL.

Estimated time: **45 minutes**, mostly waiting for things to verify.

---

## 1. Create a Vercel project (5 min)

1. Sign up at https://vercel.com (free Hobby plan is fine).
2. Click **Add New… → Project**.
3. Import your GitHub `garden-app` repo. Vercel will detect Next.js and propose defaults.
4. **Important — Build & Output settings:** leave the defaults, but in the **Root Directory** field, make sure it's empty or set to `/` (the repo root is the app root since the repo *is* `garden-app/`).
5. Before clicking Deploy, expand the **Environment Variables** section and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase → Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase → Settings → API |
   | `PLANTNET_API_KEY` | from my.plantnet.org |

6. Click **Deploy**. Wait for the build to succeed. Copy the production URL (something like `https://garden-app-xxxx.vercel.app`).

## 2. Disable Vercel's Git auto-integration (2 min)

This is the deliberate "GitHub Actions is the source of truth" choice from the plan.

1. In your Vercel project, go to **Settings → Git**.
2. Under **Ignored Build Step**, paste: `exit 0`
   - This tells Vercel to skip its own auto-builds. GitHub Actions will drive deploys via the Vercel CLI instead.
3. Save.

## 3. Update Supabase Auth redirect URLs (2 min)

1. Supabase dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel production URL (no trailing slash).
3. Add to **Redirect URLs** (one per line):
   ```
   https://your-app.vercel.app/**
   https://*-your-team.vercel.app/**
   http://localhost:3000/**
   ```
   The second line covers Vercel preview deploys (each PR gets a unique subdomain). Replace `your-team` with your Vercel team/username slug.

## 4. Visit your production URL (1 min)

Click your Vercel URL in a browser. You should see the Garden landing page. Try sign-in end-to-end — magic link should arrive and land you on `/app/gardens` at the real domain.

If this works, **you're already deployed**. The rest of this guide just automates future deploys.

---

## 5. Gather the secrets you'll add to GitHub (10 min)

You need five secrets total.

### `VERCEL_TOKEN`
1. https://vercel.com/account/tokens → **Create Token**.
2. Name: "GitHub Actions". Scope: full account (or just this project if Vercel offers).
3. Expiration: no expiration (or 1 year — your call).
4. Copy the token. **You won't see it again.**

### `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`
Easiest path: link the project locally to generate these.

```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
pnpm add -g vercel  # one-time
vercel login        # follow prompts
vercel link         # answer "no" to "Set up and deploy" and pick your existing project
cat .vercel/project.json
```

That file contains `{"orgId": "...", "projectId": "..."}`. Copy both. (The `.vercel/` folder is gitignored — don't worry about committing it.)

### `SUPABASE_ACCESS_TOKEN`
1. https://supabase.com/dashboard/account/tokens → **Generate new token**.
2. Name: "GitHub Actions". Copy it.

### `SUPABASE_PROJECT_REF`
From your Supabase project URL: `https://supabase.com/dashboard/project/<THIS_PART>/...`. Copy that ID.

### `SUPABASE_DB_PASSWORD`
The DB password you set when creating the Supabase project. If you don't remember, you can reset it in Supabase → Settings → Database → Reset database password.

## 6. Add the secrets to GitHub (5 min)

In your `garden-app` repo on GitHub:

**Settings → Secrets and variables → Actions → New repository secret**

Add each of these one at a time:

| Secret name | Value |
|---|---|
| `VERCEL_TOKEN` | from step 5 |
| `VERCEL_ORG_ID` | from step 5 |
| `VERCEL_PROJECT_ID` | from step 5 |
| `SUPABASE_ACCESS_TOKEN` | from step 5 |
| `SUPABASE_PROJECT_REF` | from step 5 |
| `SUPABASE_DB_PASSWORD` | from step 5 |

## 7. Enable branch protection on `main` (3 min)

**Settings → Branches → Branch protection rules → Add rule**

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Search and select: `CI / quality`
- (Optional) ✅ Require approvals: 1 (you can self-approve later in solo settings)

Save.

## 8. Test the pipeline (10 min)

Make a tiny change on a new branch and open a PR:

```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
git checkout -b test/cicd
# edit src/app/page.tsx — change "Track plants across your gardens" to something else
git add -A
git commit -m "test: trigger CI/CD pipeline"
git push -u origin test/cicd
```

Open the PR on GitHub. Within 2–3 minutes you should see:

1. ✅ **CI / quality** status check appear and turn green
2. 💬 A bot comment with a **🌱 Preview deployed** URL — click it, see your change live

Merge the PR. Within 2–3 minutes you should see:

3. ⚙️ **Production Deploy** workflow run, apply migrations (no-op if none new), deploy to prod, and pass smoke tests
4. Your production URL now shows the change

If anything fails, click into the failed workflow run in GitHub Actions and read the logs — the error is usually a missing secret or a typo in a secret value.

---

## Day 3 → Day 8 collapsed into now

You've effectively done Day 8 from PLAN.md ahead of schedule. Every feature from Day 4 onward will deploy automatically. When we get to actual Day 8, that slot opens up for something else — adding tests, or one of the Day 9 stretches early.
