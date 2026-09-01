/* ============================================================
   DOCTRINE — game flow
   ============================================================ */
(function () {
'use strict';
const S = window.SCHOOLS, ORD = window.SCHOOL_ORDER;
const POL = window.POLITIES, SITES = window.SITES, PLACE = window.PLACE;
const CRISES = (window.CRISES_A || []).concat(window.CRISES_B || []);
const $ = s => document.querySelector(s);
const md = t => String(t).replace(/\*([^*]+)\*/g, '<em>$1</em>');

if (!window.GLOBE) {
  const noop = () => {};
  window.GLOBE = {setMap: noop, setLabels: noop, lookAt: noop, pullBack: noop, setArcs: noop,
    setMarks: noop, setEscalation: noop, shake: noop, flash: noop};
  document.body.classList.add('gl-fallback');
}

const panel = $('#panel'), cine = $('#cine');
const G = {
  i: 0, phase: 'title',
  stats: {power: 5, security: 6, legit: 5, domestic: 6, esc: 2},
  aff: Object.fromEntries(ORD.map(k => [k, 0])),
  avail: Object.fromEntries(ORD.map(k => [k, 0])),
  insight: 0, asked: 0, right: 0, trace: [], seen: new Set(), pick: null
};
const CAPS = {power: 14, security: 14, legit: 14, domestic: 14, esc: 12};
const esc01 = () => Math.max(0, Math.min(1, G.stats.esc / CAPS.esc));

/* Schools are not offered equally often, so affinity is scored as a share of
   what was actually on the table for that school. Otherwise a consistently
   Morgenthau-ish player gets diagnosed as an offensive realist. */
const creditAvailable = c => ORD.forEach(k => {
  G.avail[k] += Math.max(0, ...c.options.map(o => o.aff[k] || 0));
});
/* A pseudo-count keeps the radar honest early on: without it, one choice in
   crisis 1 reads as "100% offensive realist". */
const PRIOR = 3;
const share = k => G.avail[k] ? G.aff[k] / (G.avail[k] + PRIOR) : 0;
const pct = k => Math.round(share(k) * 100);
const ranked = () => ORD.slice().sort((a, b) => share(b) - share(a) || G.aff[b] - G.aff[a]);

/* ─── HUD ────────────────────────────────────────────────── */
const GA = [['power', 'Power'], ['security', 'Safety'], ['legit', 'Standing'], ['domestic', 'Support']];
const ESC_WORD = ['CALM','CALM','LOW','LOW','UNEASY','UNEASY','TENSE','TENSE','BAD','BAD','SEVERE','CRITICAL','CRITICAL'];

function buildHud() {
  $('#gauges').innerHTML = GA.map(([k, l]) =>
    `<div class="g" data-g="${k}"><i>${l}</i><span class="tk"><b></b></span><u></u></div>`).join('') +
    `<div class="g esc" data-g="esc"><i>Tension</i><span class="tk"><b></b></span><u></u></div>`;
  paintHud();
}
function paintHud(d) {
  Object.keys(CAPS).forEach(k => {
    const el = $(`.g[data-g="${k}"]`); if (!el) return;
    el.querySelector('b').style.width = Math.max(0, Math.min(100, G.stats[k] / CAPS[k] * 100)) + '%';
    el.querySelector('u').textContent = k === 'esc'
      ? ESC_WORD[Math.max(0, Math.min(12, Math.round(G.stats[k])))]
      : Math.round(G.stats[k]);
    if (d && d[k]) {
      const t = document.createElement('s');
      t.textContent = (d[k] > 0 ? '+' : '') + d[k];
      t.className = d[k] > 0 ? 'pos' : 'neg';
      el.appendChild(t);
      setTimeout(() => t.remove(), 2400);
    }
  });
}

const RC = 100, RR = 74;
const pt = (i, f) => {
  const a = -Math.PI / 2 + i * Math.PI / 4;
  return [RC + Math.cos(a) * RR * f, RC + Math.sin(a) * RR * f];
};
function buildRadar() {
  let h = '';
  [0.33, 0.66, 1].forEach(f =>
    h += `<polygon class="grid" points="${ORD.map((_, i) => pt(i, f).join(',')).join(' ')}"/>`);
  ORD.forEach((k, i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.24);
    h += `<line class="spoke" x1="${RC}" y1="${RC}" x2="${x}" y2="${y}"/>`;
    const an = Math.abs(lx - RC) < 5 ? 'middle' : (lx > RC ? 'start' : 'end');
    h += `<text class="lbl" data-k="${k}" x="${lx}" y="${ly + 2}" text-anchor="${an}">${S[k].abbr}</text>`;
  });
  h += `<polygon class="blob" id="blob" points="${ORD.map((_, i) => pt(i, .03).join(',')).join(' ')}"/>`;
  $('#radar').innerHTML = h;
}
function paintRadar() {
  const r = k => 0.03 + 0.97 * share(k);
  $('#blob').setAttribute('points', ORD.map((k, i) => pt(i, r(k)).join(',')).join(' '));
  const rank = ranked();
  document.querySelectorAll('#radar .lbl').forEach(t =>
    t.classList.toggle('hi', share(t.dataset.k) > 0 && t.dataset.k === rank[0]));
  $('#lead').innerHTML = rank.slice(0, 4).map(k =>
    `<div class="row"><span class="nm" style="color:${S[k].color}">${S[k].short}</span>
      <span class="bar"><i style="width:${share(k) * 100}%;background:${S[k].color}"></i></span>
      <span class="vl">${pct(k)}</span></div>`).join('');
}
function paintTop() {
  const c = CRISES[G.i];
  $('#tAct').textContent = c ? 'ACT ' + c.act : 'DEBRIEF';
  $('#tProg').textContent = Math.min(G.i + 1, CRISES.length) + '/' + CRISES.length;
  $('#tIns').textContent = G.insight;
}

/* ─── map ────────────────────────────────────────────────── */
function paintMap(active) {
  const on = active || [];
  window.GLOBE.setMap(POL, on);
  window.GLOBE.setLabels([].concat(
    POL.map(p => ({name: p.name,
                   role: on.includes(p.id) ? p.role : (p.id === 'MERIDIA' ? 'You' : ''),
                   lat: p.lat, lng: p.lng, color: p.color,
                   active: on.includes(p.id) || p.id === 'MERIDIA'})),
    SITES.filter(s => on.includes(s.id)).map(s =>
      ({name: s.name, role: s.role, lat: s.lat, lng: s.lng, color: s.color, active: true}))
  ));
  window.GLOBE.setMarks(on.map(id => PLACE[id]).filter(p => p && !p.discs)
    .map(p => ({lat: p.lat, lng: p.lng, color: p.color, big: true})));
}
function arcCoords(c) {
  return (c.arcs || []).map(([a, b]) => {
    const A = PLACE[a], B = PLACE[b];
    return A && B ? [A.lat, A.lng, B.lat, B.lng] : null;
  }).filter(Boolean);
}

/* ─── panel plumbing ────────────────────────────────────── */
function show(html) {
  panel.innerHTML = html;
  panel.scrollTop = 0;
  panel.classList.remove('out');
}
const hidePanel = () => panel.classList.add('out');

/* ─── screens ───────────────────────────────────────────── */
function brief() {
  const c = CRISES[G.i];
  G.phase = 'brief';
  creditAvailable(c);
  window.GLOBE.setEscalation(esc01());
  paintMap(c.where);
  window.GLOBE.setArcs(arcCoords(c));
  const look = PLACE[c.look];
  if (look) window.GLOBE.lookAt(look.lat, look.lng);
  paintTop();
  show(`
    <div class="eyebrow"><span class="dot"></span>Act ${c.act} · ${c.code}</div>
    <h1>${c.title}</h1>
    <div class="sub">${c.sub}</div>
    <p class="lede">${c.setup}</p>
    <div class="facts">${c.facts.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <div class="idea"><div class="k">${c.idea.term}</div><div class="d">${c.idea.def}</div></div>
    <button class="btn" id="go">What are my options? →</button>`);
  $('#go').onclick = options;
}

function options() {
  const c = CRISES[G.i];
  G.phase = 'options';
  show(`
    <div class="eyebrow">${c.code} · pick one</div>
    <h2>${c.title}</h2>
    <div class="sub">Each one is what some serious theory would tell you to do.</div>
    <div class="opts">${c.options.map((o, n) =>
      `<button class="opt" data-n="${n}"><span class="k">${o.id}</span><span>${o.label}</span></button>`).join('')}
    </div>
    <div class="tiny">Keys 1–5 · there is no right answer</div>`);
  panel.querySelectorAll('.opt').forEach(b => b.onclick = () => choose(+b.dataset.n));
}

/* the beat where you get to watch the map instead of reading */
function choose(n) {
  const c = CRISES[G.i], o = c.options[n];
  G.pick = o;
  G.phase = 'cine';
  const d = {};
  Object.entries(o.effect).forEach(([k, v]) => {
    d[k] = v; G.stats[k] = Math.max(0, Math.min(CAPS[k], G.stats[k] + v));
  });
  Object.entries(o.aff).forEach(([k, v]) => {G.aff[k] += v; G.seen.add(k);});
  G.seen.add(o.teach.who);
  G.trace.push({code: c.code, opt: o.id, label: o.label, who: o.teach.who});

  hidePanel();
  cine.innerHTML = `<div class="cap">${o.flash}</div>`;
  cine.classList.add('on');

  window.GLOBE.setEscalation(esc01());
  window.GLOBE.setArcs(arcCoords(c));
  paintMap(c.where);
  paintHud(d); paintRadar();
  if (o.effect.esc >= 2) {
    window.GLOBE.shake(0.9 + o.effect.esc * 0.2);
    window.GLOBE.flash('rgba(255,90,60,.26)');
  } else if (o.effect.esc <= -2) {
    window.GLOBE.flash('rgba(90,220,190,.15)');
  }
  setTimeout(() => {cine.classList.remove('on'); outcome();}, 2500);
}

function outcome() {
  const c = CRISES[G.i], o = G.pick, r = S[o.teach.who];
  G.phase = 'outcome';
  show(`
    <div class="eyebrow">What happened · ${c.code}</div>
    <h2>${o.label}</h2>
    <p class="lede">${o.then}</p>
    <div class="teach" style="--c:${r.color}">
      <div class="hd"><span class="gl">${r.glyph}</span>
        <span><b>${r.name}</b><i>${r.thinkers}</i></span></div>
      <p>${md(o.teach.body)}</p>
    </div>
    <div class="chips">${Object.entries(o.aff).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span style="color:${S[k].color};border-color:${S[k].color}55">${S[k].short} +${v}</span>`)
      .join('')}</div>
    <button class="btn cy" id="go">Someone disagrees →</button>`);
  $('#go').onclick = test;
}

function test() {
  const c = CRISES[G.i], t = c.test, sp = S[t.from];
  G.phase = 'test';
  G.seen.add(t.from);
  show(`
    <div class="eyebrow" style="color:${sp.color}">${t.speaker} · ${sp.short}</div>
    <p class="q">${t.q}</p>
    <div id="qo">${t.options.map((o, n) =>
      `<button class="qopt" data-i="${n}"><i>${'ABCD'[n]}</i><span>${o.text}</span></button>`).join('')}</div>
    <div id="fb"></div>`);
  panel.querySelectorAll('.qopt').forEach(b => b.onclick = () => answer(+b.dataset.i, b));
}

function answer(i, btn) {
  const t = CRISES[G.i].test, o = t.options[i];
  G.asked++;
  panel.querySelectorAll('.qopt').forEach(b => {
    b.disabled = true;
    if (t.options[+b.dataset.i].ok) b.classList.add('ok');
    else if (b === btn) b.classList.add('no');
  });
  if (o.ok) {G.insight += 2; G.right++;} else G.insight += 1;
  paintTop();
  $('#fb').innerHTML = `
    <div class="fb ${o.ok ? 'ok' : 'no'}"><b>${o.ok ? 'Yes' : 'Not quite'}</b>${md(o.why)}</div>
    <div class="row2"><button class="btn" id="nx">
      ${G.i + 1 < CRISES.length ? 'Next situation →' : 'See your doctrine →'}</button>
      <button class="btn cy sm" id="cx2">Codex</button></div>`;
  $('#nx').onclick = next;
  $('#cx2').onclick = openCodex;
}

function next() {
  G.i++;
  if (G.i >= CRISES.length) return finale();
  brief();
}

/* ─── world panel ───────────────────────────────────────── */
function openWorld() {
  $('#world').classList.add('on');
  $('#wgrid').innerHTML = [].concat(POL, SITES).map(p =>
    `<div class="wc" style="--c:${p.color}"><b>${p.name}</b><i>${p.role}</i><span>${p.desc}</span></div>`).join('');
}

/* ─── codex ─────────────────────────────────────────────── */
function openCodex() {
  $('#cxgrid').innerHTML = ORD.map((k, n) => {
    const s = S[k], on = G.seen.has(k);
    return `<div class="cx ${on ? '' : 'locked'}" style="--c:${s.color};animation-delay:${n * .04}s">
      <div class="hd"><span class="gl">${s.gl || s.glyph}</span>
        <span><b>${s.name}</b><i>${s.family === 'realist' ? 'a kind of realism' : 'a rival school'}
        · you scored ${pct(k)}%</i></span></div>
      ${on ? `<dl>
        <dt>In a line</dt><dd>${md(s.oneLine)}</dd>
        <dt>The argument</dt><dd>${md(s.claim)}</dd>
        <dt>What it looks at</dt><dd>${md(s.unit)}</dd>
        <dt>What drives events</dt><dd>${md(s.engine)}</dd>
        <dt>How you can spot yourself doing it</dt><dd>${md(s.tell)}</dd>
        <dt>What would prove it wrong</dt><dd>${md(s.falsifier)}</dd>
        <dt>Its sharpest critic</dt><dd>${md(s.quarrel)}</dd>
        <dt>If you think in models</dt><dd>${md(s.compSci)}</dd>
        <dt>Read</dt><dd>${md(s.text)}</dd></dl>`
      : `<dl><dt>Locked</dt><dd>Take an option scored to this school, or be challenged by it,
          to open the full entry.</dd></dl>`}</div>`;
  }).join('');
  $('#codex').classList.add('on');
}

/* ─── finale ────────────────────────────────────────────── */
function finale() {
  G.phase = 'end';
  paintTop();
  window.GLOBE.pullBack();
  window.GLOBE.setArcs([]);
  paintMap(POL.map(p => p.id));
  const rank = ranked(), top = S[rank[0]], bottom = S[rank[7]];
  const REAL = ['cla', 'def', 'off', 'neo', 'heg'];
  const realRank = REAL.slice().sort((a, b) => share(b) - share(a));
  const sum = ORD.reduce((s, k) => s + share(k), 0) || 1;
  const famShare = REAL.reduce((s, k) => s + share(k), 0) / sum;
  const lean = famShare > 0.62 ? 'You played it as a realist.'
    : famShare < 0.38 ? 'You mostly refused realism.'
    : 'You were a realist with doubts.';
  show(`
    <div class="eyebrow">Debrief · what you actually believed</div>
    <h1><span style="color:${top.color}">${top.glyph}</span> ${top.name}</h1>
    <div class="sub">${md(top.oneLine)}</div>
    <div class="score">
      <div><i>Insight</i><b>${G.insight}</b></div>
      <div><i>Challenges right</i><b>${G.right}/${G.asked}</b></div>
      <div><i>Tension at the end</i><b>${Math.round(G.stats.esc)}/12</b></div>
    </div>
    <p class="lede">${lean} You took <b>${pct(rank[0])}%</b> of the ${top.short} options available to
      you, <b>${pct(rank[1])}%</b> of the ${S[rank[1]].short} ones and <b>${pct(rank[2])}%</b> of the
      ${S[rank[2]].short} ones.</p>
    <p class="lede">Inside the realist family — the split this game is about — you leaned
      <b style="color:${S[realRank[0]].color}">${S[realRank[0]].short}</b> over
      ${S[realRank[1]].short} and ${S[realRank[2]].short}. ${md(top.tell)}</p>
    <div class="teach" style="--c:${top.color}">
      <div class="hd"><span class="gl">${top.glyph}</span><span><b>Your school, stated fairly</b></span></div>
      <p>${md(top.claim)}</p></div>
    <div class="teach" style="--c:${S[rank[1]].color}">
      <div class="hd"><span class="gl">✕</span><span><b>Its sharpest critic</b></span></div>
      <p>${md(top.quarrel)}</p></div>
    <p class="lede"><b>You kept refusing ${bottom.name}</b> — only ${pct(rank[7])}% of what it offered.
      Its position: ${md(bottom.oneLine)}</p>
    <div class="tiny">Decision trace</div>
    <div class="trace">${G.trace.map((t, n) =>
      `${String(n + 1).padStart(2, '0')} <b>${t.code}</b> ${t.opt} —
       <span style="color:${S[t.who].color}">${S[t.who].short}</span>`).join('<br>')}</div>
    <div class="row2"><button class="btn" id="cx3">Read all eight schools</button>
      <button class="btn cy sm" id="again">Play again</button></div>`);
  $('#cx3').onclick = () => {ORD.forEach(k => G.seen.add(k)); openCodex();};
  $('#again').onclick = () => location.reload();
}

/* ─── boot ──────────────────────────────────────────────── */
function start() {
  $('#title').classList.add('gone');
  buildHud(); buildRadar(); paintRadar(); paintTop();
  window.GLOBE.setEscalation(esc01());
  brief();
}
paintMap([]);
$('#begin').onclick = start;
$('#cxOpen').onclick = openCodex;
$('#cxClose').onclick = () => $('#codex').classList.remove('on');
$('#wOpen').onclick = openWorld;
$('#wClose').onclick = () => $('#world').classList.remove('on');
$('#wTitle').onclick = openWorld;
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('#codex').classList.remove('on'); $('#world').classList.remove('on'); return;
  }
  if ($('#codex').classList.contains('on') || $('#world').classList.contains('on')) return;
  if (G.phase === 'title' && (e.key === 'Enter' || e.key === ' ')) return start();
  if (G.phase === 'options') {
    const b = panel.querySelector(`.opt[data-n="${+e.key - 1}"]`);
    if (b) return b.click();
  }
  if (e.key === 'Enter') {const b = $('#go') || $('#nx'); if (b) b.click();}
});
})();
