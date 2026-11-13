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

function renderOutlook() {
  const o = state.outlook;
  if (!o?.groups) return;
  $("outlook").hidden = false;
  const [prev, latest] = o.periods;
  $("outlookAbout").textContent = `${o.about} Overall: ${pctLabel(o.overall[latest])} in ${latest}, ${pctLabel(o.overall[prev])} in ${prev}.`;
  $("outlookTabs").innerHTML = Object.keys(o.groups).map((g) =>
    `<button role="tab" data-group="${esc(g)}" aria-selected="${g === outlookGroup}">${esc(g)}</button>`).join("");

  // Sort by the most recent figure available for each row.
  const latestOf = (r) => (r.values[latest] !== undefined ? [latest, r.values[latest]] : [prev, r.values[prev]]);
  const rows = [...o.groups[outlookGroup]].sort((a, b) => pctNum(latestOf(b)[1]) - pctNum(latestOf(a)[1]));
  const max = Math.max(...rows.map((r) => Math.abs(pctNum(latestOf(r)[1]))), 1);

  $("outlookRows").innerHTML = rows.map((r) => {
    const [period, v] = latestOf(r);
    const n = pctNum(v);
    const cls = v === "stable" || Math.abs(n) < 3 ? "flat" : n > 0 ? "up" : "down";
    const other = period === latest && r.values[prev] !== undefined ? `${prev.slice(0, 3)} ${pctLabel(r.values[prev])}` : "";
    return `<li class="ol-row">
      <span class="ol-name">${esc(r.name)}</span>
      <span class="badge ${cls}">${pctLabel(v)}</span>
      <div class="ol-bar ${cls}"><span style="width:${(Math.abs(n) / max) * 100}%"></span></div>
      <span class="ol-meta">${esc(period)}${other ? ` · ${esc(other)}` : ""}</span>
      ${r.area ? `<button class="link" data-area="${esc(r.area)}">See jobs →</button>` : ""}
    </li>`;
  }).join("");

  $("outlookNote").textContent = [o.notes?.[outlookGroup], o.caveat].filter(Boolean).join(" ");
  $("outlookSources").innerHTML = `<ul>${o.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>
    <p>These are year-on-year changes: October 2026 compared with October 2025. A positive number means more job postings than a year ago, not that a field is easy to get into. Updated ${esc(o.updated)}.</p>`;
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
