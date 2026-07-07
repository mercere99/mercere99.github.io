import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   MC Exam Builder — v2
   - Question library: markdown text, tags, answer pools with
     "always include" and "pin position" flags, per-question
     choice counts, points, notes / hint / explanation.
   - Generation: min/max per-tag constraints, multiple versions
     (independent | same questions reshuffled | distinct sets).
   - Export: interactive HTML practice exam, LaTeX, Markdown,
     D2L Brightspace CSV.
   - Persistence: window.storage auto-save + JSON export/import.
   ============================================================ */

const STORAGE_KEY = "mcq-library-v1";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWX";

/* ---------------- utilities ---------------- */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sample = (arr, n) => shuffle(arr).slice(0, n);
const normTag = (t) => t.trim().toLowerCase();
const hasTag = (q, tag) => [...q.tags, ...(q.xtags || [])].some((t) => normTag(t) === normTag(tag));

function csvField(s) {
  const str = String(s ?? "");
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

const slug = (s) => (s.trim().replace(/\s+/g, "-").toLowerCase() || "exam");

/* ---------------- markdown ---------------- */
/* Supports: ```fenced code```, `inline code`, **bold**, *italic*, ~~strike~~, line breaks. */

function mdToHtml(src) {
  if (!src) return "";
  let s = escapeHtml(src);
  const blocks = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push(`<pre class="md-pre"><code>${code.replace(/\n+$/, "")}</code></pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  // Lines indented by 4+ spaces form a code block (QBL convention).
  s = s.replace(/(^|\n)((?: {4}[^\n]*(?:\n|$))+)/g, (m, lead, block) => {
    blocks.push(`<pre class="md-pre"><code>${block.replace(/^ {4}/gm, "").replace(/\n+$/, "")}</code></pre>`);
    return `${lead}\u0000B${blocks.length - 1}\u0000`;
  });
  const inlines = [];
  s = s.replace(/`([^`\n]+)`/g, (m, code) => {
    inlines.push(`<code class="md-code">${code}</code>`);
    return `\u0000I${inlines.length - 1}\u0000`;
  });
  // Images before links (both operate on already-HTML-escaped text, so the
  // escaped quotes/ampersands are attribute-safe as-is).
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    inlines.push(`<img class="md-img" src="${url}" alt="${alt}">`);
    return `\u0000I${inlines.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    inlines.push(`<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
    return `\u0000I${inlines.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  // Pipe tables (GitHub style). Runs after inline formatting so cells carry it;
  // becomes a block token so the <br> pass below skips it.
  s = s.replace(/(^|\n)((?:\|[^\n]*(?:\n|$)){2,})/g, (m, lead, chunk) => {
    const lines = chunk.replace(/\n+$/, "").split("\n");
    if (!/^\|[\s:|-]+\|?\s*$/.test(lines[1] || "")) return m; // second line must be the separator row
    const cells = (ln) => ln.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const aligns = cells(lines[1]).map((c) =>
      c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"
    );
    const tr = (row, tag) =>
      `<tr>${row.map((c, i) => `<${tag} style="text-align:${aligns[i] || "left"}">${c}</${tag}>`).join("")}</tr>`;
    const head = tr(cells(lines[0]), "th");
    const body = lines.slice(2).map((ln) => tr(cells(ln), "td")).join("");
    blocks.push(`<table class="md-table"><thead>${head}</thead><tbody>${body}</tbody></table>`);
    return `${lead}\u0000B${blocks.length - 1}\u0000`;
  });
  s = s.replace(/\n/g, "<br>");
  s = s.replace(/(<br>)?\u0000B(\d+)\u0000(<br>)?/g, (m, b1, i) => blocks[+i]);
  s = s.replace(/\u0000I(\d+)\u0000/g, (m, i) => inlines[+i]);
  return s;
}

function latexEscape(s) {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function mdToLatex(src) {
  if (!src) return "";
  const blocks = [];
  const inlines = [];
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push(`\\begin{verbatim}\n${code.replace(/\n+$/, "")}\n\\end{verbatim}`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  s = s.replace(/(^|\n)((?: {4}[^\n]*(?:\n|$))+)/g, (m, lead, block) => {
    blocks.push(`\\begin{verbatim}\n${block.replace(/^ {4}/gm, "").replace(/\n+$/, "")}\n\\end{verbatim}`);
    return `${lead}\u0000B${blocks.length - 1}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, (m, code) => {
    const d = ['|', '!', '"', '@', '+', '='].find((ch) => !code.includes(ch));
    inlines.push(d ? `\\verb${d}${code}${d}` : `\\texttt{${latexEscape(code)}}`);
    return `\u0000I${inlines.length - 1}\u0000`;
  });
  const urlEsc = (u) => u.replace(/([%#&_{}])/g, "\\$1");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    inlines.push(`\\emph{[image${alt ? ": " + latexEscape(alt) : ""}]} (\\url{${urlEsc(url)}})`);
    return `\u0000I${inlines.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    inlines.push(`\\href{${urlEsc(url)}}{${latexEscape(text)}}`);
    return `\u0000I${inlines.length - 1}\u0000`;
  });
  s = latexEscape(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1\\emph{$2}");
  s = s.replace(/~~([^~\n]+)~~/g, "\\sout{$1}");
  // Pipe tables -> tabular. Cells are already LaTeX-escaped (literal & is \&),
  // so joining with raw & column separators is safe.
  s = s.replace(/(^|\n)((?:\|[^\n]*(?:\n|$)){2,})/g, (m, lead, chunk) => {
    const lines = chunk.replace(/\n+$/, "").split("\n");
    if (!/^\|[\s:|-]+\|?\s*$/.test(lines[1] || "")) return m;
    const cells = (ln) => ln.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const aligns = cells(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "c" : c.endsWith(":") ? "r" : "l"));
    const row = (r) => r.join(" & ") + " \\\\";
    const body = [row(cells(lines[0])), "\\hline", ...lines.slice(2).map((ln) => row(cells(ln)))].join("\n");
    blocks.push(`\\begin{tabular}{${aligns.join("")}}\n\\hline\n${body}\n\\hline\n\\end{tabular}`);
    return `${lead}\u0000B${blocks.length - 1}\u0000`;
  });
  s = s.replace(/\u0000B(\d+)\u0000/g, (m, i) => "\n" + blocks[+i] + "\n");
  s = s.replace(/\u0000I(\d+)\u0000/g, (m, i) => inlines[+i]);
  return s;
}

const Md = ({ text, block }) => (
  <span
    className="md"
    style={{ display: block ? "block" : "inline" }}
    dangerouslySetInnerHTML={{ __html: mdToHtml(text) }}
  />
);

/* ---------------- question model ---------------- */

function emptyQuestion() {
  return {
    id: uid(),
    text: "",
    tags: [],
    answers: [
      { id: uid(), text: "", correct: true, always: false, pin: false },
      { id: uid(), text: "", correct: false, always: false, pin: false },
      { id: uid(), text: "", correct: false, always: false, pin: false },
      { id: uid(), text: "", correct: false, always: false, pin: false },
    ],
    numChoices: 4,
    points: 1,
    notes: "",
    hint: "",
    explanation: "",
    xtags: [], // exclusive-or tags (QBL ^tag): at most one such question per exam
    extraSettings: {}, // unrecognized QBL :settings, preserved for round-tripping
  };
}

function normalizeQuestion(q) {
  return {
    ...emptyQuestion(),
    ...q,
    id: q.id || uid(),
    answers: (q.answers || []).map((a) => ({ always: false, pin: false, ...a, id: a.id || uid() })),
  };
}

function questionIsUsable(q) {
  const nCorrect = q.answers.filter((a) => a.correct && a.text.trim()).length;
  const nWrong = q.answers.filter((a) => !a.correct && a.text.trim()).length;
  return q.text.trim() && nCorrect >= 1 && nWrong >= q.numChoices - 1;
}

/* Text blocks: named intro/context passages. A question tagged with a block's
   name gets that block placed before it on the exam, and all chosen questions
   sharing the block are grouped after a single copy of it. */
const normalizeBlock = (b) => ({ id: b.id || uid(), name: (b.name || "").trim(), text: b.text || "" });

/* ---------------- QBL format ----------------
   Blocks separated by blank lines. First char of each line:
     (text)  question, or continuation of the question/answer above
     #tag    regular tag        ^tag  exclusive-or tag (max one per exam)
     :k=v    setting (options=N -> choices shown; points, hint, explanation,
             notes are recognized; everything else round-trips untouched)
     %       comment (whole line; or trailing on tag/setting lines)
     *  [    incorrect / correct answer; > pins position, + always includes
     Lines indented 1-3 spaces continue the previous entity; 4+ spaces = code. */

const escNL = (v) => String(v).replace(/\r?\n/g, "\\n");
const unescNL = (v) => String(v).replace(/\\n/g, "\n");
const QBL_KNOWN_SETTINGS = ["options", "points", "hint", "explanation", "notes"];

function parseQbl(text) {
  const questions = [];
  let cur = null;
  let lastAnswer = null;
  // /use_tags sets defaults applied to every subsequent question until the next /use_tags.
  let defaults = { tags: [], xtags: [], settings: {} };
  const uniq = (arr) => {
    const seen = new Set();
    return arr.filter((t) => {
      const k = normTag(t);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const parseTagTokens = (line, into) => {
    for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
      if (tok.startsWith("#") && tok.length > 1) into.tags.push(tok.slice(1));
      else if (tok.startsWith("^") && tok.length > 1) into.xtags.push(tok.slice(1));
      else if (tok.startsWith(":")) {
        const eq = tok.indexOf("=");
        if (eq > 1) into.settings[tok.slice(1, eq)] = tok.slice(eq + 1);
      }
    }
  };

  const flush = () => {
    if (cur && (cur.textLines.length || cur.answers.length)) {
      const s = cur.settings;
      const wrongCount = cur.answers.filter((a) => !a.correct).length;
      questions.push(
        normalizeQuestion({
          text: cur.textLines.join("\n"),
          tags: uniq(cur.tags),
          xtags: uniq(cur.xtags),
          answers: cur.answers,
          // No :options setting -> show every distractor plus one correct.
          numChoices: s.options != null ? Math.max(2, parseInt(s.options) || 2) : Math.max(2, wrongCount + 1),
          points: s.points != null ? parseFloat(s.points) || 1 : 1,
          hint: s.hint != null ? unescNL(s.hint) : "",
          explanation: s.explanation != null ? unescNL(s.explanation) : "",
          notes: s.notes != null ? unescNL(s.notes) : "",
          extraSettings: Object.fromEntries(Object.entries(s).filter(([k]) => !QBL_KNOWN_SETTINGS.includes(k))),
        })
      );
    }
    cur = null;
    lastAnswer = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "") {
      flush();
      continue;
    }
    const c = raw[0];
    if (c === "%") continue; // comment line (does not end the block)
    if (c === "/") {
      // Directive line. /use_tags resets and sets the running defaults.
      if (/^\/use_tags\b/i.test(raw)) {
        flush();
        defaults = { tags: [], xtags: [], settings: {} };
        parseTagTokens(raw.replace(/^\/use_tags/i, "").split(/(?:^|\s)%/)[0], defaults);
      }
      continue; // other /directives are ignored
    }
    if (!cur)
      cur = {
        textLines: [],
        tags: [...defaults.tags],
        xtags: [...defaults.xtags],
        answers: [],
        settings: { ...defaults.settings },
      };

    if (c === ":") {
      // Whole-line setting; the value may contain spaces. Trailing % comment stripped.
      const line = raw.replace(/\s+%.*$/, "").trim();
      const eq = line.indexOf("=");
      if (eq > 1) cur.settings[line.slice(1, eq).trim()] = line.slice(eq + 1).trim();
      else if (line.length > 1) cur.settings[line.slice(1).trim()] = "true";
      lastAnswer = null;
      continue;
    }
    if (c === "#" || c === "^") {
      parseTagTokens(raw.split(/(?:^|\s)%/)[0], cur); // trailing comment stripped
      lastAnswer = null;
      continue;
    }
    if (c === "*" || c === "[" || c === "+" || c === ">") {
      let correct = false,
        pin = false,
        always = false,
        rest;
      if (c === "[") {
        correct = true;
        const close = raw.indexOf("]");
        const inner = close > 0 ? raw.slice(1, close) : "";
        rest = close > 0 ? raw.slice(close + 1) : raw.slice(1);
        pin = inner.includes(">");
        always = inner.includes("+");
      } else {
        let i = 0;
        while (i < raw.length && "*>+".includes(raw[i])) {
          if (raw[i] === ">") pin = true;
          if (raw[i] === "+") always = true;
          i++;
        }
        rest = raw.slice(i);
      }
      lastAnswer = { id: uid(), text: rest.trim(), correct, pin, always };
      cur.answers.push(lastAnswer);
      continue;
    }
    // Continuation: 1-3 leading spaces are stripped; 4+ means code, kept verbatim.
    const line = /^ {1,3}\S/.test(raw) ? raw.trimStart() : raw;
    if (lastAnswer) lastAnswer.text += "\n" + line;
    else cur.textLines.push(line);
  }
  flush();
  return questions;
}

function toQbl(questions) {
  const qblTag = (t) => t.trim().replace(/\s+/g, "-"); // QBL tags cannot contain spaces
  const protectFirst = (ln) => (/^[#:^*\[%+> ]/.test(ln) ? " " + ln : ln);
  const contLine = (ln) => (/^ {4,}/.test(ln) ? ln : "  " + ln);
  const emitText = (text, out, first) => {
    // Interior blank lines would terminate the block, so they are dropped.
    const lines = text.split("\n").filter((ln, i) => i === 0 || ln.trim() !== "");
    lines.forEach((ln, i) => out.push(i === 0 ? first(ln) : contLine(ln)));
  };

  return (
    questions
      .map((q) => {
        const out = [];
        emitText(q.text, out, protectFirst);
        const tagBits = [...q.tags.map((t) => "#" + qblTag(t)), ...(q.xtags || []).map((t) => "^" + qblTag(t))];
        if (tagBits.length) out.push(tagBits.join(" "));
        out.push(`:options=${q.numChoices}`);
        if ((q.points ?? 1) !== 1) out.push(`:points=${q.points}`);
        if (q.hint?.trim()) out.push(`:hint=${escNL(q.hint)}`);
        if (q.explanation?.trim()) out.push(`:explanation=${escNL(q.explanation)}`);
        if (q.notes?.trim()) out.push(`:notes=${escNL(q.notes)}`);
        Object.entries(q.extraSettings || {}).forEach(([k, v]) => out.push(`:${k}=${v}`));
        q.answers.forEach((a) => {
          const marker = a.correct
            ? `[*${a.pin ? ">" : ""}${a.always ? "+" : ""}]`
            : `*${a.pin ? ">" : ""}${a.always ? "+" : ""}`;
          emitText(a.text, out, (ln) => `${marker} ${ln}`);
        });
        return out.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

/* ---------------- generation engine ---------------- */

/* Keep pinned options in their authored slots; shuffle unpinned among the rest. */
function arrangeOptions(opts) {
  const sorted = [...opts].sort((a, b) => a.authorIdx - b.authorIdx);
  const unpinned = shuffle(sorted.filter((o) => !o.pin));
  let k = 0;
  return sorted.map((o) => (o.pin ? o : unpinned[k++]));
}

/* One correct (always-include correct wins) + distractors (always-include first). */
function buildItem(q) {
  const correctPool = q.answers.filter((a) => a.correct && a.text.trim());
  const alwaysCorrect = correctPool.filter((a) => a.always);
  const correct = (alwaysCorrect.length ? sample(alwaysCorrect, 1) : sample(correctPool, 1))[0];

  const wrongPool = q.answers.filter((a) => !a.correct && a.text.trim());
  const need = q.numChoices - 1;
  const alwaysWrong = wrongPool.filter((a) => a.always);
  const otherWrong = wrongPool.filter((a) => !a.always);
  const wrong =
    alwaysWrong.length >= need ? sample(alwaysWrong, need) : [...alwaysWrong, ...sample(otherWrong, need - alwaysWrong.length)];

  const chosen = new Set([correct.id, ...wrong.map((a) => a.id)]);
  const opts = q.answers
    .map((a, idx) => ({ authorIdx: idx, pin: !!a.pin, text: a.text, correct: a.id === correct.id }))
    .filter((o, idx) => chosen.has(q.answers[idx].id));
  return { question: q, options: arrangeOptions(opts) };
}

/* Same options, fresh pin-aware ordering (for "same questions, different order"). */
function rearrangeItem(item) {
  return { question: item.question, options: arrangeOptions(item.options) };
}

function findBlockFor(q, blocksByName) {
  const t = [...q.tags, ...(q.xtags || [])].find((tag) => blocksByName.has(normTag(tag)));
  return t ? blocksByName.get(normTag(t)) : null;
}

/* Turn built items into an ordered entry list. Questions sharing a text block
   are grouped behind a single copy of the block; groups and loose questions
   shuffle as units. Entry: {key, type:"q", item} | {key, type:"block", block}. */
function assembleEntries(items, textBlocks) {
  const byName = new Map(textBlocks.filter((b) => b.name).map((b) => [normTag(b.name), b]));
  const groups = new Map();
  const loose = [];
  for (const item of items) {
    const b = findBlockFor(item.question, byName);
    if (b) {
      if (!groups.has(b.id)) groups.set(b.id, { block: b, items: [] });
      groups.get(b.id).items.push(item);
    } else loose.push(item);
  }
  const units = [
    ...loose.map((i) => [{ key: uid(), type: "q", item: i }]),
    ...[...groups.values()].map((g) => [
      { key: uid(), type: "block", block: g.block },
      ...shuffle(g.items).map((i) => ({ key: uid(), type: "q", item: i })),
    ]),
  ];
  return shuffle(units).flat();
}

const entryQuestions = (entries) => entries.filter((e) => e.type === "q").map((e) => e.item);

/* Constraint: { tag, min, max }  (max === null means unlimited).
   Randomized greedy with restarts: satisfy mins (most-constrained first),
   then fill respecting maxes. */
function selectQuestions(all, count, constraints, excludeIds) {
  const warnings = [];
  const cons = constraints
    .filter((c) => c.tag)
    .map((c) => ({ tag: c.tag, key: normTag(c.tag), min: c.min ?? 0, max: c.max == null ? Infinity : c.max }));

  const pool = all.filter((q) => questionIsUsable(q) && !excludeIds.has(q.id));

  const attempt = () => {
    const counts = new Map(cons.map((c) => [c.key, 0]));
    const selected = [];
    const ids = new Set();
    const bump = (q) => {
      cons.forEach((c) => {
        if (hasTag(q, c.tag)) counts.set(c.key, counts.get(c.key) + 1);
      });
      selected.push(q);
      ids.add(q.id);
    };
    const feasible = (q) => cons.every((c) => !hasTag(q, c.tag) || counts.get(c.key) < c.max);

    // Pass 1: satisfy minimums, most-constrained tag first.
    let guard = 0;
    while (guard++ < 2000) {
      const unmet = cons.filter((c) => counts.get(c.key) < c.min);
      if (unmet.length === 0) break;
      const open = unmet
        .map((c) => ({ c, cands: pool.filter((q) => !ids.has(q.id) && hasTag(q, c.tag) && feasible(q)) }))
        .filter((x) => x.cands.length > 0)
        .sort((a, b) => a.cands.length - b.cands.length);
      if (open.length === 0) break; // some minimum is unsatisfiable in this attempt
      bump(sample(open[0].cands, 1)[0]);
    }

    // Pass 2: fill remaining slots.
    while (selected.length < count) {
      const cands = pool.filter((q) => !ids.has(q.id) && feasible(q));
      if (cands.length === 0) break;
      bump(sample(cands, 1)[0]);
    }

    let violations = Math.max(0, count - selected.length);
    cons.forEach((c) => {
      violations += Math.max(0, c.min - counts.get(c.key));
    });
    return { selected, counts, violations };
  };

  let best = null;
  for (let i = 0; i < 30; i++) {
    const a = attempt();
    if (!best || a.violations < best.violations) best = a;
    if (best.violations === 0) break;
  }

  cons.forEach((c) => {
    const n = best.counts.get(c.key);
    if (n < c.min) warnings.push(`Tag "${c.tag}": needed at least ${c.min}, only placed ${n}.`);
  });
  if (best.selected.length < count)
    warnings.push(`Only ${best.selected.length} of ${count} questions could be selected (pool: ${pool.length} eligible).`);
  if (best.selected.length > count)
    warnings.push(`Tag minimums forced ${best.selected.length} questions (exam length was ${count}).`);

  return { selected: best.selected, warnings };
}

function generateVersions(all, textBlocks, cfg) {
  const { count, numVersions, mode } = cfg;
  // Exclusive-or (^) tags get an implicit max-1 constraint unless the user
  // has set an explicit constraint on that tag.
  const explicit = new Set(cfg.constraints.map((c) => normTag(c.tag)));
  const xorTags = new Map();
  all.forEach((q) => (q.xtags || []).forEach((t) => xorTags.set(normTag(t), t)));
  const constraints = [
    ...cfg.constraints,
    ...[...xorTags.values()]
      .filter((t) => !explicit.has(normTag(t)))
      .map((t) => ({ tag: t, min: 0, max: 1 })),
  ];
  const versions = [];

  if (numVersions <= 1 || mode === "independent") {
    for (let v = 0; v < Math.max(1, numVersions); v++) {
      const { selected, warnings } = selectQuestions(all, count, constraints, new Set());
      versions.push({ label: LETTERS[v], entries: assembleEntries(selected.map(buildItem), textBlocks), warnings });
    }
  } else if (mode === "shuffle") {
    const { selected, warnings } = selectQuestions(all, count, constraints, new Set());
    const base = selected.map(buildItem);
    versions.push({ label: "A", entries: assembleEntries(base, textBlocks), warnings });
    for (let v = 1; v < numVersions; v++) {
      versions.push({
        label: LETTERS[v],
        entries: assembleEntries(base.map(rearrangeItem), textBlocks),
        warnings: [],
      });
    }
  } else {
    // distinct question sets
    const used = new Set();
    for (let v = 0; v < numVersions; v++) {
      const { selected, warnings } = selectQuestions(all, count, constraints, used);
      selected.forEach((q) => used.add(q.id));
      versions.push({
        label: LETTERS[v],
        entries: assembleEntries(selected.map(buildItem), textBlocks),
        warnings: warnings.map((w) => `Version ${LETTERS[v]}: ${w}`),
      });
    }
  }
  return versions;
}

/* ---------------- exporters ---------------- */

function versionTitle(meta, label, many) {
  return meta.title + (many ? ` — Version ${label}` : "");
}

/* Interactive practice exam: hints, per-question reveal, Done → grade + explanations.
   Prints cleanly as a paper exam (interactive chrome hidden in print). */
function examToHtml(entries, meta, label, many) {
  const title = versionTitle(meta, label, many);
  const qItems = entryQuestions(entries);
  const totalPts = qItems.reduce((s, it) => s + (it.question.points ?? 1), 0);

  let n = 0;
  const qBlocks = entries
    .map((entry) => {
      if (entry.type === "block") {
        return `  <div class="textblock">${mdToHtml(entry.block.text)}</div>`;
      }
      const item = entry.item;
      const i = n++;
      const pts = item.question.points ?? 1;
      const cIdx = item.options.findIndex((o) => o.correct);
      const opts = item.options
        .map(
          (o, j) => `      <label class="opt"><input type="radio" name="q${i}" value="${j}"><span class="letter">${LETTERS[j]}.</span><span class="otext">${mdToHtml(o.text)}</span></label>`
        )
        .join("\n");
      const hint = item.question.hint?.trim()
        ? `<button type="button" class="mini hintbtn" data-q="${i}">Show hint</button><div class="hint hidden" id="hint${i}">${mdToHtml(item.question.hint)}</div>`
        : "";
      const expl = item.question.explanation?.trim()
        ? `<div class="explanation hidden" id="expl${i}"><b>Explanation:</b> ${mdToHtml(item.question.explanation)}</div>`
        : "";
      return `  <div class="question" id="q${i}" data-correct="${cIdx}" data-pts="${pts}">
    <div class="qtext"><span class="qnum">${i + 1}.</span> <span>${mdToHtml(item.question.text)}</span> <span class="pts">(${pts} pt${pts === 1 ? "" : "s"})</span> <span class="verdict" id="v${i}"></span></div>
    <div class="opts">
${opts}
    </div>
    <div class="qactions">${hint}<button type="button" class="mini revealbtn" data-q="${i}">Reveal answer</button></div>
    ${expl}
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 7.5in; margin: 0 auto; padding: 24px 16px 80px; color: #111; }
  header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  .meta { font-size: 11pt; color: #333; }
  .nameline { margin-top: 14px; font-size: 11pt; }
  .instructions { font-size: 10.5pt; color: #444; margin-top: 8px; font-style: italic; }
  #score { font-size: 14pt; font-weight: bold; margin-top: 10px; padding: 8px 12px; background: #eef5ef; border: 1px solid #2c6e49; border-radius: 6px; }
  .question { margin-bottom: 22px; page-break-inside: avoid; }
  .qtext { font-weight: bold; margin-bottom: 6px; }
  .qnum { display: inline-block; min-width: 24px; }
  .pts { font-weight: normal; color: #555; font-size: 10pt; }
  .verdict { font-weight: bold; font-size: 10.5pt; margin-left: 8px; }
  .verdict.ok { color: #2c6e49; }
  .verdict.bad { color: #a03030; }
  .opts { margin-left: 26px; }
  .opt { display: block; margin: 3px 0; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
  .opt input { margin-right: 8px; }
  .letter { display: inline-block; min-width: 22px; font-weight: bold; }
  .opt.is-correct { background: #dff0e2; outline: 1.5px solid #2c6e49; }
  .opt.is-wrong { background: #f7e0e0; outline: 1.5px solid #a03030; }
  .qactions { margin: 6px 0 0 26px; }
  .mini { font-family: inherit; font-size: 9.5pt; padding: 2px 10px; margin-right: 8px; cursor: pointer; border: 1px solid #888; background: #f6f6f6; border-radius: 4px; }
  .hint { margin: 6px 0 0 0; padding: 6px 10px; background: #fff8e1; border-left: 3px solid #c8a028; font-size: 10.5pt; }
  .explanation { margin: 8px 0 0 26px; padding: 6px 10px; background: #eef3f8; border-left: 3px solid #3a6ea5; font-size: 10.5pt; }
  .hidden { display: none; }
  #donebtn { display: block; margin: 30px auto 0; font-size: 13pt; padding: 10px 36px; cursor: pointer; background: #18453B; color: #fff; border: none; border-radius: 6px; }
  .textblock { background: #f7f7f2; border: 1px solid #bbb; border-left: 4px solid #18453B; border-radius: 6px; padding: 10px 14px; margin: 20px 0 14px; page-break-inside: avoid; }
  .md-table { border-collapse: collapse; margin: 8px 0; font-size: 10.5pt; }
  .md-table th, .md-table td { border: 1px solid #999; padding: 4px 10px; }
  .md-table th { background: #efefe9; }
  .md-pre { background: #f4f4f4; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; font-family: 'Menlo', 'Consolas', monospace; font-size: 10pt; overflow-x: auto; white-space: pre; }
  .md-code { background: #f4f4f4; border: 1px solid #ddd; border-radius: 3px; padding: 0 4px; font-family: 'Menlo', 'Consolas', monospace; font-size: 10pt; }
  .md-img { max-width: 100%; max-height: 4in; border: 1px solid #ddd; border-radius: 4px; display: block; margin: 6px 0; }
  a { color: #18453B; }
  @media print {
    .mini, .qactions, .hint, .explanation, .verdict, #donebtn, #score, .screen-only { display: none !important; }
    body { padding: 0; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${escapeHtml(meta.course)}${meta.course && meta.date ? " &mdash; " : ""}${escapeHtml(meta.date)} &mdash; ${qItems.length} questions, ${totalPts} points</div>
  <div class="nameline">Name: ________________________________ &nbsp;&nbsp; Section: ________</div>
  <div class="instructions screen-only">Practice mode: choose one answer per question, then press <b>Done</b> for your grade. Hints and per-question reveals are available. Printing this page produces a clean paper exam.</div>
  <div id="score" class="hidden"></div>
</header>
${qBlocks}
<button type="button" id="donebtn">Done</button>
<script>
(function(){
  var N = ${qItems.length};
  function q(i){ return document.getElementById('q' + i); }
  function reveal(i){
    var el = q(i), c = +el.dataset.correct;
    el.querySelectorAll('.opt')[c].classList.add('is-correct');
    var ex = document.getElementById('expl' + i);
    if (ex) ex.classList.remove('hidden');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.hintbtn'), function(b){
    b.addEventListener('click', function(){
      var h = document.getElementById('hint' + b.dataset.q);
      h.classList.toggle('hidden');
      b.textContent = h.classList.contains('hidden') ? 'Show hint' : 'Hide hint';
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.revealbtn'), function(b){
    b.addEventListener('click', function(){ reveal(+b.dataset.q); });
  });
  document.getElementById('donebtn').addEventListener('click', function(){
    var right = 0, earned = 0, total = 0;
    for (var i = 0; i < N; i++){
      var el = q(i), c = +el.dataset.correct, pts = +el.dataset.pts;
      total += pts;
      var sel = el.querySelector('input:checked');
      var opts = el.querySelectorAll('.opt');
      var v = document.getElementById('v' + i);
      opts[c].classList.add('is-correct');
      if (sel){
        if (+sel.value === c){ right++; earned += pts; v.textContent = '\\u2714 correct'; v.className = 'verdict ok'; }
        else { v.textContent = '\\u2718 incorrect'; v.className = 'verdict bad'; opts[+sel.value].classList.add('is-wrong'); }
      } else {
        v.textContent = '\\u2014 unanswered'; v.className = 'verdict bad';
      }
      var ex = document.getElementById('expl' + i);
      if (ex) ex.classList.remove('hidden');
      Array.prototype.forEach.call(el.querySelectorAll('input'), function(x){ x.disabled = true; });
    }
    var s = document.getElementById('score');
    s.classList.remove('hidden');
    s.textContent = 'Score: ' + earned + ' / ' + total + ' points (' + right + '/' + N + ' questions, ' + Math.round(100 * earned / (total || 1)) + '%)';
    this.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
</script>
</body>
</html>`;
}

function examToLatex(entries, meta, label, many) {
  const title = versionTitle(meta, label, many);
  const qItems = entryQuestions(entries);

  // Text blocks interrupt the enumerate; numbering resumes across segments.
  const parts = [];
  let open = false;
  let firstEnum = true;
  const openEnum = () => {
    parts.push(`\\begin{enumerate}[itemsep=12pt${firstEnum ? "" : ",resume"}]`);
    firstEnum = false;
    open = true;
  };
  const closeEnum = () => {
    if (open) parts.push("\\end{enumerate}");
    open = false;
  };
  for (const entry of entries) {
    if (entry.type === "block") {
      closeEnum();
      parts.push(`\\par\\vspace{8pt}\\noindent\\fbox{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{${mdToLatex(entry.block.text)}}}\\vspace{4pt}\\par`);
      continue;
    }
    if (!open) openEnum();
    const item = entry.item;
    const pts = item.question.points ?? 1;
    const opts = item.options.map((o) => `    \\item ${mdToLatex(o.text)}`).join("\n");
    parts.push(`  \\item ${mdToLatex(item.question.text)} \\hfill (${pts} pt${pts === 1 ? "" : "s"})
  \\begin{enumerate}[label=\\Alph*., itemsep=1pt]
${opts}
  \\end{enumerate}`);
  }
  closeEnum();

  const key = qItems
    .map((item, i) => {
      const idx = item.options.findIndex((o) => o.correct);
      const expl = item.question.explanation?.trim()
        ? ` \\\\ {\\small\\emph{Explanation:} ${mdToLatex(item.question.explanation)}}`
        : "";
      return `  \\item[${i + 1}.] \\textbf{${LETTERS[idx]}} --- ${mdToLatex(item.options[idx].text)}${expl}`;
    })
    .join("\n");

  return `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{enumitem}
\\usepackage[normalem]{ulem}
\\usepackage[hidelinks]{hyperref}
\\setlength{\\parindent}{0pt}
\\begin{document}

{\\LARGE\\bfseries ${latexEscape(title)}}\\\\[2pt]
${latexEscape(meta.course)}${meta.course && meta.date ? " --- " : ""}${latexEscape(meta.date)}\\\\[10pt]
Name: \\rule{2.6in}{0.4pt} \\hfill Section: \\rule{0.9in}{0.4pt}
\\vspace{14pt}

${parts.join("\n")}

\\clearpage
\\section*{Answer Key --- ${latexEscape(title)}}
\\begin{itemize}[itemsep=6pt]
${key}
\\end{itemize}

\\end{document}
`;
}

function examToMarkdown(entries, meta, label, many) {
  const title = versionTitle(meta, label, many);
  const qItems = entryQuestions(entries);
  let n = 0;
  const body = entries
    .map((entry) => {
      if (entry.type === "block") {
        return entry.block.text
          .split("\n")
          .map((ln) => "> " + ln)
          .join("\n");
      }
      const item = entry.item;
      n++;
      const pts = item.question.points ?? 1;
      // Multi-line answers: indent continuation lines so the markdown list holds together.
      const opts = item.options.map((o, j) => `- **${LETTERS[j]}.** ${o.text.replace(/\n/g, "\n  ")}`).join("\n");
      return `### ${n}. ${item.question.text} *(${pts} pt${pts === 1 ? "" : "s"})*\n\n${opts}`;
    })
    .join("\n\n");

  const key = qItems
    .map((item, i) => {
      const idx = item.options.findIndex((o) => o.correct);
      const expl = item.question.explanation?.trim() ? `\n   > ${item.question.explanation.replace(/\n/g, "\n   > ")}` : "";
      return `${i + 1}. **${LETTERS[idx]}** — ${item.options[idx].text.replace(/\n/g, "\n   ")}${expl}`;
    })
    .join("\n");

  return `# ${title}\n\n${meta.course}${meta.course && meta.date ? " — " : ""}${meta.date}\n\n---\n\n${body}\n\n---\n\n## Answer Key\n\n${key}\n`;
}

/* D2L Brightspace bulk-question CSV. Markdown is converted to HTML with the
   HTML flag set; Hint and Feedback rows carry the hint / explanation. Since
   D2L may shuffle questions, a question's text block is prepended to its own
   QuestionText (looked up by tag, independent of manual ordering). */
function examToD2lCsv(entries, meta, label, many, textBlocks) {
  const byName = new Map((textBlocks || []).filter((b) => b.name).map((b) => [normTag(b.name), b]));
  const rows = [];
  entryQuestions(entries).forEach((item, i) => {
    const block = findBlockFor(item.question, byName);
    const qHtml =
      (block ? `<div style="border:1px solid #999;padding:8px 12px;margin-bottom:8px;">${mdToHtml(block.text)}</div>` : "") +
      mdToHtml(item.question.text);
    rows.push(["NewQuestion", "MC", "", "", ""]);
    rows.push(["ID", `${slug(meta.title)}${many ? "-" + label : ""}-Q${String(i + 1).padStart(3, "0")}`, "", "", ""]);
    rows.push(["Title", `Question ${i + 1}${many ? ` (Version ${label})` : ""}`, "", "", ""]);
    rows.push(["QuestionText", qHtml, "HTML", "", ""]);
    rows.push(["Points", String(item.question.points ?? 1), "", "", ""]);
    rows.push(["Difficulty", "1", "", "", ""]);
    item.options.forEach((o) => {
      rows.push(["Option", o.correct ? "100" : "0", mdToHtml(o.text), "HTML", ""]);
    });
    if (item.question.hint?.trim()) rows.push(["Hint", mdToHtml(item.question.hint), "HTML", "", ""]);
    if (item.question.explanation?.trim()) rows.push(["Feedback", mdToHtml(item.question.explanation), "HTML", "", ""]);
    rows.push(["", "", "", "", ""]);
  });
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n");
}

/* ---------------- UI atoms ---------------- */

const T = {
  ink: "#1B2621",
  green: "#18453B",
  greenSoft: "#E4EEE9",
  paper: "#F4F6F3",
  card: "#FFFFFF",
  line: "#D8DFDA",
  amber: "#8A5A00",
  amberBg: "#FFF4DC",
  red: "#8C2B2B",
  redSoft: "#F6E3E3",
  gray: "#5A6660",
};

function TagChip({ tag, onRemove, mode, onClick, title, xor }) {
  // mode: undefined (neutral) | "in" | "out"; xor renders with ^ and a dashed border
  const styles =
    mode === "in"
      ? { background: T.green, color: "#fff", border: `1px ${xor ? "dashed" : "solid"} ${T.green}` }
      : mode === "out"
      ? { background: T.redSoft, color: T.red, border: `1px ${xor ? "dashed" : "solid"} ${T.red}`, textDecoration: "line-through" }
      : { background: T.greenSoft, color: T.green, border: `1px ${xor ? "dashed" : "solid"} ${xor ? T.green : T.line}` };
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        ...styles,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 4,
        cursor: onClick ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        userSelect: "none",
      }}
    >
      {mode === "out" && <span style={{ textDecoration: "none" }}>¬</span>}
      {xor && "^"}
      {tag}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 12, lineHeight: 1 }}
          aria-label={`Remove tag ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function Btn({ children, onClick, kind = "primary", small, disabled, title, active }) {
  const styles = {
    primary: { background: T.green, color: "#fff", border: `1px solid ${T.green}` },
    ghost: { background: "transparent", color: T.green, border: `1px solid ${T.green}` },
    quiet: { background: active ? T.greenSoft : "transparent", color: active ? T.green : T.ink, border: `1px solid ${active ? T.green : T.line}` },
    danger: { background: "transparent", color: T.red, border: `1px solid ${T.red}` },
  }[kind];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styles,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        borderRadius: 6,
        padding: small ? "3px 10px" : "8px 16px",
        fontSize: small ? 13 : 14,
        fontFamily: "'IBM Plex Sans', sans-serif",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

const inputStyle = {
  border: `1px solid ${T.line}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "'IBM Plex Sans', sans-serif",
  background: "#fff",
  color: T.ink,
  width: "100%",
  boxSizing: "border-box",
};

const monoInput = { ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 };

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: T.green, marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 12, color: T.gray, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

/* ---------------- question editor ---------------- */

function QuestionEditor({ initial, allTags, onSave, onCancel }) {
  const [q, setQ] = useState(() => normalizeQuestion(JSON.parse(JSON.stringify(initial))));
  const [tagInput, setTagInput] = useState("");
  const [showOptional, setShowOptional] = useState(!!(initial.notes || initial.hint || initial.explanation));
  const [showPreview, setShowPreview] = useState(false);

  const nCorrect = q.answers.filter((a) => a.correct && a.text.trim()).length;
  const wrong = q.answers.filter((a) => !a.correct && a.text.trim());
  const nWrong = wrong.length;
  const nAlwaysWrong = wrong.filter((a) => a.always).length;

  const problems = [];
  if (!q.text.trim()) problems.push("Question text is empty.");
  if (nCorrect < 1) problems.push("Mark at least one answer as correct.");
  if (nWrong < q.numChoices - 1)
    problems.push(`Need at least ${q.numChoices - 1} incorrect answers for ${q.numChoices} choices (have ${nWrong}).`);
  const notes = [];
  if (nAlwaysWrong > q.numChoices - 1)
    notes.push(`${nAlwaysWrong} distractors are marked "always" but only ${q.numChoices - 1} slots exist; a random subset will be used.`);
  if (q.answers.filter((a) => a.correct && a.always && a.text.trim()).length > 1)
    notes.push('Multiple correct answers are marked "always"; one of them will be chosen at random each time.');

  const addTag = (raw) => {
    const t = raw.trim();
    if (!t) return;
    if (t.startsWith("^")) {
      const x = t.slice(1).trim();
      if (x && !q.xtags.some((y) => normTag(y) === normTag(x))) setQ({ ...q, xtags: [...q.xtags, x] });
    } else if (!q.tags.some((x) => normTag(x) === normTag(t))) {
      setQ({ ...q, tags: [...q.tags, t] });
    }
    setTagInput("");
  };

  const setAnswer = (id, patch) => setQ({ ...q, answers: q.answers.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

  // Drag-to-reorder answers.
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const moveAnswer = (from, to) => {
    if (from == null || to == null || from === to) return;
    setQ((prev) => {
      const answers = [...prev.answers];
      const [row] = answers.splice(from, 1);
      answers.splice(to, 0, row);
      return { ...prev, answers };
    });
  };

  const suggestions = allTags
    .filter((t) => tagInput && normTag(t).includes(normTag(tagInput)) && !q.tags.some((x) => normTag(x) === normTag(t)))
    .slice(0, 6);

  const flagBtn = (on) => ({
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    padding: "3px 7px",
    borderRadius: 4,
    border: `1px solid ${on ? T.green : T.line}`,
    background: on ? T.green : "transparent",
    color: on ? "#fff" : T.gray,
    cursor: "pointer",
  });

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 20 }}>
      <Field
        label="Question text"
        hint={
          "Markdown supported: `code`, ```code blocks``` (or 4-space indent), **bold**, *italic*, ~~strike~~, " +
          "[links](url), ![images](url), and | pipe | tables | with a |---|---| separator row."
        }
      >
        <textarea
          value={q.text}
          onChange={(e) => setQ({ ...q, text: e.target.value })}
          rows={3}
          style={{ ...monoInput, resize: "vertical" }}
          placeholder="Exactly as it will appear to students…"
        />
        {q.text.trim() && (
          <div style={{ marginTop: 6 }}>
            <Btn kind="quiet" small onClick={() => setShowPreview(!showPreview)} active={showPreview}>
              {showPreview ? "Hide preview" : "Preview"}
            </Btn>
            {showPreview && (
              <div style={{ border: `1px dashed ${T.line}`, borderRadius: 6, padding: "8px 12px", marginTop: 6, fontSize: 14 }}>
                <Md text={q.text} block />
              </div>
            )}
          </div>
        )}
      </Field>

      <Field label="Tags" hint="Press Enter or comma to add. Prefix with ^ for an exclusive tag: at most one question carrying it appears per exam.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {q.tags.map((t) => (
            <TagChip key={t} tag={t} onRemove={() => setQ({ ...q, tags: q.tags.filter((x) => x !== t) })} />
          ))}
          {q.xtags.map((t) => (
            <TagChip key={"^" + t} tag={t} xor onRemove={() => setQ({ ...q, xtags: q.xtags.filter((x) => x !== t) })} />
          ))}
        </div>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(tagInput);
            }
          }}
          style={inputStyle}
          placeholder="e.g. templates, midterm-only, hard"
        />
        {suggestions.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {suggestions.map((t) => (
              <TagChip key={t} tag={t} onClick={() => addTag(t)} />
            ))}
          </div>
        )}
      </Field>

      <Field
        label="Answer pool"
        hint='Markdown works here too. "Always" answers are never dropped when sampling; "Pin" answers keep their slot in the list while others shuffle (e.g. keep "All of the above" last).'
      >
        {q.answers.map((a, i) => (
          <div
            key={a.id}
            onDragOver={(e) => {
              if (dragIdx == null) return;
              e.preventDefault();
              setOverIdx(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              moveAnswer(dragIdx, i);
              setDragIdx(null);
              setOverIdx(null);
            }}
            style={{
              display: "flex",
              gap: 8,
              alignItems: a.text.includes("\n") ? "flex-start" : "center",
              marginBottom: 6,
              opacity: dragIdx === i ? 0.4 : 1,
              borderTop: overIdx === i && dragIdx != null && dragIdx !== i ? `2px solid ${T.green}` : "2px solid transparent",
            }}
          >
            <span
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              title="Drag to reorder"
              style={{ cursor: "grab", color: T.gray, fontSize: 15, userSelect: "none", padding: "0 2px", flexShrink: 0 }}
            >
              ⠿
            </span>
            <input
              type="checkbox"
              checked={a.correct}
              onChange={(e) => setAnswer(a.id, { correct: e.target.checked })}
              title="Correct answer"
              style={{ width: 18, height: 18, accentColor: T.green, flexShrink: 0 }}
            />
            <textarea
              value={a.text}
              onChange={(e) => setAnswer(a.id, { text: e.target.value })}
              rows={Math.min(10, Math.max(1, a.text.split("\n").length))}
              style={{
                ...monoInput,
                resize: "vertical",
                overflow: "hidden",
                lineHeight: 1.45,
                borderColor: a.correct ? T.green : T.line,
                background: a.correct ? T.greenSoft : "#fff",
              }}
              placeholder={a.correct ? "Correct answer…" : "Incorrect answer (distractor)…"}
            />
            <button style={flagBtn(a.always)} onClick={() => setAnswer(a.id, { always: !a.always })} title="Always include this answer when sampling options">
              always
            </button>
            <button style={flagBtn(a.pin)} onClick={() => setAnswer(a.id, { pin: !a.pin })} title="Pin this answer to its relative position in the list">
              pin
            </button>
            <Btn kind="quiet" small onClick={() => setQ({ ...q, answers: q.answers.filter((x) => x.id !== a.id) })} title="Remove">
              ✕
            </Btn>
          </div>
        ))}
        <Btn
          kind="ghost"
          small
          onClick={() => setQ({ ...q, answers: [...q.answers, { id: uid(), text: "", correct: false, always: false, pin: false }] })}
        >
          + Add answer
        </Btn>
      </Field>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Field label="Choices shown to student" hint="1 correct + rest incorrect.">
          <input
            type="number"
            min={2}
            max={16}
            value={q.numChoices}
            onChange={(e) => setQ({ ...q, numChoices: Math.max(2, parseInt(e.target.value) || 2) })}
            style={{ ...inputStyle, width: 90 }}
          />
        </Field>
        <Field label="Points">
          <input
            type="number"
            min={0}
            step={0.5}
            value={q.points ?? 1}
            onChange={(e) => setQ({ ...q, points: parseFloat(e.target.value) || 0 })}
            style={{ ...inputStyle, width: 90 }}
          />
        </Field>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Btn kind="quiet" small onClick={() => setShowOptional(!showOptional)} active={showOptional}>
          {showOptional ? "▾" : "▸"} Optional sections (notes, hint, explanation)
        </Btn>
        {showOptional && (
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: 14, marginTop: 8 }}>
            <Field label="Notes (author-only)" hint="Never exported; for your own bookkeeping.">
              <textarea value={q.notes} onChange={(e) => setQ({ ...q, notes: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
            <Field label="Hint (shown on request in practice exams)">
              <textarea value={q.hint} onChange={(e) => setQ({ ...q, hint: e.target.value })} rows={2} style={{ ...monoInput, resize: "vertical" }} />
            </Field>
            <Field label="Explanation (shown after the exam is finished)">
              <textarea
                value={q.explanation}
                onChange={(e) => setQ({ ...q, explanation: e.target.value })}
                rows={2}
                style={{ ...monoInput, resize: "vertical" }}
              />
            </Field>
          </div>
        )}
      </div>

      {problems.length > 0 && (
        <div style={{ background: T.amberBg, color: T.amber, borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
          {problems.map((p, i) => (
            <div key={i}>• {p}</div>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ background: "#EEF3F8", color: "#3A6EA5", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
          {notes.map((p, i) => (
            <div key={i}>• {p}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={() => onSave({ ...q, answers: q.answers.filter((a) => a.text.trim()) })} disabled={problems.length > 0}>
          Save question
        </Btn>
        <Btn kind="quiet" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

/* ---------------- text blocks panel ---------------- */

function TextBlocksPanel({ blocks, setBlocks }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | block id
  const [draft, setDraft] = useState({ name: "", text: "" });

  const startEdit = (b) => {
    setEditing(b ? b.id : "new");
    setDraft(b ? { name: b.name, text: b.text } : { name: "", text: "" });
    setOpen(true);
  };
  const dupName = blocks.some((b) => b.id !== editing && normTag(b.name) === normTag(draft.name) && draft.name.trim());
  const canSave = draft.name.trim() && draft.text.trim() && !dupName;
  const save = () => {
    const b = normalizeBlock({ id: editing === "new" ? undefined : editing, name: draft.name, text: draft.text });
    setBlocks((prev) => (editing === "new" ? [...prev, b] : prev.map((x) => (x.id === editing ? b : x))));
    setEditing(null);
  };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Btn kind="quiet" small onClick={() => setOpen(!open)} active={open}>
          {open ? "▾" : "▸"} Text blocks ({blocks.length})
        </Btn>
        <span style={{ fontSize: 12, color: T.gray }}>
          Intro/context passages. Tag a question with a block's name and the block appears before it on the exam, with all
          matching questions grouped after one copy of it.
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Btn kind="ghost" small onClick={() => startEdit(null)}>
            + New text block
          </Btn>
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {editing != null && (
            <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <Field label="Block name (used as a tag)" hint="Tag questions with this exact name to attach the block.">
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...inputStyle, maxWidth: 300 }} placeholder="e.g. gravity-data" />
              </Field>
              <Field label="Block text" hint="Markdown supported, including tables — ideal for shared data.">
                <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={4} style={{ ...monoInput, resize: "vertical" }} />
              </Field>
              {dupName && (
                <div style={{ background: T.amberBg, color: T.amber, borderRadius: 6, padding: "6px 10px", fontSize: 13, marginBottom: 10 }}>
                  Another block already uses this name.
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={save} disabled={!canSave}>
                  Save block
                </Btn>
                <Btn kind="quiet" onClick={() => setEditing(null)}>
                  Cancel
                </Btn>
              </div>
            </div>
          )}
          {blocks.length === 0 && editing == null && (
            <div style={{ fontSize: 13, color: T.gray, padding: "6px 0" }}>No text blocks yet.</div>
          )}
          {blocks.map((b) => (
            <div key={b.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", borderTop: `1px solid ${T.line}`, padding: "10px 0" }}>
              <TagChip tag={b.name} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
                <Md text={b.text} block />
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn kind="quiet" small onClick={() => startEdit(b)}>
                  Edit
                </Btn>
                <Btn
                  kind="danger"
                  small
                  onClick={() => {
                    if (window.confirm("Delete this text block? Questions tagged with it keep the tag.")) setBlocks((prev) => prev.filter((x) => x.id !== b.id));
                  }}
                >
                  Delete
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- library view ---------------- */

function LibraryView({ questions, setQuestions, textBlocks, setTextBlocks, allTags, xorSet }) {
  const [editingId, setEditingId] = useState(null); // null | "new" | question id
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState({}); // { normTag: "in" | "out" }
  const fileRef = useRef(null);

  const filtered = questions.filter((q) => {
    const s = search.trim().toLowerCase();
    const allQTags = [...q.tags, ...(q.xtags || [])];
    const matchesSearch =
      !s ||
      q.text.toLowerCase().includes(s) ||
      q.answers.some((a) => a.text.toLowerCase().includes(s)) ||
      allQTags.some((t) => t.toLowerCase().includes(s)) ||
      (q.notes || "").toLowerCase().includes(s);
    const matchesTags = Object.entries(tagFilter).every(([key, mode]) => {
      const has = allQTags.some((t) => normTag(t) === key);
      return mode === "in" ? has : !has;
    });
    return matchesSearch && matchesTags;
  });

  const cycleFilter = (t) => {
    const key = normTag(t);
    setTagFilter((prev) => {
      const next = { ...prev };
      if (!next[key]) next[key] = "in";
      else if (next[key] === "in") next[key] = "out";
      else delete next[key];
      return next;
    });
  };

  const saveQuestion = (q) => {
    setQuestions((prev) => {
      const exists = prev.some((x) => x.id === q.id);
      return exists ? prev.map((x) => (x.id === q.id ? q : x)) : [...prev, q];
    });
    setEditingId(null);
  };

  const duplicate = (q) => {
    const copy = normalizeQuestion(JSON.parse(JSON.stringify(q)));
    copy.id = uid();
    copy.answers.forEach((a) => (a.id = uid()));
    copy.text = q.text + " (copy)";
    setQuestions((prev) => [...prev, copy]);
  };

  const exportJson = () => {
    downloadFile(
      `question-library-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ format: "mcq-library", version: 4, questions, textBlocks }, null, 2),
      "application/json"
    );
  };

  const exportQbl = () => {
    downloadFile(`question-library-${new Date().toISOString().slice(0, 10)}.qbl`, toQbl(questions), "text/plain");
  };

  /* Import: JSON (merged by question ID) or QBL (matched by exact question
     text — replaces the match, otherwise appended). Format auto-detected. */
  const importFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = reader.result;
        let incoming = null;
        let byIdMerge = false;
        try {
          const data = JSON.parse(txt);
          const arr = Array.isArray(data) ? data : data.questions;
          if (Array.isArray(arr)) {
            incoming = arr.map(normalizeQuestion);
            byIdMerge = true;
            if (Array.isArray(data.textBlocks)) {
              const blocks = data.textBlocks.map(normalizeBlock);
              setTextBlocks((prev) => {
                const byId = new Map(prev.map((b) => [b.id, b]));
                blocks.forEach((b) => byId.set(b.id, b));
                return [...byId.values()];
              });
            }
          }
        } catch {
          /* not JSON — fall through to QBL */
        }
        if (!incoming) incoming = parseQbl(txt);
        if (!incoming.length) throw new Error("No questions found in file.");
        setQuestions((prev) => {
          if (byIdMerge) {
            const byId = new Map(prev.map((q) => [q.id, q]));
            incoming.forEach((q) => byId.set(q.id, q));
            return [...byId.values()];
          }
          const byText = new Map(prev.map((q, i) => [q.text.trim(), i]));
          const next = [...prev];
          incoming.forEach((q) => {
            const at = byText.get(q.text.trim());
            if (at != null) next[at] = { ...q, id: next[at].id };
            else next.push(q);
          });
          return next;
        });
        alert(`Imported ${incoming.length} question${incoming.length === 1 ? "" : "s"} (${byIdMerge ? "JSON, merged by ID" : "QBL, matched by question text"}).`);
      } catch (e) {
        alert("Import failed: " + e.message);
      }
    };
    reader.readAsText(file);
  };

  const anyFilter = Object.keys(tagFilter).length > 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search questions, answers, tags, notes…"
          style={{ ...inputStyle, maxWidth: 340, flex: 1 }}
        />
        <Btn onClick={() => setEditingId("new")}>+ New question</Btn>
        <Btn kind="ghost" onClick={exportJson} title="Full-fidelity JSON backup of the library">
          Export JSON
        </Btn>
        <Btn kind="ghost" onClick={exportQbl} title="Export the library in QBL text format">
          Export QBL
        </Btn>
        <Btn kind="ghost" onClick={() => fileRef.current?.click()} title="Import a JSON backup or a QBL file (format auto-detected)">
          Import
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.qbl,.txt,application/json,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.[0]) importFile(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </div>

      {allTags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.gray, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Filter (click: include → exclude → off):
          </span>
          {allTags.map((t) => (
            <TagChip
              key={t}
              tag={t}
              xor={xorSet.has(normTag(t))}
              mode={tagFilter[normTag(t)]}
              onClick={() => cycleFilter(t)}
              title={
                tagFilter[normTag(t)] === "in"
                  ? "Showing only questions with this tag — click to exclude it instead"
                  : tagFilter[normTag(t)] === "out"
                  ? "Hiding questions with this tag — click to clear"
                  : "Click to show only questions with this tag"
              }
            />
          ))}
          {anyFilter && (
            <Btn kind="quiet" small onClick={() => setTagFilter({})}>
              Clear filters
            </Btn>
          )}
        </div>
      )}

      <TextBlocksPanel blocks={textBlocks} setBlocks={setTextBlocks} />

      {editingId === "new" && (
        <div style={{ marginBottom: 20 }}>
          <QuestionEditor initial={emptyQuestion()} allTags={allTags} onSave={saveQuestion} onCancel={() => setEditingId(null)} />
        </div>
      )}

      {filtered.length === 0 && editingId !== "new" && (
        <div style={{ textAlign: "center", padding: 48, color: T.gray, background: T.card, border: `1px dashed ${T.line}`, borderRadius: 10 }}>
          {questions.length === 0
            ? "The library is empty. Add your first question, or import a JSON backup."
            : "No questions match the current search/filter."}
        </div>
      )}

      {filtered.map((q) =>
        editingId === q.id ? (
          <div key={q.id} style={{ marginBottom: 12 }}>
            <QuestionEditor initial={q} allTags={allTags} onSave={saveQuestion} onCancel={() => setEditingId(null)} />
          </div>
        ) : (
          <div key={q.id} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "14px 18px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  <Md text={q.text} />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {q.tags.map((t) => (
                    <TagChip key={t} tag={t} />
                  ))}
                  {(q.xtags || []).map((t) => (
                    <TagChip key={"^" + t} tag={t} xor />
                  ))}
                </div>
                <div style={{ fontSize: 13, color: T.gray }}>
                  {q.answers.filter((a) => a.correct).length} correct · {q.answers.filter((a) => !a.correct).length} distractors ·{" "}
                  shows {q.numChoices} choices · {q.points ?? 1} pt{(q.points ?? 1) === 1 ? "" : "s"}
                  {q.hint?.trim() && " · hint"}
                  {q.explanation?.trim() && " · explanation"}
                  {q.notes?.trim() && " · notes"}
                  {!questionIsUsable(q) && <span style={{ color: T.amber, fontWeight: 600 }}> · needs more answers for its choice count</span>}
                </div>
                {q.notes?.trim() && (
                  <div style={{ fontSize: 12, color: T.gray, marginTop: 6, fontStyle: "italic" }}>
                    ✎ <Md text={q.notes} />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn kind="quiet" small onClick={() => setEditingId(q.id)}>
                  Edit
                </Btn>
                <Btn kind="quiet" small onClick={() => duplicate(q)}>
                  Duplicate
                </Btn>
                <Btn
                  kind="danger"
                  small
                  onClick={() => {
                    if (window.confirm("Delete this question permanently?")) setQuestions((prev) => prev.filter((x) => x.id !== q.id));
                  }}
                >
                  Delete
                </Btn>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ---------------- generate view ---------------- */

function GenerateView({ questions, setQuestions, textBlocks, allTags, xorSet }) {
  const [count, setCount] = useState(10);
  const [numVersions, setNumVersions] = useState(1);
  const [mode, setMode] = useState("independent"); // independent | shuffle | distinct
  const [constraints, setConstraints] = useState([]); // {id, tag, min, max|null}
  const [newTag, setNewTag] = useState("");
  const [versions, setVersions] = useState(null);
  const [active, setActive] = useState(0);
  const [meta, setMeta] = useState({ title: "Exam", course: "", date: new Date().toLocaleDateString() });
  const [showKey, setShowKey] = useState(true);
  // Post-generation editing controls
  const [addQId, setAddQId] = useState("");
  const [addBlockId, setAddBlockId] = useState("");
  const [examTag, setExamTag] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  // Pool size: usable questions not excluded by a max=0 constraint.
  const hardExcluded = constraints.filter((c) => c.max === 0).map((c) => c.tag);
  const poolSize = questions.filter((q) => questionIsUsable(q) && !hardExcluded.some((t) => hasTag(q, t))).length;

  const run = () => {
    setVersions(generateVersions(questions, textBlocks, { count, constraints, numVersions, mode }));
    setActive(0);
  };

  const setConstraint = (id, patch) => setConstraints((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const exporters = {
    html: { fn: examToHtml, ext: "html", mime: "text/html", label: "HTML (practice)" },
    tex: { fn: examToLatex, ext: "tex", mime: "application/x-tex", label: "LaTeX" },
    md: { fn: examToMarkdown, ext: "md", mime: "text/markdown", label: "Markdown" },
    csv: { fn: examToD2lCsv, ext: "csv", mime: "text/csv", label: "D2L CSV" },
  };

  const many = versions && versions.length > 1;

  const exportVersion = (fmt, v) => {
    const e = exporters[fmt];
    const name = `${slug(meta.title)}${many ? "-v" + v.label : ""}${fmt === "csv" ? "-d2l" : ""}.${e.ext}`;
    downloadFile(name, e.fn(v.entries, meta, v.label, many, textBlocks), e.mime);
  };

  const exportAll = (fmt) => {
    versions.forEach((v, i) => setTimeout(() => exportVersion(fmt, v), i * 400));
  };

  const current = versions?.[active];

  /* ----- manual editing of the active version ----- */
  const updateEntries = (fn) =>
    setVersions((prev) => prev.map((v, i) => (i === active ? { ...v, entries: fn(v.entries) } : v)));

  const usedIds = new Set(current ? entryQuestions(current.entries).map((it) => it.question.id) : []);
  const addableQs = questions.filter((q) => questionIsUsable(q) && !usedIds.has(q.id));

  const addQuestion = (q) => updateEntries((es) => [...es, { key: uid(), type: "q", item: buildItem(q) }]);
  const addBlock = (b) => updateEntries((es) => [...es, { key: uid(), type: "block", block: b }]);
  const addRandom = () => {
    if (addableQs.length) addQuestion(sample(addableQs, 1)[0]);
  };
  const removeEntry = (key) => updateEntries((es) => es.filter((e) => e.key !== key));
  const moveEntry = (from, to) => {
    if (from == null || to == null || from === to) return;
    updateEntries((es) => {
      const next = [...es];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  };

  const tagExamQuestions = () => {
    const tag = examTag.trim();
    if (!tag || !current) return;
    const ids = new Set(entryQuestions(current.entries).map((it) => it.question.id));
    // Update the library...
    setQuestions((prev) => prev.map((q) => (ids.has(q.id) && !hasTag(q, tag) ? { ...q, tags: [...q.tags, tag] } : q)));
    // ...and the snapshots held by every generated version, so the preview agrees.
    setVersions((prev) =>
      prev.map((v) => ({
        ...v,
        entries: v.entries.map((e) =>
          e.type === "q" && ids.has(e.item.question.id) && !hasTag(e.item.question, tag)
            ? { ...e, item: { ...e.item, question: { ...e.item.question, tags: [...e.item.question.tags, tag] } } }
            : e
        ),
      }))
    );
    setExamTag("");
  };

  const qLabel = (q) => {
    const plain = q.text.replace(/[`*~\[\]!|>#]/g, "").replace(/\s+/g, " ").trim();
    return plain.length > 70 ? plain.slice(0, 70) + "…" : plain;
  };

  // Question numbering for the preview.
  let previewN = 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 380px) 1fr", gap: 20, alignItems: "start" }}>
      {/* ---- config column ---- */}
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 20 }}>
        <div style={{ display: "flex", gap: 16 }}>
          <Field label="Questions">
            <input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 80 }}
            />
          </Field>
          <Field label="Versions">
            <input
              type="number"
              min={1}
              max={12}
              value={numVersions}
              onChange={(e) => setNumVersions(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 80 }}
            />
          </Field>
        </div>

        {numVersions > 1 && (
          <Field label="Version mode">
            {[
              ["independent", "Generate independently", "Each version is drawn fresh; overlap possible."],
              ["shuffle", "Same questions, different order", "One question set; question and answer order reshuffled per version."],
              ["distinct", "Different questions", `Disjoint sets — needs ≥ ${count * numVersions} eligible questions.`],
            ].map(([val, label, hint]) => (
              <label key={val} style={{ display: "block", fontSize: 14, marginBottom: 6, cursor: "pointer" }}>
                <input type="radio" name="vmode" checked={mode === val} onChange={() => setMode(val)} style={{ accentColor: T.green, marginRight: 8 }} />
                {label}
                <div style={{ fontSize: 12, color: T.gray, marginLeft: 24 }}>{hint}</div>
              </label>
            ))}
          </Field>
        )}

        <Field
          label="Tag constraints (min / max per exam)"
          hint={
            "Blank max = no limit. min 0 / max 0 excludes a tag entirely; min = exam length makes it required on every question." +
            (xorSet.size > 0
              ? ` Exclusive ^tags (${xorSet.size}) are automatically capped at 1 per exam; add an explicit constraint to override.`
              : "")
          }
        >
          {constraints.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  background: T.greenSoft,
                  color: T.green,
                  padding: "4px 8px",
                  borderRadius: 4,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.tag}
              </span>
              <input
                type="number"
                min={0}
                value={c.min}
                onChange={(e) => setConstraint(c.id, { min: Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ ...inputStyle, width: 58 }}
                title="Minimum"
              />
              <span style={{ color: T.gray, fontSize: 13 }}>–</span>
              <input
                type="number"
                min={0}
                value={c.max ?? ""}
                placeholder="∞"
                onChange={(e) => setConstraint(c.id, { max: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ ...inputStyle, width: 58 }}
                title="Maximum (blank = unlimited)"
              />
              <Btn kind="quiet" small onClick={() => setConstraints((prev) => prev.filter((x) => x.id !== c.id))}>
                ✕
              </Btn>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <select value={newTag} onChange={(e) => setNewTag(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">— add tag constraint —</option>
              {allTags
                .filter((t) => !constraints.some((c) => normTag(c.tag) === normTag(t)))
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>
            <Btn
              kind="ghost"
              small
              disabled={!newTag}
              onClick={() => {
                setConstraints((prev) => [...prev, { id: uid(), tag: newTag, min: 1, max: null }]);
                setNewTag("");
              }}
            >
              Add
            </Btn>
          </div>
        </Field>

        <div style={{ fontSize: 13, color: T.gray, marginBottom: 14 }}>
          Eligible pool: <b style={{ color: T.ink }}>{poolSize}</b> question{poolSize === 1 ? "" : "s"}
          {numVersions > 1 && mode === "distinct" && (
            <span style={{ color: poolSize >= count * numVersions ? T.gray : T.red }}>
              {" "}
              (need {count * numVersions} for {numVersions} distinct versions)
            </span>
          )}
        </div>

        <Btn onClick={run} disabled={questions.length === 0}>
          {versions ? "Regenerate" : "Generate"}
          {numVersions > 1 ? ` ${numVersions} versions` : " exam"}
        </Btn>
        {versions && (
          <div style={{ fontSize: 12, color: T.gray, marginTop: 8 }}>
            Regenerating discards manual edits to the current draft.
          </div>
        )}
      </div>

      {/* ---- result column ---- */}
      <div>
        {!versions && (
          <div style={{ textAlign: "center", padding: 48, color: T.gray, background: T.card, border: `1px dashed ${T.line}`, borderRadius: 10 }}>
            Configure the exam on the left, then generate. Each generation re-samples questions, correct answers, distractors,
            and ordering — then fine-tune by hand: drag to reorder, ✕ to remove, and add specific questions or text blocks.
          </div>
        )}

        {versions && (
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 20 }}>
            {/* meta + exports */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} style={{ ...inputStyle, width: 170 }} placeholder="Exam title" />
              <input value={meta.course} onChange={(e) => setMeta({ ...meta, course: e.target.value })} style={{ ...inputStyle, width: 150 }} placeholder="Course (e.g. CSE 336)" />
              <input value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} style={{ ...inputStyle, width: 115 }} placeholder="Date" />
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", cursor: "pointer" }}>
                <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} style={{ accentColor: T.green }} />
                Show key
              </label>
            </div>

            {/* version tabs */}
            {many && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {versions.map((v, i) => (
                  <Btn key={v.label} kind="quiet" small active={i === active} onClick={() => { setActive(i); setDragIdx(null); setOverIdx(null); }}>
                    Version {v.label}
                  </Btn>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12, borderBottom: `1px solid ${T.line}`, paddingBottom: 12 }}>
              <span style={{ fontSize: 12, color: T.gray, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Download{many ? ` version ${current.label}` : ""}:
              </span>
              {Object.entries(exporters).map(([fmt, e]) => (
                <Btn key={fmt} kind="ghost" small onClick={() => exportVersion(fmt, current)}>
                  ⬇ {e.label}
                </Btn>
              ))}
              {many && (
                <>
                  <span style={{ fontSize: 12, color: T.gray, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginLeft: 10 }}>
                    All versions:
                  </span>
                  {Object.entries(exporters).map(([fmt, e]) => (
                    <Btn key={fmt} kind="quiet" small onClick={() => exportAll(fmt)} title={`Download every version as ${e.label}`}>
                      {e.ext}
                    </Btn>
                  ))}
                </>
              )}
            </div>

            {/* manual editing toolbar */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14, borderBottom: `1px solid ${T.line}`, paddingBottom: 14 }}>
              <select value={addQId} onChange={(e) => setAddQId(e.target.value)} style={{ ...inputStyle, width: 250 }}>
                <option value="">— pick a question to add —</option>
                {addableQs.map((q) => (
                  <option key={q.id} value={q.id}>
                    {qLabel(q)}
                  </option>
                ))}
              </select>
              <Btn
                kind="ghost"
                small
                disabled={!addQId}
                onClick={() => {
                  const q = questions.find((x) => x.id === addQId);
                  if (q) addQuestion(q);
                  setAddQId("");
                }}
              >
                + Add selected question
              </Btn>
              <Btn kind="ghost" small disabled={addableQs.length === 0} onClick={addRandom} title="Add a random unused question from the library">
                + Add random question
              </Btn>
              {textBlocks.length > 0 && (
                <>
                  <select value={addBlockId} onChange={(e) => setAddBlockId(e.target.value)} style={{ ...inputStyle, width: 160 }}>
                    <option value="">— text block —</option>
                    {textBlocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <Btn
                    kind="ghost"
                    small
                    disabled={!addBlockId}
                    onClick={() => {
                      const b = textBlocks.find((x) => x.id === addBlockId);
                      if (b) addBlock(b);
                      setAddBlockId("");
                    }}
                  >
                    + Add text block
                  </Btn>
                </>
              )}
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                <input
                  value={examTag}
                  onChange={(e) => setExamTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && tagExamQuestions()}
                  placeholder="e.g. Exam1-2026"
                  style={{ ...inputStyle, width: 140 }}
                  title="Tag every question on this exam (updates the library)"
                />
                <Btn kind="ghost" small disabled={!examTag.trim()} onClick={tagExamQuestions}>
                  Tag exam questions
                </Btn>
              </span>
            </div>

            {current.warnings.map((w, i) => (
              <div key={i} style={{ background: T.amberBg, color: T.amber, borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 8 }}>
                ⚠ {w}
              </div>
            ))}

            {/* preview: draggable entries */}
            {current.entries.length === 0 && (
              <div style={{ textAlign: "center", padding: 32, color: T.gray }}>Empty exam — add questions above.</div>
            )}
            {current.entries.map((entry, idx) => {
              const isBlock = entry.type === "block";
              if (!isBlock) previewN++;
              const n = previewN;
              return (
                <div
                  key={entry.key}
                  onDragOver={(e) => {
                    if (dragIdx == null) return;
                    e.preventDefault();
                    setOverIdx(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveEntry(dragIdx, idx);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    marginBottom: isBlock ? 12 : 18,
                    opacity: dragIdx === idx ? 0.4 : 1,
                    borderTop: overIdx === idx && dragIdx != null && dragIdx !== idx ? `2px solid ${T.green}` : "2px solid transparent",
                  }}
                >
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(idx);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                    title="Drag to reorder"
                    style={{ cursor: "grab", color: T.gray, fontSize: 15, userSelect: "none", padding: "2px 2px 0 0", flexShrink: 0 }}
                  >
                    ⠿
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isBlock ? (
                      <div
                        style={{
                          background: "#F7F7F2",
                          border: `1px solid ${T.line}`,
                          borderLeft: `4px solid ${T.green}`,
                          borderRadius: 6,
                          padding: "10px 14px",
                        }}
                      >
                        <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: T.green, marginBottom: 4 }}>
                          ■ text block: {entry.block.name}
                        </div>
                        <Md text={entry.block.text} block />
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>
                          {n}. <Md text={entry.item.question.text} />{" "}
                          <span style={{ fontWeight: 400, color: T.gray, fontSize: 13 }}>
                            ({entry.item.question.points ?? 1} pt{(entry.item.question.points ?? 1) === 1 ? "" : "s"})
                          </span>
                        </div>
                        {entry.item.options.map((o, j) => (
                          <div
                            key={j}
                            style={{
                              marginLeft: 24,
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: 14,
                              background: showKey && o.correct ? T.greenSoft : "transparent",
                              color: showKey && o.correct ? T.green : T.ink,
                              fontWeight: showKey && o.correct ? 600 : 400,
                            }}
                          >
                            <span style={{ display: "inline-block", minWidth: 22, fontWeight: 600 }}>{LETTERS[j]}.</span>
                            <Md text={o.text} />
                            {showKey && o.correct && " ✓"}
                          </div>
                        ))}
                        {showKey && entry.item.question.explanation?.trim() && (
                          <div style={{ marginLeft: 24, marginTop: 4, fontSize: 13, color: "#3A6EA5" }}>
                            ↳ <Md text={entry.item.question.explanation} />
                          </div>
                        )}
                        <div style={{ marginLeft: 24, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {[...entry.item.question.tags.map((t) => "#" + t), ...(entry.item.question.xtags || []).map((t) => "^" + t)].map((t) => (
                            <span key={t} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#7A867F" }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <Btn kind="quiet" small onClick={() => removeEntry(entry.key)} title={isBlock ? "Remove this text block" : "Remove this question from the exam"}>
                    ✕
                  </Btn>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- root ---------------- */

export default function App() {
  const [questions, setQuestions] = useState([]);
  const [textBlocks, setTextBlocks] = useState([]);
  const [view, setView] = useState("library");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (result?.value) {
          const data = JSON.parse(result.value);
          if (Array.isArray(data.questions)) setQuestions(data.questions.map(normalizeQuestion));
          if (Array.isArray(data.textBlocks)) setTextBlocks(data.textBlocks.map(normalizeBlock));
        }
      } catch {
        // No saved library yet — start fresh.
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify({ questions, textBlocks }));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [questions, textBlocks, loaded]);

  const { allTags, xorSet } = useMemo(() => {
    const seen = new Map();
    const xor = new Set();
    questions.forEach((q) => {
      q.tags.forEach((t) => seen.set(normTag(t), t));
      (q.xtags || []).forEach((t) => {
        seen.set(normTag(t), t);
        xor.add(normTag(t));
      });
    });
    return { allTags: [...seen.values()].sort((a, b) => a.localeCompare(b)), xorSet: xor };
  }, [questions]);

  const tabStyle = (isActive) => ({
    padding: "10px 20px",
    border: "none",
    borderBottom: isActive ? `3px solid ${T.green}` : "3px solid transparent",
    background: "none",
    fontSize: 15,
    fontWeight: isActive ? 700 : 500,
    color: isActive ? T.green : T.gray,
    cursor: "pointer",
    fontFamily: "'IBM Plex Sans', sans-serif",
  });

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600;700&display=swap');
        input:focus, textarea:focus, select:focus { outline: 2px solid ${T.green}; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid ${T.green}; outline-offset: 2px; }
        .md .md-pre { background: #F0F2EF; border: 1px solid ${T.line}; border-radius: 6px; padding: 8px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; overflow-x: auto; white-space: pre; margin: 6px 0; display: block; }
        .md .md-code { background: #F0F2EF; border: 1px solid ${T.line}; border-radius: 4px; padding: 0 4px; font-family: 'IBM Plex Mono', monospace; font-size: 0.92em; }
        .md .md-img { max-width: 100%; max-height: 320px; border: 1px solid ${T.line}; border-radius: 6px; display: block; margin: 6px 0; }
        .md a { color: ${T.green}; text-decoration: underline; }
        .md .md-table { border-collapse: collapse; margin: 8px 0; font-size: 0.95em; }
        .md .md-table th, .md .md-table td { border: 1px solid ${T.line}; padding: 4px 10px; }
        .md .md-table th { background: #EDF1EC; }`}</style>

      <header style={{ background: T.green, color: "#fff", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1150, margin: "0 auto", display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 24, margin: 0 }}>Exam Forge</h1>
          <span style={{ fontSize: 13, opacity: 0.8 }}>multiple-choice question bank &amp; generator</span>
          <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, opacity: 0.85 }}>
            {questions.length} questions ·{" "}
            {saveState === "saving" ? "saving…" : saveState === "error" ? "⚠ save failed" : saveState === "saved" ? "saved" : ""}
          </span>
        </div>
      </header>

      <nav style={{ background: T.card, borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 1150, margin: "0 auto", display: "flex", padding: "0 16px" }}>
          <button style={tabStyle(view === "library")} onClick={() => setView("library")}>
            Question Library
          </button>
          <button style={tabStyle(view === "generate")} onClick={() => setView("generate")}>
            Generate Exam
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1150, margin: "0 auto", padding: "24px 16px 64px" }}>
        {!loaded ? (
          <div style={{ textAlign: "center", padding: 48, color: T.gray }}>Loading library…</div>
        ) : view === "library" ? (
          <LibraryView
            questions={questions}
            setQuestions={setQuestions}
            textBlocks={textBlocks}
            setTextBlocks={setTextBlocks}
            allTags={allTags}
            xorSet={xorSet}
          />
        ) : (
          <GenerateView
            questions={questions}
            setQuestions={setQuestions}
            textBlocks={textBlocks}
            allTags={allTags}
            xorSet={xorSet}
          />
        )}
      </main>
    </div>
  );
}
