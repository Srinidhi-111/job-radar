// Job Radar — data collector
// ------------------------------------------------------------------
// What this script does, step by step:
//   1. Reads the company list, roles and cities from config.json
//   2. Downloads each company's open jobs from its public careers feed
//      (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday or Amazon — free, no key)
//   3. Keeps jobs in Chennai / Bangalore / Coimbatore / Remote (India)
//   4. Sorts each job into a role (e.g. "Data Engineer", "Marketing") using its title,
//      and reads salary, experience level and degree from the posting text
//   5. Saves:
//        data/jobs.json     → every matching open job (Companies + Skills tabs)
//        data/history.json  → counts per role/city for this run (Trends tab)
//        data/sources.json  → which company feeds worked (for fixing the list)
//
// Run it with:  node scripts/collect.mjs
// ------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const config = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);

// Lets the tests swap the real websites for a fake local server.
const BASE = {
  greenhouse: process.env.GREENHOUSE_BASE || "https://boards-api.greenhouse.io/v1/boards",
  lever: process.env.LEVER_BASE || "https://api.lever.co/v0/postings",
  ashby: process.env.ASHBY_BASE || "https://api.ashbyhq.com/posting-api/job-board",
  smartrecruiters: process.env.SMARTRECRUITERS_BASE || "https://api.smartrecruiters.com/v1/companies",
  workable: process.env.WORKABLE_BASE || "https://apply.workable.com/api/v1/widget/accounts",
  workableV3: process.env.WORKABLE3_BASE || "https://apply.workable.com/api/v3/accounts",
  workday: process.env.WORKDAY_BASE || null, // null = use each company's own Workday address
  amazon: process.env.AMAZON_BASE || "https://www.amazon.jobs/en/search.json",
};

// ---------- helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn on every item, at most `limit` at the same time (much faster than one by one,
// while still gentle on the company's servers).
async function eachLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

// Turns HTML (or HTML-escaped HTML, which Greenhouse sends) into plain text.
function plain(s = "") {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function getJson(url, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, body === undefined
      ? { headers: { "User-Agent": "job-radar (personal project)", Accept: "application/json" } }
      : { method: "POST", body: JSON.stringify(body), headers: { "User-Agent": "job-radar (personal project)", Accept: "application/json", "Content-Type": "application/json" } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(attempt * 5000); continue; }
    throw new Error(`HTTP ${res.status}`); // 404 usually means the company id in config.json is wrong
  }
  throw new Error("server kept failing");
}

// ---------- one reader per careers platform ----------
// Each returns jobs in the same shape:
// { id, title, location, url, created, text, mode, type }

const readers = {
  async greenhouse(id) {
    const data = await getJson(`${BASE.greenhouse}/${id}/jobs?content=true`);
    return data.jobs.map((j) => ({
      id: `gh-${j.id}`,
      title: j.title,
      location: [j.location?.name, ...(j.offices ?? []).map((o) => o.name)].filter(Boolean).join(" · "),
      url: j.absolute_url,
      created: j.first_published || j.updated_at,
      text: plain(j.content),
    }));
  },

  async lever(id) {
    const data = await getJson(`${BASE.lever}/${id}?mode=json`);
    return data.map((j) => ({
      id: `lv-${j.id}`,
      title: j.text,
      location: [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(" · "),
      url: j.hostedUrl,
      created: new Date(j.createdAt).toISOString(),
      text: plain(j.descriptionPlain || j.description),
      mode: { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" }[j.workplaceType],
      type: /intern/i.test(j.categories?.commitment ?? "") ? "Internship" : undefined,
      salary: j.salaryRange && toLpa(j.salaryRange.min, j.salaryRange.max, j.salaryRange.currency, j.salaryRange.interval),
    }));
  },

  async ashby(id) {
    const data = await getJson(`${BASE.ashby}/${id}?includeCompensation=true`);
    return data.jobs.map((j) => ({
      id: `ab-${j.id}`,
      title: j.title,
      location: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean).join(" · "),
      url: j.jobUrl,
      created: j.publishedAt,
      text: plain(j.descriptionPlain || j.descriptionHtml),
      mode: j.isRemote ? "Remote" : { Remote: "Remote", Hybrid: "Hybrid", OnSite: "On-site" }[j.workplaceType],
      type: /intern/i.test(j.employmentType ?? "") ? "Internship" : undefined,
      salary: (() => {
        const c = (j.compensation?.summaryComponents ?? []).find((x) => x.compensationType === "Salary");
        return c && toLpa(c.minValue, c.maxValue, c.currencyCode, c.interval);
      })(),
    }));
  },

  // SmartRecruiters returns 100 jobs per page, so big companies need several pages.
  // country=in asks for India jobs only, so even huge companies fit in a few pages.
  async smartrecruiters(id) {
    const jobs = [];
    for (let page = 0; page < config.smartrecruitersMaxPages; page++) {
      const data = await getJson(`${BASE.smartrecruiters}/${id}/postings?country=in&limit=100&offset=${page * 100}`);
      for (const j of data.content ?? []) {
        const loc = j.location ?? {};
        jobs.push({
          id: `sr-${j.id}`,
          title: j.name,
          location: [loc.city, loc.region, loc.country === "in" ? "India" : loc.country].filter(Boolean).join(", "),
          url: `https://jobs.smartrecruiters.com/${id}/${j.id}`,
          created: j.releasedDate,
          text: "", // the list doesn't include descriptions…
          detail: async () => { // …so open the posting when we need its text
            const d = await getJson(`${BASE.smartrecruiters}/${id}/postings/${j.id}`);
            const sec = d.jobAd?.sections ?? {};
            return plain(`${sec.jobDescription?.text ?? ""} ${sec.qualifications?.text ?? ""}`);
          },
          mode: loc.remote ? "Remote" : loc.hybrid ? "Hybrid" : undefined,
          type: /intern/i.test(j.typeOfEmployment?.label ?? "") ? "Internship" : undefined,
        });
      }
      if ((page + 1) * 100 >= (data.totalFound ?? 0)) break;
      await sleep(500);
    }
    return jobs;
  },

  // Workable has two feeds; some companies only fill the newer one, so try both.
  async workable(id) {
    const data = await getJson(`${BASE.workable}/${id}?details=true`);
    if (data.jobs?.length) {
      return data.jobs.map((j) => {
        const locs = (j.locations?.length ? j.locations : [j]).map((l) => [l.city, l.region ?? l.state, l.country].filter(Boolean).join(", "));
        return {
          id: `wk-${j.shortcode}`,
          title: j.title,
          location: locs.join(" · "),
          url: j.url || j.shortlink || j.application_url,
          created: j.published_on || j.created_at,
          text: plain(j.description),
          mode: j.telecommuting ? "Remote" : undefined,
          type: /intern/i.test(j.employment_type ?? "") ? "Internship" : undefined,
        };
      });
    }
    const jobs = [];
    let token;
    for (let page = 0; page < 10; page++) {
      const r = await getJson(`${BASE.workableV3}/${id}/jobs`, { query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) });
      for (const j of r.results ?? []) {
        const locs = [j.location, ...(j.locations ?? [])].filter(Boolean).map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "));
        jobs.push({
          id: `wk-${j.shortcode}`,
          title: j.title,
          location: [...new Set(locs)].join(" · "),
          url: `https://apply.workable.com/${id}/j/${j.shortcode}/`,
          created: j.published,
          text: "",
          mode: j.remote || j.workplace === "remote" ? "Remote" : j.workplace === "hybrid" ? "Hybrid" : undefined,
          type: /intern/i.test(j.type ?? "") ? "Internship" : undefined,
        });
      }
      token = r.nextPage;
      if (!token) break;
    }
    return jobs;
  },

  // Workday: used by many big companies (career links contain "myworkdayjobs.com").
  // Not an official public API — it's the data feed behind their careers page.
  // Step 1: ask for the location filters and pick the ones in our cities.
  // Step 2: page through jobs with those filters (20 per page).
  // If a company rejects that (HTTP 422), search by city name instead.
  async workday(id, company) {
    const root = BASE.workday ?? `https://${company.host}`;
    const api = `${root}/wday/cxs/${id}/${company.site}`;
    const cityRe = new RegExp(Object.values(config.cities).join("|"), "i");
    const search = (facets, offset, searchText) =>
      getJson(`${api}/jobs`, { appliedFacets: facets, limit: 20, offset, searchText });

    const jobs = new Map();
    let detailsOpened = 0;
    async function collectPages(facets, searchText) {
      let total;
      for (let page = 0; page < (company.maxPages ?? 25); page++) {
        const data = await search(facets, page * 20, searchText);
        total ??= data.total; // Workday only sends the real total on the first page
        for (const j of data.jobPostings ?? []) {
          if (jobs.has(j.externalPath)) continue;
          let location = j.locationsText ?? "";
          let text = "";
          const openJob = async () => (await getJson(`${api}${j.externalPath}`)).jobPostingInfo ?? {};
          // "3 Locations" hides the cities, so open that job to read them (limited, to stay polite).
          if (!cityRe.test(location) && detailsOpened < 60) {
            detailsOpened++;
            try {
              const info = await openJob();
              location = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join(" · ");
              text = plain(info.jobDescription);
            } catch { /* keep the short text */ }
          }
          jobs.set(j.externalPath, {
            id: `wd-${id}-${j.bulletFields?.[0] ?? j.externalPath}`,
            title: j.title,
            location,
            url: `https://${company.host}/en-US/${company.site}${j.externalPath}`,
            created: workdayDate(j.postedOn),
            text,
            detail: async () => plain((await openJob()).jobDescription),
            mode: /remote/i.test(location) ? "Remote" : undefined,
          });
        }
        if ((page + 1) * 20 >= (total ?? 0)) break;
        await sleep(400);
      }
    }

    try {
      const first = await search({}, 0, "");
      const facets = {};
      (function walk(list, param) {
        for (const f of list ?? []) {
          const p = f.facetParameter ?? param;
          if (f.values) walk(f.values, p);
          else if (f.id && cityRe.test(f.descriptor ?? "")) (facets[p] ??= []).push(f.id);
        }
      })(first.facets);
      if (!Object.keys(facets).length) return []; // no openings in our cities right now
      await collectPages(facets, "");
      return [...jobs.values()];
    } catch (err) {
      if (!/HTTP 4(00|22)/.test(err.message)) throw err;
    }
    for (const city of ["Bengaluru", "Bangalore", "Chennai", "Coimbatore"]) await collectPages({}, city);
    return [...jobs.values()];
  },

  // Amazon: the data feed behind amazon.jobs, India only.
  async amazon(_id, company) {
    const jobs = [];
    for (let page = 0; page < (company.maxPages ?? 25); page++) {
      const data = await getJson(`${BASE.amazon}?normalized_country_code%5B%5D=IND&result_limit=100&sort=recent&offset=${page * 100}`);
      for (const j of data.jobs ?? []) {
        jobs.push({
          id: `az-${j.id_icims ?? j.id}`,
          title: j.title,
          location: j.normalized_location || j.location || j.city || "",
          url: `https://www.amazon.jobs${j.job_path}`,
          created: j.posted_date ? new Date(j.posted_date).toISOString() : undefined,
          text: plain(`${j.description_short ?? ""} ${j.basic_qualifications ?? ""} ${j.preferred_qualifications ?? ""}`),
          type: /intern/i.test(`${j.title} ${j.job_schedule_type ?? ""}`) ? "Internship" : undefined,
        });
      }
      if ((page + 1) * 100 >= (data.hits ?? 0)) break;
      await sleep(500);
    }
    return jobs;
  },
};

// Workday says "Posted Today" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" instead of a date.
function workdayDate(text = "") {
  const days = /today/i.test(text) ? 0 : /yesterday/i.test(text) ? 1 : parseInt(text.match(/\d+/)?.[0] ?? "", 10);
  return Number.isNaN(days) ? undefined : new Date(Date.now() - days * 86400000).toISOString();
}

// ---------- sorting jobs into cities, roles, types ----------

const cityRules = Object.entries(config.cities).map(([city, pattern]) => [city, new RegExp(pattern, "i")]);
const roleRules = config.roles.map((r) => [r.name, new RegExp(r.match, "i")]);

function cityOf(job) {
  for (const [city, re] of cityRules) if (re.test(job.location)) return city;
  const remote = job.mode === "Remote" || /remote/i.test(job.location);
  if (remote && /india/i.test(job.location)) return "Remote (India)";
  return null; // not one of our places
}

const roleOf = (title) => roleRules.find(([, re]) => re.test(title))?.[0] ?? null;

function modeOf(job) {
  if (job.mode) return job.mode;
  const t = `${job.title} ${job.location} ${job.text}`.toLowerCase();
  if (/\bhybrid\b/.test(t)) return "Hybrid";
  if (/\bremote\b|work from home|\bwfh\b/.test(t)) return "Remote";
  if (/\bon-?site\b|work from office|\bin-office\b/.test(t)) return "On-site";
  return "Not stated";
}

const typeOf = (job) => job.type ?? (/\bintern(ship)?s?\b|\bapprentice/i.test(job.title) ? "Internship" : "Job");

// ---------- salary (in lakhs per annum, "LPA") ----------
// Structured salary from the feed, if any (only INR counts — USD pay is for other countries).
function toLpa(min, max, currency, interval = "") {
  if (!/inr/i.test(currency ?? "") || !(min || max)) return null;
  const perYear = /month/i.test(interval) ? 12 : /hour/i.test(interval) ? 2000 : 1;
  const lpa = (v) => (v ? Math.round((v * perYear) / 1e4) / 10 : null);
  return { min: lpa(min ?? max), max: lpa(max ?? min) };
}

// Salary written in the text: "12-18 LPA", "₹6,00,000 - ₹9,00,000 per annum", "₹40,000/month".
function salaryFromText(text) {
  let m = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:-|–|to)\s*(\d{1,2}(?:\.\d)?)\s*(?:lpa|lakhs?|l\.?p\.?a)/i);
  if (m) return { min: +m[1], max: +m[2] };
  m = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:lpa|lakhs? per annum)/i);
  if (m) return { min: +m[1], max: +m[1] };
  m = text.match(/(?:₹|inr|rs\.?)\s*([\d,]{5,})(?:\s*(?:-|–|to)\s*(?:₹|inr|rs\.?)?\s*([\d,]{5,}))?\s*(per month|\/\s*month|monthly|pm\b)?/i);
  if (m) {
    const n = (x) => +x.replace(/,/g, "");
    return toLpa(n(m[1]), m[2] ? n(m[2]) : n(m[1]), "INR", m[3] ? "month" : "year");
  }
  return null;
}

// ---------- experience level and degrees ----------
function levelOf(job, type) {
  if (type === "Internship") return { level: "Internship", minYears: 0 };
  const t = `${job.title} ${job.text}`;
  const years = t.match(/(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:years|yrs)/i);
  const minYears = years && +years[1] <= 30 ? +years[1] : null;
  if (/\b(fresher|freshers|fresh graduates?|new grad|graduate (engineer|trainee|program)|trainee|entry[- ]level|campus|0\s*(?:-|–|to)\s*[12]\s*(years|yrs))\b/i.test(t)
      || minYears === 0) return { level: "Fresher", minYears };
  if ((minYears !== null && minYears >= 1) || /\b(senior|sr\.?|lead|staff|principal|manager|director|head|architect|vp)\b/i.test(job.title))
    return { level: "Experienced", minYears };
  return { level: "Not stated", minYears };
}

function degreesOf(text) {
  const d = [];
  if (/bachelor|undergraduate degree|\b(B\.?\s?Tech|B\.E\b|BE\/B\.?Tech|B\.?Sc|BCA|B\.?Com|BBA)\b/i.test(text)) d.push("Bachelor's");
  if (/master'?s|\bMBA\b|\bM\.?\s?Tech\b|\bM\.?Sc\b|\bMCA\b|\bMS (in|degree)\b|\bM\.S\.|post-?graduate|\bPGDM\b/i.test(text)) d.push("Master's");
  if (/\bph\.?\s?d|doctorate|doctoral/i.test(text)) d.push("PhD");
  return d;
}

// ---------- main ----------

await mkdir(DATA, { recursive: true });
const previous = await readJson(path.join(DATA, "jobs.json"), { jobs: [] });
const firstSeen = new Map(previous.jobs.map((j) => [j.id, j.firstSeen]));
const history = await readJson(path.join(DATA, "history.json"), {});

const jobs = [];
const sources = [];

for (const company of config.companies) {
  const reader = readers[company.ats];
  if (!reader) { sources.push({ ...company, ok: false, error: `unknown ats "${company.ats}"` }); continue; }
  try {
    const raw = await reader(company.id, company);
    const started = Date.now();
    // Keep only jobs in our cities that match a role.
    const kept = [];
    for (const j of raw) {
      const city = cityOf(j);
      const role = city && roleOf(j.title);
      if (role) kept.push({ j, city, role });
    }
    // Open the full posting when the feed left out the description: 6 at a time, max 150 per company.
    const needText = kept.filter(({ j }) => !j.text && j.detail).slice(0, company.maxDetails ?? 150);
    await eachLimit(needText, 6, async ({ j }) => {
      try { j.text = await j.detail(); } catch { /* fine, keep going without it */ }
    });
    for (const { j, city, role } of kept) {
      const type = typeOf(j);
      const { level, minYears } = levelOf(j, type);
      jobs.push({
        id: j.id,
        company: company.name,
        title: j.title.trim(),
        role,
        city,
        location: j.location,
        url: j.url,
        created: j.created,
        firstSeen: firstSeen.get(j.id) ?? today,
        type,
        mode: modeOf(j),
        level,
        minYears,
        degrees: degreesOf(j.text),
        salary: j.salary ?? salaryFromText(`${j.title} ${j.text}`),
        snippet: j.text.slice(0, 1500),
      });
    }
    const matched = kept.length;
    sources.push({ ...company, ok: true, total: raw.length, matched });
    console.log(`✓ ${company.name.padEnd(18)} ${String(raw.length).padStart(5)} open jobs, ${matched} in our cities (${Math.round((Date.now() - started) / 1000)}s)`);
  } catch (err) {
    sources.push({ ...company, ok: false, error: err.message });
    console.log(`✗ ${company.name.padEnd(18)} ${err.message} — check its "id" in config.json`);
  }
  await sleep(300);
}

if (!sources.some((s) => s.ok)) {
  console.error("Every company feed failed — nothing saved.");
  process.exit(1);
}

// Counts for the Trends tab: company → role → city → number of open jobs.
// Stored per company so trends only compare companies whose feed worked on both dates.
const counts = {};
for (const s of sources) if (s.ok) counts[s.name] = {};
for (const j of jobs) {
  const byRole = (counts[j.company][j.role] ??= {});
  byRole[j.city] = (byRole[j.city] ?? 0) + 1;
}
history[today] = { counts };

jobs.sort((a, b) => new Date(b.created ?? 0) - new Date(a.created ?? 0));
const save = (name, obj) => writeFile(path.join(DATA, name), JSON.stringify(obj, null, 1));
await save("jobs.json", { updated: new Date().toISOString(), jobs });
await save("history.json", history);
await save("sources.json", { updated: new Date().toISOString(), sources });

const ok = sources.filter((s) => s.ok).length;
console.log(`\nDone: ${ok}/${sources.length} company feeds worked, ${jobs.length} matching jobs saved.`);
