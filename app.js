"use strict";

const STORAGE_KEY = "gapfinder-ai-workspace-v1";
const DEMO_EMAIL = "demo@gapfinder.ai";
const DEMO_PASSWORD = "gapfinder2026";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STORED_TEXT = 2_500_000;

const demoTopics = [
  "Cell Structure",
  "Photosynthesis",
  "Cellular Respiration",
  "Genetics",
  "Ecosystems"
];

const demoMaterials = [
  {
    name: "Biology syllabus.txt",
    kind: "syllabus",
    text: "Biology — Unit 1\nCell Structure\nPhotosynthesis\nCellular Respiration\nGenetics\nEcosystems"
  },
  {
    name: "Biology notes.txt",
    kind: "notes",
    text: [
      "Chapter 1 · Cell Structure\nThe cell membrane is a selectively permeable barrier made mainly of a phospholipid bilayer. It controls which substances enter and leave the cell. The nucleus contains DNA and directs many of the cell's activities. Mitochondria are the main site of aerobic cellular respiration.",
      "Chapter 2 · Photosynthesis\nPhotosynthesis converts light energy into chemical energy stored in glucose. In the light-dependent reactions, chlorophyll absorbs photons in the thylakoid membranes. Water molecules split, releasing oxygen and providing electrons and hydrogen ions. The Calvin cycle uses carbon dioxide and ATP to build sugar in the stroma.",
      "Chapter 3 · Cellular Respiration\nCellular respiration releases usable energy from glucose. Glycolysis takes place in the cytoplasm and splits one glucose molecule into two pyruvate molecules. When oxygen is available, aerobic respiration continues in the mitochondria and produces much more ATP than glycolysis alone.",
      "Chapter 4 · Genetics\nA gene is a stretch of DNA that carries information for a functional product. Different versions of a gene are called alleles. During meiosis, allele pairs separate so each gamete receives one allele for each gene. A dominant allele can affect the phenotype when only one copy is present.",
      "Chapter 5 · Ecosystems\nAn ecosystem includes a community of organisms and the non-living environment with which they interact. Producers capture energy, usually from sunlight, and transfer some of it through food chains. Decomposers break down dead material and return nutrients to the environment."
    ].join("\n\n")
  },
  {
    name: "Biology past paper.txt",
    kind: "paper",
    text: "Section A — Sample past-paper questions\n1. Describe how the cell membrane controls movement into a cell.\n2. Explain the role of chlorophyll in photosynthesis.\n3. Where does glycolysis take place, and what does it produce?\n4. Explain how alleles are separated during meiosis.\n5. Describe how energy moves from producers through an ecosystem."
  }
];

const stopWords = new Set(("a an and are as at be been being by can could did do does for from had has have how i in into is it its may more most of on or our should that the their them then there these this to was were what when where which who why will with your you").split(" "));
const pageNames = {
  dashboard: "Overview",
  materials: "My materials",
  diagnostic: "Take a diagnostic",
  gaps: "Gap report",
  plan: "Revision plan",
  tutor: "Ask your material"
};
let state = null;
let currentPage = "dashboard";
let quizSession = null;
let toastTimer = 0;
let pdfScriptPromise = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function freshState() {
  return {
    version: 1,
    profile: { name: "Sravan", email: DEMO_EMAIL },
    materials: demoMaterials.map((material) => ({ ...material, demo: true })),
    attempts: [{
      id: "sample-baseline",
      date: new Date(Date.now() - 2 * 86400000).toISOString(),
      sample: true,
      total: 5,
      correct: 2,
      scores: {
        "Cell Structure": 75,
        Photosynthesis: 25,
        "Cellular Respiration": 50,
        Genetics: 25,
        Ecosystems: 75
      },
      details: []
    }],
    preferences: { days: 5, hours: 2 }
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return freshState();
    const parsed = JSON.parse(saved);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.materials) || !Array.isArray(parsed.attempts)) {
      throw new Error("Saved workspace has an unsupported format.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      localStorage.removeItem(STORAGE_KEY);
      return freshState();
    }
    throw error;
  }
}

function saveState() {
  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_STORED_TEXT + 500_000) {
      throw new Error("This workspace is too large to save. Remove a large file and try again.");
    }
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    showToast(error.name === "QuotaExceededError" ? "Browser storage is full. Remove a large material and try again." : error.message, true);
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizeText(value).split(" ").filter((word) => word.length > 2 && !stopWords.has(word));
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3600);
}

function getTopicNames() {
  const syllabus = state.materials.find((material) => material.kind === "syllabus");
  if (!syllabus) return demoTopics.slice();
  const candidates = syllabus.text.split(/\r?\n/).map((line) => line.replace(/^[\s#>*\-•\d.)]+/, "").trim()).filter(Boolean);
  const topics = candidates.filter((line) => {
    if (/^(syllabus|course|subject|unit\s+\d+|chapter\s+\d+|biology|contents?)\b/i.test(line)) return false;
    return tokenize(line).length > 0;
  }).slice(0, 40);
  return topics.length ? Array.from(new Set(topics)) : demoTopics.slice();
}

function materialChunks() {
  return state.materials.flatMap((material) => {
    const sections = material.text.split(/\r?\n\s*\r?\n/).map((block) => block.trim()).filter(Boolean);
    let activeSection = material.kind === "paper" ? "Past-paper questions" : "Uploaded text";
    const blocks = sections.length ? sections : [material.text];
    return blocks.map((block, index) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return null;
      let text = lines.join(" ");
      const heading = lines[0].match(/^(#{1,6}\s*)?((?:chapter|unit|section|topic)\s*[\d.:-]*[^.]{0,80}|[^.]{2,55})$/i);
      if (heading && (lines.length > 1 || /^(#{1,6}|chapter|unit|section|topic)\b/i.test(lines[0]))) {
        activeSection = lines[0].replace(/^#{1,6}\s*/, "");
        text = lines.slice(1).join(" ");
      }
      if (!text) text = block;
      const pageMatch = text.match(/\[Page\s+(\d+)\]/i);
      if (pageMatch) {
        activeSection = `Page ${pageMatch[1]}`;
        text = text.replace(pageMatch[0], "").trim();
      }
      return {
        materialName: material.name,
        kind: material.kind,
        section: activeSection || `Section ${index + 1}`,
        text: text.slice(0, 12_000)
      };
    }).filter((chunk) => chunk && chunk.text.length > 15);
  });
}

function scoreChunk(chunk, query) {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (!queryTerms.length) return 0;
  const content = ` ${normalizeText(chunk.text)} `;
  const sectionTerms = new Set(tokenize(chunk.section));
  let score = 0;
  for (const term of queryTerms) {
    if (content.includes(` ${term} `)) score += 1 + Math.min((content.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, "g")) || []).length - 1, 2) * 0.18;
    if (sectionTerms.has(term)) score += 1.7;
  }
  if (chunk.kind === "notes") score += 0.55;
  if (chunk.kind === "paper") score += 0.25;
  return score / Math.sqrt(queryTerms.length);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function retrieve(query, count = 3) {
  return materialChunks().map((chunk) => ({ chunk, score: scoreChunk(chunk, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.chunk);
}

function allTopicScores() {
  const topics = getTopicNames();
  const latest = new Map();
  for (const attempt of state.attempts) {
    for (const topic of topics) {
      if (typeof attempt.scores?.[topic] === "number") latest.set(topic, attempt.scores[topic]);
    }
  }
  return topics.map((topic) => ({ topic, score: latest.has(topic) ? latest.get(topic) : null }));
}

function statusForScore(score) {
  if (score === null || score === undefined) return { label: "Not assessed", key: "unassessed" };
  if (score < 50) return { label: "Needs focus", key: "weak" };
  if (score < 80) return { label: "Building", key: "medium" };
  return { label: "Strong", key: "strong" };
}

function examFrequency(topic) {
  const papers = state.materials.filter((material) => material.kind === "paper");
  if (!papers.length) return 0;
  const terms = tokenize(topic);
  let count = 0;
  for (const paper of papers) {
    const lines = paper.text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const lineWords = new Set(tokenize(line));
      const matches = terms.filter((term) => lineWords.has(term)).length;
      if (matches && matches / terms.length >= 0.5) count += 1;
    }
  }
  return count;
}

function formattedDate(value, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function citationFor(chunk) {
  return `${chunk.materialName} · ${chunk.section}`;
}

function renderDashboard() {
  const topics = allTopicScores();
  const assessed = topics.filter((item) => item.score !== null);
  const weakCount = assessed.filter((item) => item.score < 50).length;
  const latestAttempt = state.attempts.at(-1);
  const average = assessed.length ? Math.round(assessed.reduce((sum, item) => sum + item.score, 0) / assessed.length) : 0;
  const topicRows = topics.length ? topics.slice(0, 6).map((item) => {
    const status = statusForScore(item.score);
    return `<div class="topic-row"><span class="topic-name" title="${escapeHtml(item.topic)}">${escapeHtml(item.topic)}</span><div class="bar-track"><div class="bar-fill ${status.key}" style="width:${item.score ?? 0}%"></div></div><span class="topic-pct">${item.score === null ? "—" : `${item.score}%`}</span></div>`;
  }).join("") : `<div class="empty-state">Add a syllabus to see your topic map.</div>`;
  const activity = state.attempts.slice(-3).reverse().map((attempt) => `<div class="activity-item"><span class="activity-marker">${attempt.sample ? "✦" : "✓"}</span><span class="activity-copy"><strong>${attempt.sample ? "Sample baseline" : "Diagnostic completed"}</strong><small>${formattedDate(attempt.date, { month: "short", day: "numeric", year: "numeric" })} · ${attempt.correct}/${attempt.total} correct</small></span></div>`).join("");
  const recentAttempts = state.attempts.slice(-5);
  const progressRows = recentAttempts.map((attempt) => {
    const attemptIndex = state.attempts.indexOf(attempt);
    const ownAttemptNumber = state.attempts.slice(0, attemptIndex + 1).filter((entry) => !entry.sample).length;
    const percentage = attempt.total ? Math.round((attempt.correct / attempt.total) * 100) : 0;
    return `<div class="progress-entry"><span class="progress-label">${attempt.sample ? "Sample baseline" : `Attempt ${ownAttemptNumber}`}</span><div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div><span class="progress-percent">${percentage}%</span><small>${formattedDate(attempt.date, { month: "short", day: "numeric" })} · ${attempt.correct}/${attempt.total}</small></div>`;
  }).join("");
  $("#page-dashboard").innerHTML = `
    <section class="hero-card">
      <div class="hero-copy"><p class="eyebrow-muted">YOUR STUDY SNAPSHOT</p><h1>Good to see you, ${escapeHtml(state.profile.name)} <span>✳</span></h1><p>${weakCount ? `You have ${weakCount} topic${weakCount === 1 ? "" : "s"} to strengthen. Let's turn your next study session into progress.` : "Your next study session can make a difference. Take a quick diagnostic to discover where to focus."}</p><button class="button button-primary button-small" data-page="diagnostic">Start a diagnostic <span aria-hidden="true">→</span></button></div>
      <div class="hero-art" aria-hidden="true"><span>✳</span></div>
    </section>
    <div class="stat-grid">
      <article class="stat-card"><div class="stat-top"><span>Topics mapped</span><span class="stat-icon">◈</span></div><strong class="stat-value">${topics.length}<span class="stat-note">from your syllabus</span></strong></article>
      <article class="stat-card"><div class="stat-top"><span>Current mastery</span><span class="stat-icon">◉</span></div><strong class="stat-value">${assessed.length ? `${average}%` : "—"}<span class="stat-note">${assessed.length ? "across assessed topics" : "take a diagnostic"}</span></strong></article>
      <article class="stat-card"><div class="stat-top"><span>Needs focus</span><span class="stat-icon">↗</span></div><strong class="stat-value">${weakCount}<span class="stat-note">topics to revisit</span></strong></article>
      <article class="stat-card"><div class="stat-top"><span>Diagnostics</span><span class="stat-icon">✓</span></div><strong class="stat-value">${state.attempts.filter((attempt) => !attempt.sample).length}<span class="stat-note">completed by you</span></strong></article>
    </div>
    <div class="dashboard-grid">
      <article class="card"><div class="card-head"><div><h2>Your topic map</h2><p>Latest mastery by syllabus topic</p></div><button class="text-link" data-page="gaps">View gap report →</button></div><div class="card-body">${topicRows}</div></article>
      <article class="card"><div class="card-head"><div><h2>Recent activity</h2><p>${latestAttempt ? `Last studied ${formattedDate(latestAttempt.date)}` : "Your attempts will show up here"}</p></div></div><div class="card-body">${activity ? `<div class="activity-list">${activity}</div>` : `<div class="empty-state"><div class="empty-icon">◉</div>Complete your first diagnostic to start tracking progress.</div>`}</div></article>
    </div>
    <article class="card progress-card"><div class="card-head"><div><h2>Progress across attempts</h2><p>Overall diagnostic score · latest five attempts</p></div></div><div class="card-body"><div class="progress-history">${progressRows}</div></div></article>
    <section class="workflow-card"><p class="workflow-title">YOUR LEARNING LOOP</p><div class="workflow-steps"><span class="workflow-step"><span class="step-num">1</span>Add your material</span><span class="workflow-step"><span class="step-num">2</span>Take a diagnostic</span><span class="workflow-step"><span class="step-num">3</span>Find your gaps</span><span class="workflow-step"><span class="step-num">4</span>Follow your plan</span><span class="workflow-step"><span class="step-num">5</span>Retest &amp; improve</span></div></section>`;
}

function renderMaterials() {
  const materials = state.materials;
  const list = materials.length ? materials.map((material, index) => {
    const badge = material.kind === "syllabus" ? "syllabus" : material.kind === "paper" ? "paper" : "";
    const kindLabel = material.kind === "paper" ? "Past paper" : material.kind === "syllabus" ? "Syllabus" : "Notes & chapters";
    return `<div class="material-item"><span class="file-badge ${badge}">${material.name.toLowerCase().endsWith(".pdf") ? "PDF" : "TXT"}</span><span class="material-info"><strong title="${escapeHtml(material.name)}">${escapeHtml(material.name)}</strong><small>${kindLabel} · ${material.text.length.toLocaleString()} characters · stored on this device</small></span><button class="remove-material" data-remove-material="${index}" aria-label="Remove ${escapeHtml(material.name)}" title="Remove material">×</button></div>`;
  }).join("") : `<div class="empty-state">No materials yet. Upload a syllabus and notes to begin.</div>`;
  $("#page-materials").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow-muted">YOUR SOURCE LIBRARY</p><h1>Bring your material together.</h1><p>Upload a syllabus, your notes, and past papers. GapFinder uses them as the only source for its quiz and explanations.</p></div></div>
    <div class="upload-grid">
      <article class="card"><div class="card-head"><div><h2>Add study material</h2><p>PDF or plain text · processed locally in your browser</p></div></div><div class="card-body">
        <div class="upload-drop"><span class="upload-icon">↑</span><strong>Choose a file to add to your library</strong><p>PDF, TXT, MD, or CSV · up to 5 MB per file</p><div class="upload-actions"><select id="upload-kind" class="upload-category" aria-label="Material type"><option value="notes">Notes / chapter</option><option value="syllabus">Syllabus</option><option value="paper">Past paper</option></select><label class="button button-primary button-small" for="file-input">Browse files</label><input id="file-input" type="file" accept=".pdf,.txt,.md,.csv,.text,application/pdf,text/plain,text/markdown,text/csv" multiple hidden></div></div>
        <p class="material-note">The first material you add replaces the sample set, so your diagnosis stays grounded in your sources. PDF text is extracted in this browser using PDF.js. Scanned/image-only pages need OCR and are not supported.</p>
      </div></article>
      <article class="card"><div class="card-head"><div><h2>Or paste text</h2><p>Quickly add a syllabus outline or excerpt</p></div></div><div class="card-body"><form id="paste-form" class="paste-form"><div class="paste-controls"><label>Material type<select id="paste-kind" class="field-input"><option value="syllabus">Syllabus</option><option value="notes">Notes / chapter</option><option value="paper">Past paper</option></select></label><label>Source name<input id="paste-name" class="field-input" type="text" value="Pasted study material" maxlength="100" required></label></div><label for="paste-text">Text to add</label><textarea id="paste-text" placeholder="Paste your syllabus topics, notes, or exam questions here..." required></textarea><button class="button button-light button-small" type="submit">Add to materials <span aria-hidden="true">→</span></button></form></div></article>
    </div>
    <div class="upload-grid materials-full">
      <article class="card"><div class="card-head"><div><h2>Your library <span class="nav-count">${materials.length}</span></h2><p>Only material uploaded to this workspace can be retrieved</p></div></div><div class="card-body"><div class="material-list">${list}</div></div></article>
      <article class="card"><div class="card-head"><div><h2>How your material powers the app</h2><p>Retrieval and generation are kept separate</p></div></div><div class="card-body"><div class="how-rag">
        <div class="rag-step"><span class="rag-number">1</span><div><strong>Retrieve relevant passages</strong><p>Topic keywords rank passages in your notes and papers before a question or explanation is shown.</p></div></div>
        <div class="rag-step"><span class="rag-number">2</span><div><strong>Generate from retrieved text</strong><p>Quiz prompts are made by blanking a key term from a retrieved source sentence — no outside facts are added.</p></div></div>
        <div class="rag-step"><span class="rag-number">3</span><div><strong>Evaluate against the source</strong><p>Your response is checked against the omitted term, then explained with the original passage and citation.</p></div></div>
      </div><div class="material-note">This prototype uses an explainable, on-device retrieval and text-generation pipeline. It does not call a hosted LLM or send your files to a service.</div></div></article>
    </div>`;
}

function chooseAnswerTerm(sentence, topic) {
  const topicPhrase = normalizeText(topic);
  const sentenceNormalized = normalizeText(sentence);
  if (topicPhrase.length >= 4 && sentenceNormalized.includes(topicPhrase)) {
    const match = sentence.match(new RegExp(escapeRegExp(topicPhrase).replace(/\s+/g, "\\s+"), "i"));
    if (match) return match[0];
  }
  const topicTerms = new Set(tokenize(topic));
  const words = sentence.match(/\b[A-Za-z][A-Za-z-]{4,}\b/g) || [];
  const frequency = new Map();
  words.forEach((word) => {
    const normalized = normalizeText(word);
    if (stopWords.has(normalized) || topicTerms.has(normalized)) return;
    frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
  });
  const candidate = words.find((word) => {
    const normalized = normalizeText(word);
    return !stopWords.has(normalized) && !topicTerms.has(normalized) && frequency.get(normalized) === Math.max(...frequency.values());
  });
  return candidate || words[0] || topic;
}

function buildQuestion(topic, index) {
  const results = retrieve(topic, 8);
  if (!results.length) return null;
  const sources = results.filter((chunk) => chunk.kind !== "syllabus");
  const pool = sources.length ? sources : results;
  const chunk = pool[index % pool.length];
  const sentences = chunk.text.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 45) || [chunk.text];
  const sentence = sentences[index % sentences.length].slice(0, 380);
  const answer = chooseAnswerTerm(sentence, topic);
  const escapedAnswer = escapeRegExp(answer);
  const blanked = sentence.replace(new RegExp(`\\b${escapedAnswer}\\b`, "i"), "________");
  if (blanked === sentence) return null;
  return { topic, sentence, answer, prompt: `Complete the source-grounded statement: “${blanked}”`, citation: citationFor(chunk), chunk };
}

function renderDiagnostic() {
  const topics = getTopicNames();
  const available = topics.filter((topic) => retrieve(topic, 1).length > 0);
  const assessed = allTopicScores().filter((item) => item.score !== null);
  const weak = assessed.filter((item) => item.score < 50).map((item) => item.topic);
  const suggestion = weak.length ? `Your recent results suggest revisiting ${weak.slice(0, 2).join(" and ")} first.` : "A short check-in helps build your first topic-level diagnosis.";
  $("#page-diagnostic").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow-muted">A QUICK CHECK-IN</p><h1>Let's find what needs attention.</h1><p>Questions are generated from retrieved passages in your materials. Every prompt includes a source citation.</p></div></div>
    <div class="quiz-layout"><article id="quiz-panel" class="card quiz-card">
      ${available.length ? `<div class="quiz-progress"><span>READY WHEN YOU ARE</span><span>${Math.min(available.length, 8)} questions · about ${Math.max(2, Math.ceil(Math.min(available.length, 8) * 0.7))} min</span></div><div class="quiz-progress-track"><div class="quiz-progress-fill" style="width:0%"></div></div><div class="empty-state"><div class="empty-icon">◉</div><strong style="display:block;color:#46534c;margin-bottom:5px">Your diagnostic is ready</strong>We'll test ${Math.min(available.length, 8)} of ${topics.length} syllabus topics using your uploaded notes.<br><br><button class="button button-primary button-small" data-start-quiz>Start diagnostic <span aria-hidden="true">→</span></button></div>` : `<div class="empty-state"><div class="empty-icon">▤</div><strong style="display:block;color:#46534c;margin-bottom:5px">Add notes to create your quiz</strong>Upload a syllabus and notes with relevant topic content. Questions are generated only when a source passage can be retrieved.<br><br><button class="button button-light button-small" data-page="materials">Go to my materials →</button></div>`}
    </article><aside class="card quiz-side"><h3>Why this diagnostic?</h3><p>${escapeHtml(suggestion)} The goal is to spot gaps, not to judge your overall ability.</p><span class="side-citation">Every quiz item is linked to a source excerpt so you can check the evidence behind it.</span><p style="margin-top:12px">After you submit, your gap report and revision plan update automatically.</p></aside></div>`;
}

function startQuiz() {
  const topics = getTopicNames();
  const scores = new Map(allTopicScores().map((item) => [item.topic, item.score]));
  const ordered = topics.slice().sort((a, b) => {
    const aScore = scores.get(a);
    const bScore = scores.get(b);
    return (aScore === null || aScore === undefined ? -1 : aScore) - (bScore === null || bScore === undefined ? -1 : bScore);
  });
  const questions = [];
  for (const topic of ordered) {
    const question = buildQuestion(topic, questions.length);
    if (question) questions.push(question);
    if (questions.length >= 8) break;
  }
  if (!questions.length) {
    showToast("No source passages could be retrieved. Add notes for a syllabus topic first.", true);
    return;
  }
  quizSession = { questions, index: 0, answers: [], checked: false, results: [] };
  renderCurrentQuestion();
}

function renderCurrentQuestion() {
  const panel = $("#quiz-panel");
  if (!quizSession || !panel) return;
  const { questions, index, checked, results } = quizSession;
  if (index >= questions.length) {
    renderQuizCompletion();
    return;
  }
  const item = questions[index];
  const progress = Math.round(((index + (checked ? 1 : 0)) / questions.length) * 100);
  const answerValue = quizSession.answers[index] || "";
  let feedback = "";
  if (checked) {
    const result = results[index];
    feedback = `<div class="feedback ${result.correct ? "correct" : "incorrect"}"><strong>${result.correct ? "That's right — nice work." : "Not quite. Here's the evidence."}</strong>${escapeHtml(result.explanation)}<br><span class="citation" style="margin:8px 0 0">${escapeHtml(item.citation)}</span></div>`;
  }
  panel.innerHTML = `
    <div class="quiz-progress"><span>QUESTION ${index + 1} OF ${questions.length}</span><span>${Math.round((index / questions.length) * 100)}% complete</span></div>
    <div class="quiz-progress-track"><div class="quiz-progress-fill" style="width:${progress}%"></div></div>
    <p class="quiz-topic">${escapeHtml(item.topic)}</p><h2 class="quiz-question">${escapeHtml(item.prompt)}</h2>
    <span class="citation">⌁ ${escapeHtml(item.citation)}</span>
    <label class="eyebrow-muted" for="quiz-answer">YOUR ANSWER</label>
    <textarea id="quiz-answer" class="answer-box" placeholder="Type the missing idea or term..." ${checked ? "disabled" : ""}>${escapeHtml(answerValue)}</textarea>
    ${feedback}<div class="quiz-bottom"><span class="quiz-hint">Short answer · use your own words</span>${checked ? `<button class="button button-primary button-small" data-next-question>${index === questions.length - 1 ? "See my results" : "Next question"} <span aria-hidden="true">→</span></button>` : `<button class="button button-primary button-small" data-check-answer>Check answer <span aria-hidden="true">→</span></button>`}</div>`;
}

function evaluateAnswer(response, answer) {
  const normalizedResponse = normalizeText(response);
  const normalizedAnswer = normalizeText(answer);
  const responseTerms = new Set(tokenize(response));
  const expectedTerms = tokenize(answer);
  const exact = normalizedResponse === normalizedAnswer || new RegExp(`\\b${escapeRegExp(normalizedAnswer)}\\b`).test(normalizedResponse);
  const overlap = expectedTerms.length ? expectedTerms.filter((term) => responseTerms.has(term)).length / expectedTerms.length : 0;
  return exact || overlap >= 0.75;
}

function checkCurrentAnswer() {
  const response = $("#quiz-answer").value.trim();
  if (!response) {
    showToast("Write an answer before checking it.", true);
    $("#quiz-answer").focus();
    return;
  }
  const item = quizSession.questions[quizSession.index];
  const correct = evaluateAnswer(response, item.answer);
  const explanation = correct
    ? `Your answer matches the key idea. In this material: “${item.sentence}”`
    : `The missing term is “${item.answer}”. Your notes explain: “${item.sentence}”`;
  quizSession.answers[quizSession.index] = response;
  quizSession.results[quizSession.index] = { correct, explanation };
  quizSession.checked = true;
  renderCurrentQuestion();
}

function renderQuizCompletion() {
  const panel = $("#quiz-panel");
  const correct = quizSession.results.filter((result) => result.correct).length;
  const total = quizSession.questions.length;
  const detail = quizSession.questions.map((question, index) => {
    const result = quizSession.results[index];
    return `<div class="result-row"><span class="result-icon ${result.correct ? "" : "wrong"}">${result.correct ? "✓" : "×"}</span><span><strong>${escapeHtml(question.topic)}</strong><p>${escapeHtml(result.correct ? "Correct — " : `Review “${question.answer}” — `)}${escapeHtml(question.citation)}</p></span><span class="result-score">${result.correct ? "1/1" : "0/1"}</span></div>`;
  }).join("");
  panel.innerHTML = `<p class="eyebrow-muted">DIAGNOSTIC COMPLETE</p><h2 class="quiz-question">${correct === total ? "Excellent work." : "A useful first step."}</h2><p style="color:#87929a;font-size:10px;line-height:1.6">You got <strong style="color:#34423a">${correct} of ${total}</strong> questions right. Your topic-level diagnosis is ready, and your revision plan will update from these results.</p><div class="quiz-results">${detail}</div><div class="quiz-bottom"><span class="quiz-hint">Your answers are saved only in this browser.</span><button class="button button-primary button-small" data-save-diagnosis>Save diagnosis <span aria-hidden="true">→</span></button></div>`;
}

function saveDiagnosis() {
  const scoreByTopic = {};
  const detailByTopic = {};
  quizSession.questions.forEach((question, index) => {
    const result = quizSession.results[index];
    scoreByTopic[question.topic] = result.correct ? 100 : 0;
    detailByTopic[question.topic] = {
      correct: result.correct,
      answer: quizSession.answers[index],
      expected: question.answer,
      citation: question.citation,
      explanation: result.explanation
    };
  });
  const correct = quizSession.results.filter((result) => result.correct).length;
  state.attempts.push({
    id: `attempt-${Date.now()}`,
    date: new Date().toISOString(),
    sample: false,
    total: quizSession.questions.length,
    correct,
    scores: scoreByTopic,
    details: detailByTopic
  });
  if (!saveState()) return;
  quizSession = null;
  renderAll();
  showPage("gaps");
  showToast("Your diagnosis and revision plan have been updated.");
}

function topicReason(item) {
  const attempt = [...state.attempts].reverse().find((entry) => typeof entry.scores?.[item.topic] === "number");
  const detail = attempt?.details?.[item.topic];
  if (!attempt) return "Not yet assessed — take a diagnostic to see how this topic is going.";
  const frequency = examFrequency(item.topic);
  const examNote = frequency ? `This topic appeared in ${frequency} past-paper question${frequency === 1 ? "" : "s"} in your uploaded papers.` : "No matching question was found in the uploaded past papers.";
  if (attempt.sample && !detail) return `Sample baseline: ${item.score}% mastery. Retake a diagnostic for a score based on your own answers. ${examNote}`;
  if (!detail) return `${attempt.correct}/${attempt.total} answers correct in the latest attempt. ${examNote}`;
  return `${detail.correct ? "Correctly identified" : `Missed “${detail.expected}”`} in your latest answer. ${examNote}`;
}

function renderGaps() {
  const topics = allTopicScores();
  const assessed = topics.filter((item) => item.score !== null);
  const counts = {
    weak: assessed.filter((item) => item.score < 50).length,
    medium: assessed.filter((item) => item.score >= 50 && item.score < 80).length,
    strong: assessed.filter((item) => item.score >= 80).length
  };
  const rows = topics.slice().sort((a, b) => (a.score ?? -1) - (b.score ?? -1)).map((item) => {
    const status = statusForScore(item.score);
    const frequency = examFrequency(item.topic);
    return `<article class="gap-row"><div class="gap-row-main"><strong>${escapeHtml(item.topic)}</strong><small>${item.score === null ? "No quiz result yet" : `${item.score}% mastery`}</small></div><div class="bar-track"><div class="bar-fill ${status.key}" style="width:${item.score ?? 0}%"></div></div><span class="status-pill status-${status.key}">${status.label}</span><div class="gap-explanation">${escapeHtml(topicReason(item))} <span class="gap-source">${frequency ? ` · ${frequency} exam signal${frequency === 1 ? "" : "s"}` : ""}</span></div></article>`;
  }).join("");
  $("#page-gaps").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow-muted">THE DIAGNOSIS</p><h1>Your gaps, made visible.</h1><p>Topic status uses your latest quiz result. The sample baseline is clearly marked until you complete your own diagnostic.</p></div><button class="button button-primary button-small" data-page="diagnostic">Retake diagnostic →</button></div>
    <div class="gap-summary"><div class="gap-stat weak"><strong>${counts.weak}</strong><span>Needs focus · below 50%</span></div><div class="gap-stat medium"><strong>${counts.medium}</strong><span>Building · 50–79%</span></div><div class="gap-stat strong"><strong>${counts.strong}</strong><span>Strong · 80% and above</span></div></div>
    <article class="card"><div class="card-head"><div><h2>Topic-by-topic report</h2><p>${assessed.length} of ${topics.length} topics assessed · latest attempt per topic</p></div><button class="text-link" data-page="plan">Open revision plan →</button></div><div class="card-body"><div class="gap-list">${rows || `<div class="empty-state">Add a syllabus to create your topic report.</div>`}</div></div></article>`;
}

function renderPlan() {
  const prefs = state.preferences;
  const days = Math.max(1, Math.min(60, Number(prefs.days) || 1));
  const hours = Math.max(0.25, Math.min(12, Number(prefs.hours) || 0.25));
  const totalMinutes = Math.round(days * hours * 60);
  const topics = allTopicScores().map((item) => {
    const score = item.score ?? 0;
    const frequency = examFrequency(item.topic);
    const priority = (100 - score) + Math.min(frequency, 6) * 8 + (item.score === null ? 10 : 0);
    return { ...item, frequency, priority, status: statusForScore(item.score) };
  }).sort((a, b) => b.priority - a.priority);
  const weightedTotal = topics.reduce((sum, item) => sum + item.priority, 0) || 1;
  let remaining = totalMinutes;
  const plans = topics.map((item, index) => {
    let minutes = Math.round(totalMinutes * item.priority / weightedTotal / 15) * 15;
    if (index === topics.length - 1) minutes = Math.max(0, remaining);
    else minutes = Math.min(remaining, Math.max(15, minutes));
    remaining -= minutes;
    const sources = retrieve(item.topic, 1);
    const action = item.score === null ? "Take a diagnostic and mark the key terms in your notes." : item.score < 50 ? "Review the cited notes, then retry a short question without looking." : item.score < 80 ? "Revisit the missed idea and explain it in your own words." : "Do a quick spaced-recall check to keep this topic fresh.";
    return `<article class="plan-item"><span class="plan-number">${index + 1}</span><div><h3>${escapeHtml(item.topic)} <span class="status-pill status-${item.status.key}">${item.status.label}</span></h3><p>${escapeHtml(action)}${sources.length ? ` Start with ${escapeHtml(citationFor(sources[0]))}.` : ""}</p><small class="plan-priority">${item.frequency ? `Exam signal: ${item.frequency} matching question${item.frequency === 1 ? "" : "s"} · ` : ""}Priority score ${item.priority}</small></div><span class="plan-time">${minutes} min</span></article>`;
  }).join("");
  $("#page-plan").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow-muted">YOUR NEXT STEPS</p><h1>A plan that fits your time.</h1><p>Weak topics and topics appearing in your past papers get more of your revision time. New quiz results reorder the plan.</p></div></div>
    <div class="plan-controls"><label>Study days<input id="plan-days" type="number" min="1" max="60" value="${days}"></label><label>Hours per day<input id="plan-hours" type="number" min="0.25" max="12" step="0.25" value="${hours}"></label><span class="plan-total">Total study time <strong>${formatMinutes(totalMinutes)}</strong></span></div>
    <div class="plan-list">${plans || `<div class="empty-state">Add syllabus topics to build your revision plan.</div>`}</div>`;
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours} hr${hours === 1 ? "" : "s"}` : ""}${hours && remainder ? " " : ""}${remainder ? `${remainder} min` : ""}` || "0 min";
}

function renderTutor() {
  const topics = getTopicNames();
  const selectedTopic = topics[0] || "";
  const options = topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("");
  $("#page-tutor").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow-muted">EXPLAINED FROM YOUR SOURCES</p><h1>Ask your material.</h1><p>Pick a topic to retrieve its most relevant source passages. Answers only use those excerpts — not general internet knowledge.</p></div></div>
    <div class="tutor-layout"><article class="card tutor-card"><div class="tutor-intro"><strong>Explain this topic</strong><p>Choose a syllabus topic. GapFinder retrieves matching notes and returns the cited material verbatim.</p></div><form id="tutor-form" class="tutor-form"><select id="tutor-topic" aria-label="Topic">${options}</select><button class="button button-primary button-small" type="submit">Retrieve sources →</button></form><div id="tutor-answer" class="tutor-answer"></div></article><aside class="card tutor-side"><h3>Grounded, not guessed</h3><p>The app first ranks source passages by overlap with the selected topic. This page presents the retrieved text with its origin, rather than filling gaps with unsupported facts.</p><div class="source-guard">If your uploaded materials don't contain a relevant passage, GapFinder will say so instead of inventing an answer.</div></aside></div>`;
}

function explainTopic(topic) {
  const passages = retrieve(topic, 3);
  const target = $("#tutor-answer");
  if (!passages.length) {
    target.innerHTML = `<div class="empty-state">No matching source passage found for <strong>${escapeHtml(topic)}</strong>. Add a relevant chapter or note before asking for an explanation.</div>`;
    return;
  }
  target.innerHTML = `<div class="answer-source"><span class="source-label">Retrieved from your uploaded material · ${passages.length} source${passages.length === 1 ? "" : "s"}</span>${passages.map((chunk) => `<p>${escapeHtml(chunk.text)}<br><span class="citation" style="margin:7px 0 0">${escapeHtml(citationFor(chunk))}</span></p>`).join("")}</div>`;
}

function renderAll() {
  renderDashboard();
  renderMaterials();
  renderDiagnostic();
  renderGaps();
  renderPlan();
  renderTutor();
  $("#material-count").textContent = String(state.materials.length);
  $("#today-label").textContent = formattedDate(new Date(), { weekday: "short", month: "short", day: "numeric" });
}

function showPage(name) {
  if (!pageNames[name]) return;
  currentPage = name;
  $$(".page-section").forEach((section) => { section.hidden = section.id !== `page-${name}`; });
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.page === name));
  $("#page-title").textContent = pageNames[name];
  if (name === "diagnostic" && quizSession) renderCurrentQuestion();
}

function login(event) {
  event.preventDefault();
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
    $("#login-error").textContent = "Those demo credentials don't match. Use the details shown below.";
    return;
  }
  try {
    state = loadState();
  } catch (error) {
    $("#login-error").textContent = `Couldn't load this workspace: ${error.message}`;
    return;
  }
  $("#login-screen").hidden = true;
  $("#app-shell").hidden = false;
  renderAll();
  showPage(currentPage);
}

function logout() {
  state = null;
  quizSession = null;
  $("#app-shell").hidden = true;
  $("#login-screen").hidden = false;
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (!pdfScriptPromise) {
    pdfScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        if (!window.pdfjsLib) {
          reject(new Error("PDF.js loaded without its API."));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error("Could not load the PDF text reader. Check your internet connection, then try again."));
      document.head.appendChild(script);
    }).catch((error) => {
      pdfScriptPromise = null;
      throw error;
    });
  }
  return pdfScriptPromise;
}

async function readFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than the 5 MB limit.`);
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "pdf" || file.type === "application/pdf") {
    const pdfjs = await loadPdfJs();
    const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).filter(Boolean).join(" ").trim();
      if (text) pages.push(`[Page ${number}]\n${text}`);
    }
    if (!pages.length) throw new Error(`${file.name} has no selectable text. Scanned PDFs need OCR and are not supported.`);
    return pages.join("\n\n");
  }
  if (["txt", "md", "csv", "text"].includes(extension) || file.type.startsWith("text/")) {
    return file.text();
  }
  throw new Error(`${file.name} isn't a supported PDF or text file.`);
}

function saveMaterial(name, kind, text) {
  const cleanText = text.trim();
  if (!cleanText) throw new Error(`${name} doesn't contain readable text.`);
  const previousMaterials = state.materials;
  state.materials = state.materials.filter((material) => !material.demo);
  const existingTextSize = state.materials.reduce((sum, material) => sum + material.text.length, 0);
  if (existingTextSize + cleanText.length > MAX_STORED_TEXT) {
    state.materials = previousMaterials;
    throw new Error("The workspace has reached its 2.5 MB text limit. Remove an existing material first.");
  }
  state.materials.push({ name, kind, text: cleanText });
  if (!saveState()) {
    state.materials = previousMaterials;
    return false;
  }
  return true;
}

async function handleFileUpload(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  const kind = $("#upload-kind").value;
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    try {
      const text = await readFile(file);
      if (saveMaterial(file.name, kind, text)) added += 1;
    } catch (error) {
      showToast(error.message, true);
    }
  }
  input.value = "";
  renderAll();
  if (added) showToast(`${added} material${added === 1 ? "" : "s"} added. Your topic map and retrieval index are ready.`);
}

function handlePaste(event) {
  event.preventDefault();
  const text = $("#paste-text").value;
  const name = $("#paste-name").value.trim() || "Pasted material";
  try {
    if (!saveMaterial(name, $("#paste-kind").value, text)) return;
    event.target.reset();
    $("#paste-name").value = "Pasted study material";
    renderAll();
    showToast("Material added. Your topic map and retrieval index are updated.");
  } catch (error) {
    showToast(error.message, true);
  }
}

function updatePlanPreference() {
  const daysInput = $("#plan-days");
  const hoursInput = $("#plan-hours");
  const days = Math.max(1, Math.min(60, Number(daysInput.value) || 1));
  const hours = Math.max(0.25, Math.min(12, Number(hoursInput.value) || 0.25));
  state.preferences = { days, hours };
  if (!saveState()) return;
  renderPlan();
}

document.addEventListener("submit", (event) => {
  if (event.target.id === "login-form") login(event);
  if (event.target.id === "paste-form") handlePaste(event);
  if (event.target.id === "tutor-form") {
    event.preventDefault();
    explainTopic($("#tutor-topic").value);
  }
});

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-page]");
  if (nav) {
    event.preventDefault();
    showPage(nav.dataset.page);
    return;
  }
  if (event.target.closest("#logout-button")) {
    logout();
    return;
  }
  if (event.target.closest("[data-start-quiz]")) {
    startQuiz();
    return;
  }
  if (event.target.closest("[data-check-answer]")) {
    checkCurrentAnswer();
    return;
  }
  if (event.target.closest("[data-next-question]")) {
    quizSession.index += 1;
    quizSession.checked = false;
    renderCurrentQuestion();
    return;
  }
  if (event.target.closest("[data-save-diagnosis]")) {
    saveDiagnosis();
    return;
  }
  const removeButton = event.target.closest("[data-remove-material]");
  if (removeButton) {
    const index = Number(removeButton.dataset.removeMaterial);
    const material = state.materials[index];
    if (!material) return;
    state.materials.splice(index, 1);
    if (!saveState()) {
      state.materials.splice(index, 0, material);
      return;
    }
    quizSession = null;
    renderAll();
    showToast(`${material.name} removed from this workspace.`);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "file-input") handleFileUpload(event);
});

document.addEventListener("input", (event) => {
  if (event.target.id === "plan-days" || event.target.id === "plan-hours") updatePlanPreference();
});
