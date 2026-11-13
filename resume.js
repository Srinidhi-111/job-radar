// Job Radar — Résumé tab
// 1. Read your résumé (PDF, .txt or pasted text) — stays in this browser.
// 2. Find which skills it mentions, using the same skill list as the Skills tab.
// 3. Compare with what each role asks for right now, and rank the roles that fit.
// 4. Tailor for a role or a specific job: a free keyword check, or an AI rewrite
//    with Google's Gemini API using your own key (contact details removed first).
// Uses SKILLS, state, esc, fmt, $, inArea, lpa, openGuide, showTab from app.js.

const RESUME_KEY = "jobradar-resume";
const GEMINI_KEY = "jobradar-gemini-key";
const resume = { text: "", skills: new Set() };

// Browser storage can be blocked (private mode), so every access is wrapped.
const store = {
  get: (k) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not saved, still works */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- reading the file ----------
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = ok; s.onerror = () => fail(new Error("Couldn't load the PDF reader. Check your connection, or paste the text instead."));
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}

async function textFromFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return file.text();
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    // Rebuild lines: pdf.js gives text pieces; hasEOL marks line ends.
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
  }
  return pages.join("\n");
}

$("resumeFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  $("resumeStatus").textContent = `Reading ${file.name}…`;
  try {
    $("resumeText").value = (await textFromFile(file)).replace(/[ \t]+\n/g, "\n").trim();
    analyse();
  } catch (err) {
    $("resumeStatus").textContent = err.message || "Couldn't read that file. Try pasting the text instead.";
  }
});

// ---------- matching ----------
const detectSkills = (text) => new Set(Object.keys(SKILLS).filter((name) => SKILLS[name].test(text)));

// What each role asks for right now: skills mentioned in at least 12% of its postings.
function roleProfiles() {
  const byRole = {};
  for (const j of state.jobs) {
    if (!inCities(j)) continue;
    (byRole[j.role] ??= []).push(`${j.title} ${j.snippet}`);
  }
  return Object.entries(byRole).filter(([, texts]) => texts.length >= 5).map(([role, texts]) => {
    const profile = Object.keys(SKILLS)
      .map((name) => ({ name, share: texts.filter((t) => SKILLS[name].test(t)).length / texts.length }))
      .filter((s) => s.share >= 0.12).sort((a, b) => b.share - a.share).slice(0, 12);
    return { role, jobs: texts.length, profile };
  }).filter((r) => r.profile.length >= 2);
}

// Match % = how much of the role's demand (weighted by how often each skill is asked) you cover.
function rankRoles() {
  return roleProfiles().map((r) => {
    const total = r.profile.reduce((s, x) => s + x.share, 0);
    const have = r.profile.filter((x) => resume.skills.has(x.name));
    const missing = r.profile.filter((x) => !resume.skills.has(x.name));
    return { ...r, have, missing, score: Math.round((have.reduce((s, x) => s + x.share, 0) / total) * 100) };
  }).sort((a, b) => b.score - a.score || b.jobs - a.jobs);
}

function analyse() {
  resume.text = $("resumeText").value.trim();
  if ($("rememberResume").checked) store.set(RESUME_KEY, resume.text); else store.del(RESUME_KEY);
  if (resume.text.length < 80) {
    $("resumeStatus").textContent = "Add your résumé first (upload a PDF or paste the text).";
    $("matchCard").hidden = $("tailorCard").hidden = true;
    return;
  }
  resume.skills = detectSkills(resume.text);
  renderResume();
}
$("analyseBtn").addEventListener("click", analyse);

const skillChip = (name, cls = "") => `<button class="chip skill-chip ${cls}" data-guide="${esc(name)}">${esc(name)}</button>`;

function renderResume() {
  if (!resume.text) return;
  $("resumeStatus").textContent = resume.skills.size
    ? `Found ${resume.skills.size} skills in your résumé:`
    : "No skills from our list were found. Make sure your résumé lists your tools and technologies by name.";
  $("yourSkills").innerHTML = [...resume.skills].map((s) => skillChip(s, "have")).join("");

  const ranked = rankRoles();
  $("matchCard").hidden = $("tailorCard").hidden = false;
  // Show the best fits; roles with no overlap at all aren't useful here.
  $("roleMatches").innerHTML = ranked.filter((r) => r.score > 0).slice(0, 8).map((r) => `
    <li class="match">
      <div class="match-top"><strong>${esc(r.role)}</strong><span class="pct">${r.score}% match</span></div>
      <div class="bar"><span style="width:${r.score}%"></span></div>
      ${r.have.length ? `<p class="lbl">You have</p><div class="chips">${r.have.map((x) => skillChip(x.name, "have")).join("")}</div>` : ""}
      ${r.missing.length ? `<p class="lbl">To learn (most asked first)</p><div class="chips">${r.missing.slice(0, 6).map((x) => skillChip(x.name, "gap")).join("")}</div>` : ""}
      <button class="link" data-viewrole="${esc(r.role)}">View ${fmt(r.jobs)} open jobs →</button>
    </li>`).join("") || `<li class="empty">${ranked.length ? "None of the skills in your résumé match current postings yet. Make sure your tools and technologies are listed by name." : "Not enough job data yet for the selected cities."}</li>`;

  // Fill the "tailor for" dropdowns, best matches first.
  const current = $("tailorRole").value;
  $("tailorRole").innerHTML = ranked.map((r) => `<option value="${esc(r.role)}">${esc(r.role)} (${r.score}% match)</option>`).join("");
  if (ranked.some((r) => r.role === current)) $("tailorRole").value = current;
  fillJobs();
}
window.renderResume = renderResume;

function fillJobs() {
  const role = $("tailorRole").value;
  const jobs = state.jobs.filter((j) => j.role === role && inCities(j)).slice(0, 60);
  $("tailorJob").innerHTML = `<option value="">Any ${esc(role)} job (general)</option>`
    + jobs.map((j) => `<option value="${esc(j.id)}">${esc(j.company)} — ${esc(j.title)} (${esc(cityLabel(j))})</option>`).join("");
}
$("tailorRole").addEventListener("change", () => { fillJobs(); $("tailorOut").innerHTML = ""; });
$("tailorJob").addEventListener("change", () => { $("tailorOut").innerHTML = ""; });

// Chip clicks open the skill guide; "View jobs" jumps to Companies filtered to that role.
$("resume").addEventListener("click", (e) => {
  const g = e.target.closest("[data-guide]");
  if (g) return openGuide(g.dataset.guide);
  const v = e.target.closest("[data-viewrole]");
  if (v) {
    $("roleFilter").value = `r:${v.dataset.viewrole}`;
    renderCompanies();
    showTab("companies", true);
  }
});

// ---------- tailoring: free keyword check ----------
function target() {
  const role = $("tailorRole").value;
  const job = state.jobs.find((j) => j.id === $("tailorJob").value) ?? null;
  const profile = roleProfiles().find((r) => r.role === role)?.profile ?? [];
  const wanted = job ? [...detectSkills(`${job.title} ${job.snippet}`)] : profile.map((x) => x.name);
  return { role, job, profile, wanted };
}

$("keywordBtn").addEventListener("click", () => {
  const { role, job, wanted } = target();
  const have = wanted.filter((s) => resume.skills.has(s));
  const missing = wanted.filter((s) => !resume.skills.has(s));
  const pct = wanted.length ? Math.round((have.length / wanted.length) * 100) : 0;
  $("tailorOut").innerHTML = `
    <div class="result">
      <h3>${job ? `${esc(job.company)} — ${esc(job.title)}` : esc(role)}: ${pct}% keyword match</h3>
      ${job && !job.snippet ? `<p class="note">This posting's description wasn't available, so only its title was checked.</p>` : ""}
      ${have.length ? `<p class="lbl">Already in your résumé — make sure these are easy to spot (skills section + project bullets)</p><div class="chips">${have.map((s) => skillChip(s, "have")).join("")}</div>` : ""}
      ${missing.length ? `<p class="lbl">Missing — add only if you genuinely know them, otherwise learn them</p><div class="chips">${missing.map((s) => skillChip(s, "gap")).join("")}</div>` : ""}
      <p class="lbl">Tips</p>
      <ul>
        <li>Use the job's exact words for skills you have (e.g. "REST APIs", not just "APIs") — screening software matches words.</li>
        <li>Put the most relevant project first, and start each bullet with an action verb: built, designed, reduced, automated.</li>
        <li>Add numbers you can honestly back up (users, time saved, accuracy).</li>
        ${job ? `<li>Read the full posting: <a href="${esc(job.url)}" target="_blank" rel="noopener">open job</a>.</li>` : ""}
      </ul>
    </div>`;
});

// ---------- tailoring: AI rewrite with Gemini ----------
$("geminiKey").value = store.get(GEMINI_KEY);
$("saveKeyBtn").addEventListener("click", () => { store.set(GEMINI_KEY, $("geminiKey").value.trim()); $("saveKeyBtn").textContent = "Saved"; setTimeout(() => ($("saveKeyBtn").textContent = "Save"), 1500); });
$("clearKeyBtn").addEventListener("click", () => { store.del(GEMINI_KEY); $("geminiKey").value = ""; });

// Remove email, phone numbers and links before anything leaves the browser.
const stripContacts = (t) => t
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
  .replace(/(\+?\d[\d\s-]{8,}\d)/g, "[phone removed]")
  .replace(/https?:\/\/\S+|www\.\S+|(linkedin|github)\.com\/\S+/gi, "[link removed]");

// Pick the newest "Flash" model this key can use (model names change over time).
async function pickModel(key) {
  let cached = "";
  try { cached = sessionStorage.getItem("jobradar-model") ?? ""; } catch { /* blocked */ }
  if (cached) return cached;
  let model = "models/gemini-2.5-flash";
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (r.ok) {
      const list = ((await r.json()).models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .filter((m) => /flash/i.test(m.name) && !/lite|image|tts|audio|live|embed|exp|thinking/i.test(m.name));
      const ver = (n) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
      list.sort((a, b) => /preview/.test(a.name) - /preview/.test(b.name) || ver(b.name) - ver(a.name));
      if (list[0]) model = list[0].name;
    }
  } catch { /* use the default */ }
  try { sessionStorage.setItem("jobradar-model", model); } catch { /* fine */ }
  return model;
}

function buildPrompt() {
  const { role, job, profile } = target();
  const dept = state.deptOf[role] ?? "";
  return `You are helping a student in India tailor their résumé for a job application.

STRICT RULES
- Use ONLY facts that appear in the résumé. Never invent experience, projects, companies, tools, skills, certifications, degrees, dates or numbers.
- You may reword, reorder, merge and emphasise what is there, and use the job's vocabulary for things the student genuinely has.
- If the role needs something the résumé doesn't show, list it under "Gaps" — do NOT add it to the résumé text.
- Contact details were removed for privacy. Don't add any.
- Keep it to one page worth of content. Plain, confident, specific language. No buzzword filler.

TARGET
Role: ${role}${dept ? ` (${dept})` : ""}
Skills employers in Chennai/Bangalore/Coimbatore most often ask for in this role right now: ${profile.map((x) => `${x.name} (${Math.round(x.share * 100)}%)`).join(", ") || "not available"}
${job ? `Specific job: ${job.title} at ${job.company}, ${job.city}${job.salary ? `, ${lpa(job.salary)}` : ""}
Job description (may be partial):
${(job.snippet || "(not available — use the title and role skills)").slice(0, 1500)}` : "No specific job — tailor for the role in general."}

RÉSUMÉ
${stripContacts(resume.text).slice(0, 8000)}

OUTPUT — use exactly these markdown headings:
## Summary
(2–3 lines aimed at this role)
## Skills
(comma-separated, most relevant first; only skills present in the résumé)
## Experience and projects
(keep the original headings; rewrite bullets as: action verb + what you did + tools + result; keep numbers only if they were in the résumé)
## Keywords to add only if true
(job keywords the résumé lacks that the student might actually have — remind them to add only if true)
## Gaps to work on
(skills/experience the role wants that the résumé doesn't show, most important first)
## What I changed
(3–6 short points)`;
}

// Tiny markdown → HTML for the AI's answer (headings, bullets, bold).
function md(text) {
  const out = [];
  let inList = false;
  for (const raw of esc(text).split("\n")) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    if (bullet) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${bullet[1]}</li>`); continue; }
    if (inList) { out.push("</ul>"); inList = false; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) out.push(`<h3>${h[1]}</h3>`);
    else if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

$("aiBtn").addEventListener("click", async () => {
  const key = ($("geminiKey").value || store.get(GEMINI_KEY)).trim();
  if (!key) {
    $("tailorOut").innerHTML = `<p class="note">Add your free Gemini key in "AI settings" below first. Or use "Check keywords", which works without AI.</p>`;
    document.querySelector(".ai-key").open = true;
    return;
  }
  $("aiBtn").disabled = true;
  $("tailorOut").innerHTML = `<p class="note thinking">Tailoring your résumé… (10–30 seconds)</p>`;
  try {
    const model = await pickModel(key);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: buildPrompt() }] }], generationConfig: { temperature: 0.4 } }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.error?.message ?? `HTTP ${r.status}`;
      throw new Error(r.status === 429 ? "Free limit reached for now. Wait a minute (or until tomorrow) and try again."
        : /api key/i.test(msg) ? "That key didn't work. Check it in AI settings." : msg);
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("The AI returned nothing. Try again.");
    $("tailorOut").innerHTML = `
      <div class="result">
        <div class="row"><button id="copyBtn">Copy text</button><span class="note">Review every line before using it — AI can still make mistakes.</span></div>
        ${md(text)}
      </div>`;
    $("copyBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); $("copyBtn").textContent = "Copied"; } catch { $("copyBtn").textContent = "Copy failed"; }
    });
  } catch (err) {
    $("tailorOut").innerHTML = `<p class="note error">${esc(err.message)}</p>`;
  } finally {
    $("aiBtn").disabled = false;
  }
});

// ---------- restore a saved résumé ----------
(function restore() {
  const saved = store.get(RESUME_KEY);
  if (!saved) return;
  $("resumeText").value = saved;
  // Wait until app.js has loaded the job data, then analyse.
  const wait = setInterval(() => { if (state.jobs.length) { clearInterval(wait); analyse(); } }, 300);
  setTimeout(() => clearInterval(wait), 15000);
})();
