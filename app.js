/* LOTRO skill and effect database - client. All data is static JSON under data/. */

var BUCKETS = 128;
var INDEX = [];
var META = {};
var cache = { skill: {}, effect: {}, rawskill: {}, raweffect: {} };
var PROG = null;
var selected = null;

/* ---------------- data loading ---------------- */

function getJSON(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error(url + ": " + r.status);
    return r.json();
  });
}

function bucketOf(id) { return id % BUCKETS; }

function loadRecord(kind, id, raw) {
  // kind is "skill" or "effect"; raw picks the pruned-property shard
  var key = (raw ? "raw" : "") + kind;
  var b = bucketOf(id);
  var store = cache[key];
  if (!store[b]) {
    var path = "data/" + (raw ? "raw/" : "") + kind + "/" + b + ".json";
    store[b] = getJSON(path).catch(function () { return {}; });
  }
  return store[b].then(function (m) { return m[String(id)] || null; });
}

function progressions() {
  if (!PROG) PROG = getJSON("data/progressions.json").catch(function () { return {}; });
  return PROG;
}

var SIDE = {};
function sideFile(name) {
  if (!SIDE[name]) SIDE[name] = getJSON("data/" + name + ".json").catch(function () { return {}; });
  return SIDE[name];
}
function modSources() { return sideFile("modSources"); }
function gambitData() { return sideFile("gambits"); }
function itemSetData() { return sideFile("itemsets"); }
var SETS = null;
function propertyData() { return sideFile("properties"); }
function displayTypeData() { return sideFile("displayTypes"); }

/* PropertyMetaData, as the client sees it: the label a tooltip prints for a
   game property and whether the number is a percentage. DISPLAY_TYPES is the
   same idea for the "Skill Type:" line. EFFECT_CACHE holds the few effect
   records the tooltip needs to expand inline. */
var PROPS = null;
var DISPLAY_TYPES = null;
var EFFECT_CACHE = {};

/* A tooltip quotes the effects the skill applies, so those records have to be
   in hand before it can be drawn. */
function preloadTipEffects(s) {
  var ids = [];
  (s.attacks || []).forEach(function (a) {
    (a.targetEffects || []).forEach(function (e) { ids.push(e.id); });
  });
  (s.userEffects || []).forEach(function (e) { ids.push(e.id); });
  (s.toggleEffects || []).forEach(function (e) { ids.push(e.id); });
  ids = ids.slice(0, 6).filter(function (id) { return !EFFECT_CACHE[String(id)]; });
  return Promise.all(ids.map(function (id) {
    return loadRecord("effect", id).then(function (rec) {
      if (rec) EFFECT_CACHE[String(id)] = rec;
    });
  }));
}

/* The Warden builds a gambit by pressing builders in order, and the tooltip
   shows the sequence as icons. The Burglar's Razor Wit line works the same way
   with its own four. GAMBITS maps the packed code to the builder it names. */
var GAMBITS = null;

/* The client shows a gambit as a bare row of builder icons after a green
   "Requires:" - no names, no arrows. The order is the press order; the name is
   on hover and the icon links to the builder. */
function gambitRow(steps, label) {
  if (!steps || !steps.length || !GAMBITS) return null;
  var box = el("div", "gambit");
  if (label) box.appendChild(el("span", "gl", label + ":"));
  steps.forEach(function (code, i) {
    var g = GAMBITS[String(code)];
    var a = el("a", "gstep");
    a.href = g ? "#/skill/" + g.skill : "#";
    var img = el("img");
    img.src = iconUrl(g ? g.icon : 0);
    img.alt = g ? g.name : String(code);
    img.onerror = function () { this.style.visibility = "hidden"; };
    a.appendChild(img);
    a.title = (i + 1) + ". " + (g ? g.name : code);
    box.appendChild(a);
  });
  return box;
}
function sourceClasses() { return sideFile("sourceClasses"); }

/* Which classes can reach a given trait, effect or tracery. A source with no
   entry is unplaced, not universal - so it is always shown. Hiding happens
   only when a source is positively known to belong to another class. */
var SRC_CLASS = null;

/* Monster-play characters have no legendary items, so no traceries and no
   essences - listing them on a creep skill is not a near miss, it is wrong.
   Any page scoped to creep classes drops them outright. */
function usesGear(classIds, D) {
  if (!classIds || !classIds.length || !D) return true;
  for (var i = 0; i < classIds.length; i++) {
    var c = D.classes[String(classIds[i])];
    if (!c || c.side !== "creep") return true;
  }
  return false;
}

function isGearSource(id) {
  var meta = nameOf(id);
  // traceries, essences and item sets all arrive on gear a creep never wears
  return !!meta && (meta.t === "y" || meta.t === "z" || meta.t === "g");
}

/* Which classes a record belongs to. A skill says so directly; an effect only
   knows through the attribution index, which is how a creep effect page can be
   scoped the same way a creep skill page is. */
function ownerClasses(rec) {
  var direct = (rec.obtained || []).map(function (o) { return o["class"]; })
    .filter(function (c) { return c; });
  if (direct.length) return direct;
  var own = SRC_CLASS && SRC_CLASS[String(rec.id)];
  return own ? own.slice() : [];
}

/* Every class that is not monster play - the allowed set for a page that only
   Free Peoples characters can reach, such as a tracery. */
var FREEP_IDS = null;
function freepClasses(D) {
  if (!FREEP_IDS && D) {
    FREEP_IDS = Object.keys(D.classes)
      .filter(function (k) { return D.classes[k].side !== "creep"; })
      .map(function (k) { return parseInt(k, 10); });
  }
  return FREEP_IDS || [];
}
function reachable(id, classIds) {
  if (!classIds || !classIds.length || !SRC_CLASS) return true;
  var own = SRC_CLASS[String(id)];
  if (!own) return true;
  for (var i = 0; i < classIds.length; i++) {
    if (own.indexOf(classIds[i]) !== -1) return true;
  }
  return false;
}

var TRACERY_OF = null;
function effectTraceries() { return sideFile("effectTraceries"); }

function traceryData() {
  return sideFile("traceries").then(function (T) {
    if (!TRACERY_OF) {
      // any of a tracery's 36 item ids should land on the family page
      TRACERY_OF = {};
      Object.keys(T).forEach(function (fid) {
        (T[fid].members || []).forEach(function (m) { TRACERY_OF[m] = fid; });
      });
    }
    return T;
  });
}

/* Kept on the side as well as returned, because a description can name a
   trait and traits are not in the search index. */
var CLASS_DATA = null;
function classData() {
  return Promise.all([sideFile("classes"), sideFile("traits"), sideFile("traitTrees")])
    .then(function (r) {
      CLASS_DATA = { classes: r[0], traits: r[1], trees: r[2] };
      return CLASS_DATA;
    });
}

/* ---------------- small helpers ---------------- */

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function iconUrl(id) { return id ? "icons/" + id + ".png" : "icons/blank.png"; }

/* The DAT stores flavour text with three bits of markup and nothing else: a
   literal two-character "\n" for a line break, <rgb=#RRGGBB>...</rgb> for
   coloured runs, and <li>...</li> for bullet lines (class descriptions only).
   Everything becomes a text node - raw DAT text is never injected as HTML. */
function richText(str) {
  var frag = document.createDocumentFragment();
  if (!str) return frag;
  // <li> only ever wraps a whole line here, so a bullet plus a break is a
  // faithful and much simpler rendering than building real list elements.
  str = String(str).replace(/<li>\s*/gi, "\u2022 ").replace(/<\/li>/gi, "\\n");
  // The DAT pads class descriptions with runs of blank lines; keep at most one.
  str = str.replace(/(?:\\n\s*){3,}/g, "\\n\\n").replace(/^(?:\\n)+/, "");
  var re = /<rgb=#([0-9a-fA-F]{6})>([\s\S]*?)<\/rgb>/gi;
  var at = 0, m;
  function plain(t, colour) {
    var parts = t.split(/\\n|\n/);
    parts.forEach(function (bit, i) {
      if (i) frag.appendChild(document.createElement("br"));
      if (!bit) return;
      if (colour) {
        var sp = el("span", null, bit);
        sp.style.color = "#" + colour;
        frag.appendChild(sp);
      } else {
        frag.appendChild(document.createTextNode(bit));
      }
    });
  }
  while ((m = re.exec(str)) !== null) {
    plain(str.slice(at, m.index), null);
    plain(m[2], m[1]);
    at = m.index + m[0].length;
  }
  plain(str.slice(at), null);
  return frag;
}

function richPara(cls, str) {
  var n = el("p", cls);
  n.appendChild(richText(str));
  return n;
}

function fmt(n, dp) {
  if (n === undefined || n === null) return "-";
  if (typeof n !== "number") return String(n);
  if (Number.isInteger(n)) return String(n);
  var s = n.toFixed(dp === undefined ? 2 : dp);
  // strip trailing zeros only after a decimal point - the old pattern turned
  // toFixed(0) of 30.000001 ("30") into "3"
  return s.indexOf(".") === -1 ? s
       : s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/* Thousands separators, the way the game writes damage: 21,420. */
function num(n) {
  return typeof n === "number" ? Math.round(n).toLocaleString() : fmt(n);
}

function secs(n) { return n === undefined || n === null ? "-" : fmt(n) + "s"; }

/* The client writes internal names as Underscore_CamelCase with acronyms mixed
   in. Splitting on every lowercase-uppercase boundary turns "AoE" into "Ao E",
   so known acronyms are passed through whole. */
var ACRONYMS = {
  AoE: 1, AOE: 1, DoT: 1, HoT: 1, DPS: 1, HPS: 1, NPC: 1, AI: 1, UI: 1,
  PvP: 1, PvMP: 1, MP: 1, MC: 1, LI: 1, FM: 1, CC: 1
};

function titleCase(s) {
  if (Array.isArray(s)) return s.map(titleCase).join(", ");
  return String(s).split("_").map(function (part) {
    if (!part) return "";
    if (ACRONYMS[part]) return part;
    return part.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
               .replace(/^./, function (c) { return c.toUpperCase(); });
  }).filter(Boolean).join(" ");
}

/* ---------------- search ---------------- */

var typeOn = { s: true, e: true, c: true, y: true, z: true, g: true };
var catFilter = "";

/* "Fleche" should find "Fleche" with the accent. Strip combining marks so the
   comparison ignores diacritics entirely. */
function fold(str) {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function score(name, q, folded) {
  var n = folded !== undefined ? folded : fold(name);
  if (n === q) return 0;
  if (n.indexOf(q) === 0) return 1;
  var w = n.indexOf(" " + q);
  if (w >= 0) return 2;
  var i = n.indexOf(q);
  if (i >= 0) return 3 + i / 100;
  return -1;
}

function runSearch() {
  var q = fold(document.getElementById("q").value.trim());
  var numeric = /^\d{6,}$/.test(q) ? parseInt(q, 10) : null;
  var out = [];
  for (var i = 0; i < INDEX.length; i++) {
    var r = INDEX[i];
    if (!typeOn[r.t]) continue;
    if (catFilter && r.c !== catFilter) continue;
    if (numeric !== null) {
      if (r.i === numeric) out.push([0, r]);
      continue;
    }
    if (q) {
      var s = score(r.n, q, r.f);
      if (s < 0) continue;
      // an internal ("DNT") entry is plumbing - keep it findable, but never
      // ahead of the thing a player would recognise
      out.push([s + (r.x ? 50 : 0), r]);
    } else {
      // With no query, put properly-named content first: the DAT is full of
      // internal entries like "a melee attack" that would otherwise fill the list.
      out.push([(r.x ? 2 : 0) + (/^[A-Z]/.test(r.n) ? 0 : 1), r]);
    }
  }
  out.sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1].n.localeCompare(b[1].n);
  });
  var total = out.length;
  out = out.slice(0, 300);

  var box = document.getElementById("results");
  box.textContent = "";
  var frag = document.createDocumentFragment();
  out.forEach(function (pair) {
    var r = pair[1];
    var row = el("div", "row" + (selected === r.t + r.i ? " sel" : ""));
    var img = el("img");
    img.src = iconUrl(r.k);
    img.loading = "lazy";
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    var txt = el("div", "txt");
    txt.appendChild(el("div", "nm", r.n));
    var kindWord = r.t === "s" ? "Skill" : r.t === "e" ? "Effect"
                 : r.t === "y" ? "Tracery" : r.t === "z" ? "Essence"
                 : r.t === "g" ? "Set" : "Class";
    txt.appendChild(el("div", "mt", kindWord +
      (r.c && r.c !== "Class" ? " - " + titleCase(r.c) : "") +
      (r.x ? " - internal" : "")));
    row.appendChild(img);
    row.appendChild(txt);
    row.onclick = function () {
      location.hash = "#/" + routeFor(r.t) + "/" + r.i;
    };
    frag.appendChild(row);
  });
  box.appendChild(frag);
  document.getElementById("count").textContent =
    total + " match" + (total === 1 ? "" : "es") + (total > 300 ? ", showing 300" : "");
}

/* ---------------- progression chart ---------------- */

/* Progression arrays are a fixed-width table, so a curve with 5 real values is
   stored as 5 values and 155 zeros. Plotting the padding is misleading, and so
   is the tail of a curve that has stopped moving - a trait with three real
   ranks stores rank 3's value another 157 times. Cut both, keeping the first
   entry that reaches the final value, and remember how far the stored table
   ran so a caption can say the value holds. */
function trimPadding(pts) {
  var end = pts.length;
  while (end > 2 && pts[end - 1][1] === 0) end--;
  var last = pts[end - 1][1];
  var stop = end;
  while (stop > 1 && pts[stop - 2][1] === last) stop--;
  if (stop === pts.length) return pts;
  var out = pts.slice(0, stop);
  if (stop < end) out.holdsTo = pts[end - 1][0];
  return out;
}

/* The client ships curves running to level 170, past the level anyone can
   reach. Showing that tail invites reading a number nobody can have, so a
   level curve stops at the cap - keeping the value AT the cap by interpolating
   a point there when the stored curve steps straight over it. Curves indexed
   by something other than level (trait rank, item level) are left alone. */
var LEVEL_CAP = 160;

function capCurve(pts, cap) {
  if (!cap || !pts.length || pts[pts.length - 1][0] <= cap) return pts;
  var out = [];
  for (var i = 0; i < pts.length; i++) {
    if (pts[i][0] <= cap) { out.push(pts[i]); continue; }
    if (i && pts[i - 1][0] < cap) {
      var a = pts[i - 1], b = pts[i];
      var t = (cap - a[0]) / ((b[0] - a[0]) || 1);
      out.push([cap, a[1] + (b[1] - a[1]) * t]);
    }
    break;
  }
  return out.length >= 1 ? out : pts;
}

function curvePoints(p, cap) {
  if (!p) return null;
  var pts;
  if (p.type === "linear") {
    pts = p.points.filter(function (pt) {
      return typeof pt[0] === "number" && typeof pt[1] === "number";
    });
  } else if (p.type === "array") {
    var min = p.minIndex === undefined ? 1 : p.minIndex;
    pts = p.values.map(function (v, i) { return [min + i, v]; })
      .filter(function (pt) { return typeof pt[1] === "number"; });
  } else {
    return null;
  }
  return trimPadding(capCurve(pts, cap));
}

/* A few discrete steps read better as a table than as a line - a trait with
   five ranks is a comparison of five values, not a trend. */
/* "holds at that value to level 160" is worth saying on a level curve, where
   the cap is real information. On a trait's rank table the stored tail is just
   table width, so it goes unmentioned. */
function holdNote(pts, xLabel) {
  if (!pts.holdsTo || (xLabel || "Level") !== "Level") return "";
  return " - unchanged through level " + pts.holdsTo;
}

function stepTable(pts, label, xLabel) {
  var wrap = el("div", "chart");
  var t = el("table", "t");
  t.style.maxWidth = "320px";
  var head = "<tr><th>" + esc(xLabel || "Level") + "</th><th>Value</th></tr>";
  t.innerHTML = head;
  pts.forEach(function (pt) {
    var tr = el("tr");
    tr.appendChild(el("td", "num", String(pt[0])));
    tr.appendChild(el("td", "num", fmt(pt[1], 3)));
    t.appendChild(tr);
  });
  wrap.appendChild(t);
  var cap = el("div", "muted", label + holdNote(pts, xLabel));
  cap.style.fontSize = "11.5px";
  wrap.appendChild(cap);
  return wrap;
}

function chart(pts, label, xLabel) {
  if (pts.length <= 12) return stepTable(pts, label, xLabel);
  // Single series: no legend needed, the caption names it.
  var W = 520, H = 162, L = 50, R = 20, T = 26, B = 24;
  var xs = pts.map(function (p) { return p[0]; });
  var ys = pts.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  if (y0 > 0) y0 = 0;
  if (y1 === y0) y1 = y0 + 1;
  var px = function (x) { return L + (x - x0) / (x1 - x0 || 1) * (W - L - R); };
  var py = function (y) { return H - B - (y - y0) / (y1 - y0) * (H - T - B); };

  var wrap = el("div", "chart");
  var ns = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("width", "100%");
  svg.style.maxWidth = W + "px";
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label + " by " + (xLabel || "level") +
                   ", " + x0 + " to " + x1);

  function add(tag, attrs, cls) {
    var n = document.createElementNS(ns, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (cls) n.setAttribute("class", cls);
    svg.appendChild(n);
    return n;
  }

  // recessive gridlines + value labels
  var span = Math.abs(y1 - y0);
  var dp = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  [0, 0.5, 1].forEach(function (f) {
    var v = y0 + (y1 - y0) * f;
    add("line", { x1: L, x2: W - R, y1: py(v), y2: py(v) }, "grid");
    var t = add("text", { x: L - 6, y: py(v) + 3.5, "text-anchor": "end" }, "lbl");
    t.textContent = fmt(v, dp);
  });
  add("line", { x1: L, x2: W - R, y1: py(y0), y2: py(y0) }, "axis");
  [x0, x1].forEach(function (x, i) {
    var t = add("text", { x: px(x), y: H - 7, "text-anchor": i ? "end" : "start" }, "lbl");
    t.textContent = String(x);
  });

  var d = pts.map(function (p, i) {
    return (i ? "L" : "M") + px(p[0]).toFixed(1) + " " + py(p[1]).toFixed(1);
  }).join(" ");
  add("path", { d: d }, "line");

  // hover layer: crosshair, dot, readout
  var cross = add("line", { x1: 0, x2: 0, y1: T, y2: H - B, opacity: 0 }, "cross");
  var dot = add("circle", { r: 4, opacity: 0 }, "dot");
  var tip = add("text", { x: L, y: 12, opacity: 0 }, "tip");
  var hit = add("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  hit.style.cursor = "crosshair";

  hit.addEventListener("mousemove", function (ev) {
    var r = svg.getBoundingClientRect();
    var mx = (ev.clientX - r.left) / r.width * W;
    var best = pts[0], bd = Infinity;
    pts.forEach(function (p) {
      var dd = Math.abs(px(p[0]) - mx);
      if (dd < bd) { bd = dd; best = p; }
    });
    cross.setAttribute("x1", px(best[0]));
    cross.setAttribute("x2", px(best[0]));
    cross.setAttribute("opacity", 1);
    dot.setAttribute("cx", px(best[0]));
    dot.setAttribute("cy", py(best[1]));
    dot.setAttribute("opacity", 1);
    tip.textContent = (xLabel || "level").toLowerCase() + " " + best[0] +
                      "  =  " + fmt(best[1], 3);
    tip.setAttribute("x", px(best[0]) > W / 2 ? L : W - R);
    tip.setAttribute("text-anchor", px(best[0]) > W / 2 ? "start" : "end");
    tip.setAttribute("opacity", 1);
  });
  hit.addEventListener("mouseleave", function () {
    cross.setAttribute("opacity", 0);
    dot.setAttribute("opacity", 0);
    tip.setAttribute("opacity", 0);
  });

  wrap.appendChild(svg);
  var cap = el("div", "muted", label + " - " + pts.length + " points, " +
    (xLabel || "level").toLowerCase() + " " + x0 + " to " + x1 +
    holdNote(pts, xLabel));
  cap.style.fontSize = "11.5px";
  wrap.appendChild(cap);
  return wrap;
}

/* ---------------- rendering ---------------- */

function routeFor(t) {
  return t === "s" ? "skill" : t === "e" ? "effect"
       : t === "y" ? "tracery" : t === "z" ? "essence"
       : t === "g" ? "set" : "class";
}

function nameOf(id) {
  for (var i = 0; i < INDEX.length; i++) if (INDEX[i].i === id) return INDEX[i];
  return null;
}

/* Traits are not in the search index (there are 3,895 of them and they are not
   what people search for), so they get their own list rather than linkList's
   index lookup, which would render them as bare ids. */
function traitList(ids, D) {
  var ul = el("ul", "links");
  (ids || []).forEach(function (id) {
    var t = D && D.traits[String(id)];
    var li = el("li");
    var img = el("img");
    img.src = iconUrl(t ? t.icon : 0);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(img);
    var body = el("div");
    var a = el("a", null, t ? t.name : "#" + id);
    a.href = "#/trait/" + id;
    body.appendChild(a);
    if (t && t.nature) {
      body.appendChild(el("span", "via", titleCase(String(t.nature).replace("Class_", ""))));
    }
    li.appendChild(body);
    ul.appendChild(li);
  });
  return ul;
}

function linkList(refs, kindGuess, subLine) {
  var ul = el("ul", "links");
  refs.forEach(function (r) {
    var id = typeof r === "number" ? r : r.id;
    var meta = nameOf(id);
    var li = el("li");
    var img = el("img");
    img.src = iconUrl(meta ? meta.k : 0);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(img);

    var body = el("div");
    var a = el("a", null, meta ? meta.n : "#" + id);
    var kind = meta ? routeFor(meta.t) : kindGuess;
    a.href = "#/" + kind + "/" + id;
    body.appendChild(a);
    var bits = [];
    if (r && r.duration !== undefined) bits.push(fmt(r.duration) + "s");
    if (r && r.spellcraft !== undefined) bits.push("sc " + fmt(r.spellcraft));
    if (r && r.via) bits.push(r.via);
    if (bits.length) body.appendChild(el("span", "via", bits.join("  ")));

    var extra = subLine ? subLine(id) : null;
    if (extra) {
      body.appendChild(extra);
      li.className = "twoline";
    }
    li.appendChild(body);
    ul.appendChild(li);
  });
  return ul;
}

/* Under each effect a skill applies, the traceries that scale it. Answering
   "what gear affects this" without making the reader open every effect.
   Traceries only - essences are listed per property elsewhere. */
function traceryLine(ET, allowed) {
  if (!ET || allowed === false) return null;
  return function (effectId) {
    var ids = ET[String(effectId)];
    if (!ids || !ids.length) return null;
    var line = el("div", "trline");
    line.appendChild(el("span", "muted", "traceries: "));
    line.appendChild(linkRun(ids.map(function (tid) {
      return function () {
        var meta = nameOf(tid);
        var a = el("a", "trc", meta ? meta.n : "#" + tid);
        a.href = "#/tracery/" + tid;
        return a;
      };
    }), 4, 0));
    return line;
  };
}

function section(host, title, node) {
  if (!node) return;
  // an empty <ul>/<table> body means there was nothing to show after all
  if (node.tagName === "UL" && !node.children.length) return;
  host.appendChild(el("h3", "sec", title));
  host.appendChild(node);
}

function statRow(pairs) {
  var box = el("div", "stats");
  pairs.forEach(function (p) {
    if (p[1] === undefined || p[1] === null || p[1] === "-") return;
    var s = el("div", "stat" + (p[2] ? " " + p[2] : ""));
    s.appendChild(el("div", "k", p[0]));
    // a value may be a plain string or a built node (a run of links)
    if (p[1] && p[1].nodeType) {
      var v = el("div", "v");
      v.appendChild(p[1]);
      s.appendChild(v);
    } else {
      s.appendChild(el("div", "v", p[1]));
    }
    box.appendChild(s);
  });
  return box.children.length ? box : null;
}

/* Every tracery that scales something this skill reads. The same answer the
   modifier table gives property by property, collected into one line up top.
   Traceries only - essences stay in the per-property lists below. */
function skillTraceries(s, MS) {
  if (!MS) return null;
  var props = [];
  var groups = (s.mods || []).slice();
  (s.attacks || []).forEach(function (a) {
    (a.mods || []).forEach(function (gg) { groups.push(gg); });
  });
  groups.forEach(function (gg) { props = props.concat(gg.props || []); });
  (s.costs || []).forEach(function (c) { props = props.concat(c.mods || []); });

  var seen = {}, ids = [];
  props.forEach(function (prop) {
    var src = MS[prop];
    if (!src) return;
    (src.traceries || []).forEach(function (tid) {
      if (seen[tid]) return;
      var meta = nameOf(tid);
      if (!meta || meta.t !== "y") return;
      seen[tid] = 1;
      ids.push(tid);
    });
  });
  if (!ids.length) return null;
  ids.sort(function (a, b) {
    var x = nameOf(a).n, y = nameOf(b).n;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  var box = el("div", "trrun");
  box.appendChild(linkRun(ids.map(function (tid) {
    return function () {
      var a = el("a", "trc", nameOf(tid).n);
      a.href = "#/tracery/" + tid;
      return a;
    };
  }), 6, 0));
  return box;
}

function rawBlock(kind, id) {
  var d = el("details", "raw");
  var sum = el("summary", null, "Raw client properties");
  d.appendChild(sum);
  var pre = el("pre", "raw", "loading...");
  d.appendChild(pre);
  var loaded = false;
  d.addEventListener("toggle", function () {
    if (!d.open || loaded) return;
    loaded = true;
    loadRecord(kind, id, true).then(function (p) {
      pre.textContent = p ? JSON.stringify(p, null, 2) : "not available";
    });
  });
  return d;
}

function aeShape(s) {
  if (s.aeArcDegrees !== undefined) return "Arc";
  if (s.aeBoxLength !== undefined || s.aeBoxWidth !== undefined) return "Box";
  if (s.aeSphereRadius !== undefined) return "Sphere";
  return null;
}

function areaBlock(s) {
  var shape = aeShape(s);
  if (!shape && s.aeMaxTargets === undefined) return null;
  var box = statRow([
    ["Shape", shape],
    ["Arc", s.aeArcDegrees !== undefined ? fmt(s.aeArcDegrees) + " deg" : null],
    ["Arc radius", s.aeArcRadius !== undefined ? fmt(s.aeArcRadius) + "m" : null],
    ["Radius", s.aeSphereRadius !== undefined ? fmt(s.aeSphereRadius) + "m" : null],
    ["Box", (s.aeBoxLength !== undefined || s.aeBoxWidth !== undefined)
      ? fmt(s.aeBoxLength) + "m x " + fmt(s.aeBoxWidth) + "m" : null],
    ["Heading offset", s.aeHeadingOffset !== undefined ? fmt(s.aeHeadingOffset) + " deg" : null],
    ["Max targets", s.aeMaxTargets],
    ["Anchored on", s.aeAnchor],
    ["Damage", s.aeDamageSharing],
    ["Line of sight", shape && s.aeLineOfSight ? "required" : null]
  ]);
  if (!box) return null;
  var wrap = el("div");
  wrap.appendChild(box);
  if (shape === "Arc" && s.aeArcDegrees && s.aeArcRadius) {
    wrap.appendChild(arcDiagram(s.aeArcDegrees, s.aeArcRadius, s.aeHeadingOffset || 0,
                                s.aeAnchor, "Detection volume", "caster facing"));
  }
  return wrap;
}

function positionalBlock(s) {
  if (!s.positionalSpread) return null;
  var h = s.positionalHeading || 0;
  var where = (h > 135 && h < 225) ? "behind the target"
            : (h <= 45 || h >= 315) ? "in front of the target"
            : "to the side of the target";
  var wrap = el("div");
  wrap.appendChild(statRow([
    ["Heading", fmt(h) + " deg"],
    ["Spread", fmt(s.positionalSpread) + " deg"],
    ["Caster must be", where]
  ]));
  wrap.appendChild(arcDiagram(s.positionalSpread, 1, h, null,
                              "Where the caster must stand", "target facing"));
  var mults = (s.attacks || []).filter(function (a) {
    return a.positionalMultiplier !== undefined && a.positionalMultiplier !== 1;
  });
  if (mults.length) {
    var gates = [];
    (s.attacks || []).forEach(function (a) {
      (a.mods || []).forEach(function (g) {
        if (g.key && g.key.indexOf("PositionalDamageMultiplier") >= 0) {
          g.props.forEach(function (pr) {
            if (gates.indexOf(pr) < 0) gates.push(pr);
          });
        }
      });
    });
    var line = el("div", "muted", "Positional damage multiplier: " +
      mults.map(function (a) { return "x" + fmt(a.positionalMultiplier); }).join(", ") +
      (gates.length ? " - scaled by " + gates.join(", ") + " (see Modifiers below)" : ""));
    line.style.marginTop = "8px";
    wrap.appendChild(line);
  }
  return wrap;
}

/* A wedge is far easier to read than "120 deg at heading 180". 0 deg is the
   facing direction, drawn upwards, and the wedge is centred on the heading. */
function arcDiagram(degrees, radius, heading, anchor, caption, centreLabel) {
  var ns = "http://www.w3.org/2000/svg";
  var S = 132, c = S / 2, r = S / 2 - 16;
  var wrap = el("div", "chart");
  var svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 " + S + " " + S);
  svg.setAttribute("width", S);
  svg.setAttribute("height", S);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", caption + ": " + degrees + " degrees at heading " + heading);

  function add(tag, attrs, cls) {
    var n = document.createElementNS(ns, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (cls) n.setAttribute("class", cls);
    svg.appendChild(n);
    return n;
  }
  function pt(deg, rad) {
    var a = (deg - 90) * Math.PI / 180;
    return [c + Math.cos(a) * rad, c + Math.sin(a) * rad];
  }

  add("circle", { cx: c, cy: c, r: r, fill: "none" }, "grid");
  var half = Math.min(degrees, 359.9) / 2;
  var a0 = heading - half, a1 = heading + half;
  var p0 = pt(a0, r), p1 = pt(a1, r);
  var large = degrees > 180 ? 1 : 0;
  var wedge = add("path", {
    d: "M " + c + " " + c + " L " + p0[0].toFixed(1) + " " + p0[1].toFixed(1) +
       " A " + r + " " + r + " 0 " + large + " 1 " + p1[0].toFixed(1) + " " + p1[1].toFixed(1) + " Z",
    fill: "var(--accent)", "fill-opacity": ".24", stroke: "var(--accent)", "stroke-width": 1.5
  });
  // the caster / anchor, and the facing direction
  add("line", { x1: c, y1: c, x2: c, y2: c - r }, "cross");
  add("circle", { cx: c, cy: c, r: 3.5 }, "dot");
  var t = add("text", { x: c, y: 11, "text-anchor": "middle" }, "lbl");
  t.textContent = centreLabel || "facing";

  wrap.appendChild(svg);
  var cap = el("div", "muted",
    caption + " - " + fmt(degrees) + " deg wide" +
    (heading ? ", centred " + fmt(heading) + " deg off " + (centreLabel || "facing")
             : ", centred on " + (centreLabel || "facing")) +
    (anchor ? ", anchored on " + anchor : ""));
  cap.style.fontSize = "11.5px";
  wrap.appendChild(cap);
  return wrap;
}

function progChart(host, progs, progId, label) {
  var pts = curvePoints(progs[String(progId)], LEVEL_CAP);
  if (!pts || !pts.length) return false;
  host.appendChild(chart(pts, label, "Level"));
  return true;
}

function renderSkill(s, progs, D, MS, ET) {
  // a monster-play skill never has traceries or essences behind it
  var gearOk = usesGear(ownerClasses(s), D);
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(s.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, s.name));
  h.appendChild(el("div", "id", "skill " + s.id + "  /  0x" + s.id.toString(16).toUpperCase()));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag " + (s.harmful ? "harm" : "help"),
    s.harmful ? "Harmful" : "Beneficial"));
  if (s.internal) tags.appendChild(el("span", "tag", "Internal - never shown in game"));
  if (s.category) tags.appendChild(el("span", "tag kind", titleCase(s.category)));
  if (s.skillType) {
    (Array.isArray(s.skillType) ? s.skillType : [s.skillType]).forEach(function (k) {
      tags.appendChild(el("span", "tag", titleCase(k)));
    });
  }
  ["immediate", "usableWhileMoving", "requiresFacing", "mustBeStealthed",
   "breaksStealth", "ignoresResetTime"].forEach(function (f) {
    if (s[f]) tags.appendChild(el("span", "tag", titleCase(f)));
  });
  host.appendChild(tags);

  // No flavour text here - the tooltip below carries it, as the game does.

  var wrap = el("div");
  var lvl = topLevel(s, progs);
  function drawTip() {
    wrap.textContent = "";
    wrap.appendChild(tooltipPanel(s, progs, D, lvl));
    var ctl = el("div", "tipctl");
    ctl.appendChild(el("span", "muted", "at level "));
    var input = el("input");
    input.type = "number";
    input.min = "1";
    input.max = String(LEVEL_CAP);
    input.value = String(lvl);
    input.oninput = function () {
      var v = parseInt(input.value, 10);
      if (!isNaN(v) && v > 0) {
        lvl = Math.min(v, LEVEL_CAP);
        drawTip();
        input2focus();
      }
    };
    ctl.appendChild(input);
    wrap.appendChild(ctl);
    if ((s.attacks || []).some(function (a) {
      return a.implementContribution || a.damageContribution;
    })) {
      wrap.appendChild(damageNote(s));
    }
  }
  function input2focus() {
    // a number input has no text selection to move, so just restore focus
    var i = wrap.querySelector("input");
    if (i) i.focus();
  }
  drawTip();
  section(host, "Tooltip", wrap);

  if (s.gambitAdds) {
    var gb = gambitRow(s.gambitAdds, "Builds");
    if (gb) section(host, "Gambit", gb);
  }

  if (D) section(host, "How you get it", obtainedBlock(s, D));

  var range = s.maxRange !== undefined
    ? (s.minRange !== undefined ? fmt(s.minRange) + " - " : "") + fmt(s.maxRange) + "m"
    : null;
  section(host, "At a glance", statRow([
    ["Cooldown", s.cooldown !== undefined ? secs(s.cooldown) : null],
    ["Range", range],
    ["Threat", s.threat],
    ["Pip change", s.pipChange],
    ["Resist", s.resistCategory],
    ["Traceries", usesGear(ownerClasses(s), D) ? skillTraceries(s, MS) : null, "wide"]
  ]));

  section(host, "Area of effect", areaBlock(s));
  section(host, "Positional", positionalBlock(s));

  if (s.costs) {
    var t = el("table", "t");
    t.innerHTML = "<tr><th>Vital</th><th>Points</th><th>Percent</th><th>Scaling</th><th>Modifiers</th></tr>";
    s.costs.forEach(function (c) {
      var tr = el("tr");
      tr.innerHTML = "<td>" + esc(c.type || "-") + "</td>" +
        '<td class="num">' + fmt(c.points) + "</td>" +
        '<td class="num">' + (c.percent === undefined ? "-" : fmt(c.percent) + "%") + "</td>" +
        '<td class="num">' + (c.progression ? "progression " + c.progression : "-") + "</td>" +
        "<td>" + (c.mods || []).map(function (m) {
          return '<code class="pn">' + esc(m) + "</code>";
        }).join(" ") + "</td>";
      t.appendChild(tr);
    });
    section(host, "Cost", t);
    s.costs.forEach(function (c) {
      if (c.progression) progChart(host, progs, c.progression, (c.type || "Cost") + " cost");
    });
  }

  if (s.attacks) {
    // Max damage and positional are blank on most skills. Rather than a column
    // of dashes, only draw a column when some hook actually fills it.
    var hasMax = s.attacks.some(function (a) {
      return a.damageMax !== undefined || a.damageMaxProgression;
    });
    var hasPos = s.attacks.some(function (a) {
      return a.positionalMultiplier !== undefined && a.positionalMultiplier !== 1;
    });
    var at = el("table", "t");
    at.innerHTML = "<tr><th>#</th><th>Qualifier</th><th>Type</th><th>Modifier</th>" +
      (hasMax ? "<th>Max damage</th>" : "") + "<th>Crit</th>" +
      (hasPos ? "<th>Positional</th>" : "") + "<th>Implement</th></tr>";
    s.attacks.forEach(function (a, i) {
      var tr = el("tr");
      var imp = ["usesPrimary", "usesSecondary", "usesRanged", "usesNatural", "usesTactical"]
        .filter(function (k) { return a[k]; })
        .map(function (k) { return k.replace("uses", ""); }).join(", ");
      tr.innerHTML = "<td>" + (i + 1) + "</td>" +
        "<td>" + esc(a.damageQualifier || "-") + "</td>" +
        "<td>" + esc(a.damageType || "-") + "</td>" +
        '<td class="num">' + fmt(a.damageModifier) + "</td>" +
        (hasMax ? '<td class="num">' + (a.damageMax !== undefined ? fmt(a.damageMax) :
          a.damageMaxProgression ? "progression " + a.damageMaxProgression : "-") + "</td>" : "") +
        '<td class="num">' + (a.critMultiplier !== undefined ? "x" + fmt(a.critMultiplier) : "-") + "</td>" +
        (hasPos ? '<td class="num">' + (a.positionalMultiplier !== undefined && a.positionalMultiplier !== 1
          ? "x" + fmt(a.positionalMultiplier) : "-") + "</td>" : "") +
        "<td>" + esc(imp || "-") + "</td>";
      at.appendChild(tr);
    });
    section(host, "Attack hooks", at);
    s.attacks.forEach(function (a, i) {
      if (a.damageMaxProgression) {
        progChart(host, progs, a.damageMaxProgression, "Hook " + (i + 1) + " max damage");
      }
    });

    var hookEffects = [];
    s.attacks.forEach(function (a) {
      ["targetEffects", "positionalEffects", "superCritEffects"].forEach(function (k) {
        (a[k] || []).forEach(function (e) {
          hookEffects.push({ id: e.id, duration: e.duration, via: k });
        });
      });
    });
    if (hookEffects.length) {
      section(host, "Effects applied on hit",
              linkList(hookEffects, "effect", traceryLine(ET, gearOk)));
    }
  }

  [["userEffects", "Effects on the caster"],
   ["userEffectsOverride", "Caster effects (override)"],
   ["userEffectsAdditive", "Caster effects (additive)"],
   ["toggleEffects", "Toggle effects"],
   ["critEffects", "Critical effects"],
   ["critEffectsAdditive", "Critical effects (additive)"],
   ["requiredEffects", "Requires these effects"],
   ["barringEffects", "Barred by these effects"],
   ["consumedEffects", "Consumes these effects"]].forEach(function (pair) {
    if (s[pair[0]]) {
      section(host, pair[1], linkList(s[pair[0]], "effect", traceryLine(ET, gearOk)));
    }
  });

  if (s.combos) section(host, "Combos", linkList(s.combos.map(function (c) {
    return { id: c.skill, via: c.mode };
  }), "skill"));

  if (D && MS) section(host, "Effects with no chance of their own", chanceBlock(s, D, MS));
  if (D) section(host, "Effects that need a trait", conditionalBlock(s, D));
  if (D) section(host, "Procs on this skill", procBlock(s, D));
  if (D && MS) section(host, "Modifiers", modsBlock(s, D, MS));

  host.appendChild(el("h3", "sec", "Source data"));
  host.appendChild(rawBlock("skill", s.id));
  return host;
}

function renderEffect(e, progs, MS, D, ET) {
  // An effect belongs to whatever classes can reach it. A creep effect has no
  // legendary items behind it and no Free Peoples trait tree above it.
  var owners = D ? ownerClasses(e) : [];
  var gearOk = usesGear(owners, D);
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(e.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, e.name));
  h.appendChild(el("div", "id", "effect " + e.id + "  /  0x" + e.id.toString(16).toUpperCase() +
    "  /  class " + e["class"]));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag kind", titleCase(e.kind)));
  tags.appendChild(el("span", "tag " + (e.harmful ? "harm" : "help"),
    e.harmful ? "Harmful" : "Beneficial"));
  // the client marks these "DNT" - they exist to wire other things together
  if (e.internal) tags.appendChild(el("span", "tag", "Internal - never shown in game"));
  // spelled out, because titleCase turns "uiVisible" into "Ui Visible"
  var FLAG_WORDS = {
    debuff: "Debuff", permanent: "Permanent", combatOnly: "Combat only",
    uiVisible: "Shown in the UI",
    removeOnDefeat: "Removed on defeat", removeOnAwaken: "Removed on waking"
  };
  Object.keys(FLAG_WORDS).forEach(function (f) {
    if (e[f]) tags.appendChild(el("span", "tag", FLAG_WORDS[f]));
  });
  // only a named cure type earns the word - see CURE_TYPES in normalize.py
  if (e.cureType) tags.appendChild(el("span", "tag", "Curable: " + e.cureType));
  if (e.removeType) tags.appendChild(el("span", "tag", e.removeType));
  host.appendChild(tags);

  // wording lives in the tooltip - see effectTooltip
  var tipWrap = el("div");
  var elvl = LEVEL_CAP;
  function drawEffectTip() {
    tipWrap.textContent = "";
    tipWrap.appendChild(effectTooltip(e, progs, D, elvl));
    if (!usesLevel(e)) return;
    var ctl = el("div", "tipctl");
    ctl.appendChild(el("span", "muted", "at level "));
    var input = el("input");
    input.type = "number";
    input.min = "1";
    input.max = String(LEVEL_CAP);
    input.value = String(elvl);
    input.oninput = function () {
      var n = parseInt(input.value, 10);
      if (isNaN(n) || n <= 0) return;
      elvl = Math.min(n, LEVEL_CAP);
      drawEffectTip();
      drawDoes();
      var i = tipWrap.querySelector("input");
      if (i) i.focus();
    };
    ctl.appendChild(input);
    tipWrap.appendChild(ctl);
  }
  drawEffectTip();
  var vv = e.vital || {};
  if (vv.vpsInitial || vv.vpsPerPulse) {
    var vn = el("div", "muted tipnote");
    vn.innerHTML = "<strong>V</strong> is your base vitals-per-second at this "
      + "level - the rate the game scales heals and over-time effects from, "
      + "before your own healing or damage stats are applied. The coefficient "
      + "beside it is the effect's own. Effects without it carry a flat amount "
      + "and are shown as a number.";
    tipWrap.appendChild(vn);
  }
  section(host, "Tooltip", tipWrap);

  // the description carries level-driven numbers too, so it follows the picker
  var doesWrap = e.does ? el("div") : null;
  function drawDoes() {
    if (!doesWrap) return;
    doesWrap.textContent = "";
    var d = doesBlock(e.does, progs, elvl);
    if (d) doesWrap.appendChild(d);
  }
  drawDoes();
  section(host, "What it does", doesWrap);

  // a pulsing effect stores the gap between pulses, not how long it runs -
  // the duration a player cares about is the gap times the pulse count
  var totalDur = (e.pulseCount && e.interval) ? e.interval * e.pulseCount
               : (e.duration !== undefined ? e.duration : null);
  section(host, "At a glance", statRow([
    ["Duration", totalDur !== null ? secs(totalDur) : (e.permanent ? "permanent" : null)],
    ["Pulses", e.pulseCount ? e.pulseCount + " (every " + secs(e.interval) + ")"
                            : null],
    // an effect with no chance of its own says what has to supply one - the
    // tooltip leaves this out, the way the client does
    ["Probability", (e.probability !== undefined && e.probability < 0.999)
      ? fmt(e.probability * 100, 1) + "%" : null],
    ["Chance granted by", chanceSource(e), "wide"],
    ["Resist", e.resistCategory],
    // effects sharing an equivalence class do not stack with one another
    ["Does not stack with", e.equivalence, "wide"]
  ]));

  section(host, "Stat modifiers", grantsBlock(e.stats, MS, progs, "Level", D, owners));

  if (D && MS) section(host, "Modifiers", modsBlock(e, D, MS));

  if (e.nested) {
    section(host, "Applies these effects",
            linkList(e.nested, "effect", traceryLine(ET, gearOk)));
  }
  if (e.fromSets && e.fromSets.length) {
    var sul = el("ul", "links");
    e.fromSets.forEach(function (row) {
      var meta = nameOf(row[0]);
      var li = el("li");
      var si = el("img");
      si.src = iconUrl(meta ? meta.k : 0);
      si.alt = "";
      si.onerror = function () { this.style.visibility = "hidden"; };
      li.appendChild(si);
      var body = el("div");
      var a = el("a", null, meta ? meta.n : "#" + row[0]);
      a.href = "#/set/" + row[0];
      body.appendChild(a);
      body.appendChild(el("span", "via", row[1] + " piece" + (row[1] === 1 ? "" : "s")));
      li.appendChild(body);
      sul.appendChild(li);
    });
    section(host, "Granted by these set bonuses", sul);
  }
  if (e.parentEffects) section(host, "Applied by these effects", linkList(e.parentEffects, "effect"));
  if (e.usedBySkills) {
    section(host, "Applied by these skills",
            linkList(e.usedBySkills.filter(function (id) {
              return reachable(id, owners);
            }), "skill"));
  }
  if (e.appliedByTraits && D) {
    section(host, "Applied by these traits",
            traitList(e.appliedByTraits.filter(function (id) {
              return reachable(id, owners);
            }), D));
  }

  host.appendChild(el("h3", "sec", "Source data"));
  host.appendChild(rawBlock("effect", e.id));
  return host;
}

/* The generated description: what the effect actually does, in one sentence,
   built from its own type's properties. Chained effects are links rather than
   nested text - the point of the whole thing is that a raid boss effect reads
   as a line instead of a page. Level-driven numbers resolve at `level`. */
function doesBlock(toks, progs, level) {
  if (!toks || !toks.length) return null;
  var host = el("div", "does");
  toks.forEach(function (t) {
    if (typeof t === "string") {
      host.appendChild(document.createTextNode(t));
      return;
    }
    if (t.num) { host.appendChild(numToken(t.num, progs, level)); return; }
    if (t.e !== undefined) { host.appendChild(refLink(t.e, "effect", "eff")); return; }
    if (t.s !== undefined) { host.appendChild(refLink(t.s, "skill", null)); return; }
    if (t.t !== undefined) { host.appendChild(traitRef(t.t)); return; }
    if (t.o !== undefined) {
      // a summoned thing has no page of its own, so it gets its name and id
      var sp = el("span", "summon", trimMarker(t.n) || ("#" + t.o));
      sp.title = (t.w ? t.w + " " : "") + t.o;
      host.appendChild(sp);
      return;
    }
  });
  return host;
}

function trimMarker(name) {
  return name ? String(name).replace(/\s*\[[a-z]\]\s*$/i, "").trim() : name;
}

function refLink(id, kind, cls) {
  var meta = nameOf(id);
  var a = el("a", cls, meta ? meta.n : "#" + id);
  a.href = "#/" + kind + "/" + id;
  a.title = kind + " " + id;
  return a;
}

function traitRef(id) {
  // traits are not in the search index, so the name comes from the class data
  var t = CLASS_DATA && CLASS_DATA.traits && CLASS_DATA.traits[String(id)];
  var a = el("a", null, t ? t.name : "#" + id);
  a.href = "#/trait/" + id;
  a.title = "trait " + id;
  return a;
}

/* A number in a description: a constant, a progression, or both, scaled and
   averaged the way the game does it. Rendered live so the level picker moves
   it. */
function numToken(n, progs, level) {
  var v = n.k || 0;
  var known = n.k !== undefined;
  if (n.p) {
    var got = progAt(progs, n.p, level);
    if (got === null || got === undefined) {
      var sp = el("span", "scaled", "(scales with level)");
      sp.title = "progression " + n.p;
      return sp;
    }
    v += got;
    known = true;
  }
  if (!known) return document.createTextNode("?");
  if (n.m) v *= n.m;
  if (n.v) v *= 1 - n.v / 2;        // the game's spread, shown at its average
  if (n.neg) v = -v;
  var out = n.pct ? fmt(v * 100, 1).replace(/\.0$/, "") + "%" : fmt(v, 1);
  var span = el("span", "amt", out);
  if (n.p) span.title = "progression " + n.p + " at level " + level;
  return span;
}

/* ---------------- classes and traits ---------------- */

function traitLink(t, extra) {
  var li = el("li");
  var img = el("img");
  img.src = iconUrl(t && t.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  li.appendChild(img);
  var a = el("a", null, t ? t.name : "trait");
  a.href = "#/trait/" + (t ? t.id : 0);
  li.appendChild(a);
  if (extra) li.appendChild(el("span", "via", extra));
  return li;
}

/* A skill's provenance, rendered from the skill's own `obtained` list. */
function obtainedBlock(s, D) {
  if (!s.obtained || !s.obtained.length) return null;
  var ul = el("ul", "links");
  s.obtained.forEach(function (o) {
    var cls = o["class"] ? D.classes[String(o["class"])] : null;
    var li = el("li");
    var img = el("img");
    img.src = iconUrl(cls ? cls.icon : 0);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(img);
    if (cls) {
      var ca = el("a", null, cls.name);
      ca.href = "#/class/" + cls.id;
      li.appendChild(ca);
    }
    if (o.how === "level") {
      li.appendChild(el("span", null, " - trained at level " + o.level));
    } else if (o.how === "rank") {
      li.appendChild(el("span", null, o.rank ? " - earned at rank " + o.rank
                                             : " - available from the start"));
      if (o.cost) li.appendChild(el("span", "via", o.cost + " destiny points"));
    } else {
      var t = D.traits[String(o.trait)];
      li.appendChild(el("span", null, " - from trait "));
      var ta = el("a", null, t ? t.name : "#" + o.trait);
      ta.href = "#/trait/" + o.trait;
      li.appendChild(ta);
      var bits = [];
      if (o.rank) bits.push("at rank " + o.rank);
      if (o.branch) bits.push(branchName(o.branch, o.branchName));
      if (o.cell) bits.push("cell " + o.cell);
      if (o.level) bits.push("level " + o.level);
      if (o.classRank) bits.push("class rank " + o.classRank);
      if (o.setPoints) bits.push(o.setPoints + " points spent");
      if (bits.length) li.appendChild(el("span", "via", bits.join("  ")));
    }
    ul.appendChild(li);
  });
  return ul;
}

/* The shown branch name ("The Quiet Knife") comes from the enum's localised
   log_strings and is resolved at extraction time. Fall back to the tail of the
   internal key ("Class_Specialization_Burglar_Two") if it is ever missing. */
function branchName(key, name) {
  if (name) return name;
  if (!key) return "";
  var parts = String(key).split("_");
  return parts[parts.length - 1];
}

function cellSort(a, b) {
  function n(c) {
    var m = /^(\d+)_(\d+)$/.exec(c || "");
    return m ? parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) : 1e9;
  }
  return n(a.cell) - n(b.cell);
}

/* The front page lists the classes as shortcuts once the data arrives. */
function showLandingClasses() {
  var landing = document.getElementById("landing");
  if (!landing || landing.dataset.filled) return;
  landing.dataset.filled = "1";
  classData().then(function (D) {
    var box = el("div");
    box.style.marginTop = "18px";
    classGrids(D, box);
    landing.appendChild(box);
  });
}

function classCard(c) {
  var a = el("a", "classcard");
  a.href = "#/class/" + c.id;
  var img = el("img");
  img.src = iconUrl(c.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  a.appendChild(img);
  var t = el("div");
  t.appendChild(el("div", "cn", c.name));
  t.appendChild(el("div", "mt", (c.skills || []).length +
    (c.side === "creep" ? " skills by rank" : " trained skills")));
  a.appendChild(t);
  return a;
}

/* Free Peoples classes advance by level, monster-play classes by rank, so they
   are listed apart rather than sorted into one alphabet. */
function classGroups(D) {
  var all = Object.keys(D.classes).map(function (k) { return D.classes[k]; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  return [
    ["Classes", all.filter(function (c) { return c.side !== "creep"; })],
    ["Monster play", all.filter(function (c) { return c.side === "creep"; })]
  ];
}

function classGrids(D, host) {
  classGroups(D).forEach(function (g) {
    if (!g[1].length) return;
    host.appendChild(el("h3", "sec", g[0]));
    var grid = el("div", "stats");
    g[1].forEach(function (c) { grid.appendChild(classCard(c)); });
    host.appendChild(grid);
  });
}

function renderClassList(D) {
  var host = el("div");
  classGrids(D, host);
  return host;
}

function renderClass(c, D) {
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(c.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, c.name));
  h.appendChild(el("div", "id", "class " + c.id + (c.code ? "  /  internally " + c.code : "")));
  head.appendChild(h);
  host.appendChild(head);
  if (c.side === "creep") {
    var tg = el("div", "tags");
    tg.appendChild(el("span", "tag kind", "Monster play"));
    if (c.unlockCost) {
      tg.appendChild(el("span", "tag", "unlocks for " + c.unlockCost));
    }
    host.appendChild(tg);
  }
  if (c.desc) host.appendChild(richPara("desc", c.desc));

  // --- skills earned by level (players) or by rank (creeps) ---
  var creep = c.side === "creep";
  var step = creep ? "rank" : "level";
  if (c.skills) {
    var byLevel = {};
    c.skills.forEach(function (e) {
      var at = creep ? (e.rank || 0) : e.level;
      (byLevel[at] = byLevel[at] || []).push(e);
    });
    var t = el("table", "t");
    t.innerHTML = "<tr><th>" + (creep ? "Rank" : "Level") + "</th><th>Skill</th><th>" +
      (creep ? "Cost" : "Prerequisite") + "</th></tr>";
    Object.keys(byLevel).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (lvl) {
        byLevel[lvl].forEach(function (e, i) {
          var meta = nameOf(e.id);
          var tr = el("tr");
          var td0 = el("td", "num", i === 0 ? String(lvl) : "");
          var td1 = el("td");
          var im = el("img");
          im.src = iconUrl(meta ? meta.k : 0);
          im.alt = "";
          im.className = "inline";
          im.onerror = function () { this.style.visibility = "hidden"; };
          td1.appendChild(im);
          var a = el("a", null, meta ? meta.n : "#" + e.id);
          a.href = "#/skill/" + e.id;
          td1.appendChild(a);
          var td2;
          if (creep) {
            td2 = el("td", "muted", e.cost ? e.cost + " destiny points" : "free");
          } else {
            var pm = e.prerequisite ? nameOf(e.prerequisite) : null;
            td2 = el("td", "muted", pm ? pm.n : "");
          }
          tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
          t.appendChild(tr);
        });
      });
    section(host, creep ? "Skills earned by rank" : "Skills trained by level", t);
  }

  // --- the trait tree, branch by branch ---
  (c.trees || []).forEach(function (tid) {
    var tree = D.trees[String(tid)];
    if (!tree) return;
    var byBranch = {};
    tree.cells.forEach(function (cell) {
      (byBranch[cell.branch] = byBranch[cell.branch] || []).push(cell);
    });
    host.appendChild(el("h3", "sec", "Trait tree"));
    (tree.branches.length ? tree.branches : Object.keys(byBranch).map(function (k) {
      return { key: k };
    })).forEach(function (br) {
      var cells = (byBranch[br.key] || []).slice().sort(cellSort);
      if (!cells.length) return;
      var hh = el("div", "branch");
      hh.appendChild(el("div", "bn", branchName(br.key, br.name)));
      if (br.desc) {
        var d = el("div", "muted");
        d.appendChild(richText(br.desc));
        hh.appendChild(d);
      }
      var ul = el("ul", "links");
      cells.forEach(function (cell) {
        var t = D.traits[String(cell.trait)];
        var grants = (t && t.skills) ? t.skills.length : 0;
        ul.appendChild(traitLink(t, "cell " + cell.cell +
          (grants ? "  grants " + grants + " skill" + (grants === 1 ? "" : "s") : "")));
      });
      hh.appendChild(ul);

      // the client carries a copied set-bonus list for a few branches that have
      // none in game; say so rather than leaving a silent gap
      if (br.noSetBonuses) {
        var nb = el("div", "muted");
        nb.style.cssText = "font-size:11.5px;margin-top:6px";
        nb.textContent = "This line has no set bonuses.";
        hh.appendChild(nb);
      }
      // set bonuses: awarded for points spent in this branch, not placed in it
      if (br.setBonuses && br.setBonuses.length) {
        var sb = el("div", "setbonus");
        sb.appendChild(el("div", "sbh", "Set bonuses"));
        var sul = el("ul", "links");
        br.setBonuses.forEach(function (bonus) {
          sul.appendChild(traitLink(D.traits[String(bonus.trait)],
                                    bonus.points + " points"));
        });
        sb.appendChild(sul);
        hh.appendChild(sb);
      }
      host.appendChild(hh);
    });
  });

  // --- every skill this class picks up from a trait rather than a level ---
  var granted = [];
  var seen = {};
  function addGrant(traitId, where) {
    var t = D.traits[String(traitId)];
    if (!t || !t.skills) return;
    t.skills.forEach(function (g) {
      var key = g.id + ":" + traitId;
      if (seen[key]) return;
      seen[key] = 1;
      granted.push({ skill: g.id, rank: g.rank, trait: t, where: where });
    });
  }
  (c.trees || []).forEach(function (tid) {
    var tree = D.trees[String(tid)];
    if (!tree) return;
    tree.cells.forEach(function (cell) {
      addGrant(cell.trait, branchName(cell.branch, cell.branchName) + " " + cell.cell);
    });
    (tree.branches || []).forEach(function (br) {
      (br.setBonuses || []).forEach(function (bonus) {
        addGrant(bonus.trait, branchName(br.key, br.name) + " set, " + bonus.points + " points");
      });
    });
  });
  (c.traits || []).forEach(function (e) {
    addGrant(e.id, "class trait at " + step + " " + (creep ? (e.rank || 0) : e.level));
  });

  if (granted.length) {
    granted.sort(function (a, b) {
      var an = nameOf(a.skill), bn = nameOf(b.skill);
      return (an ? an.n : "").localeCompare(bn ? bn.n : "");
    });
    var gt = el("table", "t");
    gt.innerHTML = "<tr><th>Skill</th><th>From trait</th><th>Where</th></tr>";
    granted.forEach(function (g) {
      var meta = nameOf(g.skill);
      var tr = el("tr");
      var td0 = el("td");
      var im = el("img");
      im.src = iconUrl(meta ? meta.k : 0);
      im.alt = "";
      im.className = "inline";
      im.onerror = function () { this.style.visibility = "hidden"; };
      td0.appendChild(im);
      var a = el("a", null, meta ? meta.n : "#" + g.skill);
      a.href = "#/skill/" + g.skill;
      td0.appendChild(a);
      if (g.rank) td0.appendChild(el("span", "via", "at rank " + g.rank));
      tr.appendChild(td0);
      var td1 = el("td");
      var ta = el("a", null, g.trait.name);
      ta.href = "#/trait/" + g.trait.id;
      td1.appendChild(ta);
      tr.appendChild(td1);
      tr.appendChild(el("td", "muted", g.where));
      gt.appendChild(tr);
    });
    section(host, "Skills granted by traits", gt);
  }

  // --- passive class traits earned at a level ---
  if (c.traits) {
    var ul2 = el("ul", "links");
    c.traits.forEach(function (e) {
      ul2.appendChild(traitLink(D.traits[String(e.id)],
                                step + " " + (creep ? (e.rank || 0) : e.level)));
    });
    section(host, creep ? "Class traits by rank" : "Class traits by level", ul2);
  }
  return host;
}

function renderTrait(t, D, MS, progs) {
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(t.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, t.name));
  h.appendChild(el("div", "id", "trait " + t.id));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  if (t.nature) tags.appendChild(el("span", "tag kind", titleCase(String(t.nature).replace("Class_", ""))));
  if (t.category) tags.appendChild(el("span", "tag", titleCase(t.category)));
  host.appendChild(tags);

  if (t.desc) host.appendChild(richPara("desc", t.desc));
  if (t.tooltip && t.tooltip !== t.desc) {
    var tp = el("p", "muted");
    tp.appendChild(richText(t.tooltip));
    host.appendChild(tp);
  }
  section(host, "At a glance", statRow([
    ["Tier", t.tier],
    ["Minimum level", t.minLevel]
  ]));
  // a trait's Mod_Progression is indexed by the trait's RANK, not by level
  section(host, "What it changes", grantsBlock(t.stats, MS, progs, "Rank", D));

  if (t.skills) {
    section(host, "Skills granted", linkList(t.skills.map(function (g) {
      return { id: g.id, via: g.rank ? "at rank " + g.rank : "" };
    }), "skill"));
  }
  // The effects the trait puts on you. Most are plumbing - they exist to fill
  // an effect slot on a skill - so the useful half is which skills they reach.
  if (t.effects) {
    section(host, "Effects it applies", linkList(t.effects.map(function (g) {
      return { id: g.id, via: g.rank ? "at rank " + g.rank : "" };
    }), "effect"));
  }
  // which classes reach this trait
  var owners = [];
  Object.keys(D.classes).forEach(function (k) {
    var c = D.classes[k];
    var viaTree = (c.trees || []).some(function (tid) {
      var tree = D.trees[String(tid)];
      return tree && tree.cells.some(function (cell) { return cell.trait === t.id; });
    });
    var viaLevel = (c.traits || []).filter(function (e) { return e.id === t.id; })[0];
    if (viaTree || viaLevel) owners.push([c, viaLevel ? "level " + viaLevel.level : "trait tree"]);
  });
  if (owners.length) {
    var ul = el("ul", "links");
    owners.forEach(function (pair) {
      var li = el("li");
      var im = el("img");
      im.src = iconUrl(pair[0].icon);
      im.alt = "";
      im.onerror = function () { this.style.visibility = "hidden"; };
      li.appendChild(im);
      var a = el("a", null, pair[0].name);
      a.href = "#/class/" + pair[0].id;
      li.appendChild(a);
      li.appendChild(el("span", "via", pair[1]));
      ul.appendChild(li);
    });
    section(host, "Available to", ul);
  }
  return host;
}

/* A skill's *_Mod_Array names PROPERTIES, not sources - "this multiplier is
   scaled by Corsair_Positional_Bonus". This resolves each property back to the
   traits and effects that actually grant it, which is the part a player wants. */
/* Render every link, hide the overflow, and let "+N more" reveal it. A count
   with no way to see what it counts is just a tease. */
function linkRun(items, limit, notListed) {
  var frag = document.createDocumentFragment();
  var hidden = [];
  items.forEach(function (make, i) {
    var sep = i ? document.createTextNode(", ") : null;
    var node = make();
    if (!node) return;
    if (i < limit) {
      if (sep) frag.appendChild(sep);
      frag.appendChild(node);
    } else {
      var span = el("span");
      span.hidden = true;
      if (sep) span.appendChild(sep);
      span.appendChild(node);
      hidden.push(span);
      frag.appendChild(span);
    }
  });
  var extra = hidden.length;
  if (extra || notListed) {
    var more = el("a", "more");
    more.href = "#";
    more.textContent = extra ? "  +" + extra + " more" : "";
    if (extra) {
      more.onclick = function (ev) {
        ev.preventDefault();
        var open = hidden.length && hidden[0].hidden;
        hidden.forEach(function (h) { h.hidden = !open; });
        more.textContent = open ? "  show fewer" : "  +" + extra + " more";
        return false;
      };
      frag.appendChild(more);
    }
    if (notListed) {
      frag.appendChild(el("span", "via", "  (" + notListed + " not listed)"));
    }
  }
  return frag;
}

function sourceFragment(prop, MS, D, limit, only, noGear) {
  var frag = document.createDocumentFragment();
  var src = MS && MS[prop];
  if (!src || (!src.traits && !src.effects && !src.traceries && !src.sets)) {
    frag.appendChild(el("span", "muted", "no source in this dataset"));
    return frag;
  }
  var hidden = 0;
  function wanted(list) {
    return (list || []).filter(function (id) {
      if (noGear && isGearSource(id)) { hidden++; return false; }
      if (reachable(id, only)) return true;
      hidden++;
      return false;
    });
  }
  src = {
    traits: wanted(src.traits), effects: wanted(src.effects),
    traceries: wanted(src.traceries), sets: wanted(src.sets),
    traitsMore: src.traitsMore, effectsMore: src.effectsMore,
    traceriesMore: src.traceriesMore, setsMore: src.setsMore
  };
  frag.hiddenCount = hidden;
  if (!src.traits.length && !src.effects.length && !src.traceries.length
      && !src.sets.length) {
    frag.emptyByFilter = hidden > 0;
    frag.appendChild(el("span", "muted",
      hidden ? "nothing this class can reach" : "no source in this dataset"));
    return frag;
  }
  var makers = [];
  (src.traits || []).forEach(function (id) {
    makers.push(function () {
      var t = D.traits[String(id)];
      if (!t) return null;
      var a = el("a", null, t.name);
      a.href = "#/trait/" + id;
      return a;
    });
  });
  (src.traceries || []).forEach(function (id) {
    makers.push(function () {
      var meta = nameOf(id);
      var essence = meta && meta.t === "z";
      var a = el("a", essence ? "ess" : "trc",
                 (meta ? meta.n : "#" + id) + (essence ? " (essence)" : " (tracery)"));
      a.href = "#/" + (essence ? "essence" : "tracery") + "/" + id;
      return a;
    });
  });
  (src.effects || []).forEach(function (id) {
    makers.push(function () {
      var meta = nameOf(id);
      var a = el("a", "eff", meta ? meta.n : "#" + id);
      a.href = "#/effect/" + id;
      return a;
    });
  });
  (src.sets || []).forEach(function (id) {
    makers.push(function () {
      var st = SETS && SETS[String(id)];
      var a = el("a", "set", (st ? st.name : "#" + id) + " (set)");
      a.href = "#/set/" + id;
      return a;
    });
  });
  frag.appendChild(linkRun(makers, limit || 6,
    (src.traitsMore || 0) + (src.effectsMore || 0) + (src.traceriesMore || 0) +
    (src.setsMore || 0)));
  return frag;
}

function sourceCell(prop, MS, D, only, noGear) {
  var td = el("td");
  var src = MS[prop];
  if (!src) {
    td.appendChild(el("span", "muted", "no source in this dataset"));
    return td;
  }
  var frag = sourceFragment(prop, MS, D, 6, only, noGear);
  td.hiddenCount = frag.hiddenCount || 0;
  td.emptyByFilter = !!frag.emptyByFilter;
  td.appendChild(frag);
  return td;
}

/* The other direction from modsBlock: a trait or effect says which properties
   it grants, and this shows what those properties actually scale - across
   skills, and across other effects and traits, which read them through
   Mod_ModifierList. */
function grantsBlock(stats, MS, progs, xLabel, D, only) {
  if (!stats || !stats.length) return null;
  var wrap = el("div");
  var t = el("table", "t");
  t.innerHTML = "<tr><th>Property</th><th>How</th><th>Amount</th><th>What it scales</th></tr>";

  stats.forEach(function (st) {
    var tr = el("tr");

    var td0 = el("td");
    td0.appendChild(el("code", "pn", st.stat));
    if (st.description) {
      var dd = el("div", "muted");
      dd.appendChild(richText(st.description));
      td0.appendChild(dd);
    }
    // this modifier can itself be conditional
    if (st.modifiedBy && st.modifiedBy.length && D) {
      st.modifiedBy.forEach(function (prop) {
        var line = el("div", "muted");
        line.appendChild(document.createTextNode("scaled by "));
        line.appendChild(el("code", "pn", prop));
        line.appendChild(document.createTextNode(" from "));
        line.appendChild(sourceFragment(prop, MS, D, 4));
        td0.appendChild(line);
      });
    }
    tr.appendChild(td0);

    tr.appendChild(el("td", null, st.op || "Add"));

    var td2 = el("td", "num");
    if (st.value !== undefined) {
      td2.textContent = fmt(st.value);
    } else if (st.progression) {
      td2.textContent = "scales with " + (xLabel || "level").toLowerCase();
    } else {
      td2.textContent = "-";
    }
    if (st.minLevel !== undefined || st.maxLevel !== undefined) {
      td2.appendChild(el("div", "muted",
        "level " + (st.minLevel === undefined ? "" : st.minLevel) + " - " +
        (st.maxLevel === undefined ? "" : st.maxLevel)));
    }
    tr.appendChild(td2);

    tr.appendChild(readersCell(st.stat, MS, D, only));
    t.appendChild(tr);
  });
  wrap.appendChild(t);

  if (progs) {
    stats.forEach(function (st) {
      if (!st.progression) return;
      var pts = curvePoints(progs[String(st.progression)],
                            (xLabel || "Level") === "Level" ? LEVEL_CAP : 0);
      if (pts && pts.length) wrap.appendChild(chart(pts, st.stat, xLabel));
    });
  }
  return wrap;
}

/* Everything that reads a property: skill values, and other effects and traits
   that scale one of their own modifiers by it. */
function readersCell(prop, MS, D, only) {
  var td = el("td");
  var src = (MS && MS[prop]) || {};
  var any = false;
  var SHOW = 10;

  var byField = {};
  (src.skills || []).forEach(function (u) {
    if (!reachable(u[0], only)) return;
    (byField[u[1]] = byField[u[1]] || []).push(u[0]);
  });
  Object.keys(byField).sort().forEach(function (field) {
    any = true;
    var ids = byField[field];
    var line = el("div");
    line.appendChild(el("strong", null, field));
    line.appendChild(document.createTextNode(" on "));
    line.appendChild(linkRun(ids.map(function (id) {
      return function () {
        var meta = nameOf(id);
        var a = el("a", null, meta ? meta.n : "#" + id);
        a.href = "#/skill/" + id;
        return a;
      };
    }), SHOW, src.skillsMore || 0));
    td.appendChild(line);
  });

  [["readEffects", "effect", "Effects"], ["readTraits", "trait", "Traits"]].forEach(function (spec) {
    var rows = (src[spec[0]] || []).filter(function (r) {
      return reachable(r[0], only);
    });
    if (!rows.length) return;
    any = true;
    var line = el("div");
    line.appendChild(el("strong", null, spec[2]));
    line.appendChild(document.createTextNode(" "));
    line.appendChild(linkRun(rows.map(function (r) {
      return function () {
        var meta = nameOf(r[0]);
        var a = el("a", spec[1] === "effect" ? "eff" : null, meta ? meta.n : "#" + r[0]);
        a.href = "#/" + spec[1] + "/" + r[0];
        a.title = "scales its " + r[1];
        return a;
      };
    }), SHOW, src[spec[0] + "More"] || 0));
    td.appendChild(line);
  });

  if (!any) td.appendChild(el("span", "muted", "nothing in this dataset reads it"));
  return td;
}

/* Effects a skill only applies when something else is in play - almost always
   a trait. The skill names a property slot; a trait's effect fills it. Without
   this section the page silently omits half of what a traited skill does. */
var SLOT_WORDS = {
  "User Effect List": "on you",
  "Toggle User Effect List": "on you, while toggled",
  "Target Effect List": "on the target",
  "Positional Target Effect List": "on the target, from the right side",
  "Critical Effect List": "on a critical hit",
  "Critical Target Effect List": "on the target, on a critical hit",
  "Super Critical Target Effect List": "on the target, on a devastating critical",
  "Toggle Effect List": "while toggled"
};

function effectRunCell(ids) {
  var td = el("td");
  td.appendChild(linkRun(ids.map(function (eid) {
    return function () {
      var meta = nameOf(eid);
      var a = el("a", "eff", meta ? meta.n : "#" + eid);
      a.href = "#/effect/" + eid;
      a.title = "effect " + eid;
      return a;
    };
  }), 4, 0));
  return td;
}

/* An effect whose application chance is zero cannot land on its own. The
   client leaves it off the tooltip, and so does the panel above - but the
   effect is real once something grants the chance, so it is listed here with
   the property that has to supply it and whatever sets that property. */
function chanceBlock(s, D, MS) {
  var refs = [];
  (s.attacks || []).forEach(function (a) {
    ["targetEffects", "positionalEffects", "superCritEffects"].forEach(function (k) {
      (a[k] || []).forEach(function (e) { refs.push(e); });
    });
  });
  ["userEffects", "userEffectsAdditive", "toggleEffects", "critEffects"]
    .forEach(function (k) { (s[k] || []).forEach(function (e) { refs.push(e); }); });

  var rows = [];
  var seen = {};
  refs.forEach(function (ref) {
    var e = EFFECT_CACHE[String(ref.id)];
    if (!e || e.probability !== 0 || seen[ref.id]) return;
    seen[ref.id] = 1;
    rows.push(e);
  });
  if (!rows.length) return null;

  var t = el("table", "t");
  t.innerHTML = "<tr><th>Effect</th><th>Needs</th><th>Which comes from</th></tr>";
  rows.forEach(function (e) {
    var tr = el("tr");
    var td0 = el("td");
    var a = el("a", "eff", e.name);
    a.href = "#/effect/" + e.id;
    td0.appendChild(a);
    if (e.duration) td0.appendChild(el("span", "via", secs(e.duration)));
    tr.appendChild(td0);

    var td1 = el("td");
    var cs = chanceSource(e);
    if (cs) td1.appendChild(cs);
    else td1.appendChild(el("span", "muted", "nothing in this dataset grants it"));
    tr.appendChild(td1);

    tr.appendChild(e.probabilityFrom
      ? sourceCell(e.probabilityFrom, MS, D, ownerClasses(s), !usesGear(ownerClasses(s), D))
      : el("td"));
    t.appendChild(tr);
  });
  var wrap = el("div");
  wrap.appendChild(t);
  var note = el("div", "muted");
  note.style.cssText = "font-size:11.5px;margin-top:8px";
  note.textContent = "These carry no application chance of their own, so the "
    + "skill never applies them until something supplies one.";
  wrap.appendChild(note);
  return wrap;
}

function conditionalBlock(s, D) {
  var rows = s.conditionalEffects || [];
  if (!rows.length) return null;
  var t = el("table", "t");
  t.innerHTML = "<tr><th>Applies</th><th>Effect</th><th>Only when</th></tr>";
  rows.forEach(function (r) {
    var tr = el("tr");
    var td0 = el("td", null, SLOT_WORDS[r.field] || r.field);
    if (r.via) td0.appendChild(el("span", "via", r.via));
    if (r.replaces) td0.appendChild(el("span", "via", "replaces the base list"));
    tr.appendChild(td0);
    tr.appendChild(effectRunCell(r.effects));

    var td2 = el("td");
    var traits = (r.traits || []).filter(function (id) { return D.traits[String(id)]; });
    if (traits.length) {
      td2.appendChild(el("span", "muted", "traited "));
      td2.appendChild(linkRun(traits.map(function (id) {
        return function () {
          var a = el("a", null, D.traits[String(id)].name);
          a.href = "#/trait/" + id;
          return a;
        };
      }), 3, 0));
    } else {
      // no trait applies it: an item set or something else we cannot name
      var meta = nameOf(r.from);
      var a = el("a", "eff", meta ? meta.n : r.prop);
      a.href = "#/effect/" + r.from;
      td2.appendChild(el("span", "muted", "something grants "));
      td2.appendChild(a);
    }
    var pn = el("div");
    pn.appendChild(el("code", "pn", r.prop));
    td2.appendChild(pn);
    if (r.description) {
      var d = el("div", "muted");
      d.appendChild(richText(r.description));
      td2.appendChild(d);
    }
    tr.appendChild(td2);
    t.appendChild(tr);
  });
  return t;
}

/* A proc is attached to a KIND of skill rather than to this one by name, so it
   is listed apart - it fires on this skill because the skill is that kind. */
function procBlock(s, D) {
  var rows = s.procEffects || [];
  if (!rows.length) return null;
  var t = el("table", "t");
  t.innerHTML = "<tr><th>Effect</th><th>Fires on</th><th>From trait</th></tr>";
  rows.forEach(function (r) {
    var tr = el("tr");
    tr.appendChild(effectRunCell(r.effects));
    var td1 = el("td", "muted", (r.procOn || []).join(", ") || "any hit");
    td1.appendChild(el("div", null, ""));
    td1.lastChild.appendChild(el("code", "pn", r.prop));
    tr.appendChild(td1);
    var td2 = el("td");
    td2.appendChild(linkRun((r.traits || []).map(function (id) {
      return function () {
        var tt = D.traits[String(id)];
        if (!tt) return null;
        var a = el("a", null, tt.name);
        a.href = "#/trait/" + id;
        return a;
      };
    }), 3, 0));
    tr.appendChild(td2);
    t.appendChild(tr);
  });
  return t;
}

/* ---------------- tooltip ---------------- */

/* The client builds a skill tooltip at render time from the skill's own
   properties - there is no stored tooltip string anywhere in the data. This
   rebuilds the same panel from the same pieces. Every level-scaled value is
   evaluated at the chosen level; the damage line cannot be, because it depends
   on the character's weapon and mastery, so it is written with those as named
   variables and explained underneath. */

function progAt(progs, id, level) {
  var pr = progs && progs[String(id)];
  if (!pr) return null;
  level = Math.min(level, LEVEL_CAP);
  if (pr.type === "linear") {
    var pts = (pr.points || []).filter(function (q) {
      return typeof q[0] === "number" && typeof q[1] === "number";
    });
    if (!pts.length) return null;
    if (level <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (level <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        var t = (level - a[0]) / ((b[0] - a[0]) || 1);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  }
  var vals = pr.values || [];
  var min = pr.minIndex === undefined ? 1 : pr.minIndex;
  var idx = Math.max(0, Math.min(vals.length - 1, level - min));
  return vals.length ? vals[idx] : null;
}

/* The highest level any of this skill's own curves defines - the sensible
   default, since that is the number a player at cap would see. */
function topLevel(s, progs) {
  var top = 0;
  function consider(id) {
    var pr = progs && progs[String(id)];
    if (!pr) return;
    if (pr.type === "linear") {
      (pr.points || []).forEach(function (q) {
        if (typeof q[0] === "number") top = Math.max(top, q[0]);
      });
    } else {
      var min = pr.minIndex === undefined ? 1 : pr.minIndex;
      top = Math.max(top, min + (pr.values || []).length - 1);
    }
  }
  (s.costs || []).forEach(function (c) { consider(c.progression); });
  (s.attacks || []).forEach(function (a) { consider(a.damageMaxProgression); });
  return Math.min(top || LEVEL_CAP, LEVEL_CAP);
}

function tipLine(host, label, value, cls) {
  if (value === null || value === undefined || value === "") return;
  var d = el("div", "tl" + (cls ? " " + cls : ""));
  if (label) d.appendChild(el("span", "tk", label));
  if (value && value.nodeType) d.appendChild(value);
  else d.appendChild(el("span", "tv", String(value)));
  host.appendChild(d);
}

function tooltipPanel(s, progs, D, level) {
  var box = el("div", "tip");

  var head = el("div", "tiphead");
  var img = el("img");
  img.src = iconUrl(s.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  head.appendChild(el("div", "tipname", s.name));
  box.appendChild(head);

  // the client's top block: range on the right, then the two type lines
  var top = el("div", "tipbody");
  if (s.maxRange !== undefined) {
    tipLine(top, null, (s.minRange !== undefined ? fmt(s.minRange) + " - " : "") +
                       fmt(s.maxRange) + "m Range");
  }
  if (s.aeSphereRadius !== undefined) {
    tipLine(top, null, fmt(s.aeSphereRadius) + "m Radius");
  }
  if (s.aeMaxTargets) tipLine(top, null, "Max targets: " + s.aeMaxTargets);
  if (s.aeArcDegrees) tipLine(top, null, fmt(s.aeArcDegrees) + " degree arc");
  if (s.induction) tipLine(top, null, fmt(s.induction.duration) + "s Induction");
  if (s.resistCategory) {
    tipLine(top, null, "Resistance: " + titleCase(s.resistCategory));
  }
  if (s.animationMode) tipLine(top, null, titleCase(s.animationMode) + " Skill");
  var shown = (s.displayType || []).map(function (t) {
    return (DISPLAY_TYPES && DISPLAY_TYPES[t]) || titleCase(t);
  });
  if (shown.length) tipLine(top, "Skill Type:", shown.join(", "));
  if (top.children.length) box.appendChild(top);

  if (s.desc) {
    var d = el("div", "tipdesc");
    d.appendChild(richText(s.desc));
    box.appendChild(d);
  }

  // Skill_Damage_Base, then the effect rows, then the cost group, then
  // Skill_RecoveryTime_Base last - the order the client's template list gives.
  var dmg = el("div", "tipbody dmg");
  (s.attacks || []).forEach(function (a) {
    var v = damageExpr(a, progs, level);
    if (v) tipLine(dmg, null, v);
  });
  if (dmg.children.length) box.appendChild(dmg);

  effectBlocks(s, level).forEach(function (blk) { box.appendChild(blk); });

  var foot = el("div", "tipbody cost");
  (s.costs || []).forEach(function (c) {
    var v = c.points !== undefined ? c.points : progAt(progs, c.progression, level);
    var txt = v === null || v === undefined
      ? (c.percent !== undefined ? fmt(c.percent) + "% of your " + (c.type || "vital") : null)
      : num(v) + " " + (c.type || "");
    tipLine(foot, "Cost:", txt);
  });
  if (s.gambitAdds) {
    var ga = gambitRow(s.gambitAdds, "Builds");
    if (ga) foot.appendChild(ga);
  }

  if (s.pipChange) {
    var pipWord = PIP_WORDS[s.pipType] || (s.pipType ? titleCase(s.pipType) : "Pips");
    tipLine(foot, pipWord + ":", (s.pipChange > 0 ? "+" : "") + s.pipChange, "pip");
  }
  if (s.gambit) {
    var gr = gambitRow(s.gambit, "Requires");
    if (gr) foot.appendChild(gr);
  }
  if (s.gambitRemoves) {
    var grm = gambitRow(s.gambitRemoves, "Clears");
    if (grm) foot.appendChild(grm);
  } else if (s.clearsGambits) {
    tipLine(foot, null, "Clears All Gambits");
  }
  if (s.induction) {
    tipLine(foot, "Induction:", fmt(s.induction.duration) + "s" +
      (s.induction.interruptable ? ", interruptable" : ""), "time");
  }
  if (s.cooldown !== undefined) {
    tipLine(foot, "Cooldown:", secs(s.cooldown), "time");
  }
  if (foot.children.length) box.appendChild(foot);

  var req = (s.obtained || []).map(function (o) {
    var c = D && D.classes[String(o["class"])];
    if (!c) return null;
    if (o.how === "level") return c.name + ", level " + o.level;
    if (o.how === "rank") return c.name + ", rank " + (o.rank || 0);
    return c.name;
  }).filter(Boolean);
  if (req.length) box.appendChild(el("div", "tipreq", "Requires " + req[0]));
  return box;
}

/* The same panel for an effect. An effect tooltip in game is the buff or debuff
   box: what it does, for how long, and what it changes - the property lines
   come from the same PropertyMetaData the skill panel uses. */
function effectTooltip(e, progs, D, level) {
  var box = el("div", "tip");

  var head = el("div", "tiphead");
  var img = el("img");
  img.src = iconUrl(e.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  head.appendChild(el("div", "tipname", e.name));
  box.appendChild(head);

  // Effect_ResistanceCategory_Base comes before the description in the client
  if (e.resistCategory) {
    var rc = el("div", "tipbody");
    var rl = el("div", "tl tipresist");
    rl.textContent = "Resistance: " + titleCase(e.resistCategory);
    rc.appendChild(rl);
    box.appendChild(rc);
  }

  // the page no longer repeats these above, so the panel carries both the
  // definition wording and the on-application line when they differ
  var said = {};
  [e.desc, e.descOverride, e.applied].forEach(function (w) {
    if (!w || said[w]) return;
    said[w] = 1;
    var d = el("div", "tipdesc");
    d.appendChild(richText(w));
    box.appendChild(d);
  });

  var body = el("div", "tipbody");
  var v = e.vital;
  if (v) {
    var init = v.initial !== undefined ? v.initial
             : progAt(progs, v.initialProgression, level);
    var per = progAt(progs, v.perPulseProgression, level);
    var one = vitalLine(e, v, init, v.vpsInitial, v.initialVariance,
                        e.pulseCount ? " on application" : "");
    if (one) tipLine(body, null, one);
    if (e.pulseCount) {
      var rep = vitalLine(e, v, per, v.vpsPerPulse, v.perPulseVariance,
                          " every " + fmt(e.interval || e.duration) + "s, " +
                          e.pulseCount + " times");
      if (rep) tipLine(body, null, rep);
    }
    if (v.critMultiplier && v.critMultiplier !== 1) {
      tipLine(body, null, "Critical multiplier x" + fmt(v.critMultiplier));
    }
  }
  (e.stats || []).forEach(function (st) {
    var line = statLine(st);
    if (line) body.appendChild(line);
  });
  if (body.children.length) box.appendChild(body);

  // Effect_TimeDisplay_Base is the last of the client's four rows, and the
  // panel ends there. Chance, cure type, stacking and what applies it are all
  // on the page below - the tooltip is the tooltip.
  var foot = el("div", "tipbody");
  if (e.pulseCount && e.interval) {
    tipLine(foot, "Duration:", secs(e.interval * e.pulseCount) +
      "  (" + e.pulseCount + " pulses, " + fmt(e.interval) + "s apart)", "time");
  } else if (e.duration !== undefined) {
    tipLine(foot, "Duration:", secs(e.duration), "time");
  } else if (e.permanent) {
    tipLine(foot, "Duration:", "permanent", "time");
  }
  if (foot.children.length) box.appendChild(foot);
  return box;
}

/* One heal or damage-over-time line. When the effect carries a vitals-per-
   second multiplier the stored curve is a coefficient on the character's own
   healing or damage rate, not an amount - a heal-over-time curve reading 0.1
   is 0.1 of V, not 0 morale. Those are written with V as the variable, the
   same way skill damage is written with W and A. */
function vitalLine(e, v, value, vps, variance, tail) {
  if (!value) return null;
  var harmful = e.harmful;
  var word = harmful ? "Deals" : "Restores";
  var unit = e.vitalType === "Power" ? "Power" : (harmful ? "damage" : "Morale");
  var type = e.damageType ? e.damageType + " " : "";
  var span = el("span", "tv");
  if (vps) {
    var coef = Math.abs(value) * vps * (v.baseMultiplier || 1);
    span.appendChild(el("span", null, word + " "));
    span.appendChild(el("code", "dmg", fmt(coef, 2) + " x V"));
    span.appendChild(el("span", null, " " + type + unit + tail));
  } else {
    span.appendChild(el("span", null, word + " " +
      num(Math.abs(value) * (v.baseMultiplier || 1)) +
      " " + type + unit + tail));
  }
  if (variance) {
    span.appendChild(el("span", "muted", "  +/-" + fmt(variance * 100, 0) + "%"));
  }
  return span;
}

/* The property that has to supply an application chance, and the chance it
   supplies - resolved from wherever that property is actually set, so the page
   can say "50%" rather than only naming the property. */
function chanceSource(e) {
  if (!e.probabilityFrom) return null;
  var box = el("span");
  box.appendChild(el("code", "pn", e.probabilityFrom));
  var vals = e.probabilityValues || [];
  if (vals.length) {
    var pct = vals.map(function (v) {
      return fmt(v * 100, 1) + "%";
    });
    var uniq = pct.filter(function (x, i) { return pct.indexOf(x) === i; });
    box.appendChild(el("span", null, "  gives " + uniq.join(" / ")));
  } else {
    box.appendChild(el("span", "muted", "  value not in this dataset"));
  }
  return box;
}

/* Only show a level box when something on the panel actually moves with it. */
function usesLevel(e) {
  var v = e.vital || {};
  if (v.initialProgression || v.perPulseProgression) return true;
  return (e.stats || []).some(function (st) { return st.progression; });
}

/* The client's word for a class resource - the Mariner calls Balance pips
   "Attunes", and the tooltip says so. */
var PIP_WORDS = { Balance: "Attunes", Fervour: "Fervour", Focus: "Focus" };

/* Each effect the skill puts up gets its own block, the way the game shows it:
   the effect's own wording, then one line per property it changes, named and
   formatted the way PropertyMetaData says, then the duration. */
function effectBlocks(s, level) {
  var out = [];
  var refs = [];
  (s.attacks || []).forEach(function (a) {
    (a.targetEffects || []).forEach(function (e) { refs.push(e); });
  });
  (s.userEffects || []).forEach(function (e) { refs.push(e); });
  (s.toggleEffects || []).forEach(function (e) { refs.push(e); });

  refs.slice(0, 6).forEach(function (ref) {
    var e = EFFECT_CACHE[String(ref.id)];
    if (!e) return;
    // no application chance of its own: it never lands unless something
    // grants the chance, so it is listed below the panel instead
    if (e.probability === 0) return;
    var blk = el("div", "tipeff");
    var head = el("a", "tipeffname", e.name);
    head.href = "#/effect/" + e.id;
    blk.appendChild(head);
    if (e.applied || e.descOverride) {
      var d = el("div", "tipeffdesc");
      d.appendChild(richText(e.applied || e.descOverride));
      blk.appendChild(d);
    }
    (e.stats || []).forEach(function (st) {
      var line = statLine(st);
      if (line) blk.appendChild(line);
    });
    var dur = ref.duration !== undefined ? ref.duration : e.duration;
    if (dur !== undefined && dur > 0) {
      blk.appendChild(el("div", "tipdur", "Duration: " + secs(dur)));
    } else if (e.permanent) {
      blk.appendChild(el("div", "tipdur", "Duration: permanent"));
    }
    if (blk.children.length > 1) out.push(blk);
  });
  return out;
}

/* "+30% Advance Damage" - the label and the percentage flag both come from the
   property's own metadata, which is how the client writes these lines. */
/* How much a modifier is worth, worded the way the client words it. The
   operation matters: Multiply 0.7 on a percentage property is -30%, not +70%,
   and Multiply on a plain property is the "x2" of "x2 Outgoing Damage".
   `signed` is false where the wording already carries the sign. */
function statAmount(st, meta, signed) {
  var v = st.value;
  var pct = meta && meta.p;
  var n, suffix = "";
  if (st.op === "Multiply") {
    if (pct) { n = (v - 1) * 100; suffix = "%"; }
    else { n = v; }
  } else if (pct) {
    n = v * 100; suffix = "%";
  } else {
    n = v;
  }
  if (st.op === "Subtract") n = -Math.abs(n);
  var out = fmt(signed ? n : Math.abs(n), 1).replace(/\.0$/, "");
  if (signed && n > 0) out = "+" + out;
  return out + suffix;
}

/* The client's own wording for a modifier, from Mod_DescriptionOverride -
   "Slows movement speed by 30%". Its "*" is the placeholder the value goes
   into; a sign or "x" already in front of it means the value goes in
   unsigned. */
function statWording(st, meta) {
  var d = st.description;
  if (!d) return null;
  if (d.indexOf("*") === -1) return d;
  if (st.value === undefined || st.value === null) return null;
  d = d.replace(/([-+x])[ \t]*\*/g, function (_, sign) {
    return sign + statAmount(st, meta, false);
  });
  d = d.replace(/\*/g, statAmount(st, meta, true));
  return d.replace(/[ \t]{2,}/g, " ");
}

/* One line of a tooltip: "+30% Advance Damage". The label and the percentage
   flag come from the property's own metadata, which is how the client writes
   these - but where the modifier carries its own wording, that wins. */
function statLine(st, xLabel) {
  var meta = PROPS && PROPS[st.stat];
  var name = meta ? meta.n : st.stat;
  var v = st.value;
  var said = statWording(st, meta);
  if (v === undefined || v === null || typeof v === "boolean") {
    if (said) return multiLine("tipstat", said);
    if (v === undefined || v === null) {
      if (!st.progression) return null;
      return el("div", "tipstat",
                "Scales with " + (xLabel || "level") + ": " + name);
    }
    return null;
  }
  if (v === 0 && (st.modifiedBy || []).length) {
    // the value is nil until something grants it - the game still lists it
    return el("div", "tipstat cond", (said || name) + "  (when traited)");
  }
  if (v === 0) return null;
  if (said) return multiLine("tipstat", said);
  return el("div", "tipstat", statAmount(st, meta, true) + " " + name);
}

/* Some wordings carry their own line breaks, written as a literal \n. */
function multiLine(cls, str) {
  var host = el("div", cls);
  String(str).split(/\\n|\n/).forEach(function (part) {
    if (!part.trim()) return;
    if (host.childNodes.length) host.appendChild(el("br"));
    host.appendChild(document.createTextNode(part.trim()));
  });
  return host.childNodes.length ? host : null;
}

/* The effect lines a tooltip carries: what it puts on the target, and what it
   puts on you. Conditional ones are left out - the panel is what the client
   would draw for an untraited character. */
function effectLines(s) {
  var out = [];
  var onTarget = [];
  (s.attacks || []).forEach(function (a) {
    (a.targetEffects || []).forEach(function (e) { onTarget.push(e); });
  });
  if (onTarget.length) out.push({ label: "Applies", refs: onTarget });
  if (s.userEffects && s.userEffects.length) {
    out.push({ label: "On you", refs: s.userEffects });
  }
  if (s.toggleEffects && s.toggleEffects.length) {
    out.push({ label: "While active", refs: s.toggleEffects });
  }
  return out;
}

function effectRef(refs) {
  var span = el("span", "tv");
  span.appendChild(linkRun(refs.slice(0, 6).map(function (e) {
    return function () {
      var meta = nameOf(e.id);
      var a = el("a", "eff", meta ? meta.n : "#" + e.id);
      a.href = "#/effect/" + e.id;
      if (e.duration !== undefined) {
        a.title = fmt(e.duration) + "s";
      }
      return a;
    };
  }), 3, 0));
  return span;
}

/* Damage is the one line that cannot be resolved here: the client multiplies
   the skill's coefficients by the character's weapon and mastery. Those two
   are written as W and A and explained below the panel. */
function damageExpr(a, progs, level) {
  var parts = [];
  var mod = a.damageModifier === undefined ? 1 : a.damageModifier;
  if (a.implementContribution) parts.push(fmt(a.implementContribution) + " x W");
  if (a.damageContribution) parts.push(fmt(a.damageContribution) + " x A");
  if (!parts.length) return null;
  var expr = parts.join(" + ");
  if (mod !== 1) expr = fmt(mod) + " x (" + expr + ")";
  var cap = a.damageMax !== undefined ? a.damageMax
          : (a.damageMaxProgression ? progAt(progs, a.damageMaxProgression, level) : null);
  var span = el("span", "tv");
  span.appendChild(el("code", "dmg", expr));
  var hand = a.usesPrimary ? "Main-hand" : a.usesSecondary ? "Off-hand"
           : a.usesRanged ? "Ranged" : a.usesTactical ? "Tactical" : null;
  var lead = [a.damageType || null, hand ? "(" + hand + ")" : null]
    .filter(Boolean).join(" ");
  span.appendChild(el("span", null, "  " + (lead ? lead + " " : "") + "Damage"));
  var tail = [];
  if (cap) tail.push("max " + num(cap));
  if (a.critMultiplier) tail.push("crit x" + fmt(a.critMultiplier));
  if (tail.length) span.appendChild(el("span", "muted", "  " + tail.join(", ")));
  return span;
}

function damageNote(s) {
  var n = el("div", "muted tipnote");
  n.innerHTML =
    "<strong>W</strong> is what your weapon contributes at this level (its DPS "
    + "over the skill's animation) and <strong>A</strong> is your damage-add "
    + "from mastery. The client multiplies those by the coefficients above, "
    + "which are the skill's own; the two variables come from your character "
    + "and gear, so they are not in this data. Everything else on the panel is "
    + "evaluated at the level you pick.";
  return n;
}

function modsBlock(s, D, MS) {
  var groups = [];
  (s.mods || []).forEach(function (g) { groups.push([g, null]); });
  (s.attacks || []).forEach(function (a, i) {
    (a.mods || []).forEach(function (g) { groups.push([g, "attack " + (i + 1)]); });
  });
  if (!groups.length) return null;

  // A class skill only lists what that class can actually reach: its own
  // traits, its trait tree, its set bonuses and any tracery. Everything else
  // belongs to somebody else's character and is noise on this page.
  var owners = ownerClasses(s);
  var noGear = !usesGear(owners, D);
  var wrap = el("div");
  var scoped = true;

  function draw() {
    var only = scoped ? owners : null;
    var t = el("table", "t");
    t.innerHTML = "<tr><th>Value</th><th>Scaled by</th><th>Which comes from</th></tr>";
    var dropped = 0, hiddenLinks = 0;
    groups.forEach(function (pair) {
      var g = pair[0], where = pair[1];
      var cells = g.props.map(function (prop) {
        return sourceCell(prop, MS, D, only, noGear && scoped);
      });
      // a value whose every source belongs to other classes is not reachable
      var reach = cells.some(function (td) { return !td.emptyByFilter; });
      cells.forEach(function (td) { hiddenLinks += td.hiddenCount || 0; });
      if (!reach) { dropped++; return; }
      g.props.forEach(function (prop, i) {
        var tr = el("tr");
        var td0 = el("td");
        if (i === 0) {
          td0.appendChild(document.createTextNode(g.field));
          if (where) td0.appendChild(el("span", "via", where));
        }
        tr.appendChild(td0);
        var td1 = el("td");
        td1.appendChild(el("code", "pn", prop));
        tr.appendChild(td1);
        tr.appendChild(cells[i]);
        t.appendChild(tr);
      });
    });

    wrap.textContent = "";
    wrap.appendChild(t);
    var note = el("div", "muted");
    note.style.cssText = "font-size:11.5px;margin-top:8px";
    note.appendChild(document.createTextNode(
      "A value listed here is not always active - it applies only while "
      + "something grants the property beside it."));
    wrap.appendChild(note);

    if (owners.length) {
      var foot = el("div", "muted");
      foot.style.cssText = "font-size:11.5px;margin-top:4px";
      var named = owners.map(function (c) {
        var cc = D.classes[String(c)];
        return cc ? cc.name : null;
      }).filter(Boolean);
      var who = named.length === 1 ? "a " + named[0]
              : named.length === 2 ? named.join(" or ")
              : named.length ? named.slice(0, 2).join(", ") + " and "
                               + (named.length - 2) + " more"
              : "this class";
      if (scoped) {
        foot.appendChild(document.createTextNode(
          "Showing only what " + who +
          " can reach" + (noGear ? " - no traceries or essences, monster play has "
            + "no legendary items" : "") +
          (hiddenLinks ? (noGear ? "; " : " - ") + hiddenLinks + " source" +
          (hiddenLinks === 1 ? "" : "s") + " hidden" : "") +
          (dropped ? ", " + dropped + " value" + (dropped === 1 ? "" : "s") +
           " with no reachable source" : "") + ".  "));
      } else {
        foot.appendChild(document.createTextNode("Showing every class.  "));
      }
      var a = el("a", null, scoped ? "show all" : "show only this class");
      a.href = "#";
      a.onclick = function (ev) { ev.preventDefault(); scoped = !scoped; draw(); return false; };
      foot.appendChild(a);
      wrap.appendChild(foot);
    }
  }

  draw();
  return wrap;
}

/* A tracery ships as 36 items - four rarities across nine level bands - and
   every item within a rarity carries identical modifiers. So the page is one
   row per rarity, with the bands listed once rather than 36 near-duplicates. */
function renderTracery(t, D, MS, progs) {
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(t.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, t.name));
  h.appendChild(el("div", "id", (t.kind === "essence" ? "essence " : "tracery ") + t.id +
    (t.socket ? "  /  " + t.socket : "") +
    (t.channel ? "  /  " + t.channel : "")));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  var isEssence = t.kind === "essence";
  tags.appendChild(el("span", "tag kind", isEssence ? "Essence" : "Tracery"));
  // the slot name players use - Word of Mastery / Power / Craft, Heraldic
  // Tracery - rather than the internal Legacy_Class_Corsair
  if (t.slot) tags.appendChild(el("span", "tag slot", t.slot));
  var cls = t["class"] ? D.classes[String(t["class"])] : null;
  tags.appendChild(el("span", "tag", cls ? cls.name + " only" : "Any class"));
  host.appendChild(tags);

  if (t.desc) host.appendChild(richPara("desc", t.desc));

  // one row per rarity: the modifiers, and the bands it comes in
  var tbl = el("table", "t");
  tbl.innerHTML = "<tr><th>Rarity</th><th>Gives</th><th>Available at</th></tr>";
  (t.rarities || []).forEach(function (r) {
    var tr = el("tr");
    tr.appendChild(el("td", "rar-" + String(r.quality).toLowerCase(), r.quality));

    var td1 = el("td");
    (r.stats || []).forEach(function (st) {
      var line = el("div");
      line.appendChild(el("code", "pn", st.stat));
      if (st.value !== undefined) {
        line.appendChild(el("span", null, "  " + (st.op === "Add" ? "+" : "") + fmt(st.value, 4)));
      } else if (st.progression) {
        line.appendChild(el("span", "muted", "  scales with item level"));
      }
      td1.appendChild(line);
    });
    if (!(r.stats || []).length) td1.appendChild(el("span", "muted", "-"));
    tr.appendChild(td1);

    var td2 = el("td", "muted");
    var bands = (r.items || []).map(function (b) {
      return (b.minLevel === undefined ? "?" : b.minLevel) + "-" +
             (b.maxLevel === undefined ? "?" : b.maxLevel);
    });
    td2.appendChild(linkRun((r.items || []).map(function (b, i) {
      return function () {
        var sp = el("span", "band", bands[i]);
        sp.title = "item " + b.id + ", item level " + b.itemLevel;
        return sp;
      };
    }), 12, 0));
    tr.appendChild(td2);
    tbl.appendChild(tr);
  });
  section(host, "By rarity", tbl);

  // what the properties it grants actually do
  var allStats = [];
  var seenStat = {};
  (t.rarities || []).forEach(function (r) {
    (r.stats || []).forEach(function (st) {
      if (!seenStat[st.stat]) { seenStat[st.stat] = 1; allStats.push(st); }
    });
  });
  section(host, "What those properties affect",
          grantsBlock(allStats, MS, null, "Item level", D, freepClasses(D)));

  if (cls) {
    var ul = el("ul", "links");
    var li = el("li");
    var ci = el("img");
    ci.src = iconUrl(cls.icon);
    ci.alt = "";
    ci.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(ci);
    var a = el("a", null, cls.name);
    a.href = "#/class/" + cls.id;
    li.appendChild(a);
    ul.appendChild(li);
    section(host, "Usable by", ul);
  }
  return host;
}

/* An item set: the pieces that count towards it, and what each threshold
   grants. The effects hanging off a threshold are where every Itemset_*
   property in the game comes from - nothing else sets them. */
function renderSet(st, D, MS, progs) {
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(st.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, st.name));
  h.appendChild(el("div", "id", "set " + st.id));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag kind", "Item set"));
  if ((st.members || []).length) {
    tags.appendChild(el("span", "tag", st.members.length + " piece" +
      (st.members.length === 1 ? "" : "s")));
  }
  if (st.level) tags.appendChild(el("span", "tag", "From level " + st.level));
  if (st.maxLevel) tags.appendChild(el("span", "tag", "Up to level " + st.maxLevel));
  host.appendChild(tags);

  if (st.desc) host.appendChild(richPara("desc", st.desc));

  // one row per threshold - two pieces, four pieces, and so on
  var tbl = el("table", "t");
  tbl.innerHTML = "<tr><th>Pieces</th><th>Grants</th><th>Effects</th></tr>";
  var any = false;
  (st.bonuses || []).forEach(function (b) {
    any = true;
    var tr = el("tr");
    tr.appendChild(el("td", "num", b.pieces === undefined ? "-" : String(b.pieces)));

    var td1 = el("td");
    (b.stats || []).forEach(function (x) {
      // the game's own wording first - "+20% Frost Damage" - then the
      // property behind it, since that is what the rest of the site links on
      var said = statLine(x, "item level");
      if (said) { said.className = "setstat"; td1.appendChild(said); }
      var line = el("div", said ? "muted small" : null);
      line.appendChild(el("code", "pn", x.stat));
      if (!said) {
        if (x.value !== undefined) {
          line.appendChild(el("span", null, "  " + (x.op === "Add" && x.value > 0 ? "+" : "") +
                                            fmt(x.value, 4)));
        } else if (x.progression) {
          line.appendChild(el("span", "muted", "  scales with item level"));
        }
      }
      td1.appendChild(line);
    });
    if (!(b.stats || []).length) td1.appendChild(el("span", "muted", "-"));
    tr.appendChild(td1);

    if ((b.effects || []).length) tr.appendChild(effectRunCell(b.effects));
    else tr.appendChild(el("td", "muted", "-"));
    tbl.appendChild(tr);
  });
  if (any) section(host, "Set bonuses", tbl);

  // the properties the thresholds set, and what in the game reads them
  var allStats = [];
  var seenStat = {};
  (st.bonuses || []).forEach(function (b) {
    (b.stats || []).forEach(function (x) {
      if (!seenStat[x.stat]) { seenStat[x.stat] = 1; allStats.push(x); }
    });
  });
  section(host, "What those properties affect",
          grantsBlock(allStats, MS, null, "Item level", D, freepClasses(D)));

  // items are not in the index, so the pieces are listed by id
  if ((st.members || []).length) {
    var run = el("div", "muted");
    run.appendChild(linkRun(st.members.map(function (iid) {
      return function () { return el("span", "band", String(iid)); };
    }), 12, 0));
    section(host, "Pieces", run);
  }
  return host;
}

/* ---------------- routing ---------------- */

function route() {
  var detail = document.getElementById("detail");

  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    selected = null;
    if (!document.getElementById("landing")) {
      location.reload();
      return;
    }
    showLandingClasses();
    runSearch();
    return;
  }

  if (/^#\/classes\/?$/.test(location.hash)) {
    selected = null;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    classData().then(function (D) {
      detail.textContent = "";
      detail.appendChild(renderClassList(D));
      document.title = "Classes - LOTRO Skills and Effects";
    });
    runSearch();
    return;
  }

  var ym = /^#\/(?:tracery|essence)\/(\d+)$/.exec(location.hash);
  if (ym) {
    var yid = parseInt(ym[1], 10);
    selected = "y" + yid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    Promise.all([traceryData(), classData(), modSources(), progressions(),
                 sourceClasses()])
      .then(function (res) {
        var T = res[0];
        SRC_CLASS = res[4] || {};
        detail.textContent = "";
        // any member item id resolves to its family
        var rec = T[String(yid)] || T[String(TRACERY_OF[yid])];
        if (!rec) {
          detail.appendChild(el("div", "empty", "No tracery with id " + yid + "."));
          return;
        }
        detail.appendChild(renderTracery(rec, res[1], res[2], res[3]));
        detail.scrollTop = 0;
        document.title = rec.name + " - LOTRO Skills and Effects";
      });
    runSearch();
    return;
  }

  var sm = /^#\/set\/(\d+)$/.exec(location.hash);
  if (sm) {
    var sid = parseInt(sm[1], 10);
    selected = "g" + sid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    Promise.all([itemSetData(), classData(), modSources(), sourceClasses(),
                 propertyData()])
      .then(function (res) {
        SETS = res[0] || {};
        SRC_CLASS = res[3] || {};
        PROPS = res[4] || {};
        detail.textContent = "";
        var rec = SETS[String(sid)];
        if (!rec) {
          detail.appendChild(el("div", "empty", "No set with id " + sid + "."));
          return;
        }
        detail.appendChild(renderSet(rec, res[1], res[2], null));
        detail.scrollTop = 0;
        document.title = rec.name + " - LOTRO Skills and Effects";
      });
    runSearch();
    return;
  }

  var cm = /^#\/(class|trait)\/(\d+)$/.exec(location.hash);
  if (cm) {
    var what = cm[1], cid = parseInt(cm[2], 10);
    selected = what === "class" ? "c" + cid : null;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    Promise.all([classData(), modSources(), progressions()]).then(function (res) {
      var D = res[0], MS = res[1], progs = res[2];
      detail.textContent = "";
      var rec = what === "class" ? D.classes[String(cid)] : D.traits[String(cid)];
      if (!rec) {
        detail.appendChild(el("div", "empty", "No " + what + " with id " + cid + "."));
        return;
      }
      detail.appendChild(what === "class" ? renderClass(rec, D)
                                          : renderTrait(rec, D, MS, progs));
      detail.scrollTop = 0;
      document.title = rec.name + " - LOTRO Skills and Effects";
    });
    runSearch();
    return;
  }

  var m = /^#\/(skill|effect)\/(\d+)$/.exec(location.hash);
  if (!m) {
    selected = null;
    return;
  }
  var kind = m[1], id = parseInt(m[2], 10);
  selected = (kind === "skill" ? "s" : "e") + id;
  detail.textContent = "";
  detail.appendChild(el("div", "muted", "loading..."));
  var jobs = [loadRecord(kind, id), progressions(), classData(), modSources(),
              effectTraceries(), sourceClasses(), gambitData(), propertyData(),
              displayTypeData(), itemSetData()];
  Promise.all(jobs).then(function (res) {
    SRC_CLASS = res[5] || {};
    GAMBITS = res[6] || {};
    PROPS = res[7] || {};
    DISPLAY_TYPES = res[8] || {};
    SETS = res[9] || {};
    var rec = res[0];
    if (!rec) {
      detail.textContent = "";
      detail.appendChild(el("div", "empty", "No " + kind + " with id " + id + "."));
      return;
    }
    return (kind === "skill" ? preloadTipEffects(rec) : Promise.resolve())
      .then(function () { finish(res, rec); });
  });

  function finish(res, rec) {
    detail.textContent = "";
    var progs = res[1] || {};
    detail.appendChild(kind === "skill"
      ? renderSkill(rec, progs, res[2], res[3], res[4])
      : renderEffect(rec, progs, res[3], res[2], res[4]));
    detail.scrollTop = 0;
    document.title = rec.name + " - LOTRO Skills and Effects";
  }
  runSearch();
}

/* ---------------- boot ---------------- */

Promise.all([getJSON("data/meta.json"), getJSON("data/index.json")])
  .then(function (r) {
    META = r[0];
    INDEX = r[1];
    INDEX.forEach(function (e) { e.f = fold(e.n); });
    BUCKETS = META.buckets || 128;
    document.getElementById("meta").textContent =
      [META.skills.toLocaleString() + " skills",
       META.effects.toLocaleString() + " effects",
       (META.traits || 0).toLocaleString() + " traits",
       (META.traceries || 0).toLocaleString() + " traceries",
       (META.essences || 0).toLocaleString() + " essences",
       (META.sets || 0).toLocaleString() + " sets",
       ((META.classes || 0) + (META.creepClasses || 0)) + " classes"].join(", ");
    var cats = {};
    INDEX.forEach(function (r2) { if (r2.c) cats[r2.c] = 1; });
    var sel = document.getElementById("fCat");
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement("option");
      o.value = c;
      o.textContent = titleCase(c);
      sel.appendChild(o);
    });
    runSearch();
    route();
  })
  .catch(function (err) {
    document.getElementById("detail").innerHTML =
      '<div class="empty"><h2>Could not load the data</h2><p>' + esc(err.message) +
      "</p><p>Browsers block <code>fetch()</code> from <code>file://</code>. " +
      "Run <code>serve.bat</code> (or <code>python -m http.server</code>) in this " +
      "folder and open <code>http://localhost:8000</code>.</p></div>";
  });

var timer;
document.getElementById("q").addEventListener("input", function () {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 90);
});
["fSkill", "fEffect", "fClass", "fTracery", "fEssence", "fSet"].forEach(function (id) {
  var b = document.getElementById(id);
  b.onclick = function () {
    typeOn[b.dataset.t] = !typeOn[b.dataset.t];
    b.classList.toggle("on", typeOn[b.dataset.t]);
    runSearch();
  };
});
document.getElementById("fCat").onchange = function () {
  catFilter = this.value;
  runSearch();
};
window.addEventListener("hashchange", route);
