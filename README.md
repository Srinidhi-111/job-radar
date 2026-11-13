# Job Radar

A personal dashboard that tracks which roles (IT and non-IT) are growing or shrinking in **Chennai, Bangalore, Coimbatore and Remote (India)**, which companies are hiring (jobs and internships), and which skills show up across many roles.

It costs ₹0 to run: no paid APIs, no API keys. GitHub collects the data and hosts the website for free.

## How it works

```
GitHub Actions (every Monday 06:47 IST, or when you press "Run workflow")
        │  runs scripts/collect.mjs
        ▼
Public careers feeds of the companies in config.json
(Greenhouse · Lever · Ashby · SmartRecruiters — free, no key)
        │  keeps tech jobs in our cities, sorts them into roles
        ▼
data/jobs.json      open jobs right now          → Companies + Skills tabs
data/history.json   counts per company/role/city → Trends tab
data/sources.json   which company feeds worked   → list at the bottom of Companies
        │  commits the files back to this repo
        ▼
GitHub Pages serves index.html + app.js, which read those files
```

| File | What it is |
|---|---|
| `config.json` | Cities, roles (matched by job title) and the list of companies to track. |
| `scripts/collect.mjs` | The collector. One request per company (a few more for large SmartRecruiters companies). |
| `.github/workflows/collect.yml` | Tells GitHub when to run the collector. |
| `index.html`, `style.css`, `app.js` | The dashboard (plain HTML/JS, no build step). |
| `skills-guide.js` | What to learn, practice projects and free references for every skill (shown when you tap a skill). |
| `resume.js` | The Résumé tab: role matching, keyword check and AI tailoring. |
| `data/` | Created automatically by the first run. |

## One-time setup

1. **Run the collector once.** Repo → *Actions* tab → *Collect jobs* → *Run workflow*. Takes about a minute.
2. **Turn on the website.** *Settings* → *Pages* → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → *Save*. After a minute the dashboard is at `https://<your-username>.github.io/job-radar/`.

## Refreshing the data

- **Automatic:** every Monday morning.
- **Whenever you want:** *Actions* → *Collect jobs* → *Run workflow*. Works from the GitHub mobile app or a phone browser.

## Adding or fixing a company

Open the company's careers page and click any job. The link tells you which system it uses and its id:

| Job link looks like | `ats` | `id` |
|---|---|---|
| `job-boards.greenhouse.io/hackerrank/…` | `greenhouse` | `hackerrank` |
| `jobs.lever.co/meesho/…` | `lever` | `meesho` |
| `jobs.ashbyhq.com/sarvam/…` | `ashby` | `sarvam` |
| `jobs.smartrecruiters.com/Freshworks/…` | `smartrecruiters` | `Freshworks` |
| `apply.workable.com/browserstack-2/…` | `workable` | `browserstack-2` |

Add `{ "name": "…", "ats": "…", "id": "…" }` to `companies` in `config.json`.

**Workday** companies (link looks like `nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/…`) need two extra fields:

```json
{ "name": "NVIDIA", "ats": "workday", "id": "nvidia",
  "host": "nvidia.wd5.myworkdayjobs.com", "site": "NVIDIAExternalCareerSite" }
```

`id` is the first word of the host, `site` is the part after `/en-US/`. Workday isn't an official public API (it's the data feed behind their careers page), so these can break if Workday changes it.

Amazon has its own reader: `{ "name": "Amazon", "ats": "amazon", "id": "amazon" }`.

Companies with fully custom sites (Google, Microsoft, Apple, TCS, Infosys, Zoho) or Naukri-only hiring can't be read this way.

After each run, the **Company feeds** list at the bottom of the Companies tab shows which companies failed (usually a wrong id, or the company moved to a different system).

## Résumé tab

1. Upload a PDF (or paste text). It stays in your browser; nothing is uploaded to GitHub.
2. **Roles that fit you** compares the skills in your résumé with what each role is asking for right now in your selected cities.
3. **Check keywords** (free, no AI) shows which of a role's or a specific job's skills your résumé has and lacks.
4. **Tailor with AI** rewrites your résumé for the role/job using Google's Gemini API with **your own free key** from [Google AI Studio](https://aistudio.google.com/app/apikey). The key is stored only in your browser. Email, phone numbers and links are removed before sending, and the AI is told never to invent anything. Always review the result.

## Good to know

- **City buttons:** "All" shows everything. Tapping a city shows only that city; tap more cities to add them, tap again to remove. Jobs listed in several cities (e.g. "Bengaluru · Coimbatore") appear under each. The Trends tab counts each job once, under the first city it lists.

- **Trends compare only companies whose feed worked on both dates**, so one broken feed doesn't look like a hiring crash.
- Counts cover **the companies in your list**, not all of India. Mass recruiters (TCS, Infosys, Wipro) use systems this can't read; their hiring mostly runs through campus placement drives.
- **Roles** are decided from job titles by the patterns in `config.json`; the first matching role wins. Each role belongs to a department, and each department is marked IT or Non-IT (`departments` in `config.json`). Titles that match nothing land in "Other roles".
- **Salary** comes from the feed (Lever, Ashby) or from text like "12–18 LPA" / "₹40,000 per month". Most Indian postings don't state pay, so the salary filter only sees a small share of jobs.
- **Freshers / degrees** are read from the posting text ("0–1 years", "freshers", "B.Tech", "Master's", "PhD"). Postings that don't mention them won't appear under those filters.
- **Work mode** and **internship** come from the feed when it provides them, otherwise from words in the posting, so some show "Not stated".
- GitHub may pause scheduled workflows if a repo has no activity for 60 days; the weekly data commits normally keep it active.

## Run it on your own computer (optional)

```bash
node scripts/collect.mjs   # needs Node.js 20+
npx serve .                # then open the printed link
```

## Coming next

- Learning roadmaps per role
- Interview prep per company and role
- Résumé tailoring
