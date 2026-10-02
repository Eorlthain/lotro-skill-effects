

(function () {
  var banner = document.createElement("div");
  banner.id = "banner";
  banner.innerHTML = 'Work in progress - some numbers may be wrong. ' +
    'Report them on the <a href="https://discord.gg/TyyG5hnBbg" target="_blank" rel="noopener noreferrer">Fridge Discord</a>.';
  document.body.insertBefore(banner, document.body.firstChild);
})();

var BASE = (function () {
  var tag = document.querySelector('script[src*="app.js"]');
  var u = tag ? new URL(tag.getAttribute("src"), document.baseURI)
              : new URL(location.href);
  return u.pathname.replace(/[^/]*$/, "");
})();

function urlFor(route) { return BASE + String(route).replace(/^\/+/, ""); }

var ASSET_V = (function () {
  var tag = document.querySelector('script[src*="app.js"]');
  var m = tag && /[?&]v=([0-9]+)/.exec(tag.getAttribute("src") || "");
  return m ? m[1] : "";
})();
function dataUrl(file) {
  return BASE + file + (ASSET_V ? "?v=" + ASSET_V : "");
}
function propUrl(name) { return urlFor("property/" + encodeURIComponent(name)); }
function stackUrl(name) { return urlFor("stacking/" + encodeURIComponent(name)); }

anchorStaticLinks();

(function () {
  var q = location.search;
  if (q.indexOf("?/") !== 0) return;
  var parts = q.slice(2).split("&");
  var path = parts.shift().replace(/~and~/g, "&");
  history.replaceState({}, "", BASE + path +
    (parts.length ? "?" + parts.join("&") : "") + location.hash);
})();

function anchorStaticLinks() {
  var links = document.querySelectorAll("a[data-route]");
  for (var i = 0; i < links.length; i++) {
    links[i].href = urlFor(links[i].getAttribute("data-route"));
  }
}

function routePath() {
  var p = location.pathname;
  try { p = decodeURIComponent(p); } catch (e) {  }
  return (p.indexOf(BASE) === 0 ? p.slice(BASE.length) : p.replace(/^\/+/, ""))
    .replace(/\/+$/, "");
}

var BUCKETS = 128;
var INDEX = [];
var META = {};
var cache = { skill: {}, effect: {}, item: {},
              rawskill: {}, raweffect: {} };
var PROG = {};
var selected = null;

var LANDING = document.getElementById("landing");

function getJSON(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error(url + ": " + r.status);
    return r.json();
  });
}

function cached(store, key, url) {
  if (!store[key]) {
    store[key] = getJSON(dataUrl(url)).catch(function (err) {
      delete store[key];
      throw err;
    });
  }
  return store[key];
}

function bucketOf(id) { return id % BUCKETS; }

function loadRecord(kind, id, raw) {

  var key = (raw ? "raw" : "") + kind;
  var b = bucketOf(id);
  var path = "data/" + (raw ? "raw/" : "") + kind + "/" + b + ".json";
  return cached(cache[key], b, path).then(
    function (m) { return m[String(id)] || null; },
    function () { return null; });
}

function progressions() {
  return cached(PROG, "all", "data/progressions.json")
    .catch(function () { return {}; });
}

var SIDE = {};
function sideFile(name) {
  return cached(SIDE, name, "data/" + name + ".json")
    .catch(function () { return {}; });
}
function modSources() {
  return sideFile("modSources").then(function (m) { MODSRC = m; return m; });
}
function gambitData() { return sideFile("gambits"); }
function pipData() { return sideFile("pips"); }
function itemSetData() { return sideFile("itemsets"); }
function stackingData() { return sideFile("stacking"); }

function comboFlagData() { return sideFile("comboFlags"); }
function skillChannelData() { return sideFile("skillChannels"); }
var CHANNELS = null;
var STACKING = null;
var SETS = null;
var COMBOFLAGS = null;
function propertyData() { return sideFile("properties"); }

function worldStateData() { return sideFile("worldStates"); }
var WORLD_STATES = null;
function displayTypeData() { return sideFile("displayTypes"); }

function uiIconData() { return sideFile("uiIcons").catch(function () { return {}; }); }
var UICONS = null;

function disenchantData() { return sideFile("disenchant").catch(function () { return {}; }); }
var DISENCHANT = null;

var ENUM_LABELS = null;
function enumLabelData() {
  return sideFile("enumLabels").then(function (m) { ENUM_LABELS = m; return m; });
}
function enumWord(field, value) {
  if (typeof value !== "string") return value;
  var t = ENUM_LABELS && ENUM_LABELS[field];
  return (t && t[value]) || value;
}

var PROPS = null;

var MODSRC = null;
var DISPLAY_TYPES = null;
var EFFECT_CACHE = {};

function preloadTipEffects(s) {
  var ids = {};
  (s.attacks || []).forEach(function (a) {

    ["targetEffects", "positionalEffects", "critEffects", "superCritEffects"]
      .forEach(function (k) {
        (a[k] || []).forEach(function (e) { ids[e.id] = 1; });
      });
  });
  ["userEffects", "userEffectsAdditive", "toggleEffects", "toggleUserEffects",
   "critEffects"]
    .forEach(function (k) {
      (s[k] || []).forEach(function (e) {
        ids[typeof e === "number" ? e : e.id] = 1;
      });
    });
  function fetchAll(list) {
    var want = list.filter(function (id) { return !EFFECT_CACHE[id]; });
    return Promise.all(want.map(function (id) {
      return loadRecord("effect", parseInt(id, 10)).then(function (rec) {
        if (rec) EFFECT_CACHE[String(rec.id)] = rec;
      });
    }));
  }

  function reachable(list) {
    var out = {};
    list.forEach(function (id) {
      var e = EFFECT_CACHE[id];
      if (!e) return;
      var wrapper = !!carrierLines(e) || !!e.aura;
      (e.nested || []).forEach(function (n) {

        if (wrapper || n.spawn || isOverTimeVia(n.via) || isExpireVia(n.via) ||
            isReactiveVia(n.via) || n.via === COMBO_BASE_VIA) {
          out[n.id] = 1;
        }
      });
    });
    return Object.keys(out);
  }
  var seen = {};
  Object.keys(ids).forEach(function (id) { seen[id] = 1; });
  function descend(list, left) {
    if (!list.length || !left) return Promise.resolve();
    return fetchAll(list).then(function () {
      var next = reachable(list).filter(function (id) {
        if (seen[id]) return false;
        seen[id] = 1;
        return true;
      });
      return descend(next, left - 1);
    });
  }
  return descend(Object.keys(ids), 6);
}

function preloadEffectTip(e) {

  EFFECT_CACHE[String(e.id)] = e;
  return preloadTipEffects({ userEffects: [{ id: e.id }] });
}

var TRAIT_TIP_VIA = {
  "EffectGenerator_SkillProc_UserEffectList": 1,
  "EffectGenerator_SkillProc_TargetEffectList": 1,
  "EffectGenerator_UserEffectList": 1,
  "EffectGenerator_CasterEffectList": 1,
  "EffectGenerator_DefenderEffectList": 1,
  "EffectGenerator_AttackerEffectList": 1
};
function traitTipNested(e) {
  return (e.nested || []).filter(function (n) { return TRAIT_TIP_VIA[n.via]; });
}

function preloadTraitEffects(t) {
  var want = {};
  function walk(id, depth) {
    if (depth > 3 || want[id] === "done") return Promise.resolve();
    if (EFFECT_CACHE[String(id)]) {
      want[id] = "done";
      return Promise.all(traitTipNested(EFFECT_CACHE[String(id)])
        .map(function (n) { return walk(n.id, depth + 1); }));
    }
    want[id] = "done";
    return loadRecord("effect", id).then(function (rec) {
      if (!rec) return;
      EFFECT_CACHE[String(rec.id)] = rec;
      return Promise.all(traitTipNested(rec)
        .map(function (n) { return walk(n.id, depth + 1); }));
    });
  }
  return Promise.all((t.effects || []).map(function (g) { return walk(g.id, 0); }));
}

var GAMBITS = null;

var PIPS = null;

function gambitRow(steps, label) {
  if (!steps || !steps.length || !GAMBITS) return null;
  var box = el("div", "gambit");
  if (label) box.appendChild(el("span", "gl", label + ":"));
  steps.forEach(function (code, i) {
    var g = GAMBITS[String(code)];

    var a = el(g ? "a" : "span", "gstep");
    if (g) a.href = urlFor("skill/" + g.skill);
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

var SRC_CLASS = null;

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

  return !!meta && (meta.t === "y" || meta.t === "z" || meta.t === "g");
}

function ownerClasses(rec) {
  var direct = (rec.obtained || []).map(function (o) { return o["class"]; })
    .filter(function (c) { return c; });
  if (direct.length) return direct;
  var own = SRC_CLASS && SRC_CLASS[String(rec.id)];
  return own ? own.slice() : [];
}

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

function ownedBy(id, classIds) {
  if (!classIds || !classIds.length || !SRC_CLASS) return true;
  var own = SRC_CLASS[String(id)];
  if (!own) return false;
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

      TRACERY_OF = {};
      Object.keys(T).forEach(function (fid) {
        (T[fid].members || []).forEach(function (m) { TRACERY_OF[m] = fid; });
      });
    }
    return T;
  });
}

var CLASS_DATA = null;
function classData() {
  return Promise.all([sideFile("classes"), sideFile("traits"), sideFile("traitTrees")])
    .then(function (r) {
      CLASS_DATA = { classes: r[0], traits: r[1], trees: r[2] };
      return CLASS_DATA;
    });
}

function propCode(name) {
  var a = el("a", "pn");
  a.href = propUrl(name);
  a.textContent = name;
  return a;
}

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

function iconUrl(id) {
  return BASE + "icons/" + (id ? id : "blank") + ".png";
}

function richText(str) {
  var frag = document.createDocumentFragment();
  if (!str) return frag;

  str = String(str).replace(/<li>\s*/gi, "\u2022 ").replace(/<\/li>/gi, "\\n");

  str = str.replace(/(?:\\n\s*){3,}/g, "\\n\\n").replace(/^(?:\\n)+/, "");

  var re = /<rgb=#([0-9a-fA-F]{1,8})>([\s\S]*?)(?:<\/rgb>|$)/gi;
  var at = 0, m;
  function plain(t, colour) {

    var parts = String(t).replace(/<\/rgb>/gi, "").split(/\\n|\n/);
    parts.forEach(function (bit, i) {
      if (i) frag.appendChild(document.createElement("br"));
      if (!bit) return;
      if (colour && /^([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(colour)) {
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
  var s = n.toFixed(dp === undefined ? 3 : dp);

  return s.indexOf(".") === -1 ? s
       : s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function num(n) {
  return typeof n === "number" ? String(Math.round(n)) : fmt(n);
}

function numAmt(n) {
  return num(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function secs(n) {
  if (n === undefined || n === null) return "-";
  if (typeof n !== "number" || !isFinite(n) || n < 60) return fmt(n) + "s";
  var STEPS = [[86400, "d", 3600, "h"], [3600, "h", 60, "m"], [60, "m", 1, "s"]];
  for (var i = 0; i < STEPS.length; i++) {
    var big = STEPS[i][0];
    if (n < big) continue;
    var whole = Math.floor(n / big);
    var rest = n - whole * big;

    var sub = STEPS[i][2] === 1 ? fmt(rest) : Math.floor(rest / STEPS[i][2]);
    if (!rest || !sub) return whole + STEPS[i][1];
    return whole + STEPS[i][1] + " " + sub + STEPS[i][3];
  }
  return fmt(n) + "s";
}

var ACRONYMS = {
  AoE: 1, AOE: 1, DoT: 1, HoT: 1, DPS: 1, HPS: 1, NPC: 1, AI: 1, UI: 1,
  PvP: 1, PvMP: 1, MP: 1, MC: 1, LI: 1, FM: 1, CC: 1
};

function spaceWords(word) {
  word = String(word).replace(/_/g, " ");
  var out = "";
  for (var i = 0; i < word.length; i++) {
    var ch = word[i];
    if (i && /[A-Z]/.test(ch) && /[a-z0-9]/.test(word[i - 1])) out += " ";
    out += ch;
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

function titleCase(s) {
  if (Array.isArray(s)) return s.map(titleCase).join(", ");
  return String(s).split("_").map(function (part) {
    if (!part) return "";
    if (ACRONYMS[part]) return part;
    return part.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
               .replace(/^./, function (c) { return c.toUpperCase(); });
  }).filter(Boolean).join(" ");
}

var typeOn = { s: true, e: true, c: true, y: true, z: true, g: true, r: true,
               i: true };
var catFilter = "";

function fold(str) {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function squash(folded) {
  return folded.replace(/[^a-z0-9]+/g, "");
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

var TEXT = null;
var TEXT_STATE = "idle";
function searchText() {
  if (TEXT_STATE === "idle") {
    TEXT_STATE = "loading";
    sideFile("searchText").then(function (t) {
      TEXT = t || {};
      TEXT_STATE = "ready";
      runSearch();
    });
  }
  return TEXT;
}

var TYPE_WORDS = {
  s: "s", skill: "s", skills: "s",
  e: "e", effect: "e", effects: "e",
  c: "c", "class": "c", classes: "c",
  r: "r", trait: "r", traits: "r",
  y: "y", tracery: "y", traceries: "y",
  z: "z", essence: "z", essences: "z",
  g: "g", set: "g", sets: "g",

  i: "i", item: "i", items: "i",
  p: "p", prop: "p", property: "p", properties: "p"
};

var PROPNAMES = null;
var PROPNAMES_STATE = "idle";
function propertyNames() {
  if (PROPNAMES) return PROPNAMES;
  if (MODSRC) {
    PROPNAMES = Object.keys(MODSRC).sort();
    return PROPNAMES;
  }
  if (PROPNAMES_STATE === "idle") {
    PROPNAMES_STATE = "loading";
    modSources().then(function () { PROPNAMES_STATE = "ready"; runSearch(); });
  }
  return null;
}

function searchProperties(q) {
  var box = document.getElementById("results");
  var count = document.getElementById("count");
  var names = propertyNames();
  if (!names) {
    box.textContent = "";
    count.textContent = "loading properties...";
    return;
  }
  var hits = [];
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (!q) { hits.push([0, n]); continue; }
    var sc = score(n, q, fold(n));
    if (sc < 0) {
      var sq = squash(fold(n)).indexOf(squash(q));
      if (sq < 0) continue;
      sc = 4 + sq / 100;
    }
    hits.push([sc, n]);
  }
  hits.sort(function (a, b) {
    return a[0] !== b[0] ? a[0] - b[0] : a[1].localeCompare(b[1]);
  });
  var total = hits.length;
  hits = hits.slice(0, 300);
  box.textContent = "";
  var frag = document.createDocumentFragment();
  hits.forEach(function (pair) {
    var row = el("a", "row");
    row.href = propUrl(pair[1]);
    var img = el("img");
    img.src = iconUrl(0);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    var txt = el("div", "txt");
    txt.appendChild(el("div", "nm", pair[1]));
    txt.appendChild(el("div", "mt", "Property"));
    row.appendChild(img);
    row.appendChild(txt);
    frag.appendChild(row);
  });
  box.appendChild(frag);
  CURSOR = -1;
  count.textContent = total.toLocaleString() + " propert" +
    (total === 1 ? "y" : "ies") + (total > 300 ? ", showing 300" : "");
}

function idsFromQuery(q) {
  var out = [];
  var hex = /^0x([0-9a-f]+)$/i.exec(q);
  if (hex) return [parseInt(hex[1], 16)];
  if (/^\d{6,}$/.test(q)) out.push(parseInt(q, 10));
  if (/^[0-9a-f]{6,10}$/i.test(q)) out.push(parseInt(q, 16));
  return out.length ? out : null;
}

function runSearch() {
  var raw = document.getElementById("q").value.trim();
  var typeWord = null;
  var pref = /^([a-z]+):\s*(.*)$/i.exec(raw);
  if (pref && TYPE_WORDS[pref[1].toLowerCase()]) {
    typeWord = TYPE_WORDS[pref[1].toLowerCase()];
    raw = pref[2];
  }
  var q = fold(raw.trim());
  if (typeWord === "p") {
    searchProperties(q);
    return;
  }

  var qs = squash(q) || null;
  var numeric = idsFromQuery(q);
  var out = [];
  var byText = [];

  var only = (PREFS.cls && SRC_CLASS) ? PREFS.cls : null;
  for (var i = 0; i < INDEX.length; i++) {
    var r = INDEX[i];
    if (typeWord ? r.t !== typeWord : !typeOn[r.t]) continue;
    if (catFilter && r.c !== catFilter) continue;
    if (only && !belongsTo(r.i, only)) continue;
    if (numeric !== null) {
      if (numeric.indexOf(r.i) !== -1) out.push([0, r]);
      continue;
    }
    if (q) {
      var s = score(r.n, q, r.f);

      if (qs !== null) {
        var s2 = score(r.n, qs, r.q);
        if (s2 >= 0 && (s < 0 || s2 + 0.25 < s)) s = s2 + 0.25;
      }
      if (s < 0) {

        var T = searchText();
        if (T && q.length >= 3) {
          var blob = T[String(r.i)];
          if (blob && blob.indexOf(q) >= 0) byText.push([r.x ? 1 : 0, r]);
        }
        continue;
      }

      out.push([s + (r.x ? 50 : 0), r]);
    } else {

      out.push([(r.x ? 2 : 0) + (/^[A-Z]/.test(r.n) ? 0 : 1), r]);
    }
  }
  out.sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1].n.localeCompare(b[1].n);
  });
  byText.sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1].n.localeCompare(b[1].n);
  });
  var total = out.length;
  var textTotal = byText.length;
  out = out.slice(0, 300);
  byText = byText.slice(0, Math.max(0, 300 - out.length));

  var box = document.getElementById("results");
  box.textContent = "";
  var frag = document.createDocumentFragment();
  function drawRow(r) {
    var row = el("a", "row" + (selected === r.t + r.i ? " sel" : ""));
    row.href = urlFor(routeFor(r.t) + "/" + r.i);

    var kl = r.kl;
    var img = kl && iconStack([kl[0], kl[1], kl[2], r.k, kl[3]], true);
    if (!img) {
      img = el("img");
      img.src = iconUrl(r.k);
      img.loading = "lazy";
      img.alt = "";
      img.onerror = function () { this.style.visibility = "hidden"; };
    }
    var txt = el("div", "txt");
    txt.appendChild(el("div", "nm", r.n));
    var kindWord = r.t === "s" ? "Skill" : r.t === "e" ? "Effect"
                 : r.t === "y" ? "Tracery" : r.t === "z" ? "Essence"
                 : r.t === "g" ? "Set" : r.t === "r" ? "Trait"
                 : r.t === "i" ? "Item" : "Class";

    var cat = r.c && r.c !== "Class" && titleCase(r.c) !== kindWord
      ? " - " + titleCase(r.c) : "";
    txt.appendChild(el("div", "mt", kindWord + cat + (r.x ? " - internal" : "")));
    row.appendChild(img);
    row.appendChild(txt);
    frag.appendChild(row);
  }
  out.forEach(function (pair) { drawRow(pair[1]); });
  if (byText.length) {
    var sep = el("div", "resgroup");
    sep.textContent = "found in the description";
    frag.appendChild(sep);
    byText.forEach(function (pair) { drawRow(pair[1]); });
  }
  box.appendChild(frag);
  CURSOR = -1;
  var bits = [total.toLocaleString() + " match" + (total === 1 ? "" : "es")];
  if (textTotal) bits.push(textTotal.toLocaleString() + " by description");
  if (total + textTotal > 300) bits.push("showing 300");
  if (TEXT_STATE === "loading") bits.push("loading descriptions...");
  if (PREFS.cls) {
    var cn = CLASS_DATA && CLASS_DATA.classes[String(PREFS.cls)];
    bits.push((cn ? cn.name : "one class") + " only");
  }
  document.getElementById("count").textContent = bits.join(", ");
}

var CURSOR = -1;
function moveCursor(step) {
  var rows = document.querySelectorAll("#results .row");
  if (!rows.length) return;
  CURSOR += step;
  if (CURSOR < 0) CURSOR = rows.length - 1;
  if (CURSOR >= rows.length) CURSOR = 0;
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("cur", i === CURSOR);

  if (rows[CURSOR].scrollIntoView) rows[CURSOR].scrollIntoView({ block: "nearest" });
}
function openCursor() {
  var rows = document.querySelectorAll("#results .row");
  var row = rows[CURSOR] || rows[0];
  if (row) navigate(new URL(row.href).pathname);
}

function trimPadding(pts) {

  if (!pts.length) return pts;
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

function curvePoints(p, cap, progs, level) {
  if (!p) return null;
  var pts;
  if (p.type === "nested") {

    var base = p.minIndex === undefined ? 1 : p.minIndex;
    pts = (p.inner || []).map(function (id, i) {
      return [base + i, progAt(progs, id,
                               level === undefined ? LEVEL_CAP : level)];
    }).filter(function (q) { return typeof q[1] === "number"; });
    return pts.length ? trimPadding(pts) : null;
  }
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

  if (!pts.length) return null;
  return trimPadding(capCurve(pts, cap));
}

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

  var W = 520, H = 162, L = 50, R = 20, T = 26, B = 24;
  var xs = pts.map(function (p) { return p[0]; });
  var ys = pts.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);

  if (y0 > 0 && y0 <= (y1 - y0) * 0.5) y0 = 0;
  else if (y0 > 0) {
    var pad = (y1 - y0) * 0.12 || Math.abs(y0) * 0.05;
    y0 -= pad; y1 += pad;
  }
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

function routeFor(t) {
  return t === "s" ? "skill" : t === "e" ? "effect"
       : t === "y" ? "tracery" : t === "z" ? "essence"
       : t === "g" ? "set" : t === "r" ? "trait"
       : t === "i" ? "item" : "class";
}

var BY_ID = null;
function nameOf(id) {
  if (!BY_ID) {
    BY_ID = {};
    for (var i = 0; i < INDEX.length; i++) BY_ID[INDEX[i].i] = INDEX[i];
  }
  return BY_ID[id] || null;
}

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
    a.href = urlFor("trait/" + id);
    body.appendChild(a);
    if (t && t.nature) {
      body.appendChild(el("span", "via", titleCase(String(t.nature).replace("Class_", ""))));
    }
    li.appendChild(body);
    ul.appendChild(li);
  });
  return ul;
}

function viaLabel(via) {
  return String(via).split(", ").map(function (one) {
    return spaceWords(one.replace(/^Effect(Generator)?_/, "")
                         .replace(/_(Array|List)$/, ""))
      .replace(/\bEffect List\b/, "effects")
      .toLowerCase();
  }).join(", ");
}

var COMBO_SRC_SHOWN = 4;

function comboFlagSources(prop, flag) {
  var byProp = COMBOFLAGS && COMBOFLAGS[prop];
  var rec = byProp && byProp[flag];
  if (!rec) return null;
  var ids = [], more = 0;
  ["traits", "effects", "sets", "traceries"].forEach(function (kind) {
    (rec[kind] || []).forEach(function (id) { ids.push(id); });
    more += rec[kind + "More"] || 0;
  });
  return ids.length ? { ids: ids, more: more } : null;
}

function sameWords(a, b) {
  return String(a).toLowerCase().replace(/[^a-z0-9]/g, "")
      === String(b).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function comboFlagNode(prop, flag) {
  var span = el("span", "comboflag");
  var label = spaceWords(flag);
  var src = comboFlagSources(prop, flag);

  if (src && src.ids.length === 1 && !src.more) {
    var only = nameOf(src.ids[0]);
    if (only && sameWords(only.n, label)) {
      var b = el("b");
      b.appendChild(readerLink(src.ids[0], routeFor(only.t)));
      span.appendChild(b);
      return span;
    }
  }
  span.appendChild(el("b", null, label));
  if (!src) return span;
  span.appendChild(document.createTextNode(" from "));

  var dup = ambiguousNames(src.ids);
  span.appendChild(linkRun(src.ids.map(function (id) {
    return function () {
      var meta = nameOf(id);
      return meta ? readerLink(id, routeFor(meta.t), null, dup) : null;
    };
  }), COMBO_SRC_SHOWN, src.more ? src.more + " more not listed" : 0));
  return span;
}

function comboWhy(id, r) {
  if (!r || !r.when || !r.when.length) return null;
  var box = el("div", "combowhy");
  r.when.forEach(function (alt, i) {
    var line = el("div");
    line.appendChild(el("span", "muted", i ? "or while " : "while "));
    var first = true;
    alt.forEach(function (pair) {
      var prop = pair[0], flags = pair[1] || [];
      flags.forEach(function (flag) {
        if (!first) line.appendChild(el("span", "muted", " and "));
        first = false;
        line.appendChild(comboFlagNode(prop, flag));
      });
    });
    box.appendChild(line);
  });
  return box;
}

function linkList(refs, kindGuess, subLine) {
  var ul = el("ul", "links");

  var dup = ambiguousNames(refs.map(function (r) {
    return typeof r === "number" ? r : r.id;
  }));
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
    a.href = urlFor("" + kind + "/" + id);
    if (!meta) pending(a, img, id);
    if (meta && dup[meta.n]) a.appendChild(el("span", "idtag", "#" + id));
    body.appendChild(a);
    var bits = [];
    if (r && r.duration !== undefined) bits.push(fmt(r.duration) + "s");
    if (r && r.spellcraft !== undefined) bits.push("sc " + fmt(r.spellcraft));
    if (r && r.via) bits.push(viaLabel(r.via));
    if (bits.length) body.appendChild(el("span", "via", bits.join("  ")));

    var extra = subLine ? subLine(id, r) : null;
    if (extra) {
      body.appendChild(extra);
      li.className = "twoline";
    }
    li.appendChild(body);
    ul.appendChild(li);
  });
  return ul;
}

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
        a.href = urlFor("tracery/" + tid);
        return a;
      };
    }), 4, 0));
    return line;
  };
}

function section(host, title, node) {
  if (!node) return;

  if (node.tagName === "UL" && !node.children.length) return;
  if (node.tagName === "TABLE" && node.rows.length <= 1) return;
  host.appendChild(el("h3", "sec", title));
  host.appendChild(node);
}

function statRow(pairs) {
  var box = el("div", "stats");
  pairs.forEach(function (p) {
    if (p[1] === undefined || p[1] === null || p[1] === "-") return;
    var s = el("div", "stat" + (p[2] ? " " + p[2] : ""));
    s.appendChild(el("div", "k", p[0]));

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

function appliedEffectIds(s) {
  var out = [];
  (s.attacks || []).forEach(function (a) {
    HOOK_SLOTS.forEach(function (k) {
      (a[k] || []).forEach(function (e) { out.push(e.id); });
    });
  });
  CHANCE_SLOTS.concat(["userEffectsOverride", "critEffectsAdditive"])
    .forEach(function (k) {
      (s[k] || []).forEach(function (e) {
        out.push(typeof e === "number" ? e : e.id);
      });
    });
  return out;
}

function skillTraceries(s, MS, ET) {
  if (!MS) return null;
  var props = [];
  var groups = (s.mods || []).slice();
  (s.attacks || []).forEach(function (a) {
    (a.mods || []).forEach(function (gg) { groups.push(gg); });
  });
  groups.forEach(function (gg) { props = props.concat(gg.props || []); });
  (s.costs || []).forEach(function (c) { props = props.concat(c.mods || []); });

  var seen = {}, ids = [];
  function take(tid) {
    if (seen[tid]) return;
    var meta = nameOf(tid);
    if (!meta || meta.t !== "y") return;
    seen[tid] = 1;
    ids.push(tid);
  }
  props.forEach(function (prop) {
    var src = MS[prop];
    if (!src) return;
    (src.traceries || []).forEach(take);
  });

  (appliedEffectIds(s) || []).forEach(function (id) {
    ((ET && ET[String(id)]) || []).forEach(take);
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
      a.href = urlFor("tracery/" + tid);
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

  var gearOk = usesGear(ownerClasses(s), D);

  var gatedShown = !!(D && MS);
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

  ["usableWhileMoving", "requiresFacing", "mustBeStealthed",
   "breaksStealth", "ignoresResetTime"].forEach(function (f) {
    if (s[f]) tags.appendChild(el("span", "tag", titleCase(f)));
  });
  host.appendChild(tags);

  var wrap = el("div");
  var lvl = preferredLevel(topLevel(s, progs));
  function drawTip() {
    wrap.textContent = "";
    wrap.appendChild(tooltipPanel(s, progs, lvl));
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
      return a.implementContribution || hasDamageAdd(a);
    })) {
      wrap.appendChild(damageNote(s));
    }
  }
  function input2focus() {

    var i = wrap.querySelector("input");
    if (i) i.focus();
  }
  drawTip();
  section(host, "Tooltip", wrap);

  if (s.gambitAdds) {
    var gb = gambitRow(s.gambitAdds, "Builds");
    if (gb) section(host, "Gambit", gb);
  }

  var range = s.maxRange !== undefined
    ? (s.minRange !== undefined ? fmt(s.minRange) + " - " : "") + fmt(s.maxRange) + "m"
    : null;
  section(host, "At a glance", statRow([
    ["Cooldown", s.cooldown !== undefined ? secs(s.cooldown) : null],
    ["Range", range],
    ["Induction", s.induction
      ? secs(s.induction.duration) +
        (s.induction.interruptable ? ", interruptable" : ", uninterruptable")
      : null],
    ["Channel", s.channel
      ? secs(s.channel.duration) +
        (s.channel.interruptedByMovement ? ", broken by movement" : "")
      : null],
    ["Threat", s.threat],
    ["Pip change", pipGlance(s), "wide"],
    ["Resist", resistNames(s.resistCategory)],
    ["Traceries", usesGear(ownerClasses(s), D) ? skillTraceries(s, MS, ET) : null, "wide"]
  ]));

  if (D) section(host, "How you get it", obtainedBlock(s, D));

  section(host, "From these items", itemSources(s));

  section(host, "Area of effect", areaBlock(s));
  section(host, "Positional", positionalBlock(s));

  if (s.costs || s.toggleCosts) {
    var t = el("table", "t");
    t.innerHTML = "<tr><th>Vital</th><th>Points</th><th>Percent</th><th>Scaling</th><th>Modifiers</th></tr>";
    (s.costs || []).concat((s.toggleCosts || []).map(function (c) {
      var copy = {}, k;
      for (k in c) if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k];
      copy.perSecond = true;
      return copy;
    })).forEach(function (c) {
      var tr = el("tr");
      tr.innerHTML = "<td>" + esc((vitalName(c.type) || "-") +
          (c.perSecond ? " per second" : "")) + "</td>" +
        '<td class="num">' + fmt(c.points) + "</td>" +
        '<td class="num">' + (c.percent === undefined ? "-" : fmt(c.percent * 100, 3) + "%") + "</td>" +
        "<td>" + (c.progression ? "scales with level" : "-") + "</td>" +
        "<td></td>";

      tr.cells[4].appendChild(linkRun((c.mods || []).map(function (m) {
        return function () { return propCode(m); };
      }), 6, 0));
      t.appendChild(tr);
    });
    section(host, "Cost", t);

  }

  if (s.attacks) {

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
        "<td>" + esc(enumWord("damageQualifier", a.damageQualifier) || "-") + "</td>" +
        "<td>" + esc(enumWord("damageType", a.damageType) || "-") + "</td>" +
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
      HOOK_SLOTS.forEach(function (k) {
        (a[k] || []).forEach(function (e) {
          hookEffects.push({ id: e.id, duration: e.duration, via: k });
        });
      });
    });
    hookEffects = ungated(hookEffects, gatedShown);
    if (hookEffects.length) {
      section(host, "Effects applied on hit",
              linkList(hookEffects, "effect", traceryLine(ET, gearOk)));
    }
  }

  [["userEffects", "Effects on the caster"],
   ["userEffectsOverride", "Caster effects (override)"],
   ["userEffectsAdditive", "Caster effects (additive)"],
   ["toggleEffects", "Toggle effects"],
   ["toggleUserEffects", "Toggle effects on you"],
   ["critEffects", "Critical effects"],
   ["critEffectsAdditive", "Critical effects (additive)"],
   ["requiredEffects", "Requires these effects"],
   ["barringEffects", "Barred by these effects"],
   ["consumedEffects", "Requires and consumes these effects"]].forEach(function (pair) {
    if (!s[pair[0]]) return;

    var list = CHANCE_SLOTS.indexOf(pair[0]) === -1
      ? s[pair[0]] : ungated(s[pair[0]], gatedShown);
    if (list.length) {
      section(host, pair[1], linkList(list, "effect", traceryLine(ET, gearOk)));
    }
  });

  if (s.combos) section(host, "Combos into", linkList(s.combos.map(function (c) {
    return { id: c.skill, via: c.mode, when: c.when };
  }), "skill", comboWhy));
  if (s.comboFrom) {
    section(host, "Combos from", linkList(s.comboFrom.map(function (c) {
      return { id: c.skill, via: c.mode, when: c.when };
    }), "skill", comboWhy));
  }

  if (D && MS) section(host, "Effects with no chance of their own", chanceBlock(s, D, MS));
  if (D) {
    section(host, "Effects that need a trait", conditionalBlock(s, D, "trait"));
    section(host, "Effects that need a set bonus", conditionalBlock(s, D, "set"));

    section(host, "Effects that need something else",
            conditionalBlock(s, D, "other"));
  }
  if (D) section(host, "Procs on this skill", procBlock(s, D));
  if (D && MS) section(host, "Modifiers", modsBlock(s, D, MS));

  host.appendChild(el("h3", "sec", "Source data"));
  host.appendChild(rawBlock("skill", s.id));
  return host;
}

function renderEffect(e, progs, MS, D, ET) {

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

  if (e.internal) tags.appendChild(el("span", "tag", "Internal - never shown in game"));

  var FLAG_WORDS = {
    debuff: "Debuff", permanent: "Permanent", combatOnly: "Combat only",
    uiVisible: "Shown in the UI",
    removeOnDefeat: "Removed on defeat", removeOnAwaken: "Removed on waking"
  };
  Object.keys(FLAG_WORDS).forEach(function (f) {
    if (e[f]) tags.appendChild(el("span", "tag", FLAG_WORDS[f]));
  });

  if (e.cureType) tags.appendChild(el("span", "tag", "Curable: " + e.cureType));
  if (e.removeType) tags.appendChild(el("span", "tag", e.removeType));
  host.appendChild(tags);

  var tipWrap = el("div");
  var elvl = preferredLevel(LEVEL_CAP);
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

  var doesWrap = e.does ? el("div") : null;
  function drawDoes() {
    if (!doesWrap) return;
    doesWrap.textContent = "";
    var d = doesBlock(e.does, progs, elvl);
    if (d) doesWrap.appendChild(d);
  }
  drawDoes();
  section(host, "What it does", doesWrap);

  var totalDur = (e.pulseCount && e.interval) ? e.interval * e.pulseCount
               : (e.duration !== undefined ? e.duration : null);
  section(host, "At a glance", statRow([
    ["Duration", e.permanent ? "permanent"
                             : (totalDur !== null ? secs(totalDur) : null)],
    ["Pulses", e.pulseCount ? e.pulseCount + " (every " + secs(e.interval) + ")"
                            : null],

    ["Probability", (e.probability !== undefined && e.probability < 0.999)
      ? fmt(e.probability * 100, 1) + "%" : null],

    [e.probability ? "Chance added to by" : "Chance granted by",
     chanceSource(e), "wide"],
    ["Resist", resistNames(e.resistCategory)],

    [(STACKING && stackMax(STACKING[e.equivalence]) > 1)
      ? "Stacks up to " + stackMax(STACKING[e.equivalence]) + ", with"
      : "Does not stack with",
     stackLink(e.equivalence, e.id), "wide"],

    ["Class priority", (e.equivalence && typeof e.classPriority === "number")
      ? e.classPriority : null]
  ]));

  section(host, "Stat modifiers",
          grantsBlock(e.stats, MS, progs, "Level", D, owners, true));

  if (D && MS) section(host, "Modifiers", modsBlock(e, D, MS));

  if (e.cooldownChannels && CHANNELS) {
    var cdAll = [], seenCd = {};
    e.cooldownChannels.forEach(function (ch) {
      (CHANNELS[ch] || []).forEach(function (id) {
        if (!seenCd[id]) { seenCd[id] = 1; cdAll.push(id); }
      });
    });
    cdAll.sort(function (a, b) {
      var x = nameOf(a), y = nameOf(b);
      return (x ? x.n : "").localeCompare(y ? y.n : "");
    });
    if (cdAll.length) {
      var mine = owners.length ? cdAll.filter(function (id) {
        return owners.some(function (c) { return belongsTo(id, c); });
      }) : cdAll;

      var canScope = mine.length > 0 && mine.length < cdAll.length;
      var cdWrap = el("div");
      var cdScoped = true;
      var drawCd = function () {
        cdWrap.textContent = "";
        cdWrap.appendChild(linkList(cdScoped && canScope ? mine : cdAll, "skill"));
        if (!canScope) return;
        var hid = cdAll.length - mine.length;
        var foot = el("div", "muted");
        foot.style.cssText = "font-size:11.5px;margin-top:6px";
        foot.appendChild(document.createTextNode(cdScoped
          ? hid + " more skill" + (hid === 1 ? "" : "s") + " share these "
            + "channels but belong to other classes.  "
          : "Showing every class.  "));
        var a = el("a", null, cdScoped ? "show all" : "show only this class");
        a.href = "#";
        a.onclick = function (ev) {
          ev.preventDefault(); cdScoped = !cdScoped; drawCd(); return false;
        };
        foot.appendChild(a);
        cdWrap.appendChild(foot);
      };
      drawCd();
      section(host, e.cooldownMod
        ? "Reduces the cooldown of these skills by " + secs(e.cooldownMod)
        : "Reduces the cooldown of these skills", cdWrap);
    }
  }

  if (e.nested) {
    section(host, "Applies these effects",
            linkList(e.nested, "effect", traceryLine(ET, gearOk)));
  }

  if (e.preventsEffects) {
    section(host, "Prevents these effects", linkList(e.preventsEffects, "effect"));
  }
  if (e.dispelsEffects) {
    section(host, "Removes these effects", linkList(e.dispelsEffects, "effect"));
  }
  if (e.checksEffects) {
    section(host, "Checks whether these are present",
            linkList(e.checksEffects, "effect"));
  }

  [["preventedBy", "Prevented by these effects"],
   ["removedBy", "Removed by these effects"],
   ["checkedBy", "Checked for by these effects"]].forEach(function (pair) {
    if (e[pair[0]]) section(host, pair[1], linkList(e[pair[0]], "effect"));
  });

  if (e.grantsSkills) {
    section(host, "Grants these skills", linkList(e.grantsSkills, "skill"));
  }
  if (e.grantsTraits && D) {
    section(host, "Grants these traits", traitList(e.grantsTraits, D));
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
      a.href = urlFor("set/" + row[0]);
      body.appendChild(a);
      body.appendChild(el("span", "via", row[1] + " piece" + (row[1] === 1 ? "" : "s")));
      li.appendChild(body);
      sul.appendChild(li);
    });
    section(host, "Granted by these set bonuses", sul);
  }
  if (e.parentEffects) section(host, "Applied by these effects", linkList(e.parentEffects, "effect"));
  section(host, "Granted by these items", itemSources(e));
  section(host, "Switched on by these, through a property", modGrantSources(e));
  section(host, "Effects it adds to other skills", enablesBlock(e));
  section(host, "Left on the ground by these", hotspotSources(e));
  section(host, "Put on you by world state", worldStateSources(e));
  section(host, "Put on you by a class resource", pipStepSources(e));
  if (e.usedBySkills) {
    section(host, "Applied by these skills",
            skillsByClass(e.usedBySkills.filter(function (id) {
              return reachable(id, owners);
            }), D));
  }

  if (e.viaSkills) {
    var via = e.viaSkills.filter(function (id) { return reachable(id, owners); });
    if (via.length) {
      var vbox = el("div");
      vbox.appendChild(el("p", "muted",
        "These cast an effect that applies this one, rather than applying it "
        + "themselves."));
      vbox.appendChild(skillsByClass(via, D));
      if (e.viaSkillsMore) {
        vbox.appendChild(el("p", "muted",
          "and " + e.viaSkillsMore + " more not listed"));
      }
      section(host, "Applied indirectly by these skills", vbox);
    }
  }

  [["requiredBySkills", "Required by these skills"],
   ["barsSkills", "Bars these skills"],
   ["consumedBySkills", "Required and consumed by these skills"]].forEach(function (pair) {
    if (!e[pair[0]]) return;
    section(host, pair[1], linkList(e[pair[0]].filter(function (id) {
      return reachable(id, owners);
    }), "skill"));
  });

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
  a.href = urlFor("" + kind + "/" + id);
  a.title = kind + " " + id;
  if (!meta) pending(a, null, id);
  return a;
}

function traitRef(id) {
  var t = CLASS_DATA && CLASS_DATA.traits && CLASS_DATA.traits[String(id)];
  var meta = t ? null : nameOf(id);
  var a = el("a", null, t ? t.name : (meta ? meta.n : "#" + id));
  a.href = urlFor("trait/" + id);
  a.title = "trait " + id;
  return a;
}

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
  if (n.v) v *= 1 - n.v / 2;
  if (n.neg) v = -v;
  var out = n.pct ? fmt(v * 100, 1).replace(/\.0$/, "") + "%" : fmt(v, 1);
  var span = el("span", "amt", out);
  if (n.p) span.title = "progression " + n.p + " at level " + level;
  return span;
}

function traitLink(t, extra) {
  var li = el("li");
  var img = el("img");
  img.src = iconUrl(t && t.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  li.appendChild(img);
  var a = el("a", null, t ? t.name : "trait");
  a.href = urlFor("trait/" + (t ? t.id : 0));
  li.appendChild(a);
  if (extra) li.appendChild(el("span", "via", extra));
  return li;
}

function classRoutesToTrait(traitId, D) {
  var owners = [];
  if (!D || !D.classes) return owners;
  Object.keys(D.classes).forEach(function (k) {
    var c = D.classes[k];
    var how = null;
    (c.trees || []).forEach(function (tid) {
      var tree = D.trees && D.trees[String(tid)];
      if (!tree) return;
      (tree.cells || []).forEach(function (cell) {
        if (cell.trait === traitId) {
          how = how || (cell.branchName ? "trait tree - " + cell.branchName
                                        : "trait tree");
        }
      });
      (tree.branches || []).forEach(function (br) {
        var where = br.name || br.key;
        if (br.specTrait === traitId) how = "specialization for " + where;
        (br.setBonuses || []).forEach(function (bonus) {
          if (bonus.trait === traitId) {
            how = how || (bonus.points + " points in " + where);
          }
        });
      });
    });

    var viaLevel = (c.traits || []).filter(function (e) {
      return e.id === traitId;
    })[0];
    if (viaLevel) {
      var earned = viaLevel.level !== undefined ? "level " + viaLevel.level
                 : viaLevel.rank !== undefined ? "rank " + viaLevel.rank
                 : "trained";
      how = how ? earned + ", " + how : earned;
    }
    if (how) owners.push([c, how]);
  });
  return owners;
}

function obtainedBlock(s, D) {
  if (!s.obtained || !s.obtained.length) return null;

  var rows = s.obtained.filter(function (o) {
    if (o.how !== "trait" || !o["class"] || !D || !D.classes) return true;
    return classRoutesToTrait(o.trait, D).some(function (pair) {
      return pair[0].id === o["class"];
    });
  });
  if (!rows.length) return null;

  function classFor(o) {
    if (o["class"]) return D.classes[String(o["class"])] || null;
    if (o.how !== "trait") return null;
    var owners = classRoutesToTrait(o.trait, D);
    return owners.length === 1 ? owners[0][0] : null;
  }

  var ul = el("ul", "links");
  rows.forEach(function (o) {
    var cls = classFor(o);
    var li = el("li");
    var img = el("img");
    img.src = iconUrl(cls ? cls.icon : 0);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(img);
    if (cls) {
      var ca = el("a", null, cls.name);
      ca.href = urlFor("class/" + cls.id);
      li.appendChild(ca);
    }

    var lead = cls ? " - " : "";
    if (o.how === "level") {
      li.appendChild(el("span", null, lead + "trained at level " + o.level));
    } else if (o.how === "rank") {
      li.appendChild(el("span", null, o.rank ? lead + "earned at rank " + o.rank
                                             : lead + "available from the start"));

    } else {
      var t = D.traits[String(o.trait)];
      li.appendChild(el("span", null, lead + "from trait "));
      var ta = el("a", null, t ? t.name : "#" + o.trait);
      ta.href = urlFor("trait/" + o.trait);
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

function branchName(key, name) {
  if (name) return name;
  if (!key) return "";
  var parts = String(key).split("_");
  return parts[parts.length - 1];
}

function traitGrid(cells, D) {
  var placed = cells.filter(function (c) { return /^\d+_\d+$/.test(c.cell || ""); });
  if (placed.length !== cells.length || !placed.length) {
    var ul = el("ul", "links");
    cells.forEach(function (cell) {
      ul.appendChild(traitLink(D.traits[String(cell.trait)], "cell " + cell.cell));
    });
    return ul;
  }

  var minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;
  placed.forEach(function (c) {
    var q = c.cell.split("_");
    var r = parseInt(q[0], 10), k = parseInt(q[1], 10);
    minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, k); maxCol = Math.max(maxCol, k);
  });
  var cols = maxCol - minCol + 1;
  var grid = el("div", "ttree");

  grid.style.gridTemplateColumns = "repeat(" + cols + ", var(--tcell))";
  placed.forEach(function (cell) {
    var t = D.traits[String(cell.trait)];
    var pos = cell.cell.split("_");
    var a = el("a", "tcell");
    a.style.gridRow = parseInt(pos[0], 10) - minRow + 1;
    a.style.gridColumn = parseInt(pos[1], 10) - minCol + 1;
    a.href = urlFor("trait/" + (t ? t.id : cell.trait));
    var img = el("img");
    img.src = iconUrl(t ? t.icon : 0);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    a.appendChild(img);
    a.appendChild(el("span", "tn", t ? t.name : "#" + cell.trait));
    var grants = (t && t.skills) ? t.skills.length : 0;
    if (grants) {
      a.appendChild(el("span", "tg",
        grants + " skill" + (grants === 1 ? "" : "s")));
    }
    a.title = (t ? t.name : "") + " - row " + pos[0] + ", column " + pos[1];
    grid.appendChild(a);
  });
  return grid;
}

function cellSort(a, b) {
  function n(c) {
    var m = /^(\d+)_(\d+)$/.exec(c || "");
    return m ? parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) : 1e9;
  }
  return n(a.cell) - n(b.cell);
}

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
  a.href = urlFor("class/" + c.id);
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

  var creep = c.side === "creep";
  var step = creep ? "rank" : "level";
  if (c.skills) {
    var byLevel = {};
    c.skills.forEach(function (e) {
      var at = creep ? (e.rank || 0) : e.level;
      (byLevel[at] = byLevel[at] || []).push(e);
    });
    var t = el("table", "t");

    t.innerHTML = "<tr><th>" + (creep ? "Rank" : "Level") + "</th><th>Skill</th>" +
      (creep ? "" : "<th>Prerequisite</th>") + "</tr>";
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
          a.href = urlFor("skill/" + e.id);
          td1.appendChild(a);
          tr.appendChild(td0); tr.appendChild(td1);
          if (!creep) {
            var pm = e.prerequisite ? nameOf(e.prerequisite) : null;
            tr.appendChild(el("td", "muted", pm ? pm.n : ""));
          }
          t.appendChild(tr);
        });
      });
    section(host, creep ? "Skills earned by rank" : "Skills trained by level", t);
  }

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

      var spec = br.specTrait ? D.traits[String(br.specTrait)] : null;
      var bn = el("div", "bn");
      if (spec) {
        var ba = el("a", null, branchName(br.key, br.name));
        ba.href = urlFor("trait/" + br.specTrait);
        bn.appendChild(ba);
      } else {
        bn.textContent = branchName(br.key, br.name);
      }
      hh.appendChild(bn);
      if (br.desc) {
        var d = el("div", "muted");
        d.appendChild(richText(br.desc));
        hh.appendChild(d);
      }

      if (spec && spec.skills && spec.skills.length) {
        var sl = el("div", "specskills");
        sl.appendChild(el("span", "sk", "Specialising grants:"));
        sl.appendChild(linkRun(spec.skills.map(function (g) {
          return function () {
            var meta = nameOf(g.id);
            var a = el("a", null, meta ? meta.n : "#" + g.id);
            a.href = urlFor("skill/" + g.id);
            return a;
          };
        }), 6, 0));
        hh.appendChild(sl);
      }
      hh.appendChild(traitGrid(cells, D));

      if (br.noSetBonuses) {
        var nb = el("div", "muted");
        nb.style.cssText = "font-size:11.5px;margin-top:6px";
        nb.textContent = "This line cannot be specialized in, so it has no "
          + "set bonuses.";
        hh.appendChild(nb);
      }

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

      if (br.specTrait) {
        addGrant(br.specTrait,
                 "specialising in " + branchName(br.key, br.name));
      }
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
      a.href = urlFor("skill/" + g.skill);
      td0.appendChild(a);
      if (g.rank) td0.appendChild(el("span", "via", "at rank " + g.rank));
      tr.appendChild(td0);
      var td1 = el("td");
      var ta = el("a", null, g.trait.name);
      ta.href = urlFor("trait/" + g.trait.id);
      td1.appendChild(ta);
      tr.appendChild(td1);
      tr.appendChild(el("td", "muted", g.where));
      gt.appendChild(tr);
    });
    section(host, "Skills granted by traits", gt);
  }

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

  var maxRank = traitMaxRank(t, progs);
  var tlvl = preferredLevel(LEVEL_CAP);
  var tipWrap = el("div");
  function drawTraitTip() {
    tipWrap.textContent = "";
    tipWrap.appendChild(traitTooltip(t, progs, D, tlvl, maxRank));
    if (!traitUsesRank(t, progs)) return;

    var ctl = el("div", "tipctl");
    ctl.appendChild(el("span", "muted", "at level "));
    var input = el("input");
    input.type = "number";
    input.min = "1";
    input.max = String(LEVEL_CAP);
    input.value = String(tlvl);
    input.oninput = function () {
      var v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) return;
      tlvl = Math.min(v, LEVEL_CAP);
      drawTraitTip();
      var i = tipWrap.querySelector("input");
      if (i) i.focus();
    };
    ctl.appendChild(input);
    tipWrap.appendChild(ctl);
  }
  drawTraitTip();
  section(host, "Tooltip", tipWrap);

  section(host, "At a glance", statRow([
    ["Tier", t.tier],
    ["Ranks", maxRank > 1 ? maxRank : null],
    ["Minimum level", t.minLevel]
  ]));

  section(host, "What it changes",
          grantsBlock(t.stats, MS, progs, "Rank", D, ownerClasses(t), true));

  if (t.skills) {
    section(host, "Skills granted", linkList(t.skills.map(function (g) {
      return { id: g.id, via: g.rank ? "at rank " + g.rank : "" };
    }), "skill"));
  }

  if (t.effects) {
    section(host, "Effects it applies", linkList(t.effects.map(function (g) {
      return { id: g.id, via: g.rank ? "at rank " + g.rank : "" };
    }), "effect"));
  }

  section(host, "Effects it adds to other skills", enablesBlock(t));

  var owners = classRoutesToTrait(t.id, D);
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
      a.href = urlFor("class/" + pair[0].id);
      li.appendChild(a);
      li.appendChild(el("span", "via", pair[1]));
      ul.appendChild(li);
    });
    section(host, "Available to", ul);
  }
  return host;
}

function linkRun(items, limit, notListed) {
  var frag = document.createDocumentFragment();
  var hidden = [];

  var shown = 0;
  items.forEach(function (make) {
    var node = make();
    if (!node) return;
    var sep = shown ? document.createTextNode(", ") : null;
    if (shown < limit) {
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
    shown++;
  });
  var extra = hidden.length;
  if (extra) {
    var more = el("a", "more");
    more.href = "#";
    more.textContent = "  +" + extra + " more";
    more.onclick = function (ev) {
      ev.preventDefault();
      var open = hidden[0].hidden;
      hidden.forEach(function (h) { h.hidden = !open; });
      more.textContent = open ? "  show fewer" : "  +" + extra + " more";
      return false;
    };
    frag.appendChild(more);
  }
  if (notListed) {
    frag.appendChild(el("span", "via", "  (" + notListed + " not listed)"));
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
      a.href = urlFor("trait/" + id);
      return a;
    });
  });
  (src.traceries || []).forEach(function (id) {
    makers.push(function () {
      var meta = nameOf(id);
      var essence = meta && meta.t === "z";
      var a = el("a", essence ? "ess" : "trc",
                 (meta ? meta.n : "#" + id) + (essence ? " (essence)" : " (tracery)"));
      a.href = urlFor("" + (essence ? "essence" : "tracery") + "/" + id);
      return a;
    });
  });
  (src.effects || []).forEach(function (id) {
    makers.push(function () {
      var meta = nameOf(id);
      var a = el("a", "eff", meta ? meta.n : "#" + id);
      a.href = urlFor("effect/" + id);
      return a;
    });
  });
  (src.sets || []).forEach(function (id) {
    makers.push(function () {
      var st = SETS && SETS[String(id)];
      var a = el("a", "set", (st ? st.name : "#" + id) + " (set)");
      a.href = urlFor("set/" + id);
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

function classNames(ids, D) {
  var named = (ids || []).map(function (c) {
    var cc = D && D.classes ? D.classes[String(c)] : null;
    return cc ? cc.name : null;
  }).filter(Boolean);
  if (!named.length) return null;
  if (named.length === 1) return "a " + named[0];
  if (named.length === 2) return named.join(" or ");
  return named.slice(0, 2).join(", ") + " and " + (named.length - 2) + " more";
}

function grantsBlock(stats, MS, progs, xLabel, D, only, ownScope) {
  if (!stats || !stats.length) return null;
  var wrap = el("div");

  var canScope = !!(ownScope && only && only.length && SRC_CLASS);
  var strict = canScope;
  var host = el("div");
  wrap.appendChild(host);
  function draw() {
  host.textContent = "";
  var hidden = 0;
  var t = el("table", "t");
  t.innerHTML = "<tr><th>Property</th><th>How</th><th>Amount</th><th>What it scales</th></tr>";

  stats.forEach(function (st) {
    var tr = el("tr");

    var td0 = el("td");

    var pmeta = PROPS && PROPS[st.stat];
    if (pmeta && pmeta.n) td0.appendChild(el("div", "plabel", pmeta.n));
    td0.appendChild(propCode(st.stat));
    if (st.description) {
      var dd = el("div", "muted");
      dd.appendChild(richText(st.description));
      td0.appendChild(dd);
    }

    if (st.modifiedBy && st.modifiedBy.length && D) {
      st.modifiedBy.forEach(function (prop) {
        var line = el("div", "muted");
        line.appendChild(document.createTextNode("scaled by "));
        line.appendChild(propCode(prop));
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
    } else if (st.flags && st.flags.length) {

      td2.className = "";
      td2.textContent = st.flags.map(spaceWords).join(", ");
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

    var rc = readersCell(st.stat, MS, D, only, canScope && strict);
    hidden += rc.hiddenReaders || 0;
    tr.appendChild(rc);
    t.appendChild(tr);
  });
  host.appendChild(t);

  if (canScope && (hidden || !strict)) {
    var who = classNames(only, D) || "this class";
    var foot = el("div", "muted");
    foot.style.cssText = "font-size:11.5px;margin-top:6px";
    foot.appendChild(document.createTextNode(strict
      ? "Showing only what " + who + " can reach - " + hidden + " reader" +
        (hidden === 1 ? "" : "s") + " hidden as belonging elsewhere or to "
        + "nothing at all.  "
      : "Showing every reader, whatever class it belongs to.  "));
    var a = el("a", null, strict ? "show all" : "show only this class");
    a.href = "#";
    a.onclick = function (ev) { ev.preventDefault(); strict = !strict; draw(); return false; };
    foot.appendChild(a);
    host.appendChild(foot);
  }
  }
  draw();

  if (progs) {
    stats.forEach(function (st) {
      if (!st.progression) return;
      var pts = curvePoints(progs[String(st.progression)],
                            (xLabel || "Level") === "Level" ? LEVEL_CAP : 0,
                            progs, preferredLevel(LEVEL_CAP));
      if (pts && pts.length) wrap.appendChild(chart(pts, st.stat, xLabel));
    });
  }
  return wrap;
}

function ambiguousNames(ids) {
  var seen = {}, dup = {};
  ids.forEach(function (id) {
    var meta = nameOf(id);
    var n = meta ? meta.n : null;
    if (!n) return;
    if (seen[n]) dup[n] = 1; else seen[n] = 1;
  });
  return dup;
}
function readerLink(id, kind, cls, dup) {
  var meta = nameOf(id);
  var name = meta ? meta.n : "#" + id;
  var a = el("a", cls || null, name);
  a.href = urlFor(kind + "/" + id);
  if (meta && dup && dup[name]) a.appendChild(el("span", "idtag", "#" + id));
  return a;
}

function readersCell(prop, MS, D, only, strict) {
  var td = el("td");
  var src = (MS && MS[prop]) || {};
  var any = false;
  var SHOW = 10;

  var hidden = 0, seen = {};
  function keep(id) {
    if (!strict || ownedBy(id, only)) return true;
    if (!seen[id]) { seen[id] = 1; hidden++; }
    return false;
  }

  var byField = {};
  (src.skills || []).forEach(function (u) {
    if (!keep(u[0])) return;
    var list = byField[u[1]] = byField[u[1]] || [];
    if (list.indexOf(u[0]) === -1) list.push(u[0]);
  });

  var fields = Object.keys(byField).sort();
  fields.forEach(function (field, fi) {
    any = true;
    var ids = byField[field];
    var line = el("div");
    line.appendChild(el("strong", null, field));
    line.appendChild(document.createTextNode(" on "));
    var sdup = ambiguousNames(ids);
    line.appendChild(linkRun(ids.map(function (id) {
      return function () { return readerLink(id, "skill", null, sdup); };
    }), SHOW, fi === fields.length - 1 ? (src.skillsMore || 0) : 0));
    td.appendChild(line);
  });

  [["readEffects", "effect", "Effects"], ["readTraits", "trait", "Traits"]].forEach(function (spec) {
    var rows = (src[spec[0]] || []).filter(function (r) {
      return keep(r[0]);
    });
    if (!rows.length) return;

    var order = [], fieldsById = {};
    rows.forEach(function (r) {
      var k = String(r[0]);
      if (!fieldsById[k]) { fieldsById[k] = []; order.push(r[0]); }
      if (r[1] && fieldsById[k].indexOf(r[1]) === -1) fieldsById[k].push(r[1]);
    });
    any = true;
    var line = el("div");
    line.appendChild(el("strong", null, spec[2]));
    line.appendChild(document.createTextNode(" "));
    var rdup = ambiguousNames(order);
    line.appendChild(linkRun(order.map(function (id) {
      return function () {
        var a = readerLink(id, spec[1], spec[1] === "effect" ? "eff" : null, rdup);
        var f = fieldsById[String(id)];
        if (f.length) a.title = "scales its " + f.join(" and ");
        return a;
      };
    }), SHOW, src[spec[0] + "More"] || 0));
    td.appendChild(line);
  });

  if (!any) {
    td.appendChild(el("span", "muted", hidden
      ? "nothing this class can reach reads it"
      : "nothing in this dataset reads it"));
  }
  td.hiddenReaders = hidden;
  return td;
}

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
      a.href = urlFor("effect/" + eid);
      a.title = "effect " + eid;
      return a;
    };
  }), 4, 0));
  return td;
}

function enablesBlock(rec) {
  var rows = rec.enables || [];
  if (!rows.length) return null;
  var t = el("table", "t");
  t.innerHTML = "<tr><th>Adds</th><th>To these skills</th></tr>";
  rows.forEach(function (r) {
    var tr = el("tr");
    tr.appendChild(effectRunCell(r.effects || []));
    var td = el("td");
    td.appendChild(linkRun((r.skills || []).map(function (id) {
      return function () {
        var meta = nameOf(id);
        if (!meta) return null;
        var a = el("a", null, meta.n);
        a.href = urlFor("skill/" + id);
        return a;
      };
    }), 8, r.more || 0));

    var pn = el("div");
    pn.appendChild(propCode(r.prop));
    td.appendChild(pn);
    tr.appendChild(td);
    t.appendChild(tr);
  });
  return t;
}

var HOOK_SLOTS = ["targetEffects", "positionalEffects", "critEffects",
                  "superCritEffects"];
var CHANCE_SLOTS = ["userEffects", "userEffectsAdditive", "toggleEffects",
                    "toggleUserEffects", "critEffects"];

function ungated(list, covered) {
  if (!covered) return list || [];
  return (list || []).filter(function (r) {
    var e = EFFECT_CACHE[String(r.id)];
    return !e || e.probability !== 0;
  });
}

function chanceBlock(s, D, MS) {
  var refs = [];
  (s.attacks || []).forEach(function (a) {
    HOOK_SLOTS.forEach(function (k) {
      (a[k] || []).forEach(function (e) { refs.push(e); });
    });
  });
  CHANCE_SLOTS
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
    a.href = urlFor("effect/" + e.id);
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

function conditionalGate(r, D, mine) {
  var traits = (r.traits || []).filter(function (id) { return D.traits[String(id)]; });
  return { trait: traits.length > 0, set: (r.sets || []).length > 0 };
}

function conditionalBlock(s, D, want) {
  var all = s.conditionalEffects || [];
  var mine = ownerClasses(s);
  var rows = all.filter(function (r) {
    var g = conditionalGate(r, D, mine);
    return want === "trait" ? g.trait
         : want === "set" ? g.set
         : (!g.trait && !g.set);
  });
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

    var traits = (r.traits || []).filter(function (id) {
      return D.traits[String(id)] && reachable(id, mine);
    });
    if (!traits.length) {

      traits = (r.traits || []).filter(function (id) { return D.traits[String(id)]; });
    }
    if (want === "set" && (r.sets || []).length) {

      td2.appendChild(el("span", "muted", "wearing "));
      td2.appendChild(linkRun(r.sets.map(function (row) {
        return function () {
          var st = SETS && SETS[String(row[0])];
          var a = el("a", null, (st ? st.name : "set " + row[0]) +
                                (row[1] ? " (" + row[1] + ")" : ""));
          a.href = urlFor("set/" + row[0]);
          return a;
        };
      }), 3, 0));
    } else if (traits.length) {
      td2.appendChild(el("span", "muted", "traited "));
      td2.appendChild(linkRun(traits.map(function (id) {
        return function () {
          var a = el("a", null, D.traits[String(id)].name);
          a.href = urlFor("trait/" + id);
          return a;
        };
      }), 3, 0));
    } else {

      var meta = nameOf(r.from);
      var a = el("a", "eff", meta ? meta.n : r.prop);
      a.href = urlFor("effect/" + r.from);
      td2.appendChild(el("span", "muted", "something grants "));
      td2.appendChild(a);
    }
    var pn = el("div");
    pn.appendChild(propCode(r.prop));
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
    td1.lastChild.appendChild(propCode(r.prop));
    tr.appendChild(td1);
    var td2 = el("td");
    td2.appendChild(linkRun((r.traits || []).map(function (id) {
      return function () {
        var tt = D.traits[String(id)];
        if (!tt) return null;
        var a = el("a", null, tt.name);
        a.href = urlFor("trait/" + id);
        return a;
      };
    }), 3, 0));
    tr.appendChild(td2);
    t.appendChild(tr);
  });
  return t;
}

function progAt(progs, id, index, level) {
  var pr = progs && progs[String(id)];
  if (!pr) return null;
  if (pr.type === "nested") {
    var base = pr.minIndex === undefined ? 1 : pr.minIndex;
    var inner = pr.inner || [];
    var pick = Math.max(0, Math.min(inner.length - 1, index - base));
    if (!inner[pick]) return null;
    return progAt(progs, inner[pick],
                  level === undefined ? LEVEL_CAP : level);
  }
  var at = Math.min(index, LEVEL_CAP);
  if (pr.type === "linear") {
    var pts = (pr.points || []).filter(function (q) {
      return typeof q[0] === "number" && typeof q[1] === "number";
    });
    if (!pts.length) return null;
    if (at <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (at <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        var f = (at - a[0]) / ((b[0] - a[0]) || 1);
        return a[1] + (b[1] - a[1]) * f;
      }
    }
    return pts[pts.length - 1][1];
  }
  var vals = pr.values || [];
  var min = pr.minIndex === undefined ? 1 : pr.minIndex;
  var idx = Math.max(0, Math.min(vals.length - 1, at - min));
  return vals.length ? vals[idx] : null;
}

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

function vitalName(type) {
  if (!type) return "";
  var meta = PROPS && PROPS[type + "_MaxLevel"];
  if (meta && meta.n) return meta.n.replace(/^Maximum\s+/i, "");
  return spaceWords(type);
}

var CC_WORDS = {
  Stunned: "Stun",
  ConjunctionStunned: "Stun",
  Stunned_Dread: "Stun",
  Dazed: "Daze",
  Rooted: "Root",
  Feared: "Fear",
  KnockedDown: "Knockdown",
  KnockedOut: "Knockout",
  FullDisable: "Disable",
  Kneeling: "Kneel",
  Immune: "Immunity",
  MonsterInvulnerability: "Invulnerability"
};

var CC_BREAK_DEFAULT = {
  Dazed:  { damage: 1 },
  Feared: { harm: 1, damage: 0.03 }
};

function ccLines(e) {
  var cc = e.cc;
  if (!cc || !(cc.states || []).length) return [];
  var out = [];
  var dur = cc.duration !== undefined ? cc.duration : cc.variableDuration;
  cc.states.forEach(function (st) {
    var word = ENUM_LABELS && ENUM_LABELS.ccStates && ENUM_LABELS.ccStates[st];
    out.push(el("div", "tipstat",
                (dur ? secs(dur) + " " : "") + (word || CC_WORDS[st] || spaceWords(st))));
    if (st === "ConjunctionStunned") {
      out.push(el("div", "tipstat", W("startsFellowshipManoeuvre")));
    }

    var def = CC_BREAK_DEFAULT[st] || {};
    var harm = cc.breakOnSkill !== undefined ? cc.breakOnSkill : def.harm;
    if (harm) {
      out.push(el("div", "tipstat", cc.grace
        ? W("breakHarmAfter", fmt(harm * 100, 0), fmt(cc.grace))
        : W("breakChanceHarm", fmt(harm * 100, 0))));
    }
    var dmg = cc.breakOnDamage !== undefined ? cc.breakOnDamage : def.damage;
    if (dmg) {
      out.push(el("div", "tipstat", cc.grace
        ? W("breakDamageAfter", fmt(dmg * 100, 0), fmt(cc.grace))
        : W("breakChanceDamage", fmt(dmg * 100, 0))));
    }
  });
  return out;
}

var COMBAT_ONLY_GRACE = 9;
function combatOnlyNote() {
  return W("expiresOutOfCombat", COMBAT_ONLY_GRACE);
}

function auraWording(e) {
  var a = e.aura;
  if (!a) return null;
  var bits = [];
  if (a.radius !== undefined) bits.push(fmt(a.radius) + "m radius");
  var who = [];
  if (a.affectsPlayers) who.push("players");
  if (a.affectsCaster) who.push("its carrier");
  if (who.length) bits.push("affects " + who.join(" and "));
  return "Aura" + (bits.length ? " - " + bits.join(", ") : "");
}

function categoryWord(field, value) {
  var w = enumWord(field, value);
  return w === "Magic" ? W("tacticalWord") : w;
}

function resistNames(cats) {
  if (!cats) return null;
  var word = function (c) { return titleCase(categoryWord("resistCategory", c)); };
  return Array.isArray(cats) ? cats.map(word).join(", ") : word(cats);
}

function resistWording(rec, level, withLevel) {
  var cats = rec.resistCategory;
  if (!cats) return null;
  var named = resistNames(cats);

  if (!withLevel) return W("resistance", named);
  var at = rec.resistLevel || (level === undefined ? LEVEL_CAP : level);
  return W("resistanceWith", named, at);
}

function damageLow(it) {
  return it.damage * (1 - (it.damageVariance || 0));
}

function tipLine(host, label, value, cls) {
  if (value === null || value === undefined || value === "") return;
  var d = el("div", "tl" + (cls ? " " + cls : ""));
  if (label) d.appendChild(el("span", "tk", label));
  if (value && value.nodeType) d.appendChild(value);
  else d.appendChild(el("span", "tv", String(value)));
  host.appendChild(d);
}

function pipGlance(s) {
  if (!s.pipType) return s.pipChange;
  var def = PIPS && PIPS[s.pipType];
  if (!def || !def.icons) return s.pipChange;
  var bits = [];
  if (s.pipChange) {
    var side = s.pipChange < 0 ? "min" : "max";
    bits.push(Math.abs(s.pipChange) + " toward " +
              ((def.labels && def.labels[side]) || def.name));
  }
  if (s.pipTowardHome) {
    bits.push(s.pipTowardHome + " toward " +
              ((def.labels && def.labels.home) || def.name));
  }
  return bits.join(", ") || null;
}

function pipLines(host, s) {
  if (!s.pipType) return;
  var def = PIPS && PIPS[s.pipType];

  var pip = (def && def.name) || spaceWords(enumWord("pipType", s.pipType));
  if (def && def.icons) {
    twoEndedPipLines(host, s, def, pip);
    return;
  }
  var chg = s.pipChange, min = s.pipMin;
  pipBaseLines(host, s, chg, min, pip);

  var per = s.togglePipChange;
  if (per && s.togglePipSeconds) {
    tipLine(host, null, W(per < 0 ? "pipDrainEvery" : "pipGainEvery",
                          Math.abs(per), pip, fmt(s.togglePipSeconds)), "pip");
  }
}

function pipBaseLines(host, s, chg, min, pip) {
  if (chg > 0) {

    if (min) {
      tipLine(host, null, W("requiresAtLeast", min, pip), "pip");
    }
    tipLine(host, null, W("addsTo", chg, pip), "pip");
    return;
  }

  if (!chg) {
    if (min && s.togglePipChange) {
      tipLine(host, null, W("requiresAtLeast", min, pip), "pip");
    } else if (min) {
      tipW(host, "cost", "pip", min, pip);
    }
    return;
  }
  var spend = Math.abs(chg);
  if (min && min !== spend) {
    tipLine(host, null, W("requiresAtLeast", min, pip), "pip");
  }
  if (min === spend) tipW(host, "cost", "pip", spend, pip);
  else tipLine(host, null, W("removesFrom", spend, pip), "pip");
}

function twoEndedPipLines(host, s, def, pip) {
  function endName(side) {
    return (def.labels && def.labels[side]) || pip;
  }
  function icon(side) {
    var did = def.icons && def.icons[side];
    if (!did) return null;
    var img = el("img", "pipicon");
    img.src = iconUrl(did);
    img.alt = endName(side);
    img.title = endName(side);
    img.onerror = function () { this.style.visibility = "hidden"; };
    return img;
  }

  function amountLine(label, side, amount) {
    var wrap = el("span", "tv", String(amount));
    var img = icon(side);

    if (img) { img.className += " pipafter"; wrap.appendChild(img); }
    tipLine(host, label, wrap, "pip");
  }

  function sentence(side, words) {
    var wrap = el("span", "tv");
    var img = icon(side);
    if (img) wrap.appendChild(img);
    wrap.appendChild(document.createTextNode(words));
    tipLine(host, null, wrap, "pip");
  }
  function requirement(value, isMin) {
    if (def.home === undefined || def.home === null) {
      sentence(isMin ? "max" : "min",
               W(isMin ? "requiresAtLeast" : "requiresAtMost", value, pip));
      return;
    }
    var d = value - def.home;

    var side = d > 0 ? "max" : d < 0 ? "min" : (isMin ? "max" : "min");
    amountLine(wLead("requiresColon") || "Requires:", side, Math.abs(d));
  }
  var chg = s.pipChange;
  var attunesLabel = wLead("attunes") || "Attunes:";
  if (chg) amountLine(attunesLabel, chg < 0 ? "min" : "max", Math.abs(chg));
  if (s.pipTowardHome) amountLine(attunesLabel, "home", s.pipTowardHome);
  if (s.pipMin !== undefined && s.pipMin !== null) requirement(s.pipMin, true);
  if (s.pipMax !== undefined && s.pipMax !== null) requirement(s.pipMax, false);
}

function tooltipPanel(s, progs, level) {
  var box = el("div", "tip");

  var head = el("div", "tiphead");
  var img = el("img");
  img.src = iconUrl(s.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  head.appendChild(el("div", "tipname", s.name));
  box.appendChild(head);

  var top = el("div", "tipbody");

  var row0 = el("div", "tl tiprow0");

  if (s.immediate) {
    row0.appendChild(el("span", "tv", W("speedImmediate")));
  } else if (s.ignoresResetTime) {
    row0.appendChild(el("span", "tv", W("speedFast")));
  }

  if (s.maxRange !== undefined) {
    row0.appendChild(el("span", "tv tipright", W("range",
      (s.minRange !== undefined ? fmt(s.minRange) + " - " : "") +
      fmt(s.maxRange))));
  }

if (row0.children.length) top.appendChild(row0);

  var qual = null;
  (s.attacks || []).forEach(function (a) {
    if (!qual && a.damageQualifier) qual = a.damageQualifier;
  });

  if (qual) {

    var qw = enumWord("damageQualifier", qual);
    tipLine(top, null, qw === qual
      ? titleCase(qual === "Magic" ? "Tactical" : qual) + " Skill"
      : qw);
  }
  if (s.aeMaxTargets) tipW(top, "maxTargets", null, s.aeMaxTargets);
  if (s.aeSphereRadius !== undefined) {
    tipW(top, "radius", null, fmt(s.aeSphereRadius));
  }

  if (s.aeArcDegrees) tipLine(top, null, W("arc", fmt(s.aeArcDegrees), fmt(s.aeArcRadius)));

  if (s.aeBoxLength && s.aeBoxWidth) {
    tipLine(top, null, W("boxShape", fmt(s.aeBoxLength), fmt(s.aeBoxWidth)));
  }

  if (s.induction) {
    tipW(top, "induction", null, secs(s.induction.duration));
  }

  if (s.channel) {
    tipW(top, "channelDuration", null, secs(s.channel.duration));
  }
  if (s.resistCategory) {
    tipLine(top, null, resistWording(s, level), "tipresist");
  }

  var types = Array.isArray(s.displayType) ? s.displayType
            : (s.displayType ? [s.displayType] : []);
  var shown = types.map(function (t) {
    return (DISPLAY_TYPES && DISPLAY_TYPES[t]) || titleCase(t);
  });
  if (shown.length) tipW(top, "skillType", null, shown.join(", "));
  if (top.children.length) box.appendChild(top);

  if (s.desc) {
    var d = el("div", "tipdesc");
    d.appendChild(richText(s.desc));
    box.appendChild(d);
  }

  var dmg = el("div", "tipbody dmg");
  (s.attacks || []).forEach(function (a) {
    var v = damageExpr(a, progs, level);
    if (v) tipLine(dmg, null, v);
  });
  if (dmg.children.length) box.appendChild(dmg);

  effectBlocks(s, progs, level).forEach(function (blk) { box.appendChild(blk); });

  var pos = [];
  (s.attacks || []).forEach(function (a) {
    (a.positionalEffects || []).forEach(function (e) { pos.push(e); });
  });
  var posBlk = gatedGroup(pos, positionalHeading(s), progs, level);
  if (posBlk) box.appendChild(posBlk);

  var foot = el("div", "tipbody cost");

  function costParts(c) {
    var v = c.points !== undefined ? c.points : progAt(progs, c.progression, level);
    if (v === null || v === undefined) {

      return c.percent === undefined ? null
        : { amount: W("percentOfYour", fmt(c.percent * 100, 3),
                      vitalName(c.type) || "vital"), unit: "" };
    }
    return { amount: num(v), unit: vitalName(c.type) };
  }
  (s.costs || []).forEach(function (c) {
    var t = costParts(c);
    if (t) tipW(foot, "cost", null, t.amount, t.unit);
  });

  (s.toggleCosts || []).forEach(function (c) {
    var t = costParts(c);
    if (t) tipW(foot, "costPerSecond", null, t.amount, t.unit);
  });
  pipLines(foot, s);

  if (s.channel) {
    tipLine(foot, null, W("channelledSkill"), "time");
  } else if ((s.toggleEffects && s.toggleEffects.length) ||
             (s.toggleUserEffects && s.toggleUserEffects.length)) {
    tipLine(foot, null, W("toggleSkill"), "time");
  }
  if (s.gambitAdds) {
    var ga = gambitRow(s.gambitAdds, "Builds");
    if (ga) foot.appendChild(ga);
  }

  if (s.gambit) {
    var gr = gambitRow(s.gambit, "Requires");
    if (gr) foot.appendChild(gr);
  }
  if (s.gambitRemoves) {
    var grm = gambitRow(s.gambitRemoves, "Clears");
    if (grm) foot.appendChild(grm);
  } else if (s.clearsGambits) {
    tipLine(foot, null, W("clearsAllGambits"));
  }

  critGroups(s, progs, level).forEach(function (blk) { foot.appendChild(blk); });
  if (s.cooldown !== undefined) {
    tipW(foot, "cooldown", "time cdgap", secs(s.cooldown));
  }
  if (foot.children.length) box.appendChild(foot);

  return box;
}

function effectTooltip(e, progs, D, level) {
  var box = el("div", "tip" + (e.harmful ? " harm" : ""));

  var head = el("div", "tiphead");
  var img = el("img");
  img.src = iconUrl(e.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  head.appendChild(el("div", "tipname", e.name));
  box.appendChild(head);

  if (e.resistCategory) {
    var rc = el("div", "tipbody");
    var rl = el("div", "tl tipresist");
    rl.textContent = resistWording(e, level, true);
    rc.appendChild(rl);
    box.appendChild(rc);
  }

  var said = {};

  [dispelWording(e, level), e.desc, e.descOverride, e.applied].forEach(function (w) {
    if (!w || said[w]) return;
    said[w] = 1;
    var d = el("div", "tipdesc");
    d.appendChild(richText(w));
    box.appendChild(d);
  });

  var body = el("div", "tipbody");
  var saidSpan = false;
  ccLines(e).forEach(function (n) { body.appendChild(n); });
  var bub = bubbleLine(e, progs, level);
  if (bub) tipLine(body, null, bub);
  reactiveLines(e, progs, level).forEach(function (n) { body.appendChild(n); });
  var v = e.vital;
  if (v) {
    var init = v.initial !== undefined ? v.initial
             : progAt(progs, v.initialProgression, level);
    var per = progAt(progs, v.perPulseProgression, level);
    var vcls = isHeal(e) ? "vital heal" : (e.harmful ? "vital harm" : "vital");
    var one = vitalLine(e, v, init, v.vpsInitial, v.initialVariance,
                        e.pulseCount ? "initial" : "instant");
    if (one) tipLine(body, null, one, vcls);

    var rep = vitalLine(e, v, per, v.vpsPerPulse, v.perPulseVariance, "pulse");
    if (rep) tipLine(body, null, rep, vcls);

    if (rep && e.pulseCount) saidSpan = true;
  }

  (e.stats || []).forEach(function (st) {
    var line = statLine(resolveStat(st, progs, level), "level");
    if (line) body.appendChild(line);
  });
  if (body.children.length) box.appendChild(body);

  overTimeBlocks(e, progs, level, { withInitial: false, duration: false })
    .forEach(function (b) { box.appendChild(b); });

  var auraDrawn = false;
  if (e.aura && e.aura.radius !== undefined && !body.children.length) {
    EFFECT_CACHE[String(e.id)] = e;
    effectBlocks({ userEffects: [{ id: e.id }] }, progs, level)
      .forEach(function (b) { box.appendChild(b); auraDrawn = true; });
  }

  var foot = el("div", "tipbody");

  if (e.permanent) {

    if (e.expiresOutOfCombat) tipLine(foot, null, combatOnlyNote(), "time");
  } else if (saidSpan) {

  } else if (e.pulseCount && e.interval) {
    tipW(foot, "duration", "time", secs(e.interval * e.pulseCount));
  } else if (e.duration !== undefined) {
    tipW(foot, "duration", "time", secs(e.duration));
  }

  if (e.spawnPayload && e.combatOnly && !e.expiresOutOfCombat) {
    tipLine(foot, null, W("expiresOutOfCombatShort"), "time");
  }
  if (foot.children.length) box.appendChild(foot);
  if (!auraDrawn) {
    expireBlocks(e, progs, level).forEach(function (b) { box.appendChild(b); });
  }
  return box;
}

function overTimeTail(e) {
  var iv = e.interval || e.duration;
  if (!iv) return "";

  var every = " every " + Number(iv).toFixed(1) + " seconds";

  if (!e.pulseCount) return every + ".";
  return every + " for " + fmt(iv * e.pulseCount) + " seconds.";
}

function vitalLine(e, v, value, vps, variance, when) {
  var overTime = when === "pulse";
  var tail = "";
  if (!value) return null;
  var harmful = e.harmful;
  var vital = e.vitalType ? enumWord("vitalType", e.vitalType) : "Morale";

  var pulsing = !!e.pulseCount || overTime;
  var signed = !pulsing &&
               (vital !== "Morale" || (!harmful && !v.percent));
  var lead = signed ? (harmful ? "-" : "+")
           : harmful ? (overTime ? "" : "Deals ")
           : (pulsing && vital === "Morale") ? "Heals "
           : "Restores ";
  var unit = harmful ? (overTime ? harmUnit(e, vital) : (vital === "Morale" ? "damage" : vital))
                     : vital;
  var type = e.damageType ? enumWord("damageType", e.damageType) + " " : "";

  var iv = e.interval || e.duration;
  var ivTxt = iv ? Number(iv).toFixed(1) : null;
  var spanTxt = (iv && e.pulseCount) ? fmt(iv * e.pulseCount) : null;
  function frame(amountTxt) {
    var fam = harmful ? (vital === "Morale" ? "damage" : "drain")
            : (pulsing && vital === "Morale") ? "heal" : "restore";

    var args = [amountTxt];
    if (fam === "damage") args.push(e.damageType ? enumWord("damageType", e.damageType) : "");
    else if (fam !== "heal") args.push(vital);
    if (when === "pulse" && ivTxt) {
      return spanTxt
        ? W.apply(null, [fam + "EveryFor"].concat(args, [ivTxt, spanTxt]))
        : W.apply(null, [fam + "Every"].concat(args, [ivTxt]));
    }
    if (when === "initial") return W.apply(null, [fam + "Initial"].concat(args));
    return null;
  }

  var scaled = !!vps;
  var span = el("span", "tv");
  var base = Math.abs(value) * (v.baseMultiplier || 1);

  function amount(n) {
    if (!variance) return numAmt(n);
    return rangeText(n, variance);
  }

  if (v.percent && !scaled) {
    span.appendChild(el("span", null,
      W(harmful ? "subtractsMaxOf" : "restoresMaxOf",
        fmt(base * 100, 3) + "%", vital)));
    return span;
  }

  var amt = !scaled ? amount(base)
          : (variance ? fmt(base * vps * (1 - variance), 2) + " - " : "") +
            fmt(base * vps, 2) + " x V";
  function finish(text) {
    span.appendChild(el("span", null, text));
    return span;
  }

  if (when === "pulse" || when === "initial") {

    if (when === "pulse" && !ivTxt) return null;
    var framed = frame(amt);
    if (framed) return finish(framed);

    var verb = harmful ? (vital === "Morale" ? "" : "Drains ")
             : (pulsing && vital === "Morale") ? "Heals " : "Restores ";
    return finish(verb + amt + " " + (harmful && vital === "Morale"
      ? type + "Damage" : vital) + (when === "pulse"
      ? " every " + ivTxt + " seconds." : " initially."));
  }

  if (signed || !harmful) {
    return finish(W(harmful ? "minusAmount" : "plusAmount", amt, vital));
  }
  var dtype = e.damageType ? enumWord("damageType", e.damageType) : "";
  if (variance && !scaled) {
    return finish(W("damageRange", numAmt(base * (1 - variance)),
                    numAmt(base), dtype));
  }
  return finish(W("damageOne", amt, dtype));
}

function harmUnit(e, vital) {
  return vital === "Morale" ? "Damage" : vital;
}

function bubbleLine(e, progs, level) {
  var b = e.bubble;
  if (!b) return null;
  var amount;
  if (b.percent) {
    amount = fmt(b.percent * 100, 3) + "%";
  } else {
    var v = b.value !== undefined ? b.value : progAt(progs, b.progression, level);
    if (v === null || v === undefined || !v) return null;

    amount = numAmt(v);
  }
  var vital = enumWord("vitalType", b.type || "Health") || "Morale";
  return "Applies a damage preventing bubble granting " + amount +
         " temporary " + vital.toLowerCase() + ".";
}

function reactiveHeader(r) {
  var bits = [];
  (r.qualifiers || []).forEach(function (q) {

    bits.push((enumWord("damageQualifier", q) || titleCase(q))
              .replace(/\s+Skill$/, ""));
  });

  (r.on || []).forEach(function (t) {
    if (t !== "ALL") bits.push(enumWord("damageType", t) || titleCase(t));
  });

  return W("onWhat", (bits.length ? bits.join(", ") : W("any")) +
           (r.skillOnly ? " skill hit" : " " + W("damageWord")) +
           (r.casterOnly ? " from the source of this effect" : ""));
}

function reactiveAmount(leg, progs, level) {
  if (leg.percent) {
    var pv = leg.value !== undefined ? leg.value
           : progAt(progs, leg.progression, level);
    return pv === null || pv === undefined ? null
      : fmt(Math.abs(pv) * 100, 3) + "%";
  }
  var v = leg.value !== undefined ? leg.value
        : progAt(progs, leg.progression, level);
  return v === null || v === undefined ? null : numAmt(Math.abs(v));
}

function reactiveChance(leg) {
  return leg.chance === undefined ? ""
    : fmt(leg.chance * 100, 3) + "% chance to ";
}

function reactiveFires(leg) {
  return !!leg && leg.chance !== 0;
}

function reactiveLines(e, progs, level) {
  var r = e.reactive;
  if (!r) return [];
  var out = [];
  function say(text) { out.push(el("div", "tipstat", text)); }

  function head(text) { out.push(el("div", "tipeffwho react", text)); }
  function payload(leg, label) {
    var ne = EFFECT_CACHE[String(leg.id)];
    if (!ne) return;
    var host = el("div");
    effectBody(host, ne, null, progs, level);
    if (!host.children.length) return;
    tagPayload(host, 0, ne);
    head(reactiveChance(leg) + label);

    while (host.firstChild) out.push(host.removeChild(host.firstChild));
  }

  var amt;
  if (reactiveFires(r.negate)) {
    amt = reactiveAmount(r.negate, progs, level);
    if (amt) say(reactiveChance(r.negate) + W("negateDamage", amt));
  }
  if (reactiveFires(r.reflect)) {
    amt = reactiveAmount(r.reflect, progs, level);
    if (amt) {

      say(reactiveChance(r.reflect) + W("reflectAmount", amt,
          (r.reflect.damageType
            ? (enumWord("damageType", r.reflect.damageType) ||
               titleCase(r.reflect.damageType)) + " "
            : "")));
    }
  }
  if (reactiveFires(r.reflectEffect)) {
    payload(r.reflectEffect, W("reflectEffect"));
  }
  if (reactiveFires(r.selfEffect)) payload(r.selfEffect, W("applyToSelf"));

  if (out.length) out.unshift(el("div", "tipeffwho react", reactiveHeader(r)));
  return out;
}

function chanceSource(e) {
  if (!e.probabilityFrom) return null;
  var box = el("span");
  box.appendChild(propCode(e.probabilityFrom));
  var vals = e.probabilityValues || [];
  if (vals.length) {
    var pct = vals.map(function (v) {
      return fmt(v * 100, 1) + "%";
    });
    var uniq = pct.filter(function (x, i) { return pct.indexOf(x) === i; });

    box.appendChild(el("span", null, "  gives " + uniq.join(" / ")
      + (e.probabilityWhen ? " " + e.probabilityWhen : "")));
  } else {
    box.appendChild(el("span", "muted", "  value not in this dataset"));
  }
  return box;
}

function resolveStat(st, progs, index, level) {
  if (st.value !== undefined || !st.progression) return st;
  var v = progAt(progs, st.progression, index, level);
  if (v === null || v === undefined) return st;
  var copy = {};
  for (var k in st) copy[k] = st[k];
  copy.value = v;
  return copy;
}

function traitIsRanked(t) {
  if (t.maxRank) return true;
  return (t.skills || []).concat(t.effects || [])
    .some(function (g) { return g && g.rank > 1; });
}

function traitMaxRank(t, progs) {

  if (t.maxRank) return t.maxRank;
  var top = 1;
  (t.skills || []).concat(t.effects || []).forEach(function (g) {
    if (g && g.rank) top = Math.max(top, g.rank);
  });
  return top;
}

function classOfNature(nature, D) {
  if (!nature || !D || !D.classes) return null;
  var code = String(nature).replace(/^Class_/, "");
  var keys = Object.keys(D.classes);
  for (var i = 0; i < keys.length; i++) {
    if (D.classes[keys[i]].code === code) return D.classes[keys[i]];
  }
  return null;
}

function traitEffectLines(id, progs, level, depth, seen) {
  var out = [];
  if (depth > 3) return out;
  seen = seen || {};
  if (seen[id]) return out;
  seen[id] = 1;
  var e = EFFECT_CACHE[String(id)];
  if (!e) return out;
  var text = e.descOverride || e.desc;
  if (text) {
    var d = multiLine("tipstat", text);
    if (d) out.push(d);
  }
  (e.stats || []).forEach(function (st) {
    var line = statLine(resolveStat(st, progs, level), "level");
    if (line) out.push(line);
  });
  traitTipNested(e).forEach(function (n) {
    out = out.concat(traitEffectLines(n.id, progs, level, depth + 1, seen));
  });
  return out;
}

function traitTooltip(t, progs, D, level, maxRank) {
  var box = el("div", "tip trait");

  var head = el("div", "tiphead");
  var img = el("img");
  img.src = iconUrl(t.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  head.appendChild(el("div", "tipname", t.name));
  box.appendChild(head);

  var who = classOfNature(t.nature, D);
  var whoLine = el("div", "tipwho");
  whoLine.appendChild(el("span", "tipclass", who ? who.name
    : titleCase(String(t.nature || "").replace("Class_", ""))));
  whoLine.appendChild(el("span", "tiprankmax",
    maxRank > 1 ? "Ranks: " + maxRank : "Single rank"));
  box.appendChild(whoLine);

  var said = {};
  [t.desc, t.tooltip].forEach(function (w) {
    if (!w || said[w]) return;
    said[w] = 1;
    var d = el("div", "tipdesc");
    d.appendChild(richText(w));
    box.appendChild(d);
  });

  var stats = t.stats || [];
  var ranked = traitIsRanked(t);
  var lvl = level === undefined ? LEVEL_CAP : level;
  var top = ranked ? maxRank : 1;

  for (var r = 1; r <= top; r++) {
    var blk = el("div", "tiprank" + (r === 1 ? " first" : ""));

    blk.appendChild(el("div", "rl", "Rank: " + r));
    var any = false;
    stats.forEach(function (st) {

      if (r > 1 && !st.progression) return;

      var line = statLine(resolveStat(st, progs, ranked ? r : lvl, level),
                          ranked ? "rank" : "level");
      if (!line) return;

      line.className = "tipstat";
      blk.appendChild(line);
      any = true;
    });

    (t.effects || []).forEach(function (g) {
      if ((g.rank || 1) !== r) return;
      traitEffectLines(g.id, progs, level, 0, {}).forEach(function (node) {
        blk.appendChild(node);
        any = true;
      });
    });

    var earned = (t.skills || []).filter(function (g) {
      return (g.rank || 1) === r;
    });
    if (earned.length) {
      var box2 = el("div", "tipearned");
      box2.appendChild(el("div", null, "Skills Earned:"));
      earned.forEach(function (g) {
        var meta = nameOf(g.id);
        var row = el("div");
        var a = el("a", null, meta ? meta.n : "#" + g.id);
        a.href = urlFor("skill/" + g.id);
        row.appendChild(a);
        box2.appendChild(row);
      });
      blk.appendChild(box2);
      any = true;
    }
    if (!any) continue;
    box.appendChild(blk);

  }

  var MUST_WORDS = {
    one: ["You must slot this trait:", "You must slot at least one of these traits:"],
    all: ["You must slot this trait:", "You must slot all of these traits:"],
    none: ["You must not have this trait slotted:",
           "You must have none of these traits slotted:"]
  };
  if (t.requires && t.requires.length) {
    var must = el("div", "tipmust");
    t.requires.forEach(function (group) {

      var list = group && group.traits ? group.traits : group;
      var op = (group && group.op) || "one";
      if (!list || !list.length) return;
      var words = MUST_WORDS[op] || MUST_WORDS.one;
      must.appendChild(el("div", "ml", words[list.length > 1 ? 1 : 0]));
      list.forEach(function (g) {
        var row = el("div", "mi");
        var rec = D && D.traits ? D.traits[String(g.id)] : null;
        row.appendChild(document.createTextNode("- "));
        var a = el("a", null, rec ? rec.name : "#" + g.id);
        a.href = urlFor("trait/" + g.id);
        row.appendChild(a);
        if (g.rank) row.appendChild(document.createTextNode(" at rank " + g.rank));
        must.appendChild(row);
      });
    });
    box.appendChild(must);
  }

  return box;
}

function traitUsesRank(t, progs) {

  return (t.stats || []).some(function (st) { return st.progression; }) ||
    (t.skills || []).concat(t.effects || [])
      .some(function (g) { return g && g.rank > 1; });
}

function usesLevel(e) {
  var v = e.vital || {};
  if (v.initialProgression || v.perPulseProgression) return true;
  return (e.stats || []).some(function (st) { return st.progression; });
}

function dispelIsOwn(e) {
  return !!(e.dispelCategories && e.dispelCategories.length &&
            (e.desc || e.descOverride));
}

function dispelWording(e, level) {
  if (!e.dispelCategories || !e.dispelCategories.length) return null;
  if (dispelIsOwn(e)) return e.desc || e.descOverride;
  var n = e.dispelMax || 1;
  var cats = e.dispelCategories.map(function (c) {
    return titleCase(categoryWord("dispelCategories", c));
  }).join(", ");

  var strength = e.dispelStrengthOffset === undefined ? "" :
    W("dispelMaxStrength",
      (level === undefined ? LEVEL_CAP : level) + e.dispelStrengthOffset);
  return W("dispelUpTo", n, cats, strength);
}

function isHeal(e) {
  if (!e || e.harmful) return false;
  if (e.reviveVitals && e.reviveVitals.length) return true;
  return !!(e.vital && (e.vitalType === undefined || e.vitalType === "Health"));
}

function carrierLines(e) {
  if (e.fellowshipRange !== undefined) {
    return { pre: [], header: W("appliedToWithin",
      e.fellowshipWho || W("theFellowship"), fmt(e.fellowshipRange)) };
  }

  if (e.areaRange !== undefined) {

    return { pre: [], header: e.harmful
      ? W("appliedToEnemies", fmt(e.areaRange))
      : W("appliedToFriends", fmt(e.areaRange)) };
  }
  if (e.reviveVitals && e.reviveVitals.length) {
    return {
      pre: e.reviveVitals.map(function (v) {
        return W("reviveWith", fmt(v.percent * 100, 3), vitalName(v.type));
      }),
      header: W("effectsOnRevival")
    };
  }
  return null;
}

function auraHeader(e, hostile) {

  return hostile ? W("auraTargets", fmt(e.aura.radius))
                 : W("auraFellowship", fmt(e.aura.radius));
}

var AOT_INITIAL = "Effect_ApplyOverTime_Initial_Applied_Effect_Array";
var AOT_PULSE = "Effect_ApplyOverTime_Applied_Effect_Array";

function isOverTimeVia(via) {
  var v = via || "";
  return v.indexOf(AOT_INITIAL) !== -1 || v.indexOf(AOT_PULSE) !== -1;
}

function overTimeGroups(e, withInitial) {
  var init = [], pulse = [];
  (e.nested || []).forEach(function (n) {
    var v = n.via || "";

    if (v.indexOf(AOT_INITIAL) !== -1) init.push(n);
    if (v.indexOf(AOT_PULSE) !== -1) pulse.push(n);
  });
  var groups = [];
  if (withInitial && init.length) {
    groups.push({ header: W("onApplication"), nested: init });
  }

  var iv = e.interval || e.duration;
  if (pulse.length && iv) {
    groups.push({ header: W("everySeconds", fmt(iv)), nested: pulse });
  }
  return groups.length ? groups : null;
}

function tagPayload(host, from, ne) {
  if (!ne.harmful) return;
  for (var i = from; i < host.children.length; i++) {
    host.children[i].className += " harm";
  }
}

function payloadBody(host, ne, progs, level, held, noDuration, st, depth) {
  depth = depth || 0;
  var before = host.children.length;
  var carrier = depth < 3 ? carrierLines(ne) : null;
  if (carrier) {
    var inner = el("div");
    (ne.nested || []).forEach(function (n) {
      var pe = EFFECT_CACHE[String(n.id)];
      if (pe) payloadBody(inner, pe, progs, level, held, noDuration, st, depth + 1);
    });
    carrier.pre.forEach(function (t) { host.appendChild(el("div", "tipstat", t)); });
    if (inner.children.length) {

      host.appendChild(el("div", "tipeffwho" + (ne.harmful ? " harm" : ""),
                          carrier.header));
      while (inner.firstChild) host.appendChild(inner.firstChild);
    }
    return host.children.length - before;
  }
  if (st && isHeal(ne)) st.heal = true;
  effectBody(host, ne, null, progs, level, held, noDuration);

  if (host.children.length === before) {
    var base = comboBaseBranch(ne);
    if (base) {
      effectBody(host, base, null, progs, level, held, noDuration);
      if (st && isHeal(base)) st.heal = true;
      ne = base;
    }
  }
  if (host.children.length === before) return 0;
  tagPayload(host, before, ne);
  var p = ne.probability;
  if (p !== undefined && p > 0 && p < 0.999) {
    var first = host.children[before];
    var tgt = first.tagName === "A" && first.firstChild ? first.firstChild : first;
    tgt.insertBefore(document.createTextNode(
      W("chanceToApply", fmt(p * 100, 1)) + " "), tgt.firstChild);
  }
  return host.children.length - before;
}

function groupBlock(e, g, progs, level, withDuration, held) {
  var host = el("div");

  var st = { heal: false };
  g.nested.forEach(function (n) {
    var ne = EFFECT_CACHE[String(n.id)];
    if (ne) payloadBody(host, ne, progs, level, undefined, false, st);
  });
  if (!host.children.length) return null;
  var blk = el("div", "tipeff" + (e.harmful ? " harm" : "") +
                      (st.heal ? " heal" : ""));
  blk.appendChild(el("div", "tipeffwho" + (g.cls ? " " + g.cls : ""), g.header));
  while (host.firstChild) blk.appendChild(host.firstChild);
  if (withDuration && !blk.querySelector(".tipdur")) {
    var dn = durationNode(e, null, held);
    if (dn) blk.appendChild(dn);
  }
  return blk;
}

function overTimeBlocks(e, progs, level, opts) {
  var groups = overTimeGroups(e, opts.withInitial);
  if (!groups) return [];
  var out = [];
  groups.forEach(function (g) {
    var blk = groupBlock(e, g, progs, level, opts.duration, opts.held);
    if (blk) out.push(blk);
  });
  return out;
}

var AURA_VIA = "Effect_Aura_Applied_Effect_Array";
var EXPIRE_VIA = "EffectGenerator_Countdown_ExpireEffectList";

function isExpireVia(via) {
  return (via || "").indexOf(EXPIRE_VIA) !== -1;
}

function isReactiveVia(via) {
  return (via || "").indexOf("Effect_ReactiveVital_AttackerEffect_Effect") !== -1 ||
         (via || "").indexOf("Effect_ReactiveVital_DefenderEffect_Effect") !== -1;
}

function expireBlocks(e, progs, level) {
  var list = (e.nested || []).filter(function (n) { return isExpireVia(n.via); });
  if (!list.length) return [];

  var blk = groupBlock(e, { header: W("onExpiration"), cls: "expiry",
                            nested: list }, progs, level, false);
  return blk ? [blk] : [];
}

var COMBO_BASE_VIA = "Effect_Combo_EffectToAddIfNotPresent";

function comboBaseBranch(e) {
  var br = null;
  (e.nested || []).forEach(function (n) {
    if (n.via === COMBO_BASE_VIA && !br) br = EFFECT_CACHE[String(n.id)];
  });
  return br && br.probability !== 0 ? br : null;
}

function tipEffLink(node, id) {
  var a = el("a", "tipefflink");
  a.href = urlFor("effect/" + id);
  a.appendChild(node);
  return a;
}

function effectSentence(e) {
  return e.desc || e.descOverride || null;
}

function durationNode(e, ref, held) {

  if (e.permanent) {
    return (e.expiresOutOfCombat && !held)
      ? el("div", "tipdur", combatOnlyNote()) : null;
  }
  var dur = (ref && ref.duration !== undefined) ? ref.duration : e.duration;
  if (e.pulseCount && dur) dur = dur * e.pulseCount;
  if (dur !== undefined && dur > 0) {
    return el("div", "tipdur", W("duration", secs(dur)));
  }
  return null;
}

var PIP_SAID = false;

function effectBody(blk, e, ref, progs, level, held, noDuration) {
  if (PIP_SAID && e.kind === "pip") return 0;
  var before = blk.children.length;
  var dispel = dispelWording(e, level);
  if (dispel) {

    var dl = el("a", dispelIsOwn(e)
      ? "dispel tipeffflavour"
      : "tipstat dispel" + (e.harmful ? "" : " heal"), dispel);
    dl.href = urlFor("effect/" + e.id);
    blk.appendChild(dl);
    return blk.children.length - before;
  }
  var lines = ccLines(e);
  var saidSpan = false;

  var pa = e.pipAdjust;
  var pdef = pa && PIPS && PIPS[pa.type];
  if (pa && !(pdef && pdef.icons)) {
    var pname = (pdef && pdef.name) || spaceWords(enumWord("pipType", pa.type));
    lines.push(el("div", "tipstat",
      W(pa.amount < 0 ? "minusAmount" : "plusAmount", Math.abs(pa.amount), pname)));
  }
  var bub = bubbleLine(e, progs, level);
  if (bub) lines.push(el("div", "tipstat", bub));
  reactiveLines(e, progs, level).forEach(function (n) { lines.push(n); });

  var v = e.vital;
  if (v) {
    var init = v.initial !== undefined ? v.initial
             : progAt(progs, v.initialProgression, level);

    var one = vitalLine(e, v, init, v.vpsInitial, v.initialVariance,
                        e.pulseCount ? "initial" : "instant");
    if (one) { var vl = el("div", "tipstat"); vl.appendChild(one); lines.push(vl); }
    var rep = vitalLine(e, v, progAt(progs, v.perPulseProgression, level),
                        v.vpsPerPulse, v.perPulseVariance, "pulse");
    if (rep) { var vr = el("div", "tipstat"); vr.appendChild(rep); lines.push(vr); }

    if (rep && e.pulseCount) saidSpan = true;
  }
  (e.stats || []).forEach(function (st) {
    var line = statLine(resolveStat(st, progs, level), "level");
    if (line) lines.push(line);
  });

  if (!lines.length) {
    var text = effectSentence(e);
    if (text) {

      var d = multiLine("tipeffflavour", text);
      if (d) lines.push(d);
    }
  }

  if (!lines.length) return 0;
  var dn = (saidSpan || noDuration) ? null : durationNode(e, ref, held);
  if (dn) lines.push(dn);

  lines.forEach(function (n) {
    blk.appendChild(n.tagName === "A" ? n : tipEffLink(n, e.id));
  });
  return blk.children.length - before;
}

function gatedGroup(refs, heading, progs, level) {
  if (!refs || !refs.length) return null;
  var inner = effectBlocks({ userEffects: refs }, progs, level);
  if (!inner.length) return null;
  var wrap = el("div", "tipeff gated");
  wrap.appendChild(el("div", "tipeffwho", heading));
  inner.forEach(function (b) { wrap.appendChild(b); });
  return wrap;
}

function positionalHeading(s) {
  var h = s.positionalHeading || 0;
  return (h > 135 && h < 225) ? W("whenBehind") : W("whenInPosition");
}

function critGroups(s, progs, level) {
  var crit = [], sup = [], both = [], seen = {};
  (s.attacks || []).forEach(function (a) {
    (a.critEffects || []).forEach(function (e) { seen[e.id] = 1; });
  });
  (s.attacks || []).forEach(function (a) {
    (a.superCritEffects || []).forEach(function (e) {
      (seen[e.id] ? both : sup).push(e);
    });
  });
  var inBoth = {};
  both.forEach(function (e) { inBoth[e.id] = 1; });
  (s.attacks || []).forEach(function (a) {
    (a.critEffects || []).forEach(function (e) {
      if (!inBoth[e.id]) crit.push(e);
    });
  });
  return [gatedGroup(both, W("applyOnCritOrDev"), progs, level),
          gatedGroup(crit, W("applyOnCrit"), progs, level),
          gatedGroup(sup, W("applyOnDevCrit"), progs, level)]
    .filter(Boolean);
}

function effectBlocks(s, progs, level) {
  var out = [];
  var refs = [];
  (s.attacks || []).forEach(function (a) {
    (a.targetEffects || []).forEach(function (e) { refs.push(e); });
  });
  (s.userEffects || []).forEach(function (e) { refs.push(e); });
  (s.toggleEffects || []).forEach(function (e) { refs.push(e); });
  (s.toggleUserEffects || []).forEach(function (e) { refs.push(e); });

  var byId = {};
  refs = refs.filter(function (ref) {
    if (byId[ref.id]) return false;
    byId[ref.id] = 1;
    return true;
  });

  function blocksFor(e, ref, depth) {
    var made = mainBlocks(e, ref, depth);

    expireBlocks(e, progs, level).forEach(function (b) { made.push(b); });
    return made;
  }

  function mainBlocks(e, ref, depth) {
    var made = [];

    var cls = "tipeff" + (e.harmful ? " harm" : "") + (isHeal(e) ? " heal" : "");

    var timed = overTimeBlocks(e, progs, level,
                               { withInitial: true, duration: true,
                                 held: held });
    if (timed.length) {

      var own = el("div", cls);
      if (effectBody(own, e, ref, progs, level, held)) made.push(own);
      timed.forEach(function (b) { made.push(b); });
      return made;
    }
    var blk = el("div", cls);

    var spawnRefs = (e.nested || []).filter(function (n) { return n.spawn; });
    if (spawnRefs.length) {
      var sh = el("div");
      var span = 0, combatOnly = false;
      spawnRefs.forEach(function (n) {
        var ne = EFFECT_CACHE[String(n.id)];
        if (!ne) return;
        var before = sh.children.length;
        effectBody(sh, ne, null, progs, level, held, true);
        tagPayload(sh, before, ne);

        (overTimeGroups(ne, true) || []).forEach(function (g) {
          var gh = el("div");
          g.nested.forEach(function (gn) {
            var ge = EFFECT_CACHE[String(gn.id)];
            if (ge) payloadBody(gh, ge, progs, level, held, true);
          });
          if (!gh.children.length) return;
          sh.appendChild(el("div", "tipeffwho", g.header));
          while (gh.firstChild) sh.appendChild(gh.firstChild);
        });
        if (sh.children.length === before) return;
        if (ne.combatOnly) combatOnly = true;
        if (!ne.permanent) {
          var d = ne.pulseCount && ne.duration ? ne.duration * ne.pulseCount
                                               : (ne.duration || 0);
          if (d > span) span = d;
        }
      });
      if (sh.children.length) {

        var life = e.summonPermanent ? 0 : (e.summonDuration || span);
        if (life) blk.appendChild(el("div", "tipdur", W("duration", secs(life))));
        while (sh.firstChild) blk.appendChild(sh.firstChild);
        if (combatOnly && !held) {
          blk.appendChild(el("div", "tipdur", W("expiresOutOfCombatShort")));
        }
        made.push(blk);
        return made;
      }
    }

    var carrier = carrierLines(e);
    if (carrier) {
      carrier.pre.forEach(function (t) {
        blk.appendChild(el("div", "tipstat", t));
      });

      var host = el("div");

      var cst = { heal: false };
      (e.nested || []).forEach(function (n) {
        var ne = EFFECT_CACHE[String(n.id)];
        if (ne) payloadBody(host, ne, progs, level, undefined, false, cst, 1);
      });
      if (cst.heal) blk.className += " heal";
      if (host.children.length) {
        blk.appendChild(el("div", "tipeffwho", carrier.header));
        while (host.firstChild) blk.appendChild(host.firstChild);
      }
      if (blk.children.length) made.push(blk);
      return made;
    }
    if (effectBody(blk, e, ref, progs, level, held)) {
      made.push(blk);
      return made;
    }

    if (e.aura && e.aura.radius !== undefined && depth < 2) {
      var inner = [];
      (e.nested || []).forEach(function (n) {
        var ne = EFFECT_CACHE[String(n.id)];
        if (!ne) return;
        blocksFor(ne, null, depth + 1).forEach(function (b) { inner.push(b); });
      });
      if (!inner.length) return made;
      var hostile = inner.some(function (b) {
        return (" " + b.className + " ").indexOf(" harm ") !== -1;
      });
      inner.forEach(function (b) { b.className += " inaura"; });
      inner[0].insertBefore(el("div", "tipeffwho aura", auraHeader(e, hostile)),
                            inner[0].firstChild);
      return inner;
    }

    var base = depth < 2 ? comboBaseBranch(e) : null;
    return base ? blocksFor(base, null, depth + 1) : made;
  }

  var onUse = {};
  (s.toggleUserEffects || []).forEach(function (e) { onUse[e.id] = 1; });

  var held = !!(s.channel ||
                (s.toggleEffects && s.toggleEffects.length) ||
                (s.toggleUserEffects && s.toggleUserEffects.length));
  PIP_SAID = s.pipChange !== undefined && s.pipChange !== null;

  refs.forEach(function (ref) {
    var e = EFFECT_CACHE[String(ref.id)];
    if (!e) return;

    if (e.probability === 0) return;
    var made = blocksFor(e, ref, 0);
    if (made.length && onUse[ref.id]) {

      made.forEach(function (b) { b.className += " onuse"; });
      made[0].insertBefore(el("div", "tipeffwho onusehead", W("onUse")),
                           made[0].firstChild);
    }
    made.forEach(function (b) { out.push(b); });
  });
  PIP_SAID = false;
  return out;
}

function statAmount(st, meta, signed) {
  var v = st.value;
  var pct = meta && meta.p;
  var n, suffix = "";
  if (st.op === "Multiply") {
    if (pct) { n = (v - 1) * 100; suffix = "%"; }

    else { return "x" + fmt(v, 3); }
  } else if (pct) {
    n = v * 100; suffix = "%";
  } else {
    n = v;
  }
  if (st.op === "Subtract") n = -Math.abs(n);
  var shown = signed ? n : Math.abs(n);

  var out = fmt(shown, 1).replace(/\.0$/, "");

  if (GROUPED_STATS[st.stat]) {
    out = out.replace(/^(-?)(\d+)/, function (_, sign, digits) {
      return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    });
  }
  if (signed && shown > 0) out = "+" + out;
  return out + suffix;
}

function expandSelector(d) {
  if (d.indexOf("#") === -1) return d;
  d = d.replace(/#\d+:\s*\*\s*:\s*/g, "");
  d = d.replace(/#\d+:\{([^}]*)\}/g, function (_, body) {
    var opts = body.split("|").map(function (o) { return o.trim(); })
      .filter(function (o) { return o && o !== "None"; });
    if (!opts.length) return "";
    return "\\n" + opts.map(function (o) { return "\u2022 " + o; }).join("\\n");
  });
  return d.replace(/[ \t]{2,}/g, " ").trim();
}

var COUNT_UNIT = /\*\s*(?:times|stacks|seconds|secs)\b/i;

function statWording(st, meta) {
  var d = st.description;
  if (!d) return null;
  d = expandSelector(d);
  if (d.indexOf("*") === -1) return d;
  if (meta && meta.p && COUNT_UNIT.test(d)) meta = { c: meta.c, n: meta.n };

  if (typeof st.value !== "number") return null;

  var tailName = "";
  if (d.split("*").length > 2 && /\*[^A-Za-z0-9*]*$/.test(d)) {
    d = d.replace(/\*[^A-Za-z0-9*]*$/, "");
    tailName = " " + ((meta && meta.n) || st.stat || "");
  }
  d = d.replace(/([-+x])[ \t]*\*/g, function (_, sign) {

    if ((sign === "-" || sign === "+") && st.op === "Multiply" &&
        typeof st.value === "number" && !(meta && meta.p)) {
      return sign + fmt(Math.abs((st.value - 1) * 100), 3) + "%";
    }
    var amt = statAmount(st, meta, false);

    if (sign === "x" && amt.charAt(0) === "x") return amt;
    return sign + amt;
  });
  d = d.replace(/\*/g, statAmount(st, meta, true));
  return (d + tailName).replace(/[ \t]{2,}/g, " ").trim();
}

function statLine(st, xLabel) {

  if (st.silent) return null;
  var meta = PROPS && PROPS[st.stat];
  var name = meta ? meta.n : st.stat;
  var v = st.value;
  var said = statWording(st, meta);
  if (v === undefined || v === null || typeof v !== "number") {
    if (said) return multiLine("tipstat", said);

    if (xLabel === "level") return null;
    if (st.flags && st.flags.length) {
      return el("div", "tipstat",
                name + ": " + st.flags.map(spaceWords).join(", "));
    }
    if (v === undefined || v === null) {
      if (!st.progression) return null;
      return el("div", "tipstat",
                "Scales with " + (xLabel || "level") + ": " + name);
    }
    return null;
  }

  if (v === 0) {

    return said ? multiLine("tipstat", said) : null;
  }

  if (st.op === "Multiply" && v === 1 && !said) return null;
  if (said) return multiLine("tipstat", said);
  var amt = statAmount(st, meta, true);
  var key = amt.charAt(0) === "x" ? "timesAmount"
          : amt.charAt(0) === "-" ? "minusAmount" : "plusAmount";
  return el("div", "tipstat", W(key, amt.replace(/^[x+-]/, ""), name));
}

function multiLine(cls, str) {

  var text = String(str)
    .replace(/(?:\\n|\n)[ \t]*(?:(?:\\n|\n)[ \t]*)*/g, "\\n")
    .replace(/^(?:\\n)+/, "")
    .replace(/(?:\\n)+$/, "")
    .trim();
  if (!text) return null;
  var host = el("div", cls);
  host.appendChild(richText(text));
  return host.childNodes.length ? host : null;
}

function hasDamageAdd(a) {
  return !!(a.damageContribution && a.dpsAddProgression);
}

function damageExpr(a, progs, level) {
  var parts = [];
  var mod = a.damageModifier === undefined ? 1 : a.damageModifier;
  if (a.implementContribution) parts.push(fmt(a.implementContribution) + " x W");
  if (hasDamageAdd(a)) parts.push(fmt(a.damageContribution) + " x A");
  var cap = a.damageMax !== undefined ? a.damageMax
          : (a.damageMaxProgression ? progAt(progs, a.damageMaxProgression, level) : null);

  if (!parts.length) {
    if (!cap) return null;
    var flat = cap * mod;

    if (flat < 1) return null;
    return flatDamage(a, flat);
  }
  var expr = parts.join(" + ");
  if (mod !== 1) expr = fmt(mod) + " x (" + expr + ")";

  var W = parseFloat(PREFS.wdps), A = parseFloat(PREFS.dmgAdd);
  var M = parseFloat(PREFS.mastery);
  var resolved = null;

  if (!isNaN(W) || !isNaN(A)) {
    resolved = ((a.implementContribution || 0) * (isNaN(W) ? 0 : W) +
                (hasDamageAdd(a) ? a.damageContribution : 0)
                  * (isNaN(A) ? 0 : A)) * mod;

    if (cap && resolved > cap) resolved = cap;
    if (!isNaN(M) && M > 0) resolved *= 1 + M / 100;
  }
  var span = el("span", "tv");
  span.appendChild(el("code", "dmg", expr));
  if (resolved !== null) {
    span.appendChild(el("span", "resolved", "  =  " + num(resolved)));
  }
  var lead = [enumWord("damageType", a.damageType) || null,
              hand(a) ? "(" + hand(a) + ")" : null]
    .filter(Boolean).join(" ");
  span.appendChild(el("span", null, "  " + (lead ? lead + " " : "") + "Damage"));
  var tail = [];
  if (cap) tail.push("max " + num(cap));
  if (tail.length) span.appendChild(el("span", "muted", "  " + tail.join(", ")));
  return span;
}

function flatDamage(a, value) {

  var span = el("span", "tv");
  var lead = [enumWord("damageType", a.damageType) || null,
              hand(a) ? "(" + hand(a) + ")" : null]
    .filter(Boolean).join(" ");
  var v = a.damageMaxVariance;
  span.appendChild(el("span", null, v
    ? W("damageRange", numAmt(value * (1 - v)), numAmt(value), lead)
    : W("damageOne", numAmt(value), lead)));
  return span;
}

function rangeText(n, variance) {
  return numAmt(n * (1 - variance)) + " - " + numAmt(n);
}

function hand(a) {
  return a.usesPrimary ? W("mainHand") : a.usesSecondary ? W("offHand")
       : a.usesRanged ? W("rangedHand") : a.usesTactical ? W("tacticalWord")
       : null;
}

function damageNote(s) {
  var n = el("div", "muted tipnote");
  var anyAdd = (s.attacks || []).some(hasDamageAdd);
  n.innerHTML =
    "<strong>W</strong> is your weapon's damage - one roll between its low and "
    + "high figures, which is where the spread in the game's own damage line "
    + "comes from"
    + (anyAdd ? ", and <strong>A</strong> is the extra damage this attack adds "
              + "over its action duration" : "")
    + ". Mastery is applied when you set it in the sidebar; your damage "
    + "modifiers and your melee, ranged or tactical damage are not.";
  return n;
}

function modsBlock(s, D, MS) {
  var groups = [];
  (s.mods || []).forEach(function (g) { groups.push([g, null]); });
  (s.attacks || []).forEach(function (a, i) {
    (a.mods || []).forEach(function (g) { groups.push([g, "attack " + (i + 1)]); });
  });
  if (!groups.length) return null;

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
        td1.appendChild(propCode(prop));
        tr.appendChild(td1);
        tr.appendChild(cells[i]);
        t.appendChild(tr);
      });
    });

    wrap.textContent = "";

    var anyRows = t.rows.length > 1;
    if (anyRows) {
      wrap.appendChild(t);
      var note = el("div", "muted");
      note.style.cssText = "font-size:11.5px;margin-top:8px";
      note.appendChild(document.createTextNode(
        "A value listed here is not always active - it applies only while "
        + "something grants the property beside it."));
      wrap.appendChild(note);
    } else {
      var none = el("div", "muted");
      none.style.cssText = "font-size:12px";
      none.textContent = "Nothing here is granted by anything this class can "
        + "reach.";
      wrap.appendChild(none);
    }

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

  if (t.slot) tags.appendChild(el("span", "tag slot", t.slot));
  var cls = t["class"] ? D.classes[String(t["class"])] : null;
  tags.appendChild(el("span", "tag", cls ? cls.name + " only" : "Any class"));
  host.appendChild(tags);

  if (t.desc) host.appendChild(richPara("desc", t.desc));

  var tbl = el("table", "t");
  tbl.innerHTML = "<tr><th>Rarity</th><th>Gives</th><th>Available at</th></tr>";
  (t.rarities || []).forEach(function (r) {
    var tr = el("tr");
    tr.appendChild(el("td", "rar-" + String(r.quality).toLowerCase(),
                      enumWord("quality", r.quality)));

    var td1 = el("td");
    (r.stats || []).forEach(function (st) {
      var line = el("div");
      line.appendChild(propCode(st.stat));
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

  var allStats = [];
  var seenStat = {};
  (t.rarities || []).forEach(function (r) {
    (r.stats || []).forEach(function (st) {
      if (!seenStat[st.stat]) { seenStat[st.stat] = 1; allStats.push(st); }
    });
  });

  section(host, "What those properties affect",
          grantsBlock(allStats, MS, progs, "Item level", D, freepClasses(D)));

  if (cls) {
    var ul = el("ul", "links");
    var li = el("li");
    var ci = el("img");
    ci.src = iconUrl(cls.icon);
    ci.alt = "";
    ci.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(ci);
    var a = el("a", null, cls.name);
    a.href = urlFor("class/" + cls.id);
    li.appendChild(a);
    ul.appendChild(li);
    section(host, "Usable by", ul);
  }
  return host;
}

function classByCode(code, D) {
  if (!D || !D.classes) return null;
  var keys = Object.keys(D.classes);
  for (var i = 0; i < keys.length; i++) {
    if (D.classes[keys[i]].code === code) return D.classes[keys[i]];
  }
  return null;
}

function classRun(codes, D) {
  var run = el("span");
  (codes || []).forEach(function (code, i) {
    if (i) run.appendChild(document.createTextNode(", "));
    var c = classByCode(code, D);
    if (!c) { run.appendChild(document.createTextNode(spaceWords(code))); return; }
    var a = el("a", null, c.name);
    a.href = urlFor("class/" + c.id);
    run.appendChild(a);
  });
  return run.childNodes.length ? run : null;
}

function itemProgAt(progs, id, index) {
  var pr = progs && progs[String(id)];
  if (!pr) return null;
  if (pr.type === "linear") {
    var pts = (pr.points || []).filter(function (q) {
      return typeof q[0] === "number" && typeof q[1] === "number";
    });
    if (!pts.length) return null;
    if (index <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (index <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * ((index - a[0]) / ((b[0] - a[0]) || 1));
      }
    }
    return pts[pts.length - 1][1];
  }
  if (pr.type === "nested") return progAt(progs, id, index);
  var vals = pr.values || [];
  var min = pr.minIndex === undefined ? 1 : pr.minIndex;
  return vals.length ? vals[Math.max(0, Math.min(vals.length - 1, index - min))] : null;
}

var GROUPED_STATS = {
  Stat_Might: 1, Stat_Agility: 1, Stat_Will: 1, Stat_Fate: 1, Stat_Vitality: 1
};

function itemStatLines(it, progs) {
  var ilvl = it.itemLevel || 1;
  var out = [];
  (it.stats || []).forEach(function (st) {
    if (st.minLevel !== undefined && ilvl < st.minLevel) return;
    if (st.maxLevel !== undefined && ilvl > st.maxLevel) return;
    var r = st;
    if (st.value === undefined && st.progression) {
      var v = itemProgAt(progs, st.progression, ilvl);
      if (v === null || v === undefined) return;
      var meta = PROPS && PROPS[st.stat];
      r = {};
      for (var k in st) r[k] = st[k];
      r.value = (meta && meta.p) ? v : Math.round(v);
    }
    var line = statLine(r, "level");
    if (line) out.push(line);
  });
  return out;
}

var ITEM_SLOT_WORDS = {
  LightArmor: "Light Armour", MediumArmor: "Medium Armour",
  HeavyArmor: "Heavy Armour", HeavyShield: "Heavy Shield",
  MediumShield: "Warden's Shield", CraftTool: "Crafting Tool",
  BattleGauntlets: "Battle-gauntlets"
};
var ITEM_BODY_SLOTS = { Head: "Head", Shoulders: "Shoulders", Chest: "Chest",
  Hands: "Hands", Legs: "Legs", Feet: "Feet", Back: "Back" };

function itemSlotWord(slot) {
  if (ITEM_SLOT_WORDS[slot]) return ITEM_SLOT_WORDS[slot];
  var m = /^([12])H(.*)$/.exec(slot);
  if (m) return (m[1] === "1" ? "One-handed " : "Two-handed ") + spaceWords(m[2]);
  return spaceWords(slot);
}

function uiImg(did, alt, cls) {
  var i = el("img", cls || null);
  i.src = iconUrl(did);
  i.alt = alt || "";
  if (alt) i.title = alt;
  i.onerror = function () { this.style.visibility = "hidden"; };
  return i;
}

function socketIcon(token) {
  var spec = UICONS && UICONS.sockets && UICONS.sockets[token];
  if (!spec || !(spec.background || spec.overlay)) return null;
  var box = el("span", "socketicon");
  if (spec.background) box.appendChild(uiImg(spec.background, ""));
  if (spec.overlay) box.appendChild(uiImg(spec.overlay, "", "overlay"));
  return box;
}

var COIN_ORDER = ["gold", "silver", "copper"];

function iconStack(dids, lazy) {
  var box = el("span", "iconstack");
  var drawn = {};
  dids.forEach(function (did) {
    if (!did || drawn[did]) return;
    drawn[did] = 1;
    var img = uiImg(did, "");
    if (lazy) img.loading = "lazy";
    box.appendChild(img);
  });
  return box.firstChild ? box : null;
}

function itemIcon(it) {
  var L = it.iconLayers || {};
  return iconStack([L.background, L.underlay, L.shadow, it.icon, L.overlay]);
}

function itemWorth(copper) {
  var coins = (UICONS && UICONS.coins) || null;
  var left = copper, out = el("span", "worthrun"), any = false;
  COIN_ORDER.forEach(function (name) {
    var spec = coins && coins[name];
    var per = spec && spec.value ? spec.value
            : (name === "gold" ? 100000 : name === "silver" ? 100 : 1);
    var n = name === "copper" ? left : Math.floor(left / per);
    left -= n * per;

    if (!n && !(name === "copper" && !any)) return;
    any = true;
    var bit = el("span", "coin");
    bit.appendChild(document.createTextNode(num(n)));
    if (spec && spec.icon) bit.appendChild(uiImg(spec.icon, spec.name || name));
    else bit.appendChild(document.createTextNode(" " + name));
    out.appendChild(bit);
  });
  return out;
}

function preloadItemTip(it) {
  var ids = [].concat(it.onUse || [], it.whileEquipped || []);

  var st = it.set && SETS && SETS[String(it.set)];
  if (st) {
    (st.bonuses || []).forEach(function (b) {
      (b.effects || []).forEach(function (id) { ids.push(id); });
    });
  }
  return preloadTipEffects({ userEffects: ids.map(function (id) { return { id: id }; }) });
}

function setBlock(it, progs) {
  var st = it.set && SETS && SETS[String(it.set)];
  if (!st) return null;
  var box = el("div", "tipbody tipset");

  var head = el("div", "tipsetname");
  head.appendChild(document.createTextNode(st.name || ("set " + it.set)));
  if (st.maxLevel) head.appendChild(el("span", "tipsetcap", "(Max Level: " + st.maxLevel + ")"));
  box.appendChild(head);

  (st.members || []).forEach(function (mid, i) {
    var nm = (st.memberNames || [])[i];
    box.appendChild(el("div", "tipsetpiece" + (mid === it.id ? " own" : ""),
                       nm || ("item " + mid)));
  });

  var lvl = st.level || it.itemLevel || 1;
  (st.bonuses || []).forEach(function (b) {
    if (b.pieces === undefined) return;
    var lines = itemStatLines({ itemLevel: lvl, stats: b.stats }, progs);
    var blocks = (b.effects || []).length
      ? effectBlocks({ userEffects: b.effects.map(function (id) { return { id: id }; }) },
                     progs, lvl)
      : [];
    if (!lines.length && !blocks.length) return;
    box.appendChild(el("div", "tipeffwho tipsetcount",
                       W("setItemsEquipped", b.pieces)));
    lines.forEach(function (n) { n.className = "tipstat setstat"; box.appendChild(n); });
    blocks.forEach(function (n) { box.appendChild(n); });
  });
  return box;
}

function itemTooltip(it, progs, D) {
  var box = el("div", "tip item");
  var head = el("div", "tiphead");
  head.appendChild(itemIcon(it) || el("span", "iconstack"));
  var q = String(it.quality || "Common").toLowerCase();
  head.appendChild(el("div", "tipname rar-" + q, it.name));
  box.appendChild(head);

  var top = el("div", "tipbody");
  if (it.bind) {
    var onEquip = it.bind === "on equip";
    tipLine(top, null, W(it.bindAccount ? (onEquip ? "bindAccountEquip" : "bindAccountAcquire")
                                        : (onEquip ? "bindOnEquip" : "bindOnAcquire")));
  } else if (it.bindAccount) {
    tipLine(top, null, W("bindAccountAcquire"));
  }
  if (it.unique) tipLine(top, null, W("unique"));
  if (it.itemLevel) tipW(top, "itemLevel", null, it.itemLevel);

  var slot = (it.slots || [])[0];
  if (slot && slot !== "Class") {
    var row0 = el("div", "tl tiprow0");
    row0.appendChild(el("span", "tv", itemSlotWord(slot)));
    if (ITEM_BODY_SLOTS[it.category]) {
      row0.appendChild(el("span", "tv tipright", ITEM_BODY_SLOTS[it.category]));
    }
    top.appendChild(row0);
  }

  if (it.armour) tipLine(top, null, W("armourAmount", numAmt(it.armour)), "iarmour");

  if (it.damage) {
    var dtype = it.damageType ? spaceWords(enumWord("damageType", it.damageType)) : "";
    tipLine(top, null, it.damageVariance
      ? W("damageRange", numAmt(damageLow(it)), numAmt(it.damage), dtype)
      : W("damageOne", numAmt(it.damage), dtype));
  }
  if (it.dps) tipLine(top, null, W("dpsLine", fmt(it.dps, 1)), "idps");
  if (it.consumed) tipLine(top, null, W("consumedOnUse"), "idim");
  if (top.children.length) box.appendChild(top);

  var stats = itemStatLines(it, progs);
  if (stats.length) {
    var sb = el("div", "tipbody istats");
    stats.forEach(function (n) { sb.appendChild(n); });
    box.appendChild(sb);
  }

  if (it.sockets && it.sockets.length) {
    var so = el("div", "tipbody");
    it.sockets.forEach(function (label, i) {
      var ico = socketIcon((it.socketTypes || [])[i]);
      if (!ico) { tipLine(so, null, label, "isocket"); return; }
      var row = el("div", "tl isocket");
      row.appendChild(ico);
      row.appendChild(el("span", "tv", label));
      so.appendChild(row);
    });
    box.appendChild(so);
  }

  var level = preferredLevel(LEVEL_CAP);
  [["whileEquipped", "onEquip"], ["onUse", "onUse"]].forEach(function (pair) {
    var ids = it[pair[0]];
    if (!ids || !ids.length) return;
    var blk = el("div", "tipeff");
    var any = false;
    ids.forEach(function (id) {
      var e = EFFECT_CACHE[String(id)];
      if (e && effectBody(blk, e, null, progs, level)) any = true;
    });
    if (!any) return;
    blk.insertBefore(el("div", "tipeffwho", W(pair[1])), blk.firstChild);
    box.appendChild(blk);
  });

  var req = el("div", "tipbody");
  if (it.structure) {

    var dur = el("div", "tl tiprow0");
    dur.appendChild(el("span", "tv",
      W("durability", num(it.structure), num(it.structure))));
    if (it.durability) {
      dur.appendChild(el("span", "tv tipright",
        spaceWords(enumWord("durability", it.durability))));
    }
    req.appendChild(dur);
  }
  if (it.maxLevel) tipLine(req, null, W("maximumLevel", it.maxLevel));

  if (it.gloryRank) tipLine(req, null, W("requiresGloryRank", it.gloryRank), "ireq");
  if (it.minLevel) tipW(req, "minimumLevel", null, it.minLevel);
  if (it.requiresClass && it.requiresClass.length) {
    var names = it.requiresClass.map(function (code) {
      var c = classByCode(code, D);
      return c ? c.name : spaceWords(code);
    });
    tipW(req, "classColon", "ireq", names.join(", "));
  }

  if (it.monsterPlay) tipLine(req, null, W("requiresColon", "Monster Play"), "ireq");
  if (req.children.length) box.appendChild(req);

  if (it.desc) {
    var d = multiLine("tipdesc", '"' + String(it.desc).replace(/\s+$/, "") + '"');
    if (d) box.appendChild(d);
  }

  var setb = setBlock(it, progs);
  if (setb) box.appendChild(setb);

  var foot = el("div", "tipbody");
  if (it.cooldown) tipW(foot, "cooldown", "time", it.cooldown);
  if (it.worth) tipLine(foot, W("worth") || "Worth:", itemWorth(it.worth), "iworth");
  if (foot.children.length) box.appendChild(foot);

  if (it.disenchant) {
    var dz = el("div", "tipbody");
    tipLine(dz, null, W("disenchantsInto"), "idishead");
    var spec = DISENCHANT && DISENCHANT[String(it.disenchant)];
    var row = el("div", "tl idis");
    var ico = spec && itemIcon(spec);
    if (ico) row.appendChild(ico);

    var qty = it.disenchantQty > 1 ? numAmt(it.disenchantQty) + " " : "";
    if (spec && spec.name) {

      var q = String(spec.quality || "Common").toLowerCase();
      row.appendChild(el("span", "tipname rar-" + q, qty + spec.name));
    } else {

      var meta = nameOf(it.disenchant);
      var dl = el("span", "tv", qty + (meta ? meta.n : "item " + it.disenchant));
      if (!meta) dl.setAttribute("data-nameid", it.disenchant);
      row.appendChild(dl);
      loadItemIndex().then(nameLatecomers, function () {  });
    }
    dz.appendChild(row);
    box.appendChild(dz);
  }
  return box;
}

function renderItem(it, D, MS, progs) {
  var host = el("div");
  var head = el("div", "head");
  head.appendChild(itemIcon(it) || el("span", "iconstack"));
  var h = el("div");
  h.appendChild(el("h2", null, it.name));
  h.appendChild(el("div", "id", "item " + it.id + "  /  0x" +
                   it.id.toString(16).toUpperCase()));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag kind", "Item"));
  if (it.category) tags.appendChild(el("span", "tag", spaceWords(it.category)));

  if (it.quality) {
    tags.appendChild(el("span", "tag rar-" + String(it.quality).toLowerCase(),
                        spaceWords(enumWord("quality", it.quality))));
  }
  (it.slots || []).forEach(function (sl) {
    tags.appendChild(el("span", "tag", spaceWords(sl)));
  });
  if (it.consumed) tags.appendChild(el("span", "tag", "Consumed on use"));
  host.appendChild(tags);

  if (it.desc) host.appendChild(richPara("desc", it.desc));

  section(host, "Tooltip", itemTooltip(it, progs || {}, D));

  var dmg = null;
  if (it.damage) {
    dmg = it.damageVariance
      ? numAmt(damageLow(it)) + " - " + numAmt(it.damage)
      : numAmt(it.damage);
    if (it.damageType) dmg += " " + spaceWords(enumWord("damageType", it.damageType));
  }
  var bind = it.bind ? "Binds " + it.bind : (it.bindAccount ? "Bound to account" : null);
  if (bind && it.bindAccount && it.bind) bind += ", to your account";

  section(host, "At a glance", statRow([
    ["Item level", it.itemLevel],
    ["Requires level", it.minLevel],
    ["Requires", classRun(it.requiresClass, D), "wide"],
    ["Armour", it.armour ? numAmt(it.armour) : null],
    ["DPS", it.dps ? fmt(it.dps, 2) : null],
    ["Damage", dmg],
    ["Speed", it.speed ? spaceWords(enumWord("speed", it.speed)) : null],
    ["Implement", it.implement ? spaceWords(enumWord("implement", it.implement)) : null],
    ["Essence slots", it.sockets ? it.sockets.join(", ") : null],
    ["Binds", bind],
    ["Material", it.material ? spaceWords(enumWord("material", it.material)) : null],
    ["Durability", it.durability ? spaceWords(enumWord("durability", it.durability)) : null],
    ["Cooldown", it.cooldown]
  ]));

  if (it.set) {
    var st = SETS && SETS[String(it.set)];
    var sul = el("ul", "links");
    var li = el("li");
    var si = el("img");
    si.src = iconUrl(st ? st.icon : 0);
    si.alt = "";
    si.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(si);
    var sbody = el("div");
    var sa = el("a", null, st ? st.name : "#" + it.set);
    sa.href = urlFor("set/" + it.set);
    sbody.appendChild(sa);
    if (st && (st.members || []).length) {
      sbody.appendChild(el("span", "via", st.members.length + " pieces"));
    }
    li.appendChild(sbody);
    sul.appendChild(li);
    section(host, "Part of this set", sul);
  }

  if (MS) {
    section(host, "What it grants",
            grantsBlock(it.stats, MS, progs || {}, "Item level", D,
                        freepClasses(D)));
  }

  [["onUse", "What it does when used"],
   ["whileEquipped", "While it is equipped"],
   ["hotspot", "What it leaves behind"]].forEach(function (pair) {
    if (!it[pair[0]]) return;
    section(host, pair[1], linkList(it[pair[0]], "effect"));
  });

  [["grantsSkill", "Skill it grants", "skill"],
   ["usesSkill", "Skill it uses", "skill"],
   ["mountSkillShort", "Skill it grants on a short steed", "skill"],
   ["mountSkillTall", "Skill it grants on a tall steed", "skill"],
   ["requiresEffect", "Only usable while you have", "effect"],
   ["restrictedByEffect", "Cannot be used while you have", "effect"]]
    .forEach(function (row) {
      if (it[row[0]]) section(host, row[1], linkList([it[row[0]]], row[2]));
    });
  if (it.barsSkills) {
    section(host, "Skills it bars", linkList(it.barsSkills, "skill"));
  }
  return host;
}

var SIDE_WORDS = { Good: "the Free Peoples", Evil: "the creep side",
                   Player: "players" };
function worldStateSources(rec) {
  var rows = rec.fromWorldState;
  if (!rows || !rows.length) return null;
  var box = el("div");
  var ul = el("ul", "links plain");
  rows.forEach(function (r) {
    var li = el("li");
    var who = (r.filters || []).map(function (f) {
      return SIDE_WORDS[f] || spaceWords(f);
    }).join(", ");
    var when = r.floor !== undefined && r.floor === r.ceiling
      ? "reads " + fmt(r.floor)
      : (r.floor !== undefined || r.ceiling !== undefined)
        ? "is between " + fmt(r.floor === undefined ? 0 : r.floor) +
          " and " + fmt(r.ceiling === undefined ? 0 : r.ceiling)
        : "changes";

    var props = r.properties && r.properties.length ? r.properties
              : (r.property ? [r.property] : []);
    var line = el("span", "summon");
    if (props.length) {
      line.appendChild(document.createTextNode("While "));
      props.forEach(function (name, i) {
        if (i) line.appendChild(document.createTextNode(i === props.length - 1
          ? " or " : ", "));
        line.appendChild(propCode(name));
      });
      line.appendChild(document.createTextNode(" " + when));
    } else {
      line.appendChild(document.createTextNode("While a world property " + when));
    }
    li.appendChild(line);
    if (who) li.appendChild(el("span", "via", "applies to " + who));
    ul.appendChild(li);
  });
  box.appendChild(ul);
  if (rec.fromWorldStateMore) {
    box.appendChild(el("p", "muted", "and " + rec.fromWorldStateMore +
      " more not listed"));
  }
  return box;
}

var PIP_STEPS = null;
function pipStepIndex() {
  if (PIP_STEPS) return PIP_STEPS;
  if (!PIPS) return {};
  var index = {};
  Object.keys(PIPS).forEach(function (key) {
    var def = PIPS[key];
    (def.steps || []).forEach(function (st) {
      (st.effects || []).forEach(function (id) {
        (index[id] || (index[id] = []))
          .push({ pip: def, min: st.min, max: st.max });
      });
    });
  });

  Object.keys(index).forEach(function (id) {
    var rows = index[id].sort(function (a, b) {
      return a.pip.name < b.pip.name ? -1
           : a.pip.name > b.pip.name ? 1 : a.min - b.min;
    });
    var out = [];
    rows.forEach(function (r) {
      var last = out[out.length - 1];
      if (last && last.pip === r.pip && r.min <= last.max + 1) {
        last.max = Math.max(last.max, r.max);
      } else {
        out.push(r);
      }
    });
    index[id] = out;
  });
  PIP_STEPS = index;
  return PIP_STEPS;
}

function pipSideOf(def, row) {
  if (def.home === undefined) return null;
  return (row.min <= def.home && def.home <= row.max) ? "home"
       : (row.max < def.home ? "min" : "max");
}

function pipStepSources(e) {
  var rows = pipStepIndex()[e.id];
  if (!rows || !rows.length) return null;
  var ul = el("ul", "links plain");
  rows.forEach(function (r) {
    var def = r.pip;
    var li = el("li");
    var side = pipSideOf(def, r);
    var icon = side && def.icons && def.icons[side];
    if (icon) {
      var img = el("img", "pipicon");
      img.src = iconUrl(icon);
      img.alt = "";
      img.onerror = function () { this.style.visibility = "hidden"; };
      li.appendChild(img);
    }

    var whole = def.min !== undefined && def.max !== undefined
             && r.min <= def.min && r.max >= def.max;
    li.appendChild(el("span", "summon", whole
      ? "At any " + def.name
      : "While your " + def.name + " reads " +
        (r.min === r.max ? r.min : r.min + " to " + r.max)));
    var label = side && def.labels && def.labels[side];
    if (label && !whole) {
      li.appendChild(el("span", "via",
        side === "home" ? "the " + label + " middle" : "the " + label + " end"));
    }
    ul.appendChild(li);
  });
  return ul;
}

function hotspotSources(rec) {
  var rows = rec.fromHotspots;
  if (!rows || !rows.length) return null;
  var box = el("div");
  var ul = el("ul", "links plain");
  rows.forEach(function (row) {
    var li = el("li");
    li.appendChild(el("span", "summon", row[1]));
    li.appendChild(el("span", "via", "hotspot " + row[0]));
    ul.appendChild(li);
  });
  box.appendChild(ul);
  if (rec.fromHotspotsMore) {
    box.appendChild(el("p", "muted", "and " + rec.fromHotspotsMore +
      " more hotspot" + (rec.fromHotspotsMore === 1 ? "" : "s") + " not listed"));
  }
  return box;
}

function modGrantSources(rec) {
  var rows = rec.grantedByMods;
  if (!rows || !rows.length) return null;
  var ul = el("ul", "links");
  rows.forEach(function (row) {
    var meta = nameOf(row[0]);
    if (!meta) return;
    var li = el("li");
    var img = el("img");
    img.src = iconUrl(meta.k);
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    li.appendChild(img);
    var body = el("div");
    var a = el("a", null, meta.n);
    a.href = urlFor(routeFor(meta.t) + "/" + row[0]);
    body.appendChild(a);
    if (row[2]) {
      var via = el("span", "via");
      via.appendChild(document.createTextNode(" through "));
      via.appendChild(propCode(row[2]));
      body.appendChild(via);
    }
    li.appendChild(body);
    ul.appendChild(li);
  });
  return ul.children.length ? ul : null;
}

function itemSources(rec) {
  if (!rec.fromItems || !rec.fromItems.length) return null;
  var WORDS = { onUse: "on use", whileEquipped: "while equipped",
                hotspot: "from its hotspot", grantsSkill: "grants it",
                usesSkill: "uses it", mountSkillShort: "on a short steed",
                mountSkillTall: "on a tall steed", barsSkill: "bars it" };

  var order = [], seen = {};
  rec.fromItems.forEach(function (row) {
    var k = String(row[0]);
    if (!seen[k]) { seen[k] = []; order.push(row[0]); }
    var word = WORDS[row[1]] || row[1];
    if (seen[k].indexOf(word) === -1) seen[k].push(word);
  });
  var box = el("div");
  box.appendChild(linkList(order.map(function (id) {
    return { id: id, via: seen[String(id)].join(", ") };
  }), "item"));
  if (rec.fromItemsMore) {
    box.appendChild(el("p", "muted", "and " + rec.fromItemsMore +
      " more item" + (rec.fromItemsMore === 1 ? "" : "s") + " not listed"));
  }
  return box;
}

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

  var tbl = el("table", "t");
  tbl.innerHTML = "<tr><th>Pieces</th><th>Grants</th><th>Effects</th></tr>";
  var any = false;
  (st.bonuses || []).forEach(function (b) {
    any = true;
    var tr = el("tr");
    tr.appendChild(el("td", "num", b.pieces === undefined ? "-" : String(b.pieces)));

    var td1 = el("td");
    (b.stats || []).forEach(function (x) {

      var said = statLine(x, "item level");
      if (said) { said.className = "setstat"; td1.appendChild(said); }
      var line = el("div", said ? "muted small" : null);
      line.appendChild(propCode(x.stat));
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

  var allStats = [];
  var seenStat = {};
  (st.bonuses || []).forEach(function (b) {
    (b.stats || []).forEach(function (x) {
      if (!seenStat[x.stat]) { seenStat[x.stat] = 1; allStats.push(x); }
    });
  });
  section(host, "What those properties affect",
          grantsBlock(allStats, MS, progs, "Item level", D, freepClasses(D)));

  if ((st.members || []).length) {
    section(host, "Pieces", linkList(st.members, "item"));
  }
  return host;
}

var PREFS = {};

try { localStorage.removeItem("lotrodb.prefs"); } catch (e) {  }

function savePrefs() {

}

function preferredLevel(fallback) {
  var v = parseInt(PREFS.level, 10);
  if (!isNaN(v) && v > 0) return Math.min(v, LEVEL_CAP);
  return fallback;
}

function belongsTo(id, cls) {
  var own = SRC_CLASS && SRC_CLASS[String(id)];
  return !!own && own.indexOf(cls) !== -1;
}

function buildPrefsUI() {
  var host = document.getElementById("prefs");
  if (!host) return;
  host.textContent = "";

  var lvl = el("label", "pf");
  lvl.appendChild(el("span", null, "Level"));
  var li = el("input");
  li.type = "number";
  li.min = "1";
  li.max = String(LEVEL_CAP);
  li.placeholder = String(LEVEL_CAP);
  li.value = PREFS.level || "";
  li.oninput = function () {
    var v = parseInt(li.value, 10);
    PREFS.level = (!isNaN(v) && v > 0) ? Math.min(v, LEVEL_CAP) : null;
    savePrefs();
    route();
  };
  lvl.appendChild(li);
  host.appendChild(lvl);

  var cw = el("label", "pf");
  cw.appendChild(el("span", null, "Class"));
  var cs = el("select");
  cs.appendChild(new Option("Any", ""));
  cw.appendChild(cs);
  host.appendChild(cw);

  Promise.all([classData(), sourceClasses()]).then(function (r) {
    SRC_CLASS = r[1] || {};

    if (PREFS.cls) runSearch();
    classGroups(r[0]).forEach(function (g) {
      g[1].forEach(function (c) {
        var o = new Option(c.name, String(c.id));
        if (String(PREFS.cls) === String(c.id)) o.selected = true;
        cs.appendChild(o);
      });
    });
    cs.onchange = function () {
      PREFS.cls = cs.value ? parseInt(cs.value, 10) : null;
      savePrefs();
      runSearch();
      route();
    };
  });

  var gear = el("details", "pfgear");
  gear.appendChild(el("summary", null, "Weapon and mastery"));
  var note = el("div", "muted pfnote");
  note.textContent = "Put these in and the damage line resolves to real "
    + "numbers instead of W and A. Your damage modifiers and your melee, "
    + "ranged or tactical damage still multiply what comes out.";
  gear.appendChild(note);
  [["wdps", "W - weapon damage"], ["dmgAdd", "A - attack's damage-add"],
   ["mastery", "Mastery %"]]
    .forEach(function (pair) {
      var w = el("label", "pf");
      w.appendChild(el("span", null, pair[1]));
      var i = el("input");
      i.type = "number";
      i.min = "0";
      i.step = "any";
      i.value = PREFS[pair[0]] || "";
      i.oninput = function () {
        var v = parseFloat(i.value);
        PREFS[pair[0]] = isNaN(v) ? null : v;
        savePrefs();
        route();
      };
      w.appendChild(i);
      gear.appendChild(w);
    });
  host.appendChild(gear);
}

var STACK_LIST_MAX = 10;

function stackMembers(group) {
  if (!group) return [];
  return group.m || (group.length !== undefined ? group : []);
}

function stackMax(group) {
  var n = group && group.max;
  return typeof n === "number" && n > 1 ? n : 1;
}
function stackPerCaster(group) { return !!(group && group.perCaster); }

function stackRows(group) {
  return stackMembers(group).map(function (row) {
    return (row && row.length !== undefined)
      ? { id: row[0], pri: row[1], guard: !!row[2] }
      : { id: row, pri: null, guard: false };
  });
}
function stackIds(group) {
  return stackRows(group).map(function (r) { return r.id; });
}

function stackLink(name, selfId) {
  if (!name) return null;
  var group = STACKING && STACKING[name];
  if (!group || stackMembers(group).length < 2) {

    return el("span", "muted", name);
  }

  var a = el("a", "stacklink");
  a.href = stackUrl(name);
  a.appendChild(document.createTextNode(spaceWords(name)));
  var members = stackMembers(group);
  var others = stackIds(group).filter(function (id) { return id !== selfId; });
  if (members.length >= STACK_LIST_MAX || !others.length) {
    var rest = members.length - (others.length === members.length ? 0 : 1);

    a.appendChild(el("span", "stackcount",
      " (" + rest + " other" + (rest === 1 ? "" : "s") + ")"));
    return a;
  }
  var box = el("div");
  box.appendChild(a);
  var list = el("div", "stackmembers");

  var dup = ambiguousNames(others);
  list.appendChild(linkRun(others.map(function (id) {
    return function () {
      return nameOf(id) ? readerLink(id, "effect", "eff", dup) : null;
    };
  }), STACK_LIST_MAX, 0));
  box.appendChild(list);
  return box;
}

function renderStacking(name, group) {
  var rows = stackRows(group);
  var host = el("div");
  var head = el("div", "head");
  var h = el("div");
  h.appendChild(el("h2", null, spaceWords(name)));
  h.appendChild(el("div", "id", "stacking group " + name));
  head.appendChild(h);
  host.appendChild(head);

  var ranked = false, first = null, guards = 0;
  rows.forEach(function (r) {
    if (r.guard) guards++;
    if (typeof r.pri !== "number") return;
    if (first === null) first = r.pri;
    else if (r.pri !== first) ranked = true;
  });

  var maxOn = stackMax(group);
  var perCaster = stackPerCaster(group);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag kind", "Stacking group"));
  tags.appendChild(el("span", "tag", rows.length + " effects"));
  if (maxOn > 1) tags.appendChild(el("span", "tag", "Stacks up to " + maxOn));
  if (perCaster) tags.appendChild(el("span", "tag", "Per caster"));
  if (ranked) tags.appendChild(el("span", "tag", "Ranked by priority"));
  host.appendChild(tags);

  var howMany = maxOn > 1
    ? ", and a target can hold up to " + maxOn + " of them at once"
    : ", so a target holds one of them at a time";
  var whichSurvives = ranked
    ? (maxOn > 1
        ? " - which ones survive when another lands is settled by the priority "
          + "beside each name, not by whichever came last. A lower priority "
          + "does not displace a higher one."
        : " - and which one is settled by the priority beside each name, not by "
          + "whichever landed last. A lower priority does not displace a higher "
          + "one; equal priorities take the slot from each other.")
    : (maxOn > 1

        ? ". Every member here is at the same priority, so none of them "
          + "outranks another."
        : ". Every member here is at the same priority, so a second "
          + "application takes the slot from the first.");
  host.appendChild(el("p", "desc",
    "These all carry the equivalence class " + name + howMany + whichSurvives));
  if (perCaster) {
    host.appendChild(el("p", "desc",
      "The limit is counted per caster, so one from each caster can be on the "
      + "same target at the same time."));
  }
  if (guards) {
    host.appendChild(el("p", "desc",
      (guards === 1 ? "One effect here is" : guards + " effects here are")
      + " marked as protection against this class: while "
      + (guards === 1 ? "it is" : "one of them is") + " on a target, effects "
      + "of this class do not land at all, rather than replacing anything."));
  }

  var t = el("table", "t");
  t.innerHTML = "<tr><th>Effect</th>" + (ranked ? "<th>Priority</th>" : "") +
                "<th>Kind</th><th></th></tr>";
  var dup = ambiguousNames(rows.map(function (r) { return r.id; }));
  rows.forEach(function (r) {
    var meta = nameOf(r.id);
    var tr = el("tr");
    var td = el("td");
    var a = el("a", null, meta ? meta.n : "#" + r.id);
    a.href = urlFor("effect/" + r.id);
    if (!meta) pending(a, null, r.id);
    if (meta && dup[meta.n]) a.appendChild(el("span", "idtag", "#" + r.id));
    td.appendChild(a);
    tr.appendChild(td);
    if (ranked) {
      tr.appendChild(el("td", "num",
        typeof r.pri === "number" ? String(r.pri) : "-"));
    }

    tr.appendChild(el("td", "muted", meta && meta.c ? titleCase(meta.c) : ""));
    tr.appendChild(el("td", "muted",
      r.guard ? "blocks the whole class while it is up" : ""));
    t.appendChild(tr);
  });
  section(host, "In this group", t);
  return host;
}

function renderProperty(prop, MS, D) {
  var meta = PROPS && PROPS[prop];
  var host = el("div");

  var head = el("div", "head");
  var h = el("div");
  h.appendChild(el("h2", null, (meta && meta.n) ? meta.n : spaceWords(prop)));
  h.appendChild(el("div", "id", prop));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag kind", "Property"));
  if (meta && meta.c) tags.appendChild(el("span", "tag", titleCase(meta.c)));
  if (meta && meta.p) tags.appendChild(el("span", "tag", "Written as a percentage"));
  if (!meta) tags.appendChild(el("span", "tag", "No client label"));
  host.appendChild(tags);

  var watched = WORLD_STATES && WORLD_STATES[prop];
  if (watched) {
    var wl = el("ul", "links");
    (watched.effects || []).forEach(function (row) {
      var meta = nameOf(row.effect);
      var li = el("li");
      var wi = el("img");
      wi.src = iconUrl(meta ? meta.k : 0);
      wi.alt = "";
      wi.onerror = function () { this.style.visibility = "hidden"; };
      li.appendChild(wi);
      var wb = el("div");
      var wa = el("a", null, meta ? meta.n : "#" + row.effect);
      wa.href = urlFor("effect/" + row.effect);
      if (!meta) pending(wa, wi, row.effect);
      wb.appendChild(wa);
      var bits = [];
      if (row.floor !== undefined && row.floor === row.ceiling) {
        bits.push("reads " + fmt(row.floor));
      } else if (row.floor !== undefined || row.ceiling !== undefined) {
        bits.push("between " + fmt(row.floor === undefined ? 0 : row.floor) +
                  " and " + fmt(row.ceiling === undefined ? 0 : row.ceiling));
      }
      if (row.filters && row.filters.length) {
        bits.push((row.filters.map(function (f) {
          return SIDE_WORDS[f] || spaceWords(f);
        })).join(", "));
      }
      if (bits.length) wb.appendChild(el("span", "via", bits.join("  ")));
      li.appendChild(wb);
      wl.appendChild(li);
    });
    section(host, "Applies these while it holds a value", wl);
    if (watched.more) {
      host.appendChild(el("p", "muted", "and " + watched.more + " more"));
    }
  }

  var src = (MS && MS[prop]) || null;
  if (!src) {
    if (!watched) {
      host.appendChild(el("p", "muted",
        "Nothing in this dataset grants or reads this property."));
    }
    return host;
  }

  var nSrc = (src.traits || []).length + (src.effects || []).length +
             (src.traceries || []).length + (src.sets || []).length;
  var nRead = (src.skills || []).length + (src.readEffects || []).length +
              (src.readTraits || []).length;
  section(host, "At a glance", statRow([
    ["Sources", nSrc + ((src.traitsMore || src.effectsMore ||
      src.traceriesMore || src.setsMore) ? "+" : "")],
    ["Read by", nRead + ((src.skillsMore || src.readEffectsMore ||
      src.readTraitsMore) ? "+" : "")]
  ]));

  var granted = el("div", "proprun");
  granted.appendChild(sourceFragment(prop, MS, D, 40));
  section(host, "Granted by", granted);

  section(host, "What it scales", readersByClass(prop, MS, D)
                                  || el("p", "muted", "Nothing reads it."));
  return host;
}

var NO_CLASS = "none";

function classOf(key, D) {
  if (key === NO_CLASS) return null;
  return (D && D.classes ? D.classes[key] : null) || null;
}

function byClassOrder(D) {
  return function (a, b) {
    if (a === NO_CLASS) return 1;
    if (b === NO_CLASS) return -1;
    var ca = classOf(a, D), cb = classOf(b, D);
    var sa = (ca && ca.side === "creep") ? 1 : 0;
    var sb = (cb && cb.side === "creep") ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return ((ca && ca.name) || a).localeCompare((cb && cb.name) || b);
  };
}

function classGroupHead(key, D, tail) {
  var head = el("div", "propgrouphead");
  var c = classOf(key, D);
  if (c) {
    var im = el("img");
    im.src = iconUrl(c.icon);
    im.alt = "";
    im.className = "inline";
    im.onerror = function () { this.style.visibility = "hidden"; };
    head.appendChild(im);
    var a = el("a", null, c.name);
    a.href = urlFor("class/" + c.id);
    head.appendChild(a);
  } else {
    head.appendChild(el("span", null, "No class attached"));
  }

  if (tail) head.appendChild(el("span", "via", " " + tail));
  return head;
}

function bucketByClass(ids) {
  var buckets = {}, keys = [];
  ids.forEach(function (id) {
    var own = (SRC_CLASS && SRC_CLASS[String(id)]) || [];
    (own.length ? own : [NO_CLASS]).forEach(function (cid) {
      var key = String(cid);
      if (!buckets[key]) { buckets[key] = []; keys.push(key); }
      buckets[key].push(id);
    });
  });
  return { buckets: buckets, keys: keys };
}

function skillsByClass(ids, D) {
  if (!ids || !ids.length) return null;
  if (!D || !D.classes) return linkList(ids, "skill");
  var b = bucketByClass(ids);
  if (b.keys.length < 2) return linkList(ids, "skill");
  b.keys.sort(byClassOrder(D));
  var box = el("div");
  b.keys.forEach(function (key) {
    var mine = b.buckets[key];
    var group = el("div", "propgroup");
    group.appendChild(classGroupHead(key, D,
      mine.length + " skill" + (mine.length === 1 ? "" : "s")));
    group.appendChild(linkList(mine, "skill"));
    box.appendChild(group);
  });
  return box;
}

function readersByClass(prop, MS, D) {
  var src = (MS && MS[prop]) || {};
  var rows = [];
  (src.skills || []).forEach(function (u) {
    rows.push({ id: u[0], kind: "skill", field: u[1] });
  });
  [["readEffects", "effect"], ["readTraits", "trait"]].forEach(function (spec) {
    (src[spec[0]] || []).forEach(function (r) {
      rows.push({ id: r[0], kind: spec[1], field: r[1] });
    });
  });
  if (!rows.length) return null;

  var buckets = {}, order = [];
  rows.forEach(function (row) {
    var own = (SRC_CLASS && SRC_CLASS[String(row.id)]) || [];
    (own.length ? own : [NO_CLASS]).forEach(function (cid) {
      var key = String(cid);
      if (!buckets[key]) { buckets[key] = []; order.push(key); }
      buckets[key].push(row);
    });
  });
  order.sort(byClassOrder(D));

  var box = el("div");
  order.forEach(function (key) {
    var group = el("div", "propgroup");
    var ids = {};
    buckets[key].forEach(function (r) { ids[r.id] = 1; });
    var n = Object.keys(ids).length;
    group.appendChild(classGroupHead(key, D,
      n + " reader" + (n === 1 ? "" : "s")));
    group.appendChild(readerRuns(buckets[key]));
    box.appendChild(group);
  });
  if (src.skillsMore || src.readEffectsMore || src.readTraitsMore) {
    box.appendChild(el("div", "muted",
      "Some readers are not listed - the index keeps a bounded number per "
      + "property."));
  }
  return box;
}

function readerRuns(rows) {
  var frag = el("div", "proprun");
  var byField = {}, fields = [];
  rows.forEach(function (r) {
    var f = r.field || "";
    if (!byField[f]) { byField[f] = { order: [], of: {} }; fields.push(f); }
    var b = byField[f];
    if (!b.of[r.id]) { b.of[r.id] = r.kind; b.order.push(r.id); }
  });
  fields.sort();
  fields.forEach(function (f) {
    var b = byField[f];
    var line = el("div");
    if (f) {
      line.appendChild(el("strong", null, f));
      line.appendChild(document.createTextNode(" on "));
    }
    var dup = ambiguousNames(b.order);
    line.appendChild(linkRun(b.order.map(function (id) {
      return function () {
        return readerLink(id, b.of[id], b.of[id] === "effect" ? "eff" : null, dup);
      };
    }), 12, 0));
    frag.appendChild(line);
  });
  return frag;
}

function renderChanges(ch) {
  var host = el("div");
  var head = el("div", "head");
  var h = el("div");
  h.appendChild(el("h2", null, "What changed"));
  h.appendChild(el("div", "id", "since the previous rebuild"));
  head.appendChild(h);
  host.appendChild(head);

  if (!ch || !ch.baseline) {
    host.appendChild(el("p", "desc",
      "This build is the baseline. Rebuild after the next LOTRO patch and "
      + "everything that was added, removed, renamed or retuned will be "
      + "listed here."));
    return host;
  }
  var c = ch.counts || {};
  section(host, "At a glance", statRow([
    ["Added", c.added], ["Removed", c.removed],
    ["Renamed", c.renamed], ["Retuned", c.changed]
  ]));

  function rowsList(rows, kind) {
    if (!rows || !rows.length) return null;
    var ul = el("ul", "links");
    rows.forEach(function (row) {
      var id = parseInt(row[0], 10);
      var meta = nameOf(id);
      var li = el("li");
      var img = el("img");
      img.src = iconUrl(meta ? meta.k : 0);
      img.alt = "";
      img.onerror = function () { this.style.visibility = "hidden"; };
      li.appendChild(img);
      var body = el("div");
      var t = row[2] || (meta && meta.t);
      if (t && meta) {
        var a = el("a", null, row[1] || meta.n);
        a.href = urlFor(routeFor(t) + "/" + id);
        body.appendChild(a);
      } else {

        body.appendChild(el("span", null, row[1] || ("#" + id)));
      }
      if (kind === "renamed") {

        body.textContent = "";
        var meta2 = nameOf(id);
        var a2 = el("a", null, row[2]);
        a2.href = urlFor((meta2 ? routeFor(meta2.t) : "skill") + "/" + id);
        body.appendChild(a2);
        body.appendChild(el("span", "via", 'was "' + row[1] + '"'));
      }
      li.appendChild(body);
      ul.appendChild(li);
    });
    return ul;
  }

  section(host, "Added", rowsList(ch.added));
  section(host, "Renamed", rowsList(ch.renamed, "renamed"));
  section(host, "Values retuned", rowsList(ch.changed));
  section(host, "Removed", rowsList(ch.removed));

  var capped = ["added", "removed", "renamed", "changed"].some(function (k) {
    return (c[k] || 0) > ((ch[k] || []).length);
  });
  if (capped) {
    host.appendChild(el("p", "muted",
      "Long lists are cut at 400; the counts above are the real totals."));
  }
  return host;
}

function route() {

  hoverHide();
  var detail = document.getElementById("detail");
  var path = routePath();

  var shell = document.querySelector(".app");
  if (shell) shell.classList.toggle("reading", !!path);

  if (!path) {
    selected = null;
    if (!document.getElementById("landing") && LANDING) {
      detail.textContent = "";
      detail.appendChild(LANDING);
    }
    showLandingClasses();
    runSearch();
    document.title = "LOTRO Skills and Effects";
    return;
  }

  if (path === "classes") {
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

  if (path === "changes") {
    selected = null;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    sideFile("changes").then(function (ch) {
      detail.textContent = "";
      detail.appendChild(renderChanges(ch));
      document.title = "What changed - LOTRO Skills and Effects";
    });
    runSearch();
    return;
  }

  var gm = /^stacking\/(.+)$/.exec(path);
  if (gm) {
    var gname = gm[1];
    selected = null;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    stackingData().then(function (G) {
      STACKING = G || {};
      detail.textContent = "";
      var group = STACKING[gname];
      if (!group) {
        detail.appendChild(el("div", "empty",
          "No stacking group called " + gname + "."));
        return;
      }
      detail.appendChild(renderStacking(gname, group));
      document.title = gname + " - LOTRO Skills and Effects";
    });
    runSearch();
    return;
  }

  var pm = /^property\/(.+)$/.exec(path);
  if (pm) {
    var prop = pm[1];
    selected = null;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    Promise.all([modSources(), classData(), propertyData(), sourceClasses(),
                 itemSetData(), worldStateData()])
      .then(function (res) {
        PROPS = res[2] || {};
        SRC_CLASS = res[3] || {};
        SETS = res[4] || {};
        WORLD_STATES = res[5] || {};
        detail.textContent = "";
        detail.appendChild(renderProperty(prop, res[0], res[1]));
        document.title = prop + " - LOTRO Skills and Effects";
      });
    runSearch();
    return;
  }

  var ym = /^(?:tracery|essence)\/(\d+)$/.exec(path);
  if (ym) {
    var yid = parseInt(ym[1], 10);

    var ymeta = nameOf(yid);
    selected = (ymeta ? ymeta.t : "y") + yid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    Promise.all([traceryData(), classData(), modSources(), progressions(),
                 sourceClasses(), itemSetData(), propertyData()])
      .then(function (res) {
        var T = res[0];
        PROPS = res[6] || {};
        SRC_CLASS = res[4] || {};

        SETS = res[5] || {};
        detail.textContent = "";

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

  var sm = /^set\/(\d+)$/.exec(path);
  if (sm) {
    var sid = parseInt(sm[1], 10);
    selected = "g" + sid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));

    Promise.all([itemSetData(), classData(), modSources(), sourceClasses(),
                 propertyData(), progressions(), loadItemIndex()])
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
        detail.appendChild(renderSet(rec, res[1], res[2], res[5]));
        detail.scrollTop = 0;
        document.title = rec.name + " - LOTRO Skills and Effects";
      });
    runSearch();
    return;
  }

  var im = /^item\/(\d+)$/.exec(path);
  if (im) {
    var iid = parseInt(im[1], 10);
    selected = "i" + iid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    Promise.all([loadRecord("item", iid), classData(), propertyData(),
                 modSources(), progressions(), itemSetData(), sourceClasses(),
                 uiIconData(), disenchantData()])
      .then(function (res) {
      PROPS = res[2] || {};
      SETS = res[5] || {};
      SRC_CLASS = res[6] || {};
      UICONS = res[7] || {};
      DISENCHANT = res[8] || {};
      detail.textContent = "";
      var rec = res[0];
      if (!rec) {
        detail.appendChild(el("div", "empty", "No item with id " + iid + "."));
        return;
      }
      return preloadItemTip(rec).then(function () {
        detail.textContent = "";
        detail.appendChild(renderItem(rec, res[1], res[3], res[4]));
        detail.scrollTop = 0;
        document.title = rec.name + " - LOTRO Skills and Effects";
      });
    });
    runSearch();
    return;
  }

  var cm = /^(class|trait)\/(\d+)$/.exec(path);
  if (cm) {
    var what = cm[1], cid = parseInt(cm[2], 10);

    selected = (what === "class" ? "c" : "r") + cid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));

    var ctJobs = [classData(), modSources(), progressions(), itemSetData(),
                  propertyData(), sourceClasses()];
    Promise.all(ctJobs).then(function (res) {
      var D = res[0], MS = res[1], progs = res[2];

      SETS = res[3] || {};
      PROPS = res[4] || {};
      SRC_CLASS = res[5] || {};
      var rec = what === "class" ? D.classes[String(cid)] : D.traits[String(cid)];
      if (!rec) {
        detail.textContent = "";
        detail.appendChild(el("div", "empty", "No " + what + " with id " + cid + "."));
        return;
      }

      var pre = what === "class" ? Promise.resolve() : preloadTraitEffects(rec);
      pre.then(function () {
        detail.textContent = "";
        detail.appendChild(what === "class" ? renderClass(rec, D)
                                            : renderTrait(rec, D, MS, progs));
        detail.scrollTop = 0;
        document.title = rec.name + " - LOTRO Skills and Effects";
      });
    });
    runSearch();
    return;
  }

  var m = /^(skill|effect)\/(\d+)$/.exec(path);
  if (!m) {

    selected = null;
    detail.textContent = "";
    var nf = el("div", "empty");
    nf.appendChild(el("h2", null, "Nothing at that address"));
    nf.appendChild(el("p", null, "/" + path + " is not a page here."));
    var back = el("a", null, "Back to the start");
    back.href = urlFor("");
    nf.appendChild(back);
    detail.appendChild(nf);
    document.title = "LOTRO Skills and Effects";
    runSearch();
    return;
  }
  var kind = m[1], id = parseInt(m[2], 10);
  selected = (kind === "skill" ? "s" : "e") + id;
  detail.textContent = "";
  detail.appendChild(el("div", "muted", "loading..."));
  var jobs = [loadRecord(kind, id), progressions(), classData(), modSources(),
              effectTraceries(), sourceClasses(), gambitData(), propertyData(),
              displayTypeData(), itemSetData(), stackingData(),
              skillChannelData(), pipData(), comboFlagData()];
  Promise.all(jobs).then(function (res) {
    SRC_CLASS = res[5] || {};
    GAMBITS = res[6] || {};
    PROPS = res[7] || {};
    DISPLAY_TYPES = res[8] || {};
    SETS = res[9] || {};
    STACKING = res[10] || {};
    CHANNELS = res[11] || {};
    PIPS = res[12] || {};
    COMBOFLAGS = res[13] || {};
    var rec = res[0];
    if (!rec) {
      detail.textContent = "";
      detail.appendChild(el("div", "empty", "No " + kind + " with id " + id + "."));
      return;
    }
    return (kind === "skill" ? preloadTipEffects(rec) : preloadEffectTip(rec))
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

var ITEMS_IN = false;
function loadItemIndex() {
  if (ITEMS_IN) return Promise.resolve();
  ITEMS_IN = true;
  return getJSON(dataUrl("data/itemIndex.json")).then(function (blob) {
    var cats = (blob && blob.c) || [];
    var rows = (blob && blob.r) || blob || [];

    var pal = (blob && blob.p) || [];
    function palDid(n) { return n ? (pal[n - 1] || 0) : 0; }
    nameOf(0);
    var add = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var e = row && row.length !== undefined && row.i === undefined
        ? { i: row[0], n: row[1], t: "i", c: cats[row[2]] || "Item",
            k: row[3] || 0, h: 0 }
        : row;
      if (row && row.length > 4 && row.i === undefined) {

        var kl = [palDid(row[4]), palDid(row[5]), palDid(row[6]), palDid(row[7])];
        if (kl[0] || kl[1] || kl[2] || kl[3]) e.kl = kl;
      }

      if (BY_ID && BY_ID[e.i]) continue;
      e.f = fold(e.n);
      e.q = squash(e.f);
      add.push(e);
      if (BY_ID) BY_ID[e.i] = e;
    }
    INDEX = INDEX.concat(add);
    var sel = document.getElementById("fCat");
    var seen = {};
    Array.prototype.forEach.call(sel.options, function (o) { seen[o.value] = 1; });
    var extra = {};
    add.forEach(function (r) { if (r.c && !seen[r.c]) extra[r.c] = 1; });
    Object.keys(extra).sort().forEach(function (c) {
      var o = document.createElement("option");
      o.value = c;
      o.textContent = titleCase(c);
      sel.appendChild(o);
    });
    nameLatecomers();
    runSearch();
  }, function () { ITEMS_IN = false; });
}

function nameLatecomers() {
  var pend = document.querySelectorAll("[data-nameid]");
  for (var i = 0; i < pend.length; i++) {
    var node = pend[i];
    var meta = nameOf(parseInt(node.getAttribute("data-nameid"), 10));
    if (!meta) continue;
    node.removeAttribute("data-nameid");
    if (node.tagName === "IMG") node.src = iconUrl(meta.k);
    else node.textContent = meta.n;
  }
}

function pending(a, img, id) {
  a.setAttribute("data-nameid", id);
  if (img) img.setAttribute("data-nameid", id);
}

Promise.all([getJSON(dataUrl("data/meta.json")),
             getJSON(dataUrl("data/index.json")),
             enumLabelData()])
  .then(function (r) {
    META = r[0];
    INDEX = r[1];
    INDEX.forEach(function (e) { e.f = fold(e.n); e.q = squash(e.f); });
    BUCKETS = META.buckets || 128;
    if (META.levelCap) LEVEL_CAP = META.levelCap;
    document.getElementById("meta").textContent =
      [META.skills.toLocaleString() + " skills",
       META.effects.toLocaleString() + " effects",
       (META.traits || 0).toLocaleString() + " traits",
       (META.traceries || 0).toLocaleString() + " traceries",
       (META.essences || 0).toLocaleString() + " essences",
       (META.items || 0).toLocaleString() + " items",
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
    buildPrefsUI();
    migrateHash();
    runSearch();
    route();
    loadItemIndex();
  })
  .catch(function (err) {
    document.getElementById("detail").innerHTML =
      '<div class="empty"><h2>Could not load the data</h2><p>' + esc(err.message) +
      "</p><p>Browsers block <code>fetch()</code> from <code>file://</code>. " +
      "Run <code>serve.bat</code> (or <code>python -m http.server</code>) in this " +
      "folder and open <code>http://localhost:8000</code>.</p></div>";
  });

var timer;
var qbox = document.getElementById("q");
qbox.addEventListener("input", function () {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 90);
});
qbox.addEventListener("keydown", function (ev) {
  if (ev.key === "ArrowDown") { ev.preventDefault(); moveCursor(1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); moveCursor(-1); }
  else if (ev.key === "Enter") { ev.preventDefault(); openCursor(); }
  else if (ev.key === "Escape" && this.value) {
    this.value = "";
    runSearch();
  }
});

document.addEventListener("keydown", function (ev) {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var t = ev.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT" || t.isContentEditable)) return;
  ev.preventDefault();
  qbox.focus();
  qbox.select();
});
["fSkill", "fEffect", "fClass", "fTrait", "fTracery", "fEssence",
 "fSet", "fItem"].forEach(function (id) {
  var b = document.getElementById(id);
  b.onclick = function () {
    typeOn[b.dataset.t] = !typeOn[b.dataset.t];
    b.classList.toggle("on", typeOn[b.dataset.t]);
    b.setAttribute("aria-pressed", typeOn[b.dataset.t] ? "true" : "false");
    runSearch();
  };
});
document.getElementById("fCat").onchange = function () {
  catFilter = this.value;
  runSearch();
};

document.addEventListener("click", function (ev) {
  if (ev.defaultPrevented || ev.button !== 0) return;
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  var a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
  if (!a || a.target || a.hasAttribute("download")) return;
  var href = a.getAttribute("href");
  if (!href || href.charAt(0) === "#" || /^[a-z]+:/i.test(href)) return;
  var u;
  try { u = new URL(a.href); } catch (e) { return; }
  if (u.origin !== location.origin || u.pathname.indexOf(BASE) !== 0) return;

  if (/\.html$/.test(u.pathname)) return;
  ev.preventDefault();
  navigate(u.pathname);
});

function navigate(path, replace) {
  if (path !== location.pathname) {
    history[replace ? "replaceState" : "pushState"]({}, "", path);
  }
  route();
}

window.addEventListener("popstate", route);

function migrateHash() {
  var m = /^#\/(.*)$/.exec(location.hash || "");
  if (!m) return;
  history.replaceState({}, "", urlFor(m[1]));
}

var HOVER_DELAY = 180;
var HOVER_GAP = 14;
var HOVER = { box: null, token: 0, timer: null, key: null, x: 0, y: 0 };

function hoverRoute(a) {
  if (!a || a.target || a.hasAttribute("download")) return null;
  var href = a.getAttribute("href");
  if (!href || href.charAt(0) === "#" || /^[a-z]+:/i.test(href)) return null;
  var u;
  try { u = new URL(a.href); } catch (e) { return null; }
  if (u.origin !== location.origin || u.pathname.indexOf(BASE) !== 0) return null;
  var m = /^(skill|effect|trait|item)\/(\d+)$/.exec(u.pathname.slice(BASE.length));
  return m ? { kind: m[1], id: parseInt(m[2], 10) } : null;
}

function hoverSubject(node) {
  if (!node || node.nodeType !== 1) return null;
  var a = node.closest ? node.closest("a[href]") : null;

  if (a) return hoverRoute(a);
  if (node.tagName === "IMG" && node.parentElement) {
    return hoverRoute(node.parentElement.querySelector("a[href]"));
  }
  return null;
}

function hoverData() {
  return Promise.all([progressions(), classData(), modSources(),
                      sourceClasses(), gambitData(), propertyData(),
                      displayTypeData(), itemSetData(), stackingData(),
                      skillChannelData(), pipData(), comboFlagData()])
    .then(function (res) {
      SRC_CLASS = res[3] || {};
      GAMBITS = res[4] || {};
      PROPS = res[5] || {};
      DISPLAY_TYPES = res[6] || {};
      SETS = res[7] || {};
      STACKING = res[8] || {};
      CHANNELS = res[9] || {};
      PIPS = res[10] || {};
      COMBOFLAGS = res[11] || {};
      return { progs: res[0] || {}, D: res[1] };
    });
}

function hoverPanel(sub) {
  return hoverData().then(function (ctx) {
    var progs = ctx.progs, D = ctx.D;
    if (sub.kind === "trait") {
      var t = D && D.traits && D.traits[String(sub.id)];
      if (!t) return null;
      return preloadTraitEffects(t).then(function () {
        return traitTooltip(t, progs, D, preferredLevel(LEVEL_CAP),
                            traitMaxRank(t, progs));
      });
    }
    return loadRecord(sub.kind, sub.id).then(function (rec) {
      if (!rec) return null;
      if (sub.kind === "item") {
        return preloadItemTip(rec).then(function () {
          return itemTooltip(rec, progs, D);
        });
      }
      if (sub.kind === "effect") {
        return preloadEffectTip(rec).then(function () {
          return effectTooltip(rec, progs, D, preferredLevel(LEVEL_CAP));
        });
      }
      return preloadTipEffects(rec).then(function () {
        return tooltipPanel(rec, progs, preferredLevel(topLevel(rec, progs)));
      });
    });
  });
}

function hoverPlace() {
  var box = HOVER.box;
  var w = box.offsetWidth, h = box.offsetHeight;
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  var left = HOVER.x + HOVER_GAP;
  if (left + w > vw - 4) left = HOVER.x - HOVER_GAP - w;
  if (left < 4) left = Math.max(4, vw - w - 4);
  var top = HOVER.y + HOVER_GAP;
  if (top + h > vh - 4) top = HOVER.y - HOVER_GAP - h;
  if (top < 4) top = 4;
  box.style.left = Math.round(left) + "px";
  box.style.top = Math.round(top) + "px";
  box.classList.toggle("cut", box.scrollHeight > box.clientHeight + 1);
}

function hoverHide() {
  HOVER.token++;
  if (HOVER.timer) { clearTimeout(HOVER.timer); HOVER.timer = null; }
  HOVER.key = null;
  if (HOVER.box) {
    HOVER.box.hidden = true;
    HOVER.box.textContent = "";
    HOVER.box.classList.remove("cut");
  }
}

function hoverOpen(sub, token) {
  HOVER.timer = null;
  hoverPanel(sub).then(function (panel) {

    if (token !== HOVER.token || !panel) return;
    if (!HOVER.box) {
      HOVER.box = el("div");
      HOVER.box.id = "hovertip";
      HOVER.box.hidden = true;
      document.body.appendChild(HOVER.box);
    }
    HOVER.box.textContent = "";
    HOVER.box.appendChild(panel);
    HOVER.box.hidden = false;
    hoverPlace();
  }, function () {  });
}

if (window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.addEventListener("mouseover", function (ev) {
    var sub = hoverSubject(ev.target);
    if (!sub) { if (HOVER.key) hoverHide(); return; }
    var key = sub.kind + "/" + sub.id;

    if (key === HOVER.key) return;
    hoverHide();
    HOVER.key = key;
    HOVER.x = ev.clientX;
    HOVER.y = ev.clientY;
    var token = HOVER.token;
    HOVER.timer = setTimeout(function () { hoverOpen(sub, token); },
                             HOVER_DELAY);
  });

  document.addEventListener("mousemove", function (ev) {
    if (HOVER.key && (!HOVER.box || HOVER.box.hidden)) {
      HOVER.x = ev.clientX;
      HOVER.y = ev.clientY;
    }
  });
  document.addEventListener("mouseleave", hoverHide);
  document.addEventListener("click", hoverHide, true);

  document.addEventListener("scroll", hoverHide, true);
  window.addEventListener("blur", hoverHide);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hoverHide();
  });
}
