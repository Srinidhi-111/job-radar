// Job Radar — dashboard logic
// Loads data/history.json (daily counts) and data/jobs.json (postings),
// then draws the three tabs. No build step, no libraries: plain JavaScript.

const CITIES = ["Chennai", "Bangalore", "Coimbatore", "Remote (India)"];

// Skills we look for in job titles/descriptions. Add more any time.
const SKILLS = {
  "Python": /\bpython\b/i, "Java": /\bjava\b(?!script)/i, "JavaScript": /\bjavascript\b|\bjs\b/i,
  "TypeScript": /\btypescript\b/i, "C++": /c\+\+/i, "C#/.NET": /\bc#|\.net\b/i, "Go": /\bgolang\b/i,
  "SQL": /\bsql\b/i, "React": /\breact(\.js|js)?\b/i, "Angular": /\bangular\b/i, "Node.js": /\bnode(\.js|js)?\b/i,
  "Spring Boot": /\bspring\b/i, "Django/Flask/FastAPI": /\bdjango\b|\bflask\b|\bfastapi\b/i,
  "REST APIs": /\brest(ful)?\b|\bapis?\b/i, "Microservices": /micro-?services/i,
  "AWS": /\baws\b|amazon web services/i, "Azure": /\bazure\b/i, "GCP": /\bgcp\b|google cloud/i,
  "Docker": /\bdocker\b/i, "Kubernetes": /\bkubernetes\b|\bk8s\b/i, "Terraform": /\bterraform\b/i,
  "CI/CD": /ci\s?\/\s?cd|jenkins|github actions/i, "Linux": /\blinux\b/i, "Git": /\bgit\b/i,
  "Machine Learning": /machine learning|\bml\b/i, "Deep Learning": /deep learning|neural net/i,
  "LLMs / GenAI": /\bllms?\b|generative ai|gen ?ai|\bgpt\b|large language/i, "RAG": /\brag\b|retrieval.augmented/i,
  "AI Agents": /\bagents?\b|agentic/i, "PyTorch": /pytorch/i, "TensorFlow": /tensorflow/i,
  "NLP": /\bnlp\b|natural language/i, "Computer Vision": /computer vision|\bopencv\b/i,
  "Spark / Big Data": /\bspark\b|hadoop|big data|databricks/i, "Power BI / Tableau": /power ?bi|tableau/i,
  "Excel": /\bexcel\b/i, "Statistics": /statistic/i, "Data pipelines / ETL": /\betl\b|data pipeline/i,
  "MongoDB / NoSQL": /mongo|nosql/i, "Selenium / Testing": /selenium|playwright|cypress|test automation/i,
  "Security": /security|siem|soc\b|penetration|vapt/i, "Figma": /\bfigma\b/i,
  "Android / Kotlin": /android|kotlin/i, "Flutter": /\bflutter\b/i, "Embedded C": /embedded|microcontroller|rtos/i,
  "Salesforce": /salesforce/i, "Agile / Scrum": /\bagile\b|\bscrum\b/i,
  // useful outside IT too
  "Communication": /communication/i, "Stakeholder management": /stakeholder/i, "Problem solving": /problem[- ]solving/i,
  "Leadership": /leadership|people management/i, "Project management": /project management|\bpmp\b/i,
  "Negotiation": /negotiat/i, "CRM (Salesforce/HubSpot)": /\bcrm\b|hubspot/i, "Digital marketing / SEO": /\bseo\b|\bsem\b|google ads|digital marketing/i,
  "SAP / ERP": /\bsap\b|\berp\b|oracle (financials|ebs)/i, "Tally / GST": /\btally\b|\bgst\b/i,
  "AutoCAD / SolidWorks": /autocad|solidworks|catia|\bcreo\b/i, "MATLAB": /matlab/i, "Six Sigma / Lean": /six sigma|\blean\b/i,
};

const state = { history: {}, jobs: [], sources: [], roles: [], deptOf: {}, groupOf: {}, updated: null, cities: new Set(CITIES) };

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("en-IN");
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const ago = (iso) => {
  const d = daysBetween(iso.slice(0, 10), new Date().toISOString().slice(0, 10));
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
};

// The "department or role" dropdown: "", "g:IT", "d:Marketing" or "r:Data Engineer".
function inArea(role, value) {
  if (!value) return true;
  const [kind, name] = [value.slice(0, 1), value.slice(2)];
  const dept = state.deptOf[role] ?? "Other";
  if (kind === "g") return (state.groupOf[dept] ?? "Non-IT") === name;
  if (kind === "d") return dept === name;
  return role === name;
}

function areaOptions(allLabel) {
  const depts = (group) => Object.keys(state.groupOf).filter((d) => state.groupOf[d] === group);
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  return opt("", allLabel) + opt("g:IT", "All IT roles") + opt("g:Non-IT", "All non-IT roles")
    + `<optgroup label="IT departments">${depts("IT").map((d) => opt(`d:${d}`, d)).join("")}</optgroup>`
    + `<optgroup label="Non-IT departments">${depts("Non-IT").map((d) => opt(`d:${d}`, d)).join("")}</optgroup>`
    + `<optgroup label="Specific role">${state.roles.map((r) => opt(`r:${r}`, r)).join("")}</optgroup>`;
}

const lpa = (s) => s && (s.min === s.max || !s.max ? `₹${s.min ?? s.max} LPA` : `₹${s.min}–${s.max} LPA`);

async function load(file, fallback) {
  try {
    const r = await fetch(file, { cache: "no-store" });
    return r.ok ? await r.json() : fallback;
  } catch { return fallback; }
}

// ---------- city filter (shared by all tabs) ----------
// "All" shows everything. Tapping a city while "All" is on shows ONLY that city;
// after that, tapping cities adds or removes them. Removing the last one goes back to "All".
const allCities = () => state.cities.size === CITIES.length;
function drawCityButtons() {
  $("cityFilter").innerHTML = `<button data-city="*" aria-pressed="${allCities()}">All</button>`
    + CITIES.map((c) => `<button data-city="${c}" aria-pressed="${!allCities() && state.cities.has(c)}">${c}</button>`).join("");
}
$("cityFilter").addEventListener("click", (e) => {
  const city = e.target.dataset?.city;
  if (!city) return;
  if (city === "*") state.cities = new Set(CITIES);
  else if (allCities()) state.cities = new Set([city]);
  else if (state.cities.has(city)) state.cities.delete(city);
  else state.cities.add(city);
  if (!state.cities.size) state.cities = new Set(CITIES);
  drawCityButtons();
  renderAll();
});

// Is a job in any selected city? Older data only has "city", newer has "cities".
const inCities = (j) => (j.cities ?? [j.city]).some((c) => state.cities.has(c));
const cityLabel = (j) => (j.cities ?? [j.city]).join(" · ");

// ---------- TRENDS ----------
// Open jobs for a role on a date, counting only the given companies and selected cities.
function totalFor(date, role, companies) {
  const counts = state.history[date]?.counts ?? {};
  let sum = 0;
  for (const co of companies) for (const c of state.cities) sum += counts[co]?.[role]?.[c] ?? 0;
  return sum;
}
const companiesOn = (date) => new Set(Object.keys(state.history[date]?.counts ?? {}));

function sparkline(values) {
  if (values.length < 2) return "";
  const w = 300, h = 34, max = Math.max(...values, 1), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---------- INDIA-WIDE OUTLOOK (from monthly hiring reports, see outlook.json) ----------
let outlookGroup = "Roles";
const pctLabel = (v) => v === "stable" ? "Stable" : `${v > 0 ? "+" : ""}${v}%`;
const pctNum = (v) => (v === "stable" ? 0 : v);
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleString("en-IN", { month: "short" });

// Turn a field's monthly numbers into a plain-English direction.
function trendOf(series, months) {
  const have = months.filter((m) => series[m] !== undefined);
  const vals = have.map((m) => pctNum(series[m]));
  const recent = vals.slice(-3), earlier = vals.slice(0, -3);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const r = avg(recent);
  let label;
  if (vals.length < 3) {
    label = vals.every((v) => v >= 5) ? "Growing (limited data)" : vals.every((v) => v <= -3) ? "Falling (limited data)" : "Limited data";
  } else if (recent.every((v) => v >= 5)) label = "Rising steadily";
  else if (recent.every((v) => v <= -3)) label = "Falling steadily";
  else if (vals.at(-1) >= 3 && vals.at(-2) >= 0 && Math.min(...vals.slice(0, -2)) <= -5) label = "Recovering";
  else if (earlier.length && avg(earlier) >= 10 && r < avg(earlier) - 6) label = "Cooling";
  else if (r >= 5 && recent.every((v) => v > -3)) label = "Mostly growing";
  else if (r <= -3 && recent.every((v) => v < 5)) label = "Mostly falling";
  else label = "Mixed";
  const bucket = /Rising|Mostly growing|Recovering|Growing/.test(label) ? "grow" : /Falling|falling/.test(label) ? "fall" : "mixed";
  return { label, bucket, score: r, latest: series[have.at(-1)], latestMonth: have.at(-1), enough: vals.length >= 3 };
}

// One bar per month: up = more postings than a year ago, down = fewer. Gaps = not reported.
function monthBars(series, months) {
  const max = Math.max(10, ...months.map((m) => Math.abs(pctNum(series[m] ?? 0))));
  const w = 100 / months.length;
  const bars = months.map((m, i) => {
    if (series[m] === undefined) return `<rect x="${i * w + w * 0.3}" y="19" width="${w * 0.4}" height="2" class="gap"/>`;
    const v = pctNum(series[m]);
    const h = Math.max(1.5, (Math.abs(v) / max) * 18);
    return `<rect x="${i * w + w * 0.15}" y="${v >= 0 ? 20 - h : 20}" width="${w * 0.7}" height="${h}" rx="1" class="${v > 0 ? "pos" : v < 0 ? "neg" : "zero"}"><title>${monthName(m)}: ${pctLabel(series[m])}</title></rect>`;
  }).join("");
  const labels = months.map((m) => `<span>${monthName(m).slice(0, 3)}</span>`).join("");
  return `<div class="mchart"><svg class="mbars" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="20" x2="100" y2="20"/>${bars}</svg><div class="mlabels" style="grid-template-columns:repeat(${months.length},1fr)">${labels}</div></div>`;
}

function renderOutlook() {
  const o = state.outlook;
  if (!o?.groups) return;
  $("outlook").hidden = false;
  const months = o.months;
  const period = `${monthName(months[0])}–${monthName(months.at(-1))} ${months.at(-1).slice(0, 4)}`;

  // Headline: the clearest risers and fallers among roles and industries (only fields with enough data).
  const all = [...(o.groups.Roles ?? []), ...(o.groups.Industries ?? [])]
    .map((r) => ({ name: r.name, t: trendOf(r.series, months) })).filter((r) => r.t.enough);
  const up = all.filter((r) => r.t.bucket === "grow").sort((a, b) => b.t.score - a.t.score).slice(0, 3);
  const down = all.filter((r) => r.t.bucket === "fall").sort((a, b) => a.t.score - b.t.score).slice(0, 3);
  // Short names for the headline: "Global Capability Centres (GCCs)" → "GCCs", "Hospitality & travel" → "Hospitality".
  const short = (n) => esc(n.match(/\(([^)]+)\)$/)?.[1] ?? n.replace(/ & .*$/, ""));
  $("outlookHeadline").innerHTML =
    (up.length ? `<p><span class="hl up">Growing</span> ${up.map((r) => short(r.name)).join(", ")}</p>` : "")
    + (down.length ? `<p><span class="hl down">Losing ground</span> ${down.map((r) => short(r.name)).join(", ")}</p>` : "");

  const groups = [...Object.keys(o.groups), ...(o.longTerm ? ["By 2030"] : [])];
  $("outlookTabs").innerHTML = groups.map((g) =>
    `<button role="tab" data-group="${esc(g)}" aria-selected="${g === outlookGroup}">${esc(g)}</button>`).join("");

  if (outlookGroup === "By 2030") return renderLongTerm(o.longTerm);
  $("outlookAbout").textContent = `How hiring across India has moved over the last six months (${period}). Tap a field to see month by month.`;

  const rows = o.groups[outlookGroup].map((r) => ({ ...r, t: trendOf(r.series, months) }));
  const sections = [["grow", "Growing"], ["mixed", "Mixed or slowing"], ["fall", "Losing ground"]];
  $("outlookRows").innerHTML = sections.map(([key, title]) => {
    const list = rows.filter((r) => r.t.bucket === key).sort((a, b) => b.t.enough - a.t.enough || b.t.score - a.t.score);
    if (!list.length) return "";
    return `<li class="ol-head ${key}">${title}</li>` + list.map((r) => `
      <li><details class="ol-item">
        <summary>
          <span class="ol-name">${esc(r.name)}</span>
          <span class="badge ${key === "grow" ? "up" : key === "fall" ? "down" : "flat"}">${esc(r.t.label.replace(" (limited data)", "*"))}</span>
        </summary>
        ${monthBars(r.series, months)}
        <p class="ol-meta">${monthName(r.t.latestMonth)}: ${pctLabel(r.t.latest)} compared with a year earlier${r.t.enough ? "" : " · only reported " + (Object.keys(r.series).length === 1 ? "once" : "twice") + " so far"}</p>
        ${r.area ? `<button class="link" data-area="${esc(r.area)}">See jobs →</button>` : ""}
      </details></li>`).join("");
  }).join("");

  const overall = months.map((m) => `${monthName(m)} ${pctLabel(o.overall[m] ?? "–")}`).join(" · ");
  $("outlookSources").innerHTML = `
    <p>Each month's bar compares job postings in that field with the <strong>same month a year earlier</strong> (this removes seasonal swings like appraisal season or Diwali). Bar up = more postings than a year ago, bar down = fewer.</p>
    <p><strong>Rising steadily</strong> = at least +5% in each of the last 3 reports. <strong>Falling steadily</strong> = at least −3% in each. <strong>Recovering</strong> = was falling, now positive. <strong>Cooling</strong> = was strong, now much weaker. <strong>*</strong> = reported only once or twice, so the direction is less certain.</p>
    ${o.notes?.[outlookGroup] ? `<p>${esc(o.notes[outlookGroup])}</p>` : ""}
    <p>${esc(o.caveat)}</p>
    <p>All of India, all fields: ${esc(overall)}.</p>
    <p>More postings means more openings, not that a field is easy to get into. Updated ${esc(o.updated)}.</p>
    <ul>${o.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>`;
}

function renderLongTerm(lt) {
  $("outlookAbout").textContent = "Expected change in these jobs worldwide between 2025 and 2030.";
  const max = Math.max(...lt.growing.map(([, v]) => v), ...lt.shrinking.map(([, v]) => -v));
  const row = ([name, v]) => `<li class="ol-row">
      <span class="ol-name">${esc(name)}</span><span class="badge ${v > 0 ? "up" : "down"}">${v > 0 ? "+" : ""}${v}%</span>
      <div class="ol-bar ${v > 0 ? "up" : "down"}"><span style="width:${(Math.abs(v) / max) * 100}%"></span></div></li>`;
  $("outlookRows").innerHTML = `<li class="ol-head grow">Fastest growing</li>${lt.growing.map(row).join("")}
    <li class="ol-head fall">Fastest shrinking</li>${lt.shrinking.map(row).join("")}`;
  $("outlookSources").innerHTML = `<p>${esc(lt.about)}</p>
    <p>Most of the fastest-growing jobs are tech and data roles; most shrinking ones are clerical and routine tasks that software and AI now handle.</p>
    <ul>${lt.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>`;
}

$("outlookTabs").addEventListener("click", (e) => {
  const g = e.target.dataset?.group;
  if (g) { outlookGroup = g; renderOutlook(); }
});
$("outlookRows").addEventListener("click", (e) => {
  const a = e.target.closest("[data-area]");
  if (!a) return;
  $("roleFilter").value = a.dataset.area;
  renderCompanies();
  showTab("companies", true);
});

function renderTrends() {
  const dates = Object.keys(state.history).sort();
  if (!dates.length) {
    $("roleList").innerHTML = `<li class="empty">No data yet. Run the collector once (see README) and refresh.</li>`;
    $("historyNote").textContent = "";
    return;
  }
  const last = dates[dates.length - 1];
  const lastCos = companiesOn(last);
  // Compare with the most recent run that is at least 6 days older.
  const base = [...dates].reverse().find((d) => daysBetween(d, last) >= 6);
  // Only companies whose feed worked on both dates, so a broken feed doesn't look like a crash in hiring.
  const shared = base ? [...lastCos].filter((c) => companiesOn(base).has(c)) : [...lastCos];
  $("historyNote").textContent = base
    ? `Open jobs at ${shared.length} tracked companies, compared with ${base} (${daysBetween(base, last)} days earlier).`
    : `Open jobs at ${lastCos.size} tracked companies. Rising/falling needs two snapshots at least 6 days apart, so it starts after next week's automatic run (${dates.length} snapshot${dates.length === 1 ? "" : "s"} so far).`;

  const area = $("trendArea").value;
  const roles = state.roles.filter((role) => inArea(role, area)).map((role) => {
    const now = totalFor(last, role, lastCos);
    const nowShared = totalFor(last, role, shared);
    const then = base ? totalFor(base, role, shared) : null;
    const diff = then === null ? null : nowShared - then;
    const change = then ? (diff / then) * 100 : null;
    const series = dates.slice(-12).map((d) => totalFor(d, role, companiesOn(d)));
    const perCity = [...state.cities].map((c) => {
      let n = 0;
      for (const co of lastCos) n += state.history[last].counts[co]?.[role]?.[c] ?? 0;
      return `${c} ${fmt(n)}`;
    }).join(" · ");
    return { role, now, diff, change, series, perCity };
  });

  // Growth needs an older snapshot. Until then, grey out those options and say when they'll work.
  const growthOpts = [...$("trendSort").options].filter((o) => o.value !== "count");
  for (const o of growthOpts) {
    o.disabled = !base;
    o.textContent = (o.value === "growth" ? "Fastest growing" : "Fastest falling") + (base ? "" : " (after next weekly run)");
  }
  if (!base && $("trendSort").value !== "count") $("trendSort").value = "count";
  const sort = $("trendSort").value;
  const key = (r) => r.change ?? (r.diff ? Math.sign(r.diff) * 100 : 0);
  roles.sort((a, b) =>
    sort === "growth" ? key(b) - key(a) || b.now - a.now
    : sort === "decline" ? key(a) - key(b) || b.now - a.now
    : b.now - a.now);

  $("roleList").innerHTML = roles.map((r) => {
    let badge = `<span class="badge flat">first run</span>`;
    if (r.diff !== null) {
      const big = Math.abs(r.diff) >= 2 && (r.change === null || Math.abs(r.change) >= 15);
      const cls = !big ? "flat" : r.diff > 0 ? "up" : "down";
      const word = cls === "up" ? "Rising" : cls === "down" ? "Falling" : "Steady";
      const pct = r.change === null ? (r.diff ? " (new)" : "") : ` (${r.change > 0 ? "+" : ""}${r.change.toFixed(0)}%)`;
      badge = `<span class="badge ${cls}">${word}${r.diff ? ` ${r.diff > 0 ? "+" : ""}${r.diff}` : ""}${pct}</span>`;
    }
    return `<li class="role">
      <h3>${esc(r.role)}</h3><span class="count">${fmt(r.now)}</span>
      <span class="meta">open jobs</span>${badge}
      ${sparkline(r.series)}
      <span class="cityline">${esc(r.perCity)}</span>
    </li>`;
  }).join("");
}

// ---------- COMPANIES ----------
// "New" = first appeared in the latest run (only meaningful from the second run on).
const latestRun = () => Object.keys(state.history).sort().at(-1);
const isNew = (j) => Object.keys(state.history).length > 1 && j.firstSeen === latestRun();

// Minimum years a job asks for: from "3+ years" in the posting, or 0 for freshers/interns.
// null = the posting doesn't say.
function yearsOf(j) {
  if (j.level === "Fresher" || j.level === "Internship") return 0;
  return typeof j.minYears === "number" ? j.minYears : null;
}

// exp is "fresher", "none", or a range like "2-5" (from 2 up to, but not including, 5).
function expMatches(j, exp) {
  const y = yearsOf(j);
  if (exp === "fresher") return y === 0;
  if (exp === "none") return y === null;
  const [lo, hi] = exp.split("-").map(Number);
  return y !== null && y >= lo && (lo === 0 ? y <= hi : y < hi);
}

function filteredJobs() {
  const q = $("companySearch").value.trim().toLowerCase();
  const role = $("roleFilter").value, type = $("typeFilter").value, mode = $("modeFilter").value;
  const newOnly = $("newOnly").checked;
  const sal = $("salaryFilter").value, edu = $("eduFilter").value, exp = $("expFilter").value;
  return state.jobs.filter((j) =>
    inCities(j) &&
    inArea(j.role, role) &&
    (!sal || (sal === "listed" ? !!j.salary : !!j.salary && (j.salary.max ?? j.salary.min) >= +sal)) &&
    (!edu || (j.degrees ?? []).includes(edu)) &&
    (!exp || expMatches(j, exp)) &&
    (!type || j.type === type) &&
    (!mode || j.mode === mode) &&
    (!newOnly || isNew(j)) &&
    (!q || `${j.company} ${j.title} ${j.role}`.toLowerCase().includes(q)));
}

function renderCompanies() {
  if (!state.jobs.length) {
    $("companyList").innerHTML = `<p class="empty">No postings yet. Run the collector once (see README).</p>`;
    $("companyCount").textContent = "";
    return;
  }
  const groups = new Map();
  for (const j of filteredJobs()) {
    if (!groups.has(j.company)) groups.set(j.company, []);
    groups.get(j.company).push(j);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const shown = list.slice(0, 150);
  const total = list.reduce((s, [, js]) => s + js.length, 0);
  let note = `${fmt(list.length)} companies · ${fmt(total)} openings${list.length > shown.length ? " (showing top 150)" : ""}`;
  // Be upfront: most Indian postings don't state salary or degree.
  const here = state.jobs.filter(inCities);
  const share = (f) => Math.round((here.filter(f).length / (here.length || 1)) * 100);
  if ($("salaryFilter").value) note += ` · only ${share((j) => j.salary)}% of postings state a salary`;
  if ($("eduFilter").value) note += ` · ${share((j) => j.degrees?.length)}% mention a degree`;
  if ($("expFilter").value && $("expFilter").value !== "none") note += ` · ${share((j) => yearsOf(j) !== null)}% state experience`;
  $("companyCount").textContent = note;

  $("companyList").innerHTML = shown.map(([company, js]) => {
    const interns = js.filter((j) => j.type === "Internship").length;
    return `<details class="company">
      <summary><strong>${esc(company)}</strong>
        <span class="n">${js.length} open${interns ? ` · ${interns} intern` : ""}</span></summary>
      <div class="postings">${js.map((j) => `
        <div class="posting">
          <a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
          <div class="chips">
            ${isNew(j) ? `<span class="chip new">NEW</span>` : ""}
            <span class="chip ${j.type === "Internship" ? "intern" : ""}">${j.type}</span>
            <span class="chip">${esc(j.mode)}</span>
            <span class="chip">${esc(cityLabel(j))}</span>
            <span class="chip">${esc(j.role)}</span>
            ${j.salary ? `<span class="chip pay">${lpa(j.salary)}</span>` : ""}
            ${j.level === "Fresher" ? `<span class="chip intern">Fresher-friendly</span>` : ""}
            ${j.level === "Experienced" && j.minYears ? `<span class="chip">${j.minYears}+ yrs</span>` : ""}
            ${(j.degrees ?? []).map((d) => `<span class="chip">${esc(d)}</span>`).join("")}
            ${j.created ? `<span class="chip">posted ${ago(j.created)}</span>` : ""}
          </div>
          ${j.snippet ? `<p>${esc(j.snippet.slice(0, 180))}…</p>` : ""}
        </div>`).join("")}
      </div>
    </details>`;
  }).join("") || `<p class="empty">No matches. Try loosening the filters.</p>`;
  renderSources();
}

function renderSources() {
  const ok = state.sources.filter((s) => s.ok), bad = state.sources.filter((s) => !s.ok);
  $("sourcesSummary").textContent = `Company feeds: ${ok.length} of ${state.sources.length} working`;
  $("sourcesList").innerHTML = `<ul>${[
    ...bad.map((s) => `<li class="bad">✗ ${esc(s.name)} (${esc(s.ats)} "${esc(s.id)}"): ${esc(s.error)}</li>`),
    ...ok.map((s) => `<li>✓ ${esc(s.name)}: ${s.matched} here / ${s.total} worldwide</li>`),
  ].join("")}</ul>`;
}

// ---------- SKILLS ----------
function renderSkills() {
  const role = $("skillRoleFilter").value;
  const jobs = state.jobs.filter((j) => inCities(j) && inArea(j.role, role));
  if (!jobs.length) {
    $("skillList").innerHTML = `<li class="empty">No postings yet.</li>`;
    return;
  }
  const stats = Object.keys(SKILLS).map((name) => ({ name, count: 0, roles: new Set() }));
  for (const j of jobs) {
    const text = `${j.title} ${j.snippet}`;
    for (const s of stats) if (SKILLS[s.name].test(text)) { s.count++; s.roles.add(j.role); }
  }
  const totalRoles = new Set(jobs.map((j) => j.role)).size;
  const ranked = stats.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const max = ranked[0]?.count || 1;

  $("skillList").innerHTML = ranked.map((s) => {
    const pct = ((s.count / jobs.length) * 100).toFixed(0);
    const transferable = !role.startsWith("r:") && totalRoles >= 4 && s.roles.size >= Math.ceil(totalRoles * 0.4);
    return `<li class="skill" data-skill="${esc(s.name)}" tabindex="0" role="button">
      <span><strong>${esc(s.name)}</strong>${transferable ? `<span class="tag">TRANSFERABLE</span>` : ""}</span>
      <span class="meta">${pct}% of postings${role.startsWith("r:") ? "" : ` · ${s.roles.size} role${s.roles.size === 1 ? "" : "s"}`}</span>
      <div class="bar"><span style="width:${(s.count / max) * 100}%"></span></div>
    </li>`;
  }).join("");
}

// ---------- skill guide pop-up ----------
// How much a skill is asked for: share of postings overall and the roles that ask most.
function skillDemand(name) {
  const re = SKILLS[name];
  const jobs = state.jobs.filter(inCities);
  const byRole = {};
  let hits = 0;
  for (const j of jobs) {
    const r = (byRole[j.role] ??= { n: 0, hit: 0 });
    r.n++;
    if (re && re.test(`${j.title} ${j.snippet}`)) { r.hit++; hits++; }
  }
  const top = Object.entries(byRole).filter(([, r]) => r.n >= 5 && r.hit)
    .map(([role, r]) => [role, Math.round((r.hit / r.n) * 100)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return { share: jobs.length ? Math.round((hits / jobs.length) * 100) : 0, count: hits, top };
}

function openGuide(name) {
  const g = (window.SKILL_GUIDES ?? {})[name];
  const d = skillDemand(name);
  const list = (items, tag = "ul") => `<${tag}>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</${tag}>`;
  $("guideBody").innerHTML = `
    <h2>${esc(name)}</h2>
    ${g ? `<p>${esc(g.about)}</p>` : ""}
    <p class="demand">Asked for in <strong>${d.share}%</strong> of postings here (${fmt(d.count)} jobs)${d.top.length ? ` · most by ${d.top.map(([r, p]) => `${esc(r)} (${p}%)`).join(", ")}` : ""}</p>
    ${g ? `<h3>What to learn, in order</h3>${list(g.learn, "ol")}
    <h3>Practice projects</h3>${list(g.build)}
    <h3>Free references</h3><ul>${g.refs.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join("")}</ul>`
    : `<p>No guide yet for this skill. Try <a href="https://roadmap.sh" target="_blank" rel="noopener">roadmap.sh</a>.</p>`}`;
  $("guide").showModal();
}
$("guideClose").addEventListener("click", () => $("guide").close());
$("guide").addEventListener("click", (e) => { if (e.target === $("guide")) $("guide").close(); }); // tap outside closes
$("skillList").addEventListener("click", (e) => { const li = e.target.closest("[data-skill]"); if (li) openGuide(li.dataset.skill); });
$("skillList").addEventListener("keydown", (e) => { const li = e.target.closest("[data-skill]"); if (li && e.key === "Enter") openGuide(li.dataset.skill); });

// Switch tab from code (used by the Résumé tab's "View jobs" buttons).
function showTab(tab, scrollUp = false) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== tab));
  if (scrollUp) window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- tabs & startup ----------
document.querySelector(".tabs").addEventListener("click", (e) => {
  const tab = e.target.dataset?.tab;
  if (tab) showTab(tab);
});

function renderAll() {
  renderTrends(); renderCompanies(); renderSkills();
  window.renderResume?.(); // résumé matches depend on the selected cities too
}

["trendSort", "trendArea"].forEach((id) => $(id).addEventListener("change", renderTrends));
["companySearch", "roleFilter", "typeFilter", "modeFilter", "salaryFilter", "expFilter", "eduFilter", "newOnly"].forEach((id) =>
  $(id).addEventListener("input", renderCompanies));
$("skillRoleFilter").addEventListener("change", renderSkills);

(async function init() {
  drawCityButtons();
  const [history, jobsFile, sourcesFile, config, outlook] = await Promise.all([
    load("data/history.json", {}),
    load("data/jobs.json", { updated: null, jobs: [] }),
    load("data/sources.json", { sources: [] }),
    load("config.json", { roles: [] }),
    load("outlook.json", null),
  ]);
  state.history = history;
  state.jobs = jobsFile.jobs;
  state.updated = jobsFile.updated;
  state.sources = sourcesFile.sources;
  state.roles = config.roles.map((r) => r.name);
  for (const r of config.roles) state.deptOf[r.name] = r.department;
  state.groupOf = config.departments ?? {};
  state.outlook = outlook;
  renderOutlook();

  $("trendArea").innerHTML = areaOptions("All roles");
  $("roleFilter").innerHTML = areaOptions("All roles");
  $("skillRoleFilter").innerHTML = areaOptions("Across all roles");

  $("updated").textContent = jobsFile.updated
    ? `Updated ${new Date(jobsFile.updated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · ${Object.keys(history).length} run(s) so far`
    : "No data collected yet";
  renderAll();
})();
