/* LOTRO skill and effect database - client. All data is static JSON under data/. */

/* Where this copy of the site is served from - the directory index.html sits
   in, taken from the script tag rather than guessed, so the same build works at
   a domain root, in a GitHub Pages project subpath, and on localhost.
   Everything the page fetches or links to is built on it. */
   
/* Site-wide banner */
(function () {
  var banner = document.createElement("div");
  banner.id = "banner";
  banner.innerHTML = 'This site is a work in progress and may contain mistakes. ' +
    'Join the Fridge Discord: <a href="https://discord.gg/TyyG5hnBbg" target="_blank" rel="noopener">https://discord.gg/TyyG5hnBbg</a>';
  document.body.insertBefore(banner, document.body.firstChild);
})();   
   
var BASE = (function () {
  var tag = document.querySelector('script[src*="app.js"]');
  var u = tag ? new URL(tag.getAttribute("src"), document.baseURI)
              : new URL(location.href);
  return u.pathname.replace(/[^/]*$/, "");
})();

/* Pages used to live behind "#/skill/123". A hash never reaches the server, so
   all 39,540 pages were one URL as far as a crawler was concerned. These build
   real paths instead; navigation is intercepted below and served from the data
   already in hand, so it is still a single-page app. */
function urlFor(route) { return BASE + String(route).replace(/^\/+/, ""); }
/* The same ?v=N the page already carries on app.js and style.css, put on
   every data file too. Without it a rebuild shipped new JSON to a reader who
   still had the old copy cached - the markup and the code updated, the data
   did not, and the page showed yesterday's answer with no way to tell. The
   number comes off this script's own tag, so refresh.py's existing bump
   invalidates the data as well. Icons are NOT versioned: an icon id names one
   immutable picture, and busting 14,000 of them every rebuild would be a lot
   of downloading for nothing. */
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

/* A static host has no rewrite rule, so a deep link like /skill/123 is served
   by 404.html, which bounces it back here as "/?/skill/123". Put the real path
   back now - after this document's own relative URLs (style.css, app.js, the
   icon) have already been resolved against the un-rewritten address, and
   before anything reads the route. */
anchorStaticLinks();

(function () {
  var q = location.search;
  if (q.indexOf("?/") !== 0) return;
  var parts = q.slice(2).split("&");
  var path = parts.shift().replace(/~and~/g, "&");
  history.replaceState({}, "", BASE + path +
    (parts.length ? "?" + parts.join("&") : "") + location.hash);
})();

/* Any link written in index.html rather than built here. A relative href is
   resolved against the document's current address every time it is read, and
   this app changes that address on every navigation - so "classes" sitting in
   the markup meant /effect/123 -> /effect/classes. Anchoring them on BASE once
   at boot makes them behave like every link the app builds itself. */
function anchorStaticLinks() {
  var links = document.querySelectorAll("a[data-route]");
  for (var i = 0; i < links.length; i++) {
    links[i].href = urlFor(links[i].getAttribute("data-route"));
  }
}

/* The part of the address this app routes on. */
function routePath() {
  var p = location.pathname;
  try { p = decodeURIComponent(p); } catch (e) { /* keep it raw */ }
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

/* The landing block is written in index.html and is destroyed the first time
   a detail page is drawn over it. Hold on to the original node so the front
   page can be put back: the old code called location.reload() instead, which
   threw away every data file the session had cached. */
var LANDING = document.getElementById("landing");

/* ---------------- data loading ---------------- */

function getJSON(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error(url + ": " + r.status);
    return r.json();
  });
}

/* Cache a fetch by key, but never cache a FAILURE. Storing the fallback for
   a rejected request left a whole 128-record shard reading "no such effect"
   until the page was reloaded; forgetting the key instead lets the next visit
   try again. */
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
  // kind is "skill" or "effect"; raw picks the pruned-property shard
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
/* What switches each combo gate flag on. A combo row names the flag it waits
   on - Fulgurant Strike's blue version wants BlueLine - and the flag name on
   its own only moves the question along one step, so this says which trait,
   effect, set or tracery puts it there. */
function comboFlagData() { return sideFile("comboFlags"); }
function skillChannelData() { return sideFile("skillChannels"); }
var CHANNELS = null;
var STACKING = null;
var SETS = null;
var COMBOFLAGS = null;
function propertyData() { return sideFile("properties"); }
/* Which effects a world property switches on - the reverse of an effect's
   "Put on you by world state" block. A world property is not a modifier
   property, so without this its page said only "nothing grants or reads
   this" and the link the effect page offers led nowhere. */
function worldStateData() { return sideFile("worldStates"); }
var WORLD_STATES = null;
function displayTypeData() { return sideFile("displayTypes"); }

/* An enum value arrives as its internal token name - "Fervor", "Magic" - and
   the client prints something else: the log string on the enum's own mapper,
   which is localised and British-spelt. normalize.py ships every one of those
   that differs, keyed by the field the value lands in, so nothing here has to
   know which enum a field came from and no word is spelled out in this file.
   A field with no label, or a value the enum has no log string for, keeps the
   name it arrived with. */
var ENUM_LABELS = null;
function enumLabelData() {
  return sideFile("enumLabels").then(function (m) { ENUM_LABELS = m; return m; });
}
function enumWord(field, value) {
  if (typeof value !== "string") return value;
  var t = ENUM_LABELS && ENUM_LABELS[field];
  return (t && t[value]) || value;
}

/* PropertyMetaData, as the client sees it: the label a tooltip prints for a
   game property and whether the number is a percentage. DISPLAY_TYPES is the
   same idea for the "Skill Type:" line. EFFECT_CACHE holds the few effect
   records the tooltip needs to expand inline. */
var PROPS = null;
/* The modifier-source index, kept global so a tooltip line can name the trait
   that improves it without every caller threading it down. */
var MODSRC = null;
var DISPLAY_TYPES = null;
var EFFECT_CACHE = {};

/* A tooltip quotes the effects the skill applies, and chanceBlock below it
   reports which of them carry no application chance of their own. Both read
   EFFECT_CACHE, so every effect either could name has to be in hand before the
   page is drawn. Loading only the first six of three of the slots meant
   chanceBlock silently skipped effects on 79 skills - and, because the cache
   is never cleared, gave a different answer depending on what had been browsed
   before. A skill names at most ten distinct effects, so this stays bounded. */
function preloadTipEffects(s) {
  var ids = {};
  (s.attacks || []).forEach(function (a) {
    ["targetEffects", "positionalEffects", "superCritEffects"].forEach(function (k) {
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
  // A carrier's payload is what the panel actually prints, so it has to be in
  // hand too - one level down, which is as deep as the client goes. A combo
  // router's untraited branch is printed at the same depth, for the same
  // reason - see comboBaseBranch.
  return fetchAll(Object.keys(ids)).then(function () {
    var deeper = {}, branches = {};
    Object.keys(ids).forEach(function (id) {
      var e = EFFECT_CACHE[id];
      if (!e) return;
      if (carrierLines(e)) {
        (e.nested || []).forEach(function (n) { deeper[n.id] = 1; });
        return;
      }
      (e.nested || []).forEach(function (n) {
        if (isOverTimeVia(n.via) || isExpireVia(n.via) ||
            isReactiveVia(n.via)) deeper[n.id] = 1;
        if (n.via === COMBO_BASE_VIA) { deeper[n.id] = 1; branches[n.id] = 1; }
      });
    });
    return fetchAll(Object.keys(deeper)).then(function () {
      // A router's branch is drawn as if the skill applied it directly, so
      // where the branch is ITSELF a carrier its payload is one further step
      // away and has to be in hand too. Only branches go this deep: the set
      // is small, and a carrier's payload never needs a third level.
      var third = {};
      Object.keys(branches).forEach(function (id) {
        var b = EFFECT_CACHE[id];
        if (!b) return;
        var wrapper = !!carrierLines(b);
        (b.nested || []).forEach(function (n) {
          if (wrapper || isOverTimeVia(n.via) || isExpireVia(n.via)) {
            third[n.id] = 1;
          }
        });
      });
      return fetchAll(Object.keys(third));
    });
  });
}

/* The same one level down, for an EFFECT's own page. Nothing was preloaded
   there at all, because until over-time groups the effect panel never quoted
   anything but the effect's own fields. */
function preloadEffectTip(e) {
  var want = (e.nested || []).filter(function (n) {
    return (isOverTimeVia(n.via) || isExpireVia(n.via) ||
            isReactiveVia(n.via)) && !EFFECT_CACHE[String(n.id)];
  });
  return Promise.all(want.map(function (n) {
    return loadRecord("effect", n.id).then(function (rec) {
      if (rec) EFFECT_CACHE[String(rec.id)] = rec;
    });
  }));
}

/* A trait's rank block quotes the effects it applies - "On every Swordplay
   Critical Hit: / -1s Haversack Skills Cooldown" is A Watched Pot's whole
   rank 1, and it lives on the effect, not on the trait's own modifiers. The
   wording is often one level down (a proc carries the header, its nested
   effect carries the line), so the chain is walked, not just the first hop. */
/* Which nested links mean "and this is applied too". A tier-up ladder is a
   sequence of alternatives, not a list of things that all happen, and flatten-
   ing one into a rank block printed Furious Storms as +5/+10/+15/+20/+25% at
   every rank at once. Countdown expiry, combos and on-removal are conditional
   in the same way. Only the generator lists are unconditional. */
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

/* The Warden builds a gambit by pressing builders in order, and the tooltip
   shows the sequence as icons. The Burglar's Razor Wit line works the same way
   with its own four. GAMBITS maps the packed code to the builder it names. */
var GAMBITS = null;
/* The class resources, keyed by Skill_Pip_AffectedType. Fervour and the rest
   just count up; Attunement and Balance swing either side of a home value and
   carry an icon for each end. */
var PIPS = null;

/* The client shows a gambit as a bare row of builder icons after a green
   "Requires:" - no names, no arrows. The order is the press order; the name is
   on hover and the icon links to the builder. */
function gambitRow(steps, label) {
  if (!steps || !steps.length || !GAMBITS) return null;
  var box = el("div", "gambit");
  if (label) box.appendChild(el("span", "gl", label + ":"));
  steps.forEach(function (code, i) {
    var g = GAMBITS[String(code)];
    // href="#" would route to the landing page; an unknown builder is not a link
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

/* The same question asked the other way round: only records POSITIVELY known
   to belong to one of these classes. Used where a list is an answer to "what
   does MY trait scale" rather than a catalogue - Foe of the Darkness is a
   Warden trait, and Distraction, Swarm of Bees, Bastion of Light and One Trap
   are unattributed or monster effects that nothing places anywhere. Waving
   them through because nothing contradicts them made the list wrong; hiding
   them with a count and a way back does not. */
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

/* A property name used to be inert text. It is the hub of the whole dataset -
   everything that grants it and everything that reads it hangs off it - so it
   is a link to its own page now. Kept looking like code, because it is. */
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
  // 39 strings open a colour and never close it - Sacrifice's whole wording is
  // "<rgb=#00FFDD>If you fall below 1% morale..." with no </rgb>. Requiring
  // the pair printed the opening tag as text, so the close is optional and an
  // unclosed colour simply runs to the end.
  // 37 tags in the data are malformed - "<rgb=#66fff>", five digits - so the
  // digit count is not the thing that decides whether this is markup. Anything
  // that is not a real hex colour keeps its text and drops the colour.
  var re = /<rgb=#([0-9a-fA-F]{1,8})>([\s\S]*?)(?:<\/rgb>|$)/gi;
  var at = 0, m;
  function plain(t, colour) {
    // a stray close with no open is scaffolding, not content
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
  // strip trailing zeros only after a decimal point - the old pattern turned
  // toFixed(0) of 30.000001 ("30") into "3"
  return s.indexOf(".") === -1 ? s
       : s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/* A whole game number, written the way the game writes it: 7800, not 7,800.
   These used to carry thousands separators, which is not what the client
   does on a tooltip - "+7,800 Tactical Mitigation" should read "+7800". The
   separators that remain are on COUNTS of records (the results total, the
   sidebar tally), which are the site's own numbers rather than the game's. */
function num(n) {
  return typeof n === "number" ? String(Math.round(n)) : fmt(n);
}

/* The client writes anything over a minute in minutes and seconds: 60s is
   "1m", 120s is "2m", 81s is "1m 21s". Under a minute it stays in seconds.
   The same step repeats upwards, because 216 cooldowns and durations run past
   an hour and the Scribe Manuals sit at ten days - "14400m" is not a reading
   of anything. Only the whole next unit down is shown, so nothing grows a
   third term. */
function secs(n) {
  if (n === undefined || n === null) return "-";
  if (typeof n !== "number" || !isFinite(n) || n < 60) return fmt(n) + "s";
  var STEPS = [[86400, "d", 3600, "h"], [3600, "h", 60, "m"], [60, "m", 1, "s"]];
  for (var i = 0; i < STEPS.length; i++) {
    var big = STEPS[i][0];
    if (n < big) continue;
    var whole = Math.floor(n / big);
    var rest = n - whole * big;
    // Seconds keep their fraction ("2m 5.5s"); hours and days are read to a
    // whole minute or hour, so nothing prints "1h 1.02m".
    var sub = STEPS[i][2] === 1 ? fmt(rest) : Math.floor(rest / STEPS[i][2]);
    if (!rest || !sub) return whole + STEPS[i][1];
    return whole + STEPS[i][1] + " " + sub + STEPS[i][3];
  }
  return fmt(n) + "s";
}

/* The client writes internal names as Underscore_CamelCase with acronyms mixed
   in. Splitting on every lowercase-uppercase boundary turns "AoE" into "Ao E",
   so known acronyms are passed through whole. */
var ACRONYMS = {
  AoE: 1, AOE: 1, DoT: 1, HoT: 1, DPS: 1, HPS: 1, NPC: 1, AI: 1, UI: 1,
  PvP: 1, PvMP: 1, MP: 1, MC: 1, LI: 1, FM: 1, CC: 1
};

/* An internal enum name as words: "MeleeDPS" -> "Melee DPS". Runs of capitals
   stay together, so DPS does not become D P S. */
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

/* ---------------- search ---------------- */

var typeOn = { s: true, e: true, c: true, y: true, z: true, g: true, r: true,
               i: true };
var catFilter = "";

/* "Fleche" should find "Fleche" with the accent. Strip combining marks so the
   comparison ignores diacritics entirely. */
function fold(str) {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/* The same name with every space, hyphen and apostrophe taken out. LOTRO names
   are full of punctuation nobody wants to reproduce - Shield-taunt, Wizard's
   Frost, Ranged Skill: Swift Bow - so "shieldtaunt" and "shield taunt" both
   have to find the same skill. Runs on an already-folded string. */
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

/* Description text, fetched the first time anybody searches. 1.4MB is far too
   much to put in front of first paint, and most visits never need it - but
   name-only search misses most of what a player actually asks for ("which
   skills mention bleed"). */
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

/* "s:" or "skill:" in front of a query means only that kind, for this query
   alone - quicker than reaching for the filter buttons and back again. */
var TYPE_WORDS = {
  s: "s", skill: "s", skills: "s",
  e: "e", effect: "e", effects: "e",
  c: "c", "class": "c", classes: "c",
  r: "r", trait: "r", traits: "r",
  y: "y", tracery: "y", traceries: "y",
  z: "z", essence: "z", essences: "z",
  g: "g", set: "g", sets: "g",
  // "i:" was missing while an Items filter button sat right there, so i:sword
  // searched for the literal string "i:sword" and silently found nothing.
  i: "i", item: "i", items: "i",
  p: "p", prop: "p", property: "p", properties: "p"
};

/* "p:" is not a type in the index - nothing in it has t === "p" - so every
   property search returned nothing at all, quietly, while 3,294 property
   pages sat in the sitemap with no way to reach them by name. The names live
   in modSources.json, which the property page loads anyway. */
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

/* An id can be typed either way round. Every page prints both forms in its
   header ("skill 1879049328 / 0x70000470"), and pasting either back into the
   box used to find nothing at all.

   "70000470" is ambiguous - decimal and hex are both readings - so both are
   offered and whichever one names a real record wins. */
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
  // Always worth trying, even when the query itself has no punctuation: the
  // point is to reach names that do. Only a query that is nothing but
  // punctuation has no squashed form to match with.
  var qs = squash(q) || null;
  var numeric = idsFromQuery(q);
  var out = [];
  var byText = [];
  // A class picked in the sidebar narrows every list on the site - but only
  // once the attribution index is in hand. Without that guard, a filter
  // restored from a previous visit rejected everything on the first paint,
  // because belongsTo cannot say yes to anything before SRC_CLASS loads.
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
      // failing that, try it with the punctuation taken out of both sides. A
      // shade worse than the literal hit, so exact typing still wins a tie.
      if (qs !== null) {
        var s2 = score(r.n, qs, r.q);
        if (s2 >= 0 && (s < 0 || s2 + 0.25 < s)) s = s2 + 0.25;
      }
      if (s < 0) {
        // no name match: the description is the second place to look
        var T = searchText();
        if (T && q.length >= 3) {
          var blob = T[String(r.i)];
          if (blob && blob.indexOf(q) >= 0) byText.push([r.x ? 1 : 0, r]);
        }
        continue;
      }
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
    var img = el("img");
    img.src = iconUrl(r.k);
    img.loading = "lazy";
    img.alt = "";
    img.onerror = function () { this.style.visibility = "hidden"; };
    var txt = el("div", "txt");
    txt.appendChild(el("div", "nm", r.n));
    var kindWord = r.t === "s" ? "Skill" : r.t === "e" ? "Effect"
                 : r.t === "y" ? "Tracery" : r.t === "z" ? "Essence"
                 : r.t === "g" ? "Set" : r.t === "r" ? "Trait"
                 : r.t === "i" ? "Item" : "Class";
    // a category that just repeats the kind ("Set - Set") says nothing twice
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

/* Arrow keys move through the results and Enter opens one, so a search can be
   finished without leaving the keyboard. */
var CURSOR = -1;
function moveCursor(step) {
  var rows = document.querySelectorAll("#results .row");
  if (!rows.length) return;
  CURSOR += step;
  if (CURSOR < 0) CURSOR = rows.length - 1;
  if (CURSOR >= rows.length) CURSOR = 0;
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("cur", i === CURSOR);
  // not every engine has it, and a missing scroll is never worth an exception
  if (rows[CURSOR].scrollIntoView) rows[CURSOR].scrollIntoView({ block: "nearest" });
}
function openCursor() {
  var rows = document.querySelectorAll("#results .row");
  var row = rows[CURSOR] || rows[0];
  if (row) navigate(new URL(row.href).pathname);
}

/* ---------------- progression chart ---------------- */

/* Progression arrays are a fixed-width table, so a curve with 5 real values is
   stored as 5 values and 155 zeros. Plotting the padding is misleading, and so
   is the tail of a curve that has stopped moving - a trait with three real
   ranks stores rank 3's value another 157 times. Cut both, keeping the first
   entry that reaches the final value, and remember how far the stored table
   ran so a caption can say the value holds. */
function trimPadding(pts) {
  // 20 progressions hold lists of trait NAMES rather than numbers, so nothing
  // survives the numeric filter above and there is no curve to trim. Reading
  // pts[-1] here took the whole page down.
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

/* The client ships curves running to level 170, past the level anyone can
   reach. Showing that tail invites reading a number nobody can have, so a
   level curve stops at the cap - keeping the value AT the cap by interpolating
   a point there when the stored curve steps straight over it. Curves indexed
   by something other than level (trait rank, item level) are left alone. */
/* Set from meta.json at boot - the extractor owns it now, so a cap raise is a
   rebuild rather than a code change. The literal is only the fallback for a
   meta.json written before the field existed. */
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
    // one point per rank, each read at the level the reader has chosen
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
  // nothing numeric in it - there is no curve, and every caller treats a null
  // the same way it treats one it cannot draw
  if (!pts.length) return null;
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
  // Forcing the baseline to zero flattened every curve living in a narrow band
  // - a crit multiplier going 1.0 to 1.15 drew as a horizontal line. Keep zero
  // where the data comes near it anyway, and otherwise show the band.
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
       : t === "g" ? "set" : t === "r" ? "trait"
       : t === "i" ? "item" : "class";
}

/* Built once at boot. This was a linear scan over all 39,540 index entries,
   run once per link rendered and twice per comparison in every sort. */
var BY_ID = null;
function nameOf(id) {
  if (!BY_ID) {
    BY_ID = {};
    for (var i = 0; i < INDEX.length; i++) BY_ID[INDEX[i].i] = INDEX[i];
  }
  return BY_ID[id] || null;
}

/* Traits have their own list rather than linkList's, because the class data
   carries the rank and level a trait is earned at and the index does not. */
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

/* A nested reference carries the raw property key it was found under -
   "Effect_ApplyOverTime_Applied_Effect_Array". The prefix and the Array/List
   suffix are scaffolding; what is left is the route, and that is worth
   reading. A merged reference carries several, comma separated. */
function viaLabel(via) {
  return String(via).split(", ").map(function (one) {
    return spaceWords(one.replace(/^Effect(Generator)?_/, "")
                         .replace(/_(Array|List)$/, ""))
      .replace(/\bEffect List\b/, "effects")
      .toLowerCase();
  }).join(", ");
}

/* ---------------- why a combo is open ---------------- */

/* A combo row carries the flags it waits on. The client keeps them in a
   bitfield named per class - Combat_Brawler_SkillCombo, Combat_Warden_
   SkillCombo, and three that are not class-named at all - and a skill offers
   the chain only while the named flags are set on the player.

   Naming the flag was never going to be enough on its own: "combos into
   Fulgurant Strike while BlueLine" just moves the question along one step.
   comboFlags.json closes it - BlueLine is what the trait The Fulcrum ORs into
   ForwardSource_Combat_Brawler_SkillCombo, so the line can name the trait. */
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

/* "Dissonance from Dissonance" is not an answer, it is an echo: the flag and
   the effect that sets it are often one name. Compared loosely because the
   flag is an internal token and the record is prose - Itemset_Call_to_
   Greatness_Two against "Call to Greatness". */
function sameWords(a, b) {
  return String(a).toLowerCase().replace(/[^a-z0-9]/g, "")
      === String(b).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* One flag: what it is called, and - where the data knows - what puts it on
   you. Flags like DualWield and Stealthed are states the client works out for
   itself and no record sets them, so the name stands alone rather than the
   line pretending to an answer it does not have. */
function comboFlagNode(prop, flag) {
  var span = el("span", "comboflag");
  var label = spaceWords(flag);
  var src = comboFlagSources(prop, flag);
  // one source, named the same as the flag: the name becomes the link rather
  // than being printed twice with "from" between the copies
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
  // two sets can share a name - Call to Greatness is two of them - and the
  // site's habit is to trail the id rather than print one name twice
  var dup = ambiguousNames(src.ids);
  span.appendChild(linkRun(src.ids.map(function (id) {
    return function () {
      var meta = nameOf(id);
      return meta ? readerLink(id, routeFor(meta.t), null, dup) : null;
    };
  }), COMBO_SRC_SHOWN, src.more ? src.more + " more not listed" : 0));
  return span;
}

/* `when` is a list of alternatives - any one of them opens the chain - and
   each alternative is a list of [gate property, flags] pairs whose flags are
   all required together. normalize.py has already dropped the alternatives a
   weaker one covers, so every line here is a way in that the others are not. */
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
  // Four distinct skills apply a Warden Morale-tap and they share two names
  // between them; printed plain, the list reads as each one listed twice.
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

    // the row, not just the id: two combo rows can name one skill and differ
    // only in the flags that open them, and an id alone cannot tell them apart
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
        a.href = urlFor("tracery/" + tid);
        return a;
      };
    }), 4, 0));
    return line;
  };
}

function section(host, title, node) {
  if (!node) return;
  // an empty <ul>, or a table with nothing under its header row, means there
  // was nothing to show after all
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
    ["Traceries", usesGear(ownerClasses(s), D) ? skillTraceries(s, MS) : null, "wide"]
  ]));

  // what the skill does comes first; where it comes from is reference
  if (D) section(host, "How you get it", obtainedBlock(s, D));
  // "Granted by" is the effect page's wording; on a skill an item can also be
  // the thing that bars it, so the heading has to cover both.
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
      // the modifier cell holds links, so it is built rather than templated
      tr.cells[4].appendChild(linkRun((c.mods || []).map(function (m) {
        return function () { return propCode(m); };
      }), 6, 0));
      t.appendChild(tr);
    });
    section(host, "Cost", t);
    // No chart for the cost curve. 4,529 skills carry one - 4,187 of them
    // Power, 340 war-steed Power, 2 Morale - and a rising line of power cost
    // is not something a reader ever needed drawn: the panel above already
    // resolves the actual cost at their level, and the level box moves it.
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
   ["toggleUserEffects", "Toggle effects on you"],
   ["critEffects", "Critical effects"],
   ["critEffectsAdditive", "Critical effects (additive)"],
   ["requiredEffects", "Requires these effects"],
   ["barringEffects", "Barred by these effects"],
   ["consumedEffects", "Requires and consumes these effects"]].forEach(function (pair) {
    if (s[pair[0]]) {
      section(host, pair[1], linkList(s[pair[0]], "effect", traceryLine(ET, gearOk)));
    }
  });

  // Both directions. A combo is stored only on the skill that opens it, so
  // without the reverse the far half of every chain looked like it combined
  // with nothing - Desperate Shield and Desperate Fist said nothing about
  // Desperate Spear, which is the only way into them.
  if (s.combos) section(host, "Combos into", linkList(s.combos.map(function (c) {
    return { id: c.skill, via: c.mode, when: c.when };
  }), "skill", comboWhy));
  if (s.comboFrom) {
    section(host, "Combos from", linkList(s.comboFrom.map(function (c) {
      return { id: c.skill, via: c.mode, when: c.when };
    }), "skill", comboWhy));
  }

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
    ["Duration", e.permanent ? "permanent"
                             : (totalDur !== null ? secs(totalDur) : null)],
    ["Pulses", e.pulseCount ? e.pulseCount + " (every " + secs(e.interval) + ")"
                            : null],
    // an effect with no chance of its own says what has to supply one - the
    // tooltip leaves this out, the way the client does
    ["Probability", (e.probability !== undefined && e.probability < 0.999)
      ? fmt(e.probability * 100, 1) + "%" : null],
    // the property is ADDITIVE, so on an effect that already has a chance of
    // its own it adds to it rather than being the whole of it
    [e.probability ? "Chance added to by" : "Chance granted by",
     chanceSource(e), "wide"],
    ["Resist", resistNames(e.resistCategory)],
    // Effects sharing an equivalence class do not stack with one another.
    // Naming the class was as far as this went; what a player is asking is
    // "so what else is in it", which is now one click away.
    // "does not stack with" is wrong for a class that holds more than one
    [(STACKING && stackMax(STACKING[e.equivalence]) > 1)
      ? "Stacks up to " + stackMax(STACKING[e.equivalence]) + ", with"
      : "Does not stack with",
     stackLink(e.equivalence, e.id), "wide"],
    // which rung of that class this one is: an Aegis - 1 and an Aegis - 5
    // share a slot and are not interchangeable
    ["Class priority", (e.equivalence && typeof e.classPriority === "number")
      ? e.classPriority : null]
  ]));

  section(host, "Stat modifiers",
          grantsBlock(e.stats, MS, progs, "Level", D, owners, true));

  if (D && MS) section(host, "Modifiers", modsBlock(e, D, MS));

  // A cooldown effect names recovery channels - internal groupings like
  // "ClassSkillLine_29" - and printing those said nothing. These are the
  // skills on them.
  //
  // The channels are NOT class-scoped in the data: ClassSkillLine_19 holds 23
  // Captain skills and one Burglar one. The game resolves a channel against
  // the caster's own skills, so the raw list is mostly other people's. Scope
  // it to whoever can actually get this effect.
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
      // no owner class, or nothing attributable: scoping has no basis, so
      // showing everything beats showing nothing
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
  // The other three things a nested reference can mean. These used to be
  // listed as applications, which said the opposite of the truth: a
  // protection effect claimed to cast the very effect it blocks.
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
  // ...and the same three relationships seen from the other end. "What stops
  // this landing on me" is the more useful direction, and only the effect
  // doing it used to know the relationship existed at all.
  [["preventedBy", "Prevented by these effects"],
   ["removedBy", "Removed by these effects"],
   ["checkedBy", "Checked for by these effects"]].forEach(function (pair) {
    if (e[pair[0]]) section(host, pair[1], linkList(e[pair[0]], "effect"));
  });
  // The same "Effect*" keys also name skills and traits. They used to be
  // listed as effects, which sent the reader to a page that does not exist.
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
  // Skills that reach this effect through another effect. A Warden Morale-tap
  // is applied by an over-time effect, and THAT is what the four skills cast,
  // so without this the tap's page named no skill at all.
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
  // Skills that relate to this effect WITHOUT applying it. Listing these
  // under "applied by" claimed a skill casts the effect that blocks it.
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
  a.href = urlFor("trait/" + (t ? t.id : 0));
  li.appendChild(a);
  if (extra) li.appendChild(el("span", "via", extra));
  return li;
}

/* A skill's provenance, rendered from the skill's own `obtained` list. */
/* Which classes can reach a trait, and by which of the four routes: a cell in
   one of the class's trees, a branch's specialization trait, a branch's
   set-bonus trait, or the class's own level/rank table. The last two matter
   most - a specialization trait and a set-bonus trait sit in no tree cell and
   on no level table.

   This is THE answer to "is this still a class trait", so the trait page's
   "Available to" and the skill page's "How you get it" both ask it here rather
   than each deciding for itself. */
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
    // Monster-play classes advance by RANK, not level, and 687 of the 982
    // class trait entries carry no level at all - so every creep trait page
    // read "Available to / Stalker / level undefined". A trained trait that
    // also sits in a tree keeps the tree wording as well; overwriting it threw
    // away the more useful half.
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
  /* A class trait removed from the game still names the skill it used to
     grant. Heart Seeker offered two Hunter traits and only one of them is in
     the Hunter's tree; the other is a pre-revamp trait no Hunter can take. The
     trait page already declines to name a class for it - its "Available to"
     is empty - so the skill page claiming "Hunter - from trait Heart Seeker"
     was the two pages contradicting each other on the same question.

     Only rows that NAME a class are checked. War-steed, racial, Big Battle
     and characteristic traits are not class traits, sit in no class tree, and
     keep their rows. 9 rows go, across 9 skills, every one a Class_Burglar or
     Class_Hunter trait from before the trait trees. */
  var rows = s.obtained.filter(function (o) {
    if (o.how !== "trait" || !o["class"] || !D || !D.classes) return true;
    return classRoutesToTrait(o.trait, D).some(function (pair) {
      return pair[0].id === o["class"];
    });
  });
  if (!rows.length) return null;

  /* A row that names no class is often not classless at all. Every one of the
     56 specialization rows is a trait exactly one class can take - Come At Me
     comes from The Fulcrum, which only a Brawler has - and the row carried the
     tree, the branch and the cell but no class, so it rendered with nothing
     where the class belongs: " - from trait The Fulcrum". The class is
     derivable from the trait, so derive it.

     Only where the answer is unambiguous. The war-steed, racial, Big Battle,
     characteristic and set-bonus rows reach no class at all, and a trait two
     classes could take would be a guess; both keep no class. */
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
    // the dash joins the class to what follows it, so with no class there is
    // nothing for it to join and the line starts on the wording itself
    var lead = cls ? " - " : "";
    if (o.how === "level") {
      li.appendChild(el("span", null, lead + "trained at level " + o.level));
    } else if (o.how === "rank") {
      li.appendChild(el("span", null, o.rank ? lead + "earned at rank " + o.rank
                                             : lead + "available from the start"));
      // MonsterPlay_SkillCost is a destiny-point price, and destiny points are
      // no longer part of monster play - the number is still in the DAT but it
      // is not something a reader can spend, so it is not shown.
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

/* The shown branch name ("The Quiet Knife") comes from the enum's localised
   log_strings and is resolved at extraction time. Fall back to the tail of the
   internal key ("Class_Specialization_Burglar_Two") if it is ever missing. */
function branchName(key, name) {
  if (name) return name;
  if (!key) return "";
  var parts = String(key).split("_");
  return parts[parts.length - 1];
}

/* Every cell carries its position in the tree as "row_col", and the page was
   throwing that away to print a flat list - the one thing a trait tree IS is a
   shape. Laid out on a grid it reads the way it does in the client. A tree
   whose cells are not row_col (the war-steed trees use their own scheme) falls
   back to the list. */
function traitGrid(cells, D) {
  var placed = cells.filter(function (c) { return /^\d+_\d+$/.test(c.cell || ""); });
  if (placed.length !== cells.length || !placed.length) {
    var ul = el("ul", "links");
    cells.forEach(function (cell) {
      ul.appendChild(traitLink(D.traits[String(cell.trait)], "cell " + cell.cell));
    });
    return ul;
  }
  // A cell's position is its place in the WHOLE tree, and each branch owns a
  // slice of it - the three branches sit in columns 1-4, 5-8 and 9-12. Using
  // those numbers directly built a twelve-column grid per branch and dropped
  // the third one's traits into the last four, hard right and a twelfth of the
  // width each. Every branch is drawn on its own axes instead.
  var minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;
  placed.forEach(function (c) {
    var q = c.cell.split("_");
    var r = parseInt(q[0], 10), k = parseInt(q[1], 10);
    minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, k); maxCol = Math.max(maxCol, k);
  });
  var cols = maxCol - minCol + 1;
  var grid = el("div", "ttree");
  // fixed tracks, not fractions: a cell has a name in it and should be the
  // same size whatever the panel width happens to be
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
    // The creep table's third column held the destiny-point cost, which the
    // game no longer has; with nothing to put there the column goes too.
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
      // The branch heading IS a trait - the specialisation you take to commit
      // to the line - and it was the one thing on this page with no way into
      // it. Its own page carries the numbers.
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
      // Specialising in a line hands you skills outright. They sit on the
      // specialisation trait, which is in no tree cell and no set bonus, so
      // nothing on this page mentioned them at all.
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

      // a line you cannot specialize in awards no set bonuses, whatever
      // specialization progression the data leaves pointing at it
      if (br.noSetBonuses) {
        var nb = el("div", "muted");
        nb.style.cssText = "font-size:11.5px;margin-top:6px";
        nb.textContent = "This line cannot be specialized in, so it has no "
          + "set bonuses.";
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
      // the specialisation trait itself - 30 of the 36 branches grant skills
      // this way, and none of them were reaching this table
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

  // The wording used to sit here as loose paragraphs; it belongs in the panel,
  // the way it does on a skill and an effect page.
  var maxRank = traitMaxRank(t, progs);
  var tlvl = preferredLevel(LEVEL_CAP);
  var tipWrap = el("div");
  function drawTraitTip() {
    tipWrap.textContent = "";
    tipWrap.appendChild(traitTooltip(t, progs, D, tlvl, maxRank));
    if (!traitUsesRank(t, progs)) return;
    // Every rank is on the panel already; what is left to choose is the
    // character level those ranked curves are read at.
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
  // a trait's Mod_Progression is indexed by the trait's RANK, not by level
  // Scoped to the classes that can actually reach this trait. Foe of the
  // Darkness is a Warden trait, and its Light Damage property is read by
  // every class's light skills - so the unscoped cell answered "what does
  // this trait scale" with a list of Minstrel cries.
  section(host, "What it changes",
          grantsBlock(t.stats, MS, progs, "Rank", D, ownerClasses(t), true));

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
  // A trait can supply a skill's conditional effects directly, the same way an
  // effect can. Nothing in the live data does - all 549 grantors are effects -
  // but normalize writes the field either way, so the page reads it either way
  // rather than silently dropping one.
  section(host, "Effects it adds to other skills", enablesBlock(t));
  // Which classes reach this trait, and by which of the four routes - the
  // same question the skill page asks before it will call something a class
  // trait, so both pages read it off one function.
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

/* A skill's *_Mod_Array names PROPERTIES, not sources - "this multiplier is
   scaled by Corsair_Positional_Bonus". This resolves each property back to the
   traits and effects that actually grant it, which is the part a player wants. */
/* Render every link, hide the overflow, and let "+N more" reveal it. A count
   with no way to see what it counts is just a tease. */
function linkRun(items, limit, notListed) {
  var frag = document.createDocumentFragment();
  var hidden = [];
  // Count what is actually emitted, not what was offered: a maker returns null
  // when its target is missing from the dataset, and keying the separator and
  // the limit off the offered index put a leading ", " on such a list and let
  // a skipped item consume a visible slot.
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

/* "a Warden", "Reaver or Defiler" - how a scoped page names whose page it is. */
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

/* The other direction from modsBlock: a trait or effect says which properties
   it grants, and this shows what those properties actually scale - across
   skills, and across other effects and traits, which read them through
   Mod_ModifierList. */
function grantsBlock(stats, MS, progs, xLabel, D, only, ownScope) {
  if (!stats || !stats.length) return null;
  var wrap = el("div");
  // ownScope says `only` is "the classes this record BELONGS to", which is
  // what makes hiding the unattributed correct. A tracery or item set passes
  // every Free Peoples class instead - a scope that means "not monster play",
  // not "mine" - and there the lenient filter is still the right one.
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
    // the tooltip above prints "Incoming Healing"; this table printed only
    // Combat_IncomingHealing_Modifier_Current, which is the same thing said
    // in a language nobody speaks
    var pmeta = PROPS && PROPS[st.stat];
    if (pmeta && pmeta.n) td0.appendChild(el("div", "plabel", pmeta.n));
    td0.appendChild(propCode(st.stat));
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
      // an "Or" switches named flags on; the names are the whole modifier
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

  // The escape hatch. Hiding the unattributed is right for the question this
  // table answers, but a reader chasing an odd property should still be able
  // to see everything that touches it.
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

/* Everything that reads a property: skill values, and other effects and traits
   that scale one of their own modifiers by it. */
/* Six different effects in this dataset are called "Healing". Printed as a
   run of identical links they read as one thing repeated, so where a name is
   ambiguous inside a single run the id is shown after it - these ARE distinct
   records, unlike the same-id repeats collapsed below. */
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
  // On a class-scoped page an unattributed record is not a maybe, it is
  // noise - so `strict` demands a positive match. Turning it off shows
  // everything, not the old lenient filter: "show all" that still hid the
  // other classes was a lie in a link.
  var hidden = 0, seen = {};
  function keep(id) {
    if (!strict || ownedBy(id, only)) return true;
    if (!seen[id]) { seen[id] = 1; hidden++; }
    return false;
  }

  // Same story on the skill side: one row per value slot means a skill that
  // scales two of its own numbers by this property arrived twice under the
  // same field, and was listed twice under the same name.
  var byField = {};
  (src.skills || []).forEach(function (u) {
    if (!keep(u[0])) return;
    var list = byField[u[1]] = byField[u[1]] || [];
    if (list.indexOf(u[0]) === -1) list.push(u[0]);
  });
  // the capped-away count belongs to the property, so it is stated after the
  // last field rather than repeated under every one
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
    // One row per FIELD the reader scales, so an effect that scales both its
    // "Initial Change" and its "Change Per Interval" by this property arrived
    // twice and was listed twice under the same name. It is one effect; the
    // fields belong together on its hover, not as separate entries. 949 of
    // the 8,175 reader rows were repeats of an id already on the line.
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
      a.href = urlFor("effect/" + eid);
      a.title = "effect " + eid;
      return a;
    };
  }), 4, 0));
  return td;
}

/* conditionalBlock read backwards. A skill says "I apply these extra effects
   when something sets this property"; the effect or trait that SETS it said
   nothing at all, so the link ran one way only - and the wrong way round for
   anyone reading the buff. Centreing Self (1879060704) adds a power restore
   to Intent Concentration and its page named neither the skill nor the effect
   it adds; the skill's page carried the whole relationship.

   Grouped by what is added, because one grantor usually plugs the same effect
   list into many skills - the largest covers 239 of them. */
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
    // the property is the whole mechanism, so it is named rather than implied
    var pn = el("div");
    pn.appendChild(propCode(r.prop));
    td.appendChild(pn);
    tr.appendChild(td);
    t.appendChild(tr);
  });
  return t;
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
  ["userEffects", "userEffectsAdditive", "toggleEffects", "toggleUserEffects",
   "critEffects"]
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

function conditionalBlock(s, D) {
  var rows = s.conditionalEffects || [];
  if (!rows.length) return null;
  var mine = ownerClasses(s);
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
    // Threat properties are shared: Trait_Threat_overTime_Extreme is granted
    // by every class's tank specialization, so Spear of Fate listed The Hide
    // and Defender of the Free beside Determination. Only the ones this
    // skill's own class can slot belong here.
    var traits = (r.traits || []).filter(function (id) {
      return D.traits[String(id)] && reachable(id, mine);
    });
    if (!traits.length) {
      // nothing survived the scope - better the whole list than an empty cell
      traits = (r.traits || []).filter(function (id) { return D.traits[String(id)]; });
    }
    if (traits.length) {
      td2.appendChild(el("span", "muted", "traited "));
      td2.appendChild(linkRun(traits.map(function (id) {
        return function () {
          var a = el("a", null, D.traits[String(id)].name);
          a.href = urlFor("trait/" + id);
          return a;
        };
      }), 3, 0));
    } else {
      // no trait applies it: an item set or something else we cannot name
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

/* ---------------- tooltip ---------------- */

/* The client builds a skill tooltip at render time from the skill's own
   properties - there is no stored tooltip string anywhere in the data. This
   rebuilds the same panel from the same pieces. Every level-scaled value is
   evaluated at the chosen level; the damage line cannot be, because it depends
   on the character's weapon and mastery, so it is written with those as named
   variables and explained underneath. */

/* `index` is whatever the curve is indexed BY - character level for a skill or
   an effect, trait RANK for a trait. A nested curve needs both numbers: the
   outer array is indexed by rank and names an inner curve, which is then read
   at the character's level. */
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

/* The client does not call a vital by its enum name: MountPower is
   "War-steed Power" and Health is "Morale". PropertyMetaData already holds
   both, on the vital's own cap property - "Maximum War-steed Power" - so the
   name is read from the game's data rather than hard-coded here. */
function vitalName(type) {
  if (!type) return "";
  var meta = PROPS && PROPS[type + "_MaxLevel"];
  if (meta && meta.n) return meta.n.replace(/^Maximum\s+/i, "");
  return spaceWords(type);
}

/* Crowd control. The client gives it its own line on the panel - "5s Stun",
   "15s Daze" - and nothing else on the effect says it, so a stun read as an
   empty block and was dropped. The state names in the data are internal; these
   are the words the client prints. 234 effects induce a state. */
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

/* What breaks the state, where the effect itself does not override it. The
   defaults belong to the combat-state resource, which is not in this dataset,
   so they are recorded here from the client's own panels:

     Riddle              Dazed   100% on damage, and no harm line at all
     Invocation of       Feared  100% on harm, 3% on damage
       Elbereth
     Shadow Breath       Feared  the same 100% on harm, its own 50% on damage

   A stun never breaks, so it needs no entry. Rooted is deliberately absent:
   nine roots override the damage chance and print their own number, and one
   that does not print no break line, which is better than a guessed default.
   An effect's own override wins per channel - Shadow Breath keeps the fear's
   100% on harm while replacing the 3% on damage. */
var CC_BREAK_DEFAULT = {
  Dazed:  { damage: 1 },
  Feared: { harm: 1, damage: 0.03 }
};

/* A Conjunction Stunned is what opens a Fellowship Manoeuvre, and the client
   says so on its own line under the stun. */
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
      out.push(el("div", "tipstat", "Starts Fellowship Manoeuvre"));
    }
    // "after 1s" is the grace period: the state cannot be broken at all until
    // it has run that long. Riddle's is 0, so its line is the bare chance.
    var after = cc.grace ? " after " + secs(cc.grace) : "";
    var def = CC_BREAK_DEFAULT[st] || {};
    var harm = cc.breakOnSkill !== undefined ? cc.breakOnSkill : def.harm;
    if (harm) {
      out.push(el("div", "tipstat",
                  fmt(harm * 100, 0) + "% break chance on harm" + after));
    }
    var dmg = cc.breakOnDamage !== undefined ? cc.breakOnDamage : def.damage;
    if (dmg) {
      out.push(el("div", "tipstat",
                  fmt(dmg * 100, 0) + "% break chance on damage" + after));
    }
  });
  return out;
}

/* "Expires if out of combat for 9 seconds." IS a real client line - Gambit
   Chain - Step 1 (1879459423) prints it in game. What it is not is a line
   every combat-only effect gets: `Effect_Duration_CombatOnly` on its own
   covers 3,167 effects, and 2,765 of those also set
   `Effect_RemovalOnlyInCombat`, which says only combat can take the effect
   off - so leaving the fight does nothing and the line would be a lie. Power
   of Knowledge (1879369513) is one of those.

   normalize.py settles the pair into `expiresOutOfCombat` (402 effects) and
   the panel reads that. `combatOnly` stays raw for the page's "Combat only"
   tag either way.

   The 9 is a client global - nothing on the effect carries it - so it is
   named here, and it is the number the game shows. */
var COMBAT_ONLY_GRACE = 9;
function combatOnlyNote() {
  return "Expires if out of combat for " + COMBAT_ONLY_GRACE + " seconds.";
}

/* "Resistance: Song (160)". Effect_Resist_Level is 0 on almost every effect
   that names a category, and the number the client shows there is the
   caster's level - so it follows the panel's level box. */
/* An aura is a field around whoever carries it. Its reach and its audience
   are the whole of what tells one aura from another, and neither was on the
   panel - "Aura, 5m radius" is the first thing a reader wants. */
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

/* One or several resist categories, in the client's own words. */
/* The client calls this category TACTICAL. The data calls it Magic, and the
   resist and dispel enums carry no log strings at all - extract.py writes out
   only the values whose label DIFFERS from the internal token, and for those
   two enums there are none - so enumWord hands the token straight back and
   "Resistance: Magic" reached the panel.

   The word is not invented here: the damage-qualifier enum does spell it out
   ("Magic" -> "Tactical Skill"), and the skill-type line has hard-coded the
   same rename since it was written. This puts it in one place for every list
   that names a combat category - Resistance: on 156 skills and 72 effects,
   and the generated dispel list on 10 more. */
function categoryWord(field, value) {
  var w = enumWord(field, value);
  return w === "Magic" ? "Tactical" : w;
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
  // The level belongs to the EFFECT's line only. A skill naming a resistance
  // category is saying what its effects can be resisted as, not carrying a
  // resist level of its own - Blinding Dust the skill reads "Resistance:
  // Wound" and Blinding Dust the effect reads "Resistance: Wound (160)".
  if (!withLevel) return "Resistance: " + named;
  var at = rec.resistLevel || (level === undefined ? LEVEL_CAP : level);
  return "Resistance: " + named + " (" + at + ")";
}

function tipLine(host, label, value, cls) {
  if (value === null || value === undefined || value === "") return;
  var d = el("div", "tl" + (cls ? " " + cls : ""));
  if (label) d.appendChild(el("span", "tk", label));
  if (value && value.nodeType) d.appendChild(value);
  else d.appendChild(el("span", "tv", String(value)));
  host.appendChild(d);
}

/* What a skill does to your class resource, written the four ways the client
   writes it. Skill_Pip_Change and Skill_Pip_RequiredMinValue decide between
   them, and they are read together because neither says the whole thing:

     change  min   reads as                          e.g.
     +3      -     "Adds 3 to Fervour"               Heart Seeker (+5 Focus)
     -3      3     "Cost: 3 Fervour"                 Brutal Strikes
     -5      -     "Removes 5 from Fervour"          Fury of Blades
     -4      5     "Requires at least 5 Fervour"     Ferocious Strikes
                   "Removes 4 from Fervour"
     -       1     "Cost: 1 Fervour"                 Hamstring

   A cost is a spend the skill also gates on, so where the two numbers agree
   the client says it once. Where they disagree it says both, because
   "requires 5, spends 4" is two facts.

   The resource is named by its own enum label, never by a table here -
   Skill_Pip_AffectedType is what makes it Fervour rather than Focus. All of
   these carry the "pip" class: a pip line sits in the cost block but is not
   the power cost, and reads in its own yellow-green.

   Skill_Pip_RequiredMaxValue (9 skills) is deliberately not printed: no
   in-game panel has been seen for one, and its wording would be a guess. */
/* The At a glance version of the pip line - the same facts without the icon,
   since a two-ended resource says nothing useful as a bare signed number. */
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
  // the resource's own name beats the enum label - the DAT spells the enum
  // "Atunement" and the client has never shown a player that
  var pip = (def && def.name) || spaceWords(enumWord("pipType", s.pipType));
  if (def && def.icons) {
    twoEndedPipLines(host, s, def, pip);
    return;
  }
  var chg = s.pipChange, min = s.pipMin;
  if (chg > 0) {
    // Requiring the resource AND paying you more of it is not a contradiction:
    // Agile Rejoinder wants 3 Focus on the bar before it will fire and then
    // adds 3 more. The gate used to be dropped on the floor here, because a
    // skill that ADDS to a resource was assumed not to ask for any. The
    // requirement reads first - it is what decides whether the skill is
    // available at all. Only Agile Rejoinder takes this path; the other 14
    // that do both are Attunement and Balance skills, and the two-ended
    // renderer below has always printed their "Requires:" line.
    if (min) {
      tipLine(host, null, "Requires at least " + min + " " + pip, "pip");
    }
    tipLine(host, null, "Adds " + chg + " to " + pip, "pip");
    return;
  }
  // A minimum with no change of its own is still a cost - Hamstring gates on
  // 1 Fervour and takes it.
  if (!chg) {
    if (min) tipLine(host, "Cost:", min + " " + pip, "pip");
    return;
  }
  var spend = Math.abs(chg);
  if (min && min !== spend) {
    tipLine(host, null, "Requires at least " + min + " " + pip, "pip");
  }
  if (min === spend) tipLine(host, "Cost:", spend + " " + pip, "pip");
  else tipLine(host, null, "Removes " + spend + " from " + pip, "pip");
}

/* Attunement and Balance do not count up - they slide either side of a home
   value, and which way a skill slides you is the whole point. The client does
   not spell the direction out in words: it prints an amount and lets one of
   the resource's three icons say which end it belongs to.

     Attunes:  3 [red rune]      toward Damage Attuned   Scathing Mockery
     Attunes:  4 [pale rune]     back toward Balanced    Armour of The Elements
     Requires: 7 [fore rune]     Balance 32, home 25     Lunge

   Every number on these lines is RELATIVE TO HOME. The raw values are not:
   Lunge wants Balance 32 on a scale whose middle is 25, and "Requires Balance
   32" makes a reader do that subtraction themselves. 32 - 25 = 7 toward Fore,
   and the icon carries the rest.

   A negative change moves toward the low end, a positive one toward the high
   end, and Skill_Pip_Toward_Home moves toward the middle from either side.
   The end's own name survives as the icon's alt text and title, so hovering
   still says "Damage Attuned" and a reader without images is not stranded. */
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
  // Label, number, icon - the same shape as "Cost: 3 Fervour", split into the
  // same label and value spans.
  function amountLine(label, side, amount) {
    var wrap = el("span", "tv", String(amount));
    var img = icon(side);
    // the icon trails the number here, so its gap moves to the other side
    if (img) { img.className += " pipafter"; wrap.appendChild(img); }
    tipLine(host, label, wrap, "pip");
  }
  // Only for a resource whose home value is unknown - then a distance cannot
  // be worked out and the raw threshold is all there is to say.
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
               "Requires " + pip + " " + value + (isMin ? " or more" : " or less"));
      return;
    }
    var d = value - def.home;
    // At exactly home the distance is 0 and the sign says nothing, so the
    // constraint itself picks the end: a minimum pushes up, a maximum down.
    // "Requires: 0 [healing]" is right for Improved Rune of Restoration -
    // any healing attunement at all, including none.
    var side = d > 0 ? "max" : d < 0 ? "min" : (isMin ? "max" : "min");
    amountLine("Requires:", side, Math.abs(d));
  }
  var chg = s.pipChange;
  if (chg) amountLine("Attunes:", chg < 0 ? "min" : "max", Math.abs(chg));
  if (s.pipTowardHome) amountLine("Attunes:", "home", s.pipTowardHome);
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

  // The client's top block, in the client's order. The first row carries two
  // things at once - the speed word on the left, the range pushed to the right
  // edge - and everything else is one line each below it:
  //
  //   Fast                                    40m Range
  //   Tactical Skill
  //   Max targets: 8
  //   Radius: 10m
  //   Resistance: Cry
  //   Skill Type: Cry
  //
  // Induction is NOT up here: it belongs with the cost and cooldown at the
  // foot, and printing it in both places said the same thing twice.
  var top = el("div", "tipbody");

  // The speed label is only present for skills explicitly marked as
  // Skill_Immediate or Skill_IgnoresResetTime. A skill with neither flag
  // has no speed label at all.
  var row0 = el("div", "tl tiprow0");

  if (s.immediate) {
    row0.appendChild(el("span", "tv", "Immediate"));
  } else if (s.ignoresResetTime) {
    row0.appendChild(el("span", "tv", "Fast"));
  }

  if (s.maxRange !== undefined) {
    row0.appendChild(el("span", "tv tipright",
      (s.minRange !== undefined ? fmt(s.minRange) + " - " : "") +
      fmt(s.maxRange) + "m Range"));
  }

if (row0.children.length) top.appendChild(row0);
  // Skill_AnimationMode is the ANIMATION, not the combat category: Wizard's
  // Frost animates as "Melee" while the client calls it a Tactical Skill. The
  // category is Skill_AttackHook_DamageQualifier, whose "Magic" is what the
  // client writes as Tactical. Skill_AttackHook_UsesTactical is a different
  // question - which mastery the damage draws on - and keying off it labelled
  // 5,506 skills wrongly, Dissonant Strike and Healer's Strike among them.
  // Only 11 skills carry hooks that disagree with each other, so the first
  // qualifier is the skill's category; with no attack hook at all there is
  // nothing but the animation to go on.
  var qual = null;
  (s.attacks || []).forEach(function (a) {
    if (!qual && a.damageQualifier) qual = a.damageQualifier;
  });
  // With no attack hook there is no category: Story of Courage is a buff, and
  // the client prints no "... Skill" line for it at all. Falling back to the
  // animation put "Ranged Skill" on 2,944 skills that have no combat category.
  if (qual) {
    // The enum's own label is the finished line - "Melee" labels as "Melee
    // Skill" and "Magic" as "Tactical Skill" - so " Skill" is only appended
    // when there is no label to use.
    var qw = enumWord("damageQualifier", qual);
    tipLine(top, null, qw === qual
      ? titleCase(qual === "Magic" ? "Tactical" : qual) + " Skill"
      : qw);
  }
  if (s.aeMaxTargets) tipLine(top, null, "Max targets: " + s.aeMaxTargets);
  if (s.aeSphereRadius !== undefined) {
    tipLine(top, "Radius:", fmt(s.aeSphereRadius) + "m");
  }
  // An arc is a wedge in front of you, and what a player needs off the panel
  // is how far it reaches, not how wide it opens. All 1,136 arc skills carry
  // aeArcRadius alongside the angle, and 1,119 of them have no maxRange at
  // all - so without this line their panel never says how far they reach.
  // The angle is not lost: the page below draws the wedge, to scale.
  if (s.aeArcDegrees) tipLine(top, "Range:", fmt(s.aeArcRadius) + "m");
  // The client puts the induction here, between the radius and the resistance,
  // and words it as bare seconds in the same grey as the rest of the block -
  // the green "time" colour belongs to the cooldown at the foot. Whether it
  // can be interrupted is on the page below, not on the panel.
  if (s.induction) {
    tipLine(top, "Induction:", secs(s.induction.duration));
  }
  // A channel is not a toggle: Still As Death runs for Channeling_Duration and
  // then ends. The state it points at is the only place that number lives.
  if (s.channel) {
    tipLine(top, "Channel Duration:", secs(s.channel.duration));
  }
  if (s.resistCategory) {
    tipLine(top, null, resistWording(s, level), "tipresist");
  }
  // one malformed record must not blank the whole tooltip
  var types = Array.isArray(s.displayType) ? s.displayType
            : (s.displayType ? [s.displayType] : []);
  var shown = types.map(function (t) {
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

  effectBlocks(s, progs, level).forEach(function (blk) { box.appendChild(blk); });

  var foot = el("div", "tipbody cost");
  function costText(c, suffix) {
    var v = c.points !== undefined ? c.points : progAt(progs, c.progression, level);
    if (v === null || v === undefined) {
      // Skill_Vital_Percent is a fraction, not a percentage: Warden's Triumph
      // stores 0.025 and the client prints "2.5% of your Morale". Printing it
      // straight read as "0.03%" - out by a factor of a hundred.
      return c.percent === undefined ? null
        : fmt(c.percent * 100, 3) + "% of your " + (vitalName(c.type) || "vital") + suffix;
    }
    return num(v) + " " + vitalName(c.type) + suffix;
  }
  (s.costs || []).forEach(function (c) {
    tipLine(foot, "Cost:", costText(c, ""));
  });
  // Skill_Toggle_VitalCostPerSecondList - what the skill drains for as long as
  // it stays on. Spur On costs 640 War-steed Power to start and 10 a second to
  // hold; only the first was on the panel. 47 skills have one.
  (s.toggleCosts || []).forEach(function (c) {
    tipLine(foot, "Cost:", costText(c, " Per Second"));
  });
  pipLines(foot, s);
  // The client prints "Toggle Skill" straight after the cost, and without it
  // nothing on the panel says the skill stays on once used. A non-empty
  // Skill_Toggle_Effect_List is exactly what marks one - 1,583 skills, and
  // the emitted toggleEffects list matches it one for one.
  // A skill with a channeling state holds its effects for a fixed time and
  // then drops them; the client calls that a Channel Skill, not a Toggle
  // Skill. The channeling state is the marker, not the toggle effect list -
  // two of the 171 channels carry no toggle effects of their own.
  if (s.channel) {
    tipLine(foot, null, "Channel Skill", "time");
  } else if ((s.toggleEffects && s.toggleEffects.length) ||
             (s.toggleUserEffects && s.toggleUserEffects.length)) {
    tipLine(foot, null, "Toggle Skill", "time");
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
    tipLine(foot, null, "Clears All Gambits");
  }
  if (s.cooldown !== undefined) {
    tipLine(foot, "Cooldown:", secs(s.cooldown), "time cdgap");
  }
  if (foot.children.length) box.appendChild(foot);
  // The panel ends at the cooldown. What class you have to be, and at what
  // level, is provenance rather than what the skill does - the page's own
  // "How you get it" section carries it, in full rather than first-only.
  return box;
}

/* The same panel for an effect. An effect tooltip in game is the buff or debuff
   box: what it does, for how long, and what it changes - the property lines
   come from the same PropertyMetaData the skill panel uses. */
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

  // Effect_ResistanceCategory_Base comes before the description in the client
  var aur = auraWording(e);
  if (aur) {
    var ab = el("div", "tipbody");
    tipLine(ab, null, aur);
    box.appendChild(ab);
  }
  if (e.resistCategory) {
    var rc = el("div", "tipbody");
    var rl = el("div", "tl tipresist");
    rl.textContent = resistWording(e, level, true);
    rc.appendChild(rl);
    box.appendChild(rc);
  }

  // the page no longer repeats these above, so the panel carries both the
  // definition wording and the on-application line when they differ
  var said = {};
  // fellowshipHeader is deliberately NOT here: it ends in a colon and
  // introduces the nested effect, so on the carrier's own page it would dangle.
  // "What it does" below already words the whole relationship.
  [dispelWording(e, level), e.desc, e.descOverride, e.applied].forEach(function (w) {
    if (!w || said[w]) return;
    said[w] = 1;
    var d = el("div", "tipdesc");
    d.appendChild(richText(w));
    box.appendChild(d);
  });

  var body = el("div", "tipbody");
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
                        e.pulseCount ? " on application" : "", false);
    if (one) tipLine(body, null, one, vcls);
    // Whenever there IS a per-pulse value - not only when a pulse COUNT is
    // set. 727 effects pulse without counting, 639 of them harmful, and every
    // one of them drew nothing at all.
    var rep = vitalLine(e, v, per, v.vpsPerPulse, v.perPulseVariance,
                        overTimeTail(e), true);
    if (rep) tipLine(body, null, rep, vcls);
  }
  // Resolve the curve at the chosen level. Without this the panel printed
  // "Scales with level: Finesse Rating" while a level box sat directly
  // underneath it - the one thing on screen that could have answered it.
  (e.stats || []).forEach(function (st) {
    var line = statLine(resolveStat(st, progs, level), "level");
    if (line) body.appendChild(line);
  });
  if (body.children.length) box.appendChild(body);

  // What it keeps doing while it is on you. The initial list is deliberately
  // left out here - see overTimeGroups.
  overTimeBlocks(e, progs, level, { withInitial: false, duration: false })
    .forEach(function (b) { box.appendChild(b); });
  expireBlocks(e, progs, level).forEach(function (b) { box.appendChild(b); });

  // Effect_TimeDisplay_Base is the last of the client's four rows, and the
  // panel ends there. Chance, cure type, stacking and what applies it are all
  // on the page below - the tooltip is the tooltip.
  var foot = el("div", "tipbody");
  // permanent wins: such an effect still carries an interval, and printing
  // that as its duration says it lasts a second when it never expires
  if (e.permanent) {
    // nothing where there is nothing to say - see durationNode
    if (e.expiresOutOfCombat) tipLine(foot, null, combatOnlyNote(), "time");
  } else if (e.pulseCount && e.interval) {
    tipLine(foot, "Duration:", secs(e.interval * e.pulseCount), "time");
  } else if (e.duration !== undefined) {
    tipLine(foot, "Duration:", secs(e.duration), "time");
  }
  if (foot.children.length) box.appendChild(foot);
  return box;
}

/* How the client words a repeating heal or damage: "every 2.0 seconds for 12
   seconds" - the interval always to one decimal, the span as the whole time it
   runs, and "seconds" spelled out rather than the "s" the duration rows use.
   Effect_Duration_ConstantInterval is emitted as both `interval` and
   `duration`, so the total is that times the pulse count. */
function overTimeTail(e) {
  var iv = e.interval || e.duration;
  if (!iv) return "";
  // Always one decimal on the interval - fmt() returns "2" for a whole
  // number, and the client writes "every 2.0 seconds".
  // The client ends this one with a full stop, unlike every other panel line.
  var every = " every " + Number(iv).toFixed(1) + " seconds";
  // No pulse count means it is not counting pulses at all: it runs until it
  // is removed, or for as long as the channel that put it there lasts. Power
  // of Knowledge (1879369512/13) is the case - there is no "for N seconds" to
  // write, and demanding one kept the line off the panel entirely.
  if (!e.pulseCount) return every + ".";
  return every + " for " + fmt(iv * e.pulseCount) + " seconds.";
}

/* One heal or damage-over-time line. Two things stop the stored number from
   being an amount, and both used to print as "Restores 0 Morale":

   Effect_InstantVital_Multiplicative - the value is a FRACTION of the target's
   maximum. Dire Need's 0.3 is "Restores 30% of maximum Morale", and 215
   effects are written that way.

   A vitals-per-second multiplier - the curve is a coefficient on the
   character's own healing or damage rate, so a heal-over-time curve reading
   0.1 is 0.1 of V, not 0 morale. Those are written with V as the variable, the
   same way skill damage is written with W and A. */
/* `overTime` marks the per-pulse line. It changes the wording twice, and both
   are the client's:

     instant   +193 Power                 Restores 27540 Morale
     over time Restores 86 - 96 Power     202 - 224 Lightning Damage

   A resource change is written as a signed amount only when it lands at once;
   the repeating form keeps the verb. And a repeating HARM has no verb at all -
   it reads like the damage line at the top of a skill panel, "202 - 224
   Lightning Damage", not "Deals 202 Lightning damage". */
function vitalLine(e, v, value, vps, variance, tail, overTime) {
  if (!value) return null;
  var harmful = e.harmful;
  var vital = e.vitalType ? enumWord("vitalType", e.vitalType) : "Morale";
  /* MORALE is the only vital the client writes as a sentence when it lands at
     once. A resource vital is "+193 Power", never "Restores 193 Power" - how
     Song of the Hammerhand's expiry reads in game. Applied to Power (239
     effects) and the two war-steed vitals (90), on the reasoning that they
     are the same kind of resource; only plain Power is confirmed. Morale
     keeps "Restores" / "Deals", which IS confirmed - Dire Need reads
     "Restores 30% of maximum Morale". */
  var signed = vital !== "Morale" && !overTime;
  var lead = signed ? (harmful ? "-" : "+")
           : harmful ? (overTime ? "" : "Deals ")
           : "Restores ";
  var unit = harmful ? (overTime ? harmUnit(e, vital) : (vital === "Morale" ? "damage" : vital))
                     : vital;
  var type = e.damageType ? enumWord("damageType", e.damageType) + " " : "";
  /* DEAD END, recorded so it is not tried again: a vitals-per-second
     multiplier of exactly 1 is NOT a reliable "no scaling" marker. It looked
     like one - 40 of the 41 curves beside a vps of 1 read above 5 at the cap
     - but Inspirational Verse - Rider (1879255503) carries vpsInitial 1.0 and
     vpsPerPulse 0.5 on the SAME curve, worth 23.8, which can only be a
     coefficient. Gift of Nature's 16400 on a vps of 1 can only be an amount.
     Same flag, same vital, opposite meanings, and nothing but the magnitude
     to tell them apart - so the flag is taken at face value. */
  var scaled = !!vps;
  var span = el("span", "tv");
  var base = Math.abs(value) * (v.baseMultiplier || 1);

  /* The amount, as the RANGE the client shows. `..._Variance` is the whole
     spread, so the ends are the value give or take half of it - which is
     also how describe.py's numToken has always read it. "86 - 96", not
     "91  +/-10%". */
  function amount(n) {
    if (!variance) return num(n);
    return num(n * (1 - variance / 2)) + " - " + num(n * (1 + variance / 2));
  }

  if (v.percent && !scaled) {
    span.appendChild(el("span", null,
      lead + fmt(base * 100, 3) + "% of maximum " + vital +
      (!signed && harmful && !overTime ? " as " + type + "damage" : "") + tail));
    return span;
  }
  if (scaled) {
    if (lead) span.appendChild(el("span", null, lead));
    span.appendChild(el("code", "dmg", fmt(base * vps, 2) + " x V"));
    span.appendChild(el("span", null, " " + type + unit + tail));
    if (variance) {
      span.appendChild(el("span", "muted",
                          "  +/-" + fmt(variance * 100, 0) + "%"));
    }
    return span;
  }
  span.appendChild(el("span", null,
    lead + amount(base) + " " + type + unit + tail));
  return span;
}

/* What a repeating harm calls what it takes off you: the client writes
   "202 - 224 Lightning Damage" for morale and names the resource otherwise. */
function harmUnit(e, vital) {
  return vital === "Morale" ? "Damage" : vital;
}

/* A bubble soaks damage until the pool it grants is spent. The size of that
   pool is the whole of what the effect does and it is nowhere in the
   Mod_Array, so every bubble on the site said nothing about itself: Word of
   Exaltation (effect 1879220523) carries four modifiers and all four are
   value 0 until a trait supplies them, which left the panel with no line and
   the block dropped - a heal skill whose tooltip never mentioned its bubble.

   The client words it "Applies a damage preventing bubble granting 16%
   temporary morale." Three shapes in the data, 88 effects: a percentage of
   maximum (38), a flat amount (40), and a progression that scales with level
   (8) - the last resolved against the panel's own level box. The vital is
   Health on all but two, and its display name comes from the enum the way
   every other vital line gets it. */
function bubbleLine(e, progs, level) {
  var b = e.bubble;
  if (!b) return null;
  var amount;
  if (b.percent) {
    amount = fmt(b.percent * 100, 3) + "%";
  } else {
    var v = b.value !== undefined ? b.value : progAt(progs, b.progression, level);
    if (v === null || v === undefined || !v) return null;
    amount = num(v);
  }
  var vital = enumWord("vitalType", b.type || "Health") || "Morale";
  return "Applies a damage preventing bubble granting " + amount +
         " temporary " + vital.toLowerCase() + ".";
}

/* A reactive effect watches for incoming damage and answers it. Wisdom of the
   Council (effect 1879060814, skill 1879060811) is the shape:

       On any damage:
       50% chance to Negate 85% damage
       Reflect 4260 Light damage
       25% chance to Reflect effect:
       3s Stun
       Duration: 10s

   All of it lives on eleven `Effect_ReactiveVital_*` properties that only
   describe.py read, so the panel showed nothing but the heal the skill applies
   alongside. 359 effects carry one, 143 of them on a skill panel across 151
   skills, and 89 of those drew NOTHING at all before this.

   Negate comes before reflect - that is the order the client writes them in,
   and the reverse of describe.py's prose.

   Confirmed against the game: the heading, "Negate N% damage", "Reflect N
   <type> damage" and "N% chance to Reflect effect:". The other two legs are
   this site's own wording on describe.py's reading - "Apply to yourself:" for
   an `Effect_ReactiveVital_DefenderEffect_Effect` (73 effects carry one alone)
   and "Removed once it triggers." for `..._RemoveOnSuccessfulProc`. */
function reactiveHeader(r) {
  var bits = [];
  (r.qualifiers || []).forEach(function (q) {
    // the enum label is the SKILL name for the category - "Melee Skill",
    // "Tactical Skill" - and "On Melee Skill damage:" says skill twice
    bits.push((enumWord("damageQualifier", q) || titleCase(q))
              .replace(/\s+Skill$/, ""));
  });
  // "ALL" is the catch-all rather than a damage type, and the client says
  // "any" for it: 306 of the 359 are written that way.
  (r.on || []).forEach(function (t) {
    if (t !== "ALL") bits.push(enumWord("damageType", t) || titleCase(t));
  });
  return "On " + (bits.length ? bits.join(", ") : "any") +
         (r.skillOnly ? " skill hit" : " damage") +
         (r.casterOnly ? " from the source of this effect" : "") + ":";
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
  return v === null || v === undefined ? null : num(Math.abs(v));
}

function reactiveChance(leg) {
  return leg.chance === undefined ? ""
    : fmt(leg.chance * 100, 3) + "% chance to ";
}

/* A leg with a flat zero chance never fires - the same rule the panel already
   applies to an effect whose own application chance is zero. Mearas-lore
   (1879242033) reads "0% chance to Apply to yourself:" without it. */
function reactiveFires(leg) {
  return !!leg && leg.chance !== 0;
}

function reactiveLines(e, progs, level) {
  var r = e.reactive;
  if (!r) return [];
  var out = [];
  function say(text) { out.push(el("div", "tipstat", text)); }
  // "react" reads these in the effect green rather than the dimmer label
  // colour the carrier groups use - they are part of the buff, not a caption
  function head(text) { out.push(el("div", "tipeffwho react", text)); }
  function payload(leg, label) {
    var ne = EFFECT_CACHE[String(leg.id)];
    if (!ne) return;
    var host = el("div");
    effectBody(host, ne, null, progs, level);
    if (!host.children.length) return;
    tagPayload(host, 0, ne);
    head(reactiveChance(leg) + label);
    // push does NOT detach the node the way appendChild does, so the child
    // has to be removed by hand or the loop never ends
    while (host.firstChild) out.push(host.removeChild(host.firstChild));
  }

  var amt;
  if (reactiveFires(r.negate)) {
    amt = reactiveAmount(r.negate, progs, level);
    if (amt) say(reactiveChance(r.negate) + "Negate " + amt + " damage");
  }
  if (reactiveFires(r.reflect)) {
    amt = reactiveAmount(r.reflect, progs, level);
    if (amt) {
      say(reactiveChance(r.reflect) + "Reflect " + amt +
          (r.reflect.damageType
            ? " " + (enumWord("damageType", r.reflect.damageType) ||
                     titleCase(r.reflect.damageType))
            : "") + " damage");
    }
  }
  if (reactiveFires(r.reflectEffect)) {
    payload(r.reflectEffect, "Reflect effect:");
  }
  if (reactiveFires(r.selfEffect)) payload(r.selfEffect, "Apply to yourself:");
  if (r.removeOnProc && out.length) say("Removed once it triggers.");
  // the heading only where something came of it
  if (out.length) out.unshift(el("div", "tipeffwho react", reactiveHeader(r)));
  return out;
}

/* The property that has to supply an application chance, and the chance it
   supplies - resolved from wherever that property is actually set, so the page
   can say "50%" rather than only naming the property. */
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
    box.appendChild(el("span", null, "  gives " + uniq.join(" / ")));
  } else {
    box.appendChild(el("span", "muted", "  value not in this dataset"));
  }
  return box;
}

/* A modifier that carries a curve instead of a flat value. statLine can only
   print what it is given, so fill the value in from the curve at the index the
   reader has chosen - level for a skill or effect, RANK for a trait. */
function resolveStat(st, progs, index, level) {
  if (st.value !== undefined || !st.progression) return st;
  var v = progAt(progs, st.progression, index, level);
  if (v === null || v === undefined) return st;
  var copy = {};
  for (var k in st) copy[k] = st[k];
  copy.value = v;
  return copy;
}

/* How far a trait's ranks actually run: the end of its own curves, and any
   rank at which it hands over a skill or an effect. */
/* Whether a trait has a rank ladder at all. Trait_Virtue_Maximum_Rank is the
   client's own answer, and a trait without one is not ranked: its curves are
   indexed by the character's LEVEL, not by a rank. Every creep trait is in
   that group - a creep cannot buy ranks, so Flayer of Flesh has one rank whose
   values are read at the level cap. Reading the end of a level curve as a rank
   count gave those traits 160 ranks and 160 identical-looking blocks. */
function traitIsRanked(t) {
  if (t.maxRank) return true;
  return (t.skills || []).concat(t.effects || [])
    .some(function (g) { return g && g.rank > 1; });
}

function traitMaxRank(t, progs) {
  // The client stores the answer. Guessing it from a curve's length is wrong:
  // modifier arrays are padded to a fixed width and repeat their last value,
  // and an unranked trait's curve is a LEVEL curve that runs to 160.
  if (t.maxRank) return t.maxRank;
  var top = 1;
  (t.skills || []).concat(t.effects || []).forEach(function (g) {
    if (g && g.rank) top = Math.max(top, g.rank);
  });
  return top;
}

/* The trait panel, laid out the way the client lays it out: the description
   once, then EVERY earnable rank in turn with what it is worth. A trait is
   bought a rank at a time, so the ladder IS the thing being read - one rank in
   isolation cannot answer "is the next point worth it".

   Values depend on level as well as rank, because a trait modifier is usually
   a progression of progressions: the outer array picks a curve by rank, and
   that curve is then read at the character's level. */
function classOfNature(nature, D) {
  if (!nature || !D || !D.classes) return null;
  var code = String(nature).replace(/^Class_/, "");
  var keys = Object.keys(D.classes);
  for (var i = 0; i < keys.length; i++) {
    if (D.classes[keys[i]].code === code) return D.classes[keys[i]];
  }
  return null;
}

/* One effect on a trait's rank block, and whatever it nests. The client
   prints the effect's own wording and then its modifier lines, in the same
   green as the rest of the rank - it does not print the effect's name here,
   so neither does this. */
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

  // the client's second line: whose trait it is, and how far it goes
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
    // The client heads every rank block, single-rank traits included - A
    // Watched Pot's one block reads "Rank: 1" in game.
    blk.appendChild(el("div", "rl", "Rank: " + r));
    var any = false;
    stats.forEach(function (st) {
      // A modifier with no curve is granted once, when the trait is first
      // taken - it is not re-granted at every rank. Repeating it made
      // Enervating Counter's rank 2 read "After Blade Shield, Riposte
      // increases the damage your target receives." again instead of the
      // +2.5% the rank actually buys. The client lists only what the rank adds.
      if (r > 1 && !st.progression) return;
      // An unranked trait indexes its curves by level, not by rank.
      var line = statLine(resolveStat(st, progs, ranked ? r : lvl, level),
                          ranked ? "rank" : "level");
      if (!line) return;
      // Every rank reads the same colour in the client - sampled off a
      // screenshot at #99FF00, first rank included. Painting rank 1 pale was
      // my own invention.
      line.className = "tipstat";
      blk.appendChild(line);
      any = true;
    });
    // The effects this rank puts on you. These used to be left out on the
    // belief that the client does not list them - A Watched Pot proves
    // otherwise: its entire rank 1 is an effect's wording plus its nested
    // effect's line, and without them the block rendered empty.
    (t.effects || []).forEach(function (g) {
      if ((g.rank || 1) !== r) return;
      traitEffectLines(g.id, progs, level, 0, {}).forEach(function (node) {
        blk.appendChild(node);
        any = true;
      });
    });
    // "Skills Earned:" and then the skills, the way the client words it.
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

    // The client prints "2 Points to Next Rank" here. Trait_PointBasedTrait_
    // PointCostProgression - the only cost curve on the trait - reads a flat
    // 1.0 at every rank, so it is not the number the client is showing and
    // something else feeds that line. Printing "1 Point" would be worse than
    // printing nothing, so this stays out until the real source is found.
  }

  // What has to be slotted first - or must NOT be. The client prints this in
  // red, and for the "one of these" case it is the only thing on the panel
  // explaining why a trait cannot be taken. The three operators are real and
  // opposite: Volley is barred by The Bowmaster and The Trapper, and calling
  // that a requirement told the reader to slot the very traits that lock it.
  var MUST_WORDS = {
    one: ["You must slot this trait:", "You must slot at least one of these traits:"],
    all: ["You must slot this trait:", "You must slot all of these traits:"],
    none: ["You must not have this trait slotted:",
           "You must have none of these traits slotted:"]
  };
  if (t.requires && t.requires.length) {
    var must = el("div", "tipmust");
    t.requires.forEach(function (group) {
      // a build from before the operator was carried is a bare array
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

/* Only show a rank box when a rank actually changes something. */
function traitUsesRank(t, progs) {
  // A level box is worth showing whenever a curve is on the panel - an
  // unranked trait's curve moves with level even though its rank never does.
  return (t.stats || []).some(function (st) { return st.progression; }) ||
    (t.skills || []).concat(t.effects || [])
      .some(function (g) { return g && g.rank > 1; });
}

/* Only show a level box when something on the panel actually moves with it. */
function usesLevel(e) {
  var v = e.vital || {};
  if (v.initialProgression || v.perPulseProgression) return true;
  return (e.stats || []).some(function (st) { return st.progression; });
}

/* The client's word for a class resource - the Mariner calls Balance pips
   "Attunes", and the tooltip says so. */
/* Each effect the skill puts up gets its own block, the way the game shows it:
   the effect's own wording, then one line per property it changes, named and
   formatted the way PropertyMetaData says, then the duration. */
/* A dispel-by-resist effect has no modifiers and no duration - the whole of it
   is one sentence. Cry of the Valar and the other removals carried it as a
   bare name with nothing under it, so the panel never said what the skill
   actually does.

   Where the author WROTE that sentence it wins, and the generated one is not
   built at all. 9 of the 81 dispels carry a `Effect_Definition_Description`,
   and in every one of them it says something the categories cannot:

     Remove Corruption (1879111268, 10 skills)
       own:  Removes 1 tier of up to 3 different Corruption effects ...
       ours: Removes up to 3 Corruption effects from the target.

   A corruption is removed a TIER at a time and the data has no field saying
   so. The rest collapse the raw category enums into the words the client
   actually prints - `[Disease, Physical, Wound, Cry, Song, Fear, Poison,
   Magic]` is "Physical, Cry, Song, or Tactical" to a reader. 22 skills.

   Its colour follows the same split: the author's sentence is flavour and
   reads in the description colour like every other `effectSentence`, while
   the generated line keeps the red/green of what the dispel does - red when
   it strips a buff off an enemy, heal green when it cures an ally. */
function dispelIsOwn(e) {
  return !!(e.dispelCategories && e.dispelCategories.length &&
            (e.desc || e.descOverride));
}

function dispelWording(e, level) {
  if (!e.dispelCategories || !e.dispelCategories.length) return null;
  if (dispelIsOwn(e)) return e.desc || e.descOverride;
  var n = e.dispelMax || 1;
  var out = "Removes up to " + n + " " +
    e.dispelCategories.map(function (c) {
      return titleCase(categoryWord("dispelCategories", c));
    }).join(", ") +
    " effect" + (n === 1 ? "" : "s");
  // Effect_DispelByResist_StrengthRestrictionOffset is added to the caster's
  // LEVEL, so this number moves with the level box: at 160 the client writes
  // "with maximum strength of 165".
  if (e.dispelStrengthOffset !== undefined) {
    out += " with maximum strength of " +
      ((level === undefined ? LEVEL_CAP : level) + e.dispelStrengthOffset);
  }
  return out + " from the target.";
}

/* A carrier applies nothing itself - it hands its nested effects on to
   somebody. The client never shows the carrier as an effect: it writes what
   the carrier decides, then a line naming who is about to receive something,
   then what the nested effect actually does. Two kinds:

     Effects applied to the Fellowship within 15 metres:   (Story of Courage)
     +21,600 Fear Resist Rating

     Target revives with 50% Morale                        (Enlivening Grace)
     Target revives with 0% Power
     Effects to apply on revival:
     You have been recently revived.
     Duration: 30s

   Without this the panel ended at the carrier's name with nothing under it. */
/* The client writes anything that restores you in the same bright green as
   the cost line - heals, heals over time, and revives alike. Everything else
   a skill puts up is pale; what it does to an enemy is red. */
function isHeal(e) {
  if (!e || e.harmful) return false;
  if (e.reviveVitals && e.reviveVitals.length) return true;
  return !!(e.vital && (e.vitalType === undefined || e.vitalType === "Health"));
}

function carrierLines(e) {
  if (e.fellowshipRange !== undefined) {
    return { pre: [], header: "Effects applied to " +
      (e.fellowshipWho || "the Fellowship") +
      " within " + fmt(e.fellowshipRange) + " metres:" };
  }
  // An area carrier is the same shape: a radius, and whoever is standing in
  // it. Who that is comes from what the payload DOES rather than from the
  // Effect_Area_Affects* flags - those name entity categories (monsters,
  // monster-players, player pets) and which of them count as enemies depends
  // on the caster's own side, so a creep AoE would read backwards. A harmful
  // payload is aimed at enemies whoever throws it.
  if (e.areaRange !== undefined) {
    return { pre: [], header: "Effects applied to " +
      (e.harmful ? "enemies" : "allies") +
      " within " + fmt(e.areaRange) + " metres:" };
  }
  if (e.reviveVitals && e.reviveVitals.length) {
    return {
      pre: e.reviveVitals.map(function (v) {
        return "Target revives with " + fmt(v.percent * 100, 3) + "% " +
               vitalName(v.type);
      }),
      header: "Effects to apply on revival:"
    };
  }
  return null;
}

/* An over-time applier is a carrier that fires more than once. It holds two
   lists - one applied the moment it lands, one applied on every pulse - and
   the client heads each with when it happens rather than who gets it:

     On application:
     Removes up to 1 Disease, Wound, Fear, Poison effect ... from the target.
     Duration: 4s

     Every 2 seconds:
     Removes up to 1 Disease, Wound, Fear, Poison effect ... from the target.
     Duration: 4s

   That is Scribe a New Ending (skill 1879232717 -> effect 1879265201 ->
   1879265200), which had NOTHING on either panel: the carrier changes no
   property and carries no wording, so both the skill's block and the effect's
   own body came out empty. 1,260 effects are built this way, 380 of them on a
   skill panel.

   The two lists are separate blocks, each ending in how long the whole thing
   runs - the carrier's own interval times its pulse count, not the payload's
   duration. Where the payload HAS a duration of its own that one stands and
   the carrier's is left off, or the block would end in two Duration rows
   saying different things (261 of 762 payloads).

   On the effect's own page only the pulse list is shown: the effect is already
   on you there, so what it did on landing is in the past. The page's own "What
   it does" prose below still words the whole thing, initial application
   included. */
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
    // One nested entry usually names BOTH routes - normalize merges duplicate
    // references and joins the routes onto `via` - so these are not exclusive.
    // Neither key is a substring of the other ("..._Initial_Applied_..." vs
    // "..._Applied_..."), so each test stands on its own.
    if (v.indexOf(AOT_INITIAL) !== -1) init.push(n);
    if (v.indexOf(AOT_PULSE) !== -1) pulse.push(n);
  });
  var groups = [];
  if (withInitial && init.length) {
    groups.push({ header: "On application:", nested: init });
  }
  if (pulse.length) {
    var iv = e.interval || e.duration;
    groups.push({
      header: iv ? "Every " + fmt(iv) + " second" + (iv === 1 ? "" : "s") + ":"
                 : "On each pulse:",
      nested: pulse
    });
  }
  return groups.length ? groups : null;
}

/* A payload line reads in the colour of the effect that PRODUCED it, not of
   the block it happens to land in. A reactive effect's block holds both the
   friendly answer (Negate, Reflect damage) and the debuff it throws back, so
   Wisdom of the Council's "3s Stun" sat in the green of the block instead of
   the red every other crowd-control line reads in.

   Only the harm case is tagged per line. Heal is already handled a level up:
   groupBlock puts `heal` on the whole block when any payload restores morale,
   and that is the documented rule for a carrier's colour. */
function tagPayload(host, from, ne) {
  if (!ne.harmful) return;
  for (var i = from; i < host.children.length; i++) {
    host.children[i].className += " harm";
  }
}

/* A heading and the effects under it. Shared by every group a panel draws -
   the two over-time lists and the on-expiry list - because they differ only
   in the words and in whether the carrier's own total closes the block.

   Build the payload FIRST: with nothing in it the heading would announce
   effects that never arrive. */
function groupBlock(e, g, progs, level, withDuration, held) {
  var host = el("div");
  var heal = false;
  g.nested.forEach(function (n) {
    var ne = EFFECT_CACHE[String(n.id)];
    if (!ne) return;
    // A carrier is only a wrapper, so what it hands on decides the colour -
    // the heal case only, as everywhere else.
    if (isHeal(ne)) heal = true;
    var before = host.children.length;
    effectBody(host, ne, null, progs, level);
    tagPayload(host, before, ne);
  });
  if (!host.children.length) return null;
  var blk = el("div", "tipeff" + (e.harmful ? " harm" : "") +
                      (heal ? " heal" : ""));
  blk.appendChild(el("div", "tipeffwho" + (g.cls ? " " + g.cls : ""), g.header));
  while (host.firstChild) blk.appendChild(host.firstChild);
  if (withDuration && !blk.querySelector(".tipdur")) {
    var dn = durationNode(e, null, held);
    if (dn) blk.appendChild(dn);
  }
  return blk;
}

/* One block per list. `duration` asks for the carrier's own total to close
   each block; the effect's own panel already prints that in its foot. */
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

/* What an effect leaves behind when its countdown runs out. Song of the
   Hammerhand (effect 1879218453) is the case: its bubble ends and hands back
   part of the power the skill cost, and the panel said nothing about it.

       -0% Incoming Damage
       Duration: 30s

       Applied on expiration:
       Restores 269 Power

   `EffectGenerator_Countdown_ExpireEffectList`, 1,117 effects - 246 of their
   payloads have something to draw and land on 329 skill panels. The block
   carries no duration of its own: what is written above it is how long the
   wait is, and the payload's own duration prints where it has one.

   `EffectGenerator_OnRemoval_Effect` (761 effects, 98 skills) is the sibling
   and is deliberately NOT drawn - it fires when the effect comes off by any
   route, not only by running out, so it needs a heading of its own that
   nothing has confirmed. describe.py already tells the two apart in prose
   ("On removal, applies" / "On expiration, applies"), so the wording is there
   to copy when somebody reports what the client writes. */
var EXPIRE_VIA = "EffectGenerator_Countdown_ExpireEffectList";

function isExpireVia(via) {
  return (via || "").indexOf(EXPIRE_VIA) !== -1;
}

/* What a reactive effect throws back, or puts on you - see reactiveLines. */
function isReactiveVia(via) {
  return (via || "").indexOf("Effect_ReactiveVital_AttackerEffect_Effect") !== -1 ||
         (via || "").indexOf("Effect_ReactiveVital_DefenderEffect_Effect") !== -1;
}

function expireBlocks(e, progs, level) {
  var list = (e.nested || []).filter(function (n) { return isExpireVia(n.via); });
  if (!list.length) return [];
  // red whatever sits above it - see the .tipeffwho.expiry rule
  var blk = groupBlock(e, { header: "Applied on expiration:", cls: "expiry",
                            nested: list }, progs, level, false);
  return blk ? [blk] : [];
}

/* A combo effect is a server-side router, not something that happens to you:
   it looks for an effect on the caster and applies one of two others depending
   on whether it found it. Both branches are named on the router -
   Effect_Combo_EffectToAddIfPresent and ..._IfNotPresent - and the router
   itself usually has no name, no description and no modifiers, so the panel
   printed nothing at all for it.

   The NotPresent branch is the panel's own case. What these routers look for
   is trait- or gear-granted (the Rune-keeper's is Flashing Images, effect
   1879313929, off the trait of that name), and the panel is the skill
   untraited and ungeared - so the branch taken when nothing has been granted
   is the branch to print. Epic Conclusion (1879109295) and the seven other
   Rune-keeper attunement finishers reach "Returns to Neutral Attunement"
   (effect 1879253754) this way, and in game every one of them says so just
   above the cost.

   WHATEVER the branch is. It was restricted to a sentence at first, out of a
   worry that Null Effect (1879117734, on 26 skills) would print its movement
   multiplier of exactly 1.0 as a no-op line. It does not: that modifier is
   `silent`, so statLine drops it and the block goes with it. Raise the Spirit
   (skill 1879064187) is what settled it - its router 1879314528 looks for
   Resonant Piercing Cry and routes to the bigger heal 1879314529 if it finds
   it, the plain 1879173086 if it does not, so the whole skill had NO heal
   number on its panel. 34 branch effects across 82 skills, the rest of them
   bleeds, debuffs and heals that were missing for the same reason.

   Returns the branch EFFECT, and effectBlocks draws it as though the skill
   applied it directly - its own colour, its own carrier and over-time
   handling, linked to its own page. */
var COMBO_BASE_VIA = "Effect_Combo_EffectToAddIfNotPresent";

function comboBaseBranch(e) {
  var br = null;
  (e.nested || []).forEach(function (n) {
    if (n.via === COMBO_BASE_VIA && !br) br = EFFECT_CACHE[String(n.id)];
  });
  return br && br.probability !== 0 ? br : null;
}

/* Every line an effect puts on a skill panel links back to the effect, so the
   panel can drop its NAME and its description sentence and still be a way in.
   The client's panel is the applied values - "+20% Skill Crit Chance", not
   "Provocateur / Grants a critical chance bonus on your next skill play." */
function tipEffLink(node, id) {
  var a = el("a", "tipefflink");
  a.href = urlFor("effect/" + id);
  a.appendChild(node);
  return a;
}

/* What one effect contributes to a panel block: a line per property it
   changes, then how long it lasts. The effect's name and description are
   deliberately not printed - see tipEffLink. The description is the one
   fallback: where an effect changes no property at all that sentence is the
   whole of what it does, and without it the block would be empty. Returns how
   many lines it put up, so a caller can drop a block that said nothing. */
/* The sentence a skill panel shows for an effect that carries no numbers of
   its own. Three strings could serve and they are NOT interchangeable:

     Effect_Definition_Description  what the effect IS   "Forced Attack"
     Effect_Description_Override    an author's replacement wording
     Effect_Applied_Description     the line you read when it LANDS on someone
                                    "The monster is infuriated."

   A skill panel answers "what will this do", so it uses the definition -
   Challenge reads "Forced Attack", not a combat-log sentence about a monster.
   No effect carries both a definition and an override, so their order settles
   nothing.

   THE APPLIED LINE IS NOT PANEL TEXT AT ALL. It is what the client writes on
   the effect icon once the effect is on someone, and the game does not repeat
   it here: Renewed Defences (1879384922) is a marker with no modifiers whose
   only string is one, and it appears on no skill tooltip in the game though
   three skills apply it. This was the last resort until that was reported;
   797 effects were riding on it, 578 of them printing literal junk ("..", a
   DNT note) and the remaining 219 printing icon text for immunity markers and
   raid mechanics - "Unaffected by debuffs which slow movement speed", "Cannot
   move. Damage will not end this state."

   Nothing is lost from the site: the effect's OWN page still prints all three,
   in this order. Only the skill panel stops borrowing the wrong one. */
function effectSentence(e) {
  return e.desc || e.descOverride || null;
}

/* How long a block's effect lasts. The reference's own duration wins where it
   carries one; a pulsing effect's stored duration is the INTERVAL, so the span
   is that times the pulse count. */
function durationNode(e, ref, held) {
  // Permanent WINS, the way effectTooltip's foot has always had it: such an
  // effect still carries an interval, and printing that as its duration says
  // Power of Knowledge lasts a second when it never expires on its own.
  //
  // And a permanent effect has no duration to state, so it states none:
  // "Duration: permanent" is gone from all 14,054 of them. The one line such
  // an effect can carry is the out-of-combat expiry - and not even that on a
  // skill the reader HOLDS, because a toggle or a channel keeps its effects
  // for exactly as long as it runs and the foot already says so.
  if (e.permanent) {
    return (e.expiresOutOfCombat && !held)
      ? el("div", "tipdur", combatOnlyNote()) : null;
  }
  var dur = (ref && ref.duration !== undefined) ? ref.duration : e.duration;
  if (e.pulseCount && dur) dur = dur * e.pulseCount;
  if (dur !== undefined && dur > 0) {
    return el("div", "tipdur", "Duration: " + secs(dur));
  }
  return null;
}

function effectBody(blk, e, ref, progs, level, held) {
  var before = blk.children.length;
  var dispel = dispelWording(e, level);
  if (dispel) {
    // A dispel is written as its sentence, not as a named effect box - that is
    // how the client draws it, and there is nothing else to put in the box.
    // Red when it strips a buff off an enemy (Cry of the Valar), the heal
    // green when it cures an ally (Story of Courage) - the effect's own
    // harmful flag decides, and hard-coding red got the cures wrong. The
    // author's own sentence is flavour instead, so it takes the description
    // colour and deliberately carries no `tipstat` - see dispelWording.
    var dl = el("a", dispelIsOwn(e)
      ? "dispel tipeffflavour"
      : "tipstat dispel" + (e.harmful ? "" : " heal"), dispel);
    dl.href = urlFor("effect/" + e.id);
    blk.appendChild(dl);
    return blk.children.length - before;
  }
  var lines = ccLines(e);
  var bub = bubbleLine(e, progs, level);
  if (bub) lines.push(el("div", "tipstat", bub));
  reactiveLines(e, progs, level).forEach(function (n) { lines.push(n); });
  // What it does to your morale or power. Only the effect's OWN panel used to
  // print this, so a heal skill's tooltip - Chord of Salvation, Raise the
  // Spirit - never said how much it heals, and the block was dropped for
  // having nothing in it.
  var v = e.vital;
  if (v) {
    var init = v.initial !== undefined ? v.initial
             : progAt(progs, v.initialProgression, level);
    var one = vitalLine(e, v, init, v.vpsInitial, v.initialVariance,
                        e.pulseCount ? " on application" : "", false);
    if (one) { var vl = el("div", "tipstat"); vl.appendChild(one); lines.push(vl); }
    var rep = vitalLine(e, v, progAt(progs, v.perPulseProgression, level),
                        v.vpsPerPulse, v.perPulseVariance, overTimeTail(e), true);
    if (rep) { var vr = el("div", "tipstat"); vr.appendChild(rep); lines.push(vr); }
  }
  (e.stats || []).forEach(function (st) {
    var line = statLine(resolveStat(st, progs, level), "level");
    if (line) lines.push(line);
  });
  // Only where there is no value at all: 1,649 effects suppress every modifier
  // line they carry, and for those the sentence IS the effect.
  if (!lines.length) {
    var text = effectSentence(e);
    if (text) {
      // flavour, not a number: it reads in the panel's description colour the
      // way the effect's own page already prints the same string, rather than
      // in the red kept for what a harmful effect does to a target
      var d = multiLine("tipeffflavour", text);
      if (d) lines.push(d);
    }
  }
  // A duration on its own says nothing without the line it belongs to.
  if (!lines.length) return 0;
  var dn = durationNode(e, ref, held);
  if (dn) lines.push(dn);
  // A line that already carries its own link keeps it - a reactive effect's
  // payload is built by effectBody one level down and points at the effect it
  // reflects, and wrapping it again would nest an <a> inside an <a>.
  lines.forEach(function (n) {
    blk.appendChild(n.tagName === "A" ? n : tipEffLink(n, e.id));
  });
  return blk.children.length - before;
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

  // One effect, one block. A toggle regularly names the same effect in both
  // Skill_Toggle_Effect_List and Skill_Toggle_User_Effect_List - 167 such
  // repeats across 121 skills - and the panel drew it twice. Rousing Words
  // (1879109284) printed "Every 3 seconds: +1 Healing Attunement" two rows
  // running. Deduped BEFORE the cap, so the "and N more" count is right and
  // a repeat does not spend one of the six slots. Exactly one of the 167
  // carries anything beyond the id; the first spelling wins.
  var byId = {};
  refs = refs.filter(function (ref) {
    if (byId[ref.id]) return false;
    byId[ref.id] = 1;
    return true;
  });

  /* What one reference puts on the panel. A router that says nothing itself
     ends up here a second time with the branch it routes to, which is why
     this is a function rather than the body of the loop - the branch has to
     be treated exactly as if the skill had applied it directly, carriers,
     over-time groups and all. `depth` only stops a router pointing at a
     router pointing at a router. */
  function blocksFor(e, ref, depth) {
    var made = mainBlocks(e, ref, depth);
    // What it leaves behind when it runs out, under its own heading. A router
    // is reached through mainBlocks, so its branch has already contributed its
    // own expiry group by the time this adds the router's (which has none).
    expireBlocks(e, progs, level).forEach(function (b) { made.push(b); });
    return made;
  }

  function mainBlocks(e, ref, depth) {
    var made = [];
    // What it does to a target it harms reads red; what it gives you reads
    // pale. Everything was green, so a slow looked like a buff.
    var cls = "tipeff" + (e.harmful ? " harm" : "") + (isHeal(e) ? " heal" : "");
    // An over-time applier is two blocks, not one - what it does on landing
    // and what it does on every pulse, each under its own heading.
    var timed = overTimeBlocks(e, progs, level,
                               { withInitial: true, duration: true,
                                 held: held });
    if (timed.length) {
      // Additive, not instead of: 23 of these carriers do say something of
      // their own ("Puts on your costume!" on the 20 Guise skills,
      // "+1 Focus every 5 Seconds" on Stance: Precision) and an early return
      // threw it away.
      var own = el("div", cls);
      if (effectBody(own, e, ref, progs, level, held)) made.push(own);
      timed.forEach(function (b) { made.push(b); });
      return made;
    }
    var blk = el("div", cls);
    var carrier = carrierLines(e);
    if (carrier) {
      carrier.pre.forEach(function (t) {
        blk.appendChild(el("div", "tipstat", t));
      });
      // Build the payload first: with nothing in it the header would announce
      // effects that never arrive.
      var host = el("div");
      (e.nested || []).forEach(function (n) {
        var ne = EFFECT_CACHE[String(n.id)];
        if (!ne) return;
        // A carrier is only a wrapper, so what it hands on decides the colour.
        // Only the heal case: the carrier's own harmful flag already sets
        // "harm", and adding it from the payload too gave a carrier with one
        // harmful and one restorative nested effect both classes at once -
        // "Effects applied to allies" in the red kept for debuffs.
        if (isHeal(ne)) blk.className += " heal";
        effectBody(host, ne, null, progs, level);
      });
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
    // Nothing of its own: if it is a router, draw what it routes to untraited.
    var base = depth < 2 ? comboBaseBranch(e) : null;
    return base ? blocksFor(base, null, depth + 1) : made;
  }

  /* The caster's half of a toggle or a channel: what YOU get while it runs, as
     against what the target is taking. The client heads it "on use:" - Power
     of Knowledge (1879238096) drains the target for lightning and hands you
     power back under that line.

     Only Skill_Toggle_User_Effect_List, which is 43 skills and 25 with
     anything to draw. A plain Skill_User_Effect_List gets no heading: Epic
     Conclusion's "Returns to Neutral Attunement" is one and the client runs
     it straight on. */
  var onUse = {};
  (s.toggleUserEffects || []).forEach(function (e) { onUse[e.id] = 1; });

  /* A skill the reader HOLDS - a toggle, or a channel - keeps its effects for
     exactly as long as it runs, so none of them expires for leaving combat.
     The same test the foot uses to print "Toggle Skill" / "Channel Skill". */
  var held = !!(s.channel ||
                (s.toggleEffects && s.toggleEffects.length) ||
                (s.toggleUserEffects && s.toggleUserEffects.length));

  refs.slice(0, 6).forEach(function (ref) {
    var e = EFFECT_CACHE[String(ref.id)];
    if (!e) return;
    // no application chance of its own: it never lands unless something
    // grants the chance, so it is listed below the panel instead
    if (e.probability === 0) return;
    var made = blocksFor(e, ref, 0);
    if (made.length && onUse[ref.id]) {
      made[0].insertBefore(el("div", "tipeffwho", "on use:"), made[0].firstChild);
    }
    made.forEach(function (b) { out.push(b); });
  });
  // the panel quotes at most six, the way the client's box is bounded - but
  // saying so beats letting the rest disappear without a word
  if (refs.length > 6) {
    var rest = el("div", "tipeff");
    rest.appendChild(el("div", "tipeffdesc", "and " + (refs.length - 6) +
      " more effect" + (refs.length - 6 === 1 ? "" : "s") +
      " - listed in full below"));
    out.push(rest);
  }
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
    // a plain multiplier is not an amount to sign - the game writes "x0.9".
    // fmt already trims trailing zeros; stripping them a second time here made
    // /\.?0+$/ eat the zero off a whole number, so x10 rendered as "x1".
    else { return "x" + fmt(v, 3); }
  } else if (pct) {
    n = v * 100; suffix = "%";
  } else {
    n = v;
  }
  if (st.op === "Subtract") n = -Math.abs(n);
  var shown = signed ? n : Math.abs(n);
  // No thousands separator: the client writes "+7800 Tactical Mitigation".
  var out = fmt(shown, 1).replace(/\.0$/, "");
  if (signed && shown > 0) out = "+" + out;
  return out + suffix;
}

/* The client's own wording for a modifier, from Mod_DescriptionOverride -
   "Slows movement speed by 30%". Its "*" is the placeholder the value goes
   into; a sign or "x" already in front of it means the value goes in
   unsigned. */
/* Thirteen mounted-combat trait descriptions use a selector markup nothing
   else in the data does:

     "#1: * : The following skills will bleed: #1:{None|Keen Strike...[G]|...}"

   "#1:" names a branch and the braces hold one option per class, tagged with a
   letter. Nothing here knows which branch a reader is, and inventing a mapping
   from those letters would be a guess - so the scaffolding is stripped and the
   options are listed. Left alone, the raw "#1:{None|...}" was being printed. */
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

function statWording(st, meta) {
  var d = st.description;
  if (!d) return null;
  d = expandSelector(d);
  if (d.indexOf("*") === -1) return d;
  if (st.value === undefined || st.value === null) return null;
  /* A wording whose LAST placeholder is followed by no words at all wants the
     property's NAME there, not the value a second time. Duty Bound (effect
     1879084065) words its Health_MaxLevel modifier "+ *   * " and the client
     writes "+5% Maximum Morale"; pasting the amount into both gave the
     nonsense "+5% x1.05".

     Two placeholders alone do not mean this - the other multi-placeholder
     wordings spell out what each one is ("+ * Glory Gain\n+ * Commendation
     Gain", "+ * Attack Damage\n+ * Savage Bleed Damage") and want the value
     in every one of them. The trailing test is what separates the two, and it
     matches exactly 14 modifier lines on 12 records: the racial Maximum
     Morale and Power buffs (Duty Bound, Motivated, Power of the Eldar, Mood -
     Max Morale Bonus), Weakening Wheeze's two regen debuffs, and
     Mischievous's "- * s  * " -> "-5s Riddle Cooldown". */
  var tailName = "";
  if (d.split("*").length > 2 && /\*[^A-Za-z0-9*]*$/.test(d)) {
    d = d.replace(/\*[^A-Za-z0-9*]*$/, "");
    tailName = " " + ((meta && meta.n) || st.stat || "");
  }
  d = d.replace(/([-+x])[ \t]*\*/g, function (_, sign) {
    // A wording that puts a SIGN in front of its placeholder is asking for a
    // delta, not a factor: "- * Outgoing Damage" on a Multiply of 0.99 is the
    // client's "-1% Outgoing Damage", and pasting the factor in gave the
    // nonsense "-x0.99". 109 wordings are written this way.
    if ((sign === "-" || sign === "+") && st.op === "Multiply" &&
        typeof st.value === "number" && !(meta && meta.p)) {
      return sign + fmt(Math.abs((st.value - 1) * 100), 3) + "%";
    }
    var amt = statAmount(st, meta, false);
    // A plain multiplier is written "x0.8" by statAmount, and 508 wordings
    // already put the x in front of their own placeholder - "x * Outgoing
    // Damage". Pasting both gave "xx0.8".
    if (sign === "x" && amt.charAt(0) === "x") return amt;
    return sign + amt;
  });
  d = d.replace(/\*/g, statAmount(st, meta, true));
  return (d + tailName).replace(/[ \t]{2,}/g, " ").trim();
}

/* One line of a tooltip: "+30% Advance Damage". The label and the percentage
   flag come from the property's own metadata, which is how the client writes
   these - but where the modifier carries its own wording, that wins. */
function statLine(st, xLabel) {
  // Mod_DescriptionOverride set to "(NONE)" or to a blank string is the
  // author switching this line off, and the client honours that: Timeless
  // Echoes of Battle words its Song modifier "- * Target Song and Cry Resist
  // Rating" and silences the sibling Cry modifier, because the one line
  // already covers both. 6,257 effect modifiers and 830 trait modifiers are
  // marked this way - most of them flag properties with no number to show.
  if (st.silent) return null;
  var meta = PROPS && PROPS[st.stat];
  var name = meta ? meta.n : st.stat;
  var v = st.value;
  var said = statWording(st, meta);
  if (v === undefined || v === null || typeof v === "boolean") {
    if (said) return multiLine("tipstat", said);
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
  // A modifier whose value is nil until something else grants it used to print
  // a grey "<name>  (when traited)" line. The panel shows the skill as it is
  // with nothing traited, so there is no number and nothing to say: it falls
  // through to the zero case below, which keeps a custom wording and drops a
  // bare property name.
  if (v === 0) {
    // A zero is often just a carrier for the wording. Muscle Memory's entire
    // effect is a Mod_DescriptionOverride hung on a 0 to Stat_Will - "Using
    // skills from Battle Memory will restore a small amount of Power" - and
    // dropping the line for having no number threw away the only content it
    // had. 135 modifier lines on traits, 2,112 on effects and 716 on item
    // sets were being lost this way.
    return said ? multiLine("tipstat", said) : null;
  }
  var line = said ? multiLine("tipstat", said)
                  : el("div", "tipstat", statAmount(st, meta, true) + " " + name);
  return line;
}

/* Some wordings carry their own line breaks, written as a literal \n - and
   some carry the client's colour markup too. Dissonance's Ballad Damage
   modifier is worded "+ * Ballad Damage \n\n<rgb=#FF7700> All Heals become
   Self-only</rgb>", and writing it as a plain text node printed the tags. */
function multiLine(cls, str) {
  // Split first and the markup breaks: Adamant's wording is
  // "<rgb=#00FFDD>Each Fervour consumed increases potency by 4%.\n</rgb>",
  // and cutting on the newline leaves an unclosed tag on one line and a bare
  // closing tag on the next, neither of which richText can pair up. So the
  // blank runs are collapsed to single breaks and the whole string, tags
  // intact, goes through richText - which turns the breaks into <br> itself.
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

/* Damage is the one line that cannot be resolved here: the client multiplies
   the skill's coefficients by the character's weapon and mastery. Those two
   are written as W and A and explained below the panel. */
/* The damage-add term is real only where the ATTACK supplies an additional
   DPS of its own, through Skill_AttackHook_DPSAddMod_Progression. 1,002 of the
   1,049 hooks that carry a damage-add multiplier have no such progression, so
   their second term multiplies zero - and the panel was printing "6.545 x W +
   6.545 x A" for all of them, which reads as half the damage coming from
   somewhere it never comes from. Bash is one: its tooltip is pure weapon
   contribution, and solving a real in-game tooltip against it only closed once
   the A term was dropped. */
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
  // A hook with no weapon and no damage-add contribution is not a hook that
  // deals no damage - it is one whose damage IS Skill_AttackHook_HookDamageMax,
  // a flat curve read at the character's level. That is how nearly every creep
  // skill is written: Gut Punch's 2,070 at 160 lives only there, and requiring
  // a W or an A term meant 6,300 attack hooks printed no damage line at all.
  if (!parts.length) {
    if (!cap) return null;
    var flat = cap * mod;
    // Under 1 it is not a damage figure at all: 27 of the 33 such hooks carry
    // a Hook Damage Max modifier, which means the curve is a coefficient some
    // property scales - a skirmish soldier's 0.4, not four tenths of a hit.
    // Printing it rounded gave "0 Common Damage".
    if (flat < 1) return null;
    return flatDamage(a, flat);
  }
  var expr = parts.join(" + ");
  if (mod !== 1) expr = fmt(mod) + " x (" + expr + ")";
  // W and A are the two numbers this data cannot know. Once the reader has
  // supplied them once, in the sidebar, the expression is just arithmetic.
  var W = parseFloat(PREFS.wdps), A = parseFloat(PREFS.dmgAdd);
  var M = parseFloat(PREFS.mastery);
  var resolved = null;
  // Mastery alone resolves nothing - it multiplies a weapon number that is
  // not there yet - so the gate stays on W and A.
  if (!isNaN(W) || !isNaN(A)) {
    resolved = ((a.implementContribution || 0) * (isNaN(W) ? 0 : W) +
                (hasDamageAdd(a) ? a.damageContribution : 0)
                  * (isNaN(A) ? 0 : A)) * mod;
    // The cap is the skill's own ceiling, so it bites before the character's
    // multipliers rather than after them.
    if (cap && resolved > cap) resolved = cap;
    if (!isNaN(M) && M > 0) resolved *= 1 + M / 100;
  }
  var span = el("span", "tv");
  span.appendChild(el("code", "dmg", expr));
  if (resolved !== null) {
    span.appendChild(el("span", "resolved", "  =  " + num(resolved)));
  }
  var hand = a.usesPrimary ? "Main-hand" : a.usesSecondary ? "Off-hand"
           : a.usesRanged ? "Ranged" : a.usesTactical ? "Tactical" : null;
  var lead = [enumWord("damageType", a.damageType) || null,
              hand ? "(" + hand + ")" : null]
    .filter(Boolean).join(" ");
  span.appendChild(el("span", null, "  " + (lead ? lead + " " : "") + "Damage"));
  var tail = [];
  if (cap) tail.push("max " + num(cap));
  if (tail.length) span.appendChild(el("span", "muted", "  " + tail.join(", ")));
  return span;
}

/* The same line for a hook whose damage is a flat number rather than an
   expression - no W, no A, nothing for the reader to supply. */
function flatDamage(a, value) {
  var span = el("span", "tv");
  span.appendChild(el("code", "dmg", num(value)));
  if (a.damageMaxVariance) {
    span.appendChild(el("span", "muted", "  +/-" + fmt(a.damageMaxVariance * 100, 0) + "%"));
  }
  var hand = a.usesPrimary ? "Main-hand" : a.usesSecondary ? "Off-hand"
           : a.usesRanged ? "Ranged" : a.usesTactical ? "Tactical" : null;
  var lead = [enumWord("damageType", a.damageType) || null,
              hand ? "(" + hand + ")" : null]
    .filter(Boolean).join(" ");
  span.appendChild(el("span", null, "  " + (lead ? lead + " " : "") + "Damage"));
  return span;
}

/* W was described here as "its DPS over the skill's animation", which is wrong
   and wrong by a factor of two on a skill whose action duration is 2s. Solving
   a real Bash tooltip settled it: W is the weapon's own damage roll, and the
   spread between the panel's low and high figures is the weapon's own spread,
   not a coefficient of DPS. The multipliers below W and A are named too, since
   a reader comparing the panel against the game will be short by exactly them.
*/
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
        td1.appendChild(propCode(prop));
        tr.appendChild(td1);
        tr.appendChild(cells[i]);
        t.appendChild(tr);
      });
    });

    wrap.textContent = "";
    // the class filter can drop every group, which used to leave the header
    // row standing over nothing
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

  // what the properties it grants actually do
  var allStats = [];
  var seenStat = {};
  (t.rarities || []).forEach(function (r) {
    (r.stats || []).forEach(function (st) {
      if (!seenStat[st.stat]) { seenStat[st.stat] = 1; allStats.push(st); }
    });
  });
  // progressions are loaded for this route and were being thrown away here,
  // so "scales with item level" never drew the curve it was describing
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

/* An item set: the pieces that count towards it, and what each threshold
   grants. The effects hanging off a threshold are where every Itemset_*
   property in the game comes from - nothing else sets them. */
/* An item page, kept to the one question this database answers about an item:
   what does it put on you. Nothing about where it drops or what it sells for -
   an item is here because it is the answer to "what applies that effect". */
/* Classes are named by their internal code on an item ("Runekeeper"), which
   is the same spelling the trait trees use. */
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

/* An item page. Until the extractor learned the four equipment classes this
   was a name, an icon and a category - the whole gear half of the game was
   missing, which is also why a set could not link its own pieces. */
function renderItem(it, D, MS, progs) {
  var host = el("div");
  var head = el("div", "head");
  var img = el("img");
  img.src = iconUrl(it.icon);
  img.alt = "";
  img.onerror = function () { this.style.visibility = "hidden"; };
  head.appendChild(img);
  var h = el("div");
  h.appendChild(el("h2", null, it.name));
  h.appendChild(el("div", "id", "item " + it.id + "  /  0x" +
                   it.id.toString(16).toUpperCase()));
  head.appendChild(h);
  host.appendChild(head);

  var tags = el("div", "tags");
  tags.appendChild(el("span", "tag kind", "Item"));
  if (it.category) tags.appendChild(el("span", "tag", spaceWords(it.category)));
  // the same quality tokens the tracery tables use, so one colour is one
  // rarity everywhere on the site
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

  // Damage is stored as an average and a spread: 33.96 at 0.25 is the client's
  // "25.5 - 42.5 Common Damage".
  var dmg = null;
  if (it.damage) {
    var v = it.damageVariance || 0;
    dmg = v ? num(it.damage * (1 - v)) + " - " + num(it.damage * (1 + v))
            : num(it.damage);
    if (it.damageType) dmg += " " + spaceWords(enumWord("damageType", it.damageType));
  }
  var bind = it.bind ? "Binds " + it.bind : (it.bindAccount ? "Bound to account" : null);
  if (bind && it.bindAccount && it.bind) bind += ", to your account";

  section(host, "At a glance", statRow([
    ["Item level", it.itemLevel],
    ["Requires level", it.minLevel],
    ["Requires", classRun(it.requiresClass, D), "wide"],
    ["Armour", it.armour ? num(it.armour) : null],
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

  // Which set it belongs to - the reverse of the set page's own piece list,
  // and the answer to "what is the rest of this armour worth".
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

  // The item's own Mod_Array: 77,075 items carry one, and it is the same shape
  // a trait or an effect uses, so every property links to its own page and the
  // curve resolves at the reader's item level.
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
  // What it hands over, and what gates it. An item can be here for the gate
  // alone: Fragment of Mordirith's Crown grants nothing and cannot be used
  // while a particular effect is on you, and that is the whole of its entry.
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

/* A property-response callback: "while this world property reads 4, everything
   matching this filter gets these effects". It is how the Ettenmoors relic
   buffs land on a whole side at once, and until now nothing on the effect's
   page said where it came from. The callback itself has no name, so what is
   worth printing is the condition and the audience. */
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
    // Which world property. It comes from the response map that pairs this
    // callback with a world event; a few callbacks are driven by more than
    // one, and naming them all beats naming none.
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

/* ---------------- what a class resource puts on you ---------------- */

/* Nothing casts Extremely Foreward (1879466226). No trait grants it, no item
   carries it, no skill applies it - it is simply on you while the Mariner's
   Balance reads 44 to 50, and a pip's step list is the only thing in the data
   that says so. Its page used to read "permanent, beneficial" and stop there.

   pips.json ships the forward direction (each resource, each band, the effects
   that sit on you inside it); this is the reverse, built once from it rather
   than as its own file, because pips.json is 25 records long and is already
   loaded on every record page. */
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
  // Balance - Aft sits on the bottom two bands, 0-6 and 7-18, which is one
  // stretch with a line drawn through it: the boundary is where a DIFFERENT
  // effect on the same step changes, not this one. Touching bands of one
  // resource are merged so the page says 0 to 18 rather than naming a
  // threshold the player never crosses.
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

/* Which end of a two-ended resource a band sits on, in the name the client
   uses for it - the one derived from the effects on that side. */
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
    // A band covering the whole range is not a condition: the resource always
    // reads something, so the effect is simply always there.
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

/* A hotspot is a patch of ground that does something to whoever stands in it.
   Like a summon it has no page - it is a thing in the world, not a record a
   reader browses - so it is named rather than linked. */
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

/* A modifier can hand over an effect rather than a number - "while this
   property is set, you also get X". A Big Battle banner upgrade switches its
   aura on this way, and nothing on the aura's page said so. */
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

/* Which items put an effect on you - the only source a food buff or a potion
   effect has. 2,903 effects have no other. */
function itemSources(rec) {
  if (!rec.fromItems || !rec.fromItems.length) return null;
  var WORDS = { onUse: "on use", whileEquipped: "while equipped",
                hotspot: "from its hotspot", grantsSkill: "grants it",
                usesSkill: "uses it", mountSkillShort: "on a short steed",
                mountSkillTall: "on a tall steed", barsSkill: "bars it" };
  // One item can relate to a skill twice - a skill scroll grants it and then
  // bars itself once you know it - so the item is named once carrying both.
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

  // the properties the thresholds set, and what in the game reads them
  var allStats = [];
  var seenStat = {};
  (st.bonuses || []).forEach(function (b) {
    (b.stats || []).forEach(function (x) {
      if (!seenStat[x.stat]) { seenStat[x.stat] = 1; allStats.push(x); }
    });
  });
  section(host, "What those properties affect",
          grantsBlock(allStats, MS, progs, "Item level", D, freepClasses(D)));

  // The pieces. These were printed as bare ids, because the item extraction
  // was IItem only and 10,583 of the 10,607 member ids across every set - all
  // the armour, weapons and jewellery - had no record to name. They do now.
  if ((st.members || []).length) {
    section(host, "Pieces", linkList(st.members, "item"));
  }
  return host;
}

/* ---------------- your character ---------------- */

/* Level, class and the two weapon numbers, remembered between visits. Every
   page already had its own level box; setting the same number over and over
   was the single most repetitive thing about using the site. Stored per
   browser, never sent anywhere. */
var PREFS = (function () {
  try { return JSON.parse(localStorage.getItem("lotrodb.prefs")) || {}; }
  catch (e) { return {}; }
})();

function savePrefs() {
  // a private window, or storage switched off, must not break the page
  try { localStorage.setItem("lotrodb.prefs", JSON.stringify(PREFS)); }
  catch (e) { /* nothing to do - the settings just do not persist */ }
}

/* The level a page should open at: the reader's own, when they have said. */
function preferredLevel(fallback) {
  var v = parseInt(PREFS.level, 10);
  if (!isNaN(v) && v > 0) return Math.min(v, LEVEL_CAP);
  return fallback;
}

/* Positively known to belong to this class. Unlike reachable(), an unplaced
   source does NOT pass: "show me Champion things" means the ones we can say
   are the Champion's, not everything we cannot rule out. */
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

  // the class list and the attribution index are only needed once somebody
  // actually opens this, so neither is on the critical path to first paint
  Promise.all([classData(), sourceClasses()]).then(function (r) {
    SRC_CLASS = r[1] || {};
    // a class restored from a previous visit could not be applied until now
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

/* ---------------- stacking groups ---------------- */

/* SMALL is where naming the members beats counting them. 579 of the 654
   groups are under ten, and for those "(2 others)" was making the reader open
   a page to learn two names. The big ones keep the count - a boss-fight class
   with 52 members is a list nobody reads in a stat cell. */
var STACK_LIST_MAX = 10;

/* A stacking group ships as {m: [[id, class priority, 1 if it guards the
   class]], max, perCaster}. Older builds wrote the member array on its own,
   and older ones still wrote bare ids, so all three shapes are read. */
function stackMembers(group) {
  if (!group) return [];
  return group.m || (group.length !== undefined ? group : []);
}
/* How many of the class a target can hold, and whether that is counted per
   caster. Absent means one - which is the whole point of an equivalence
   class, and true of all but 18 of the groups on this site. */
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
    // a class with no other member does not stack against anything in
    // particular, so there is nothing to link to
    return el("span", "muted", name);
  }
  // One link, count included. The count used to be a separate span that
  // butted straight up against the name with no gap - "MN Com Bossfight 752
  // others" - and, not being part of the anchor, looked clickable without
  // being so. It goes to the same page either way now.
  var a = el("a", "stacklink");
  a.href = stackUrl(name);
  a.appendChild(document.createTextNode(spaceWords(name)));
  var members = stackMembers(group);
  var others = stackIds(group).filter(function (id) { return id !== selfId; });
  if (members.length >= STACK_LIST_MAX || !others.length) {
    var rest = members.length - (others.length === members.length ? 0 : 1);
    // a real space, not a CSS gap - this text gets read and copied
    a.appendChild(el("span", "stackcount",
      " (" + rest + " other" + (rest === 1 ? "" : "s") + ")"));
    return a;
  }
  var box = el("div");
  box.appendChild(a);
  var list = el("div", "stackmembers");
  // A stacking group is exactly where one name repeats - two of the three
  // Reveal Weakness effects are called "Reveal Weakness" - so the id trails
  // an ambiguous one, as it does everywhere else on the site.
  var dup = ambiguousNames(others);
  list.appendChild(linkRun(others.map(function (id) {
    return function () {
      return nameOf(id) ? readerLink(id, "effect", "eff", dup) : null;
    };
  }), STACK_LIST_MAX, 0));
  box.appendChild(list);
  return box;
}

/* Everything sharing one equivalence class - which is to say, everything that
   overwrites rather than adds to the others. The effect page could name the
   class but never say what else was in it, because effects are sharded 128
   ways and finding the rest meant fetching all of them. */
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

  // The old wording said a second application simply replaces the first,
  // which reads as a disarm overwriting the immunity to disarm sitting in the
  // same class. The class is a slot; Effect_ClassPriority decides who holds
  // it, and a protection effect in the list is not competing for it at all.
  // Most classes hold one member, but 18 of them hold more - the three
  // Ballads among them - and saying "one at a time" of those was simply wrong.
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
        // which of them is dropped once the limit is reached is not something
        // the client data says, so it is not claimed here
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
    // the record itself is a shard away; the index carries neither duration
    // nor kind, so this column is filled in by the effect page it links to
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

  // A world property is watched rather than granted, so this comes first and
  // may be the whole page.
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

  // A property page is the one place the reader list is long enough to be
  // unreadable flat - Resistance Penetration Percent is read by 194 skills
  // across ten classes. Grouping by class turns it into ten short answers.
  section(host, "What it scales", readersByClass(prop, MS, D)
                                  || el("p", "muted", "Nothing reads it."));
  return host;
}

/* ---------------- grouping a long list by class ---------------- */

/* Free Peoples first, then monster play, each alphabetically, and whatever the
   data cannot place last. Shared, so a property page's readers and an effect
   page's skills come out in the same order rather than each page inventing
   one. */
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

/* The class's icon and name, and a count of what is under it. */
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
  // a real space, not just a CSS margin - this text gets read and copied
  if (tail) head.appendChild(el("span", "via", " " + tail));
  return head;
}

/* Which class or classes can reach each of these, in that order. A record two
   classes can reach is listed under both: that is the truthful answer to "can
   MY class do this", asked once per class. */
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

/* A skill list grouped the way a property page groups its readers. Effect
   1879477203 is applied by 42 skills across five classes, and flat that is a
   wall a reader has to scan for their own class; grouped it is five short
   answers.

   With everything in one bucket the heading would say nothing the page does
   not already say, so a single-class list stays flat - which is most effects.
   Falls back to flat when the class data has not loaded. */
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

/* The readers of one property, in class order, with everything the data
   cannot place gathered at the end rather than mixed through. */
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

/* One field per line - "Critical Hit on A, B, C" - with a record that scales
   two of its own numbers by this property named once, carrying both fields. */
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

/* ---------------- what changed ---------------- */

/* The extractor snapshots every record's name and a hash of its contents on
   each rebuild, and diffs against the one the previous rebuild left. Nowhere
   else says what a LOTRO patch actually did to the numbers. */
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
        // a removed record has no page left to link to
        body.appendChild(el("span", null, row[1] || ("#" + id)));
      }
      if (kind === "renamed") {
        // the block above built the "added" shape; a rename needs the new name
        // as the link and the old one beside it
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

/* ---------------- routing ---------------- */

function route() {
  // a panel left hanging over a page that is being replaced
  hoverHide();
  var detail = document.getElementById("detail");
  var path = routePath();
  // on a phone the list and the page cannot both have the screen; once
  // something is open, the list shrinks to a strip
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
    // the index types traceries "y" and essences "z"; hardcoding "y" meant an
    // essence row never highlighted
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
        // a granting property can come from an item set; without this the set
        // links on this page rendered as bare ids
        SETS = res[5] || {};
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

  var sm = /^set\/(\d+)$/.exec(path);
  if (sm) {
    var sid = parseInt(sm[1], 10);
    selected = "g" + sid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    // A set page IS its pieces, so this is the one route that waits for the
    // item index rather than naming them late - six raw ids where the content
    // should be is worse than a moment more of "loading...".
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
                 modSources(), progressions(), itemSetData(), sourceClasses()])
      .then(function (res) {
      PROPS = res[2] || {};
      SETS = res[5] || {};
      SRC_CLASS = res[6] || {};
      detail.textContent = "";
      var rec = res[0];
      if (!rec) {
        detail.appendChild(el("div", "empty", "No item with id " + iid + "."));
        return;
      }
      detail.appendChild(renderItem(rec, res[1], res[3], res[4]));
      detail.scrollTop = 0;
      document.title = rec.name + " - LOTRO Skills and Effects";
    });
    runSearch();
    return;
  }

  var cm = /^(class|trait)\/(\d+)$/.exec(path);
  if (cm) {
    var what = cm[1], cid = parseInt(cm[2], 10);
    // traits are in the index as "r"; leaving this null meant a trait row in
    // the results list never highlighted
    selected = (what === "class" ? "c" : "r") + cid;
    detail.textContent = "";
    detail.appendChild(el("div", "muted", "loading..."));
    // sourceClasses is what scopes a trait page to its own class. Without it
    // SRC_CLASS is null, reachable() waves everything through, and a Warden
    // trait's "what it scales" cell answers with Minstrel cries - but only
    // when the trait page is the FIRST thing loaded, which is why this was
    // easy to miss by clicking into it from a skill.
    var ctJobs = [classData(), modSources(), progressions(), itemSetData(),
                  propertyData(), sourceClasses()];
    Promise.all(ctJobs).then(function (res) {
      var D = res[0], MS = res[1], progs = res[2];
      // a trait modifier can be scaled by a property an item set grants
      SETS = res[3] || {};
      PROPS = res[4] || {};
      SRC_CLASS = res[5] || {};
      var rec = what === "class" ? D.classes[String(cid)] : D.traits[String(cid)];
      if (!rec) {
        detail.textContent = "";
        detail.appendChild(el("div", "empty", "No " + what + " with id " + cid + "."));
        return;
      }
      // A trait panel quotes its effects' wording, so those records have to
      // be in hand before it is drawn.
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
    // leaving the previous page up presented it as the answer to an address
    // this site does not serve
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

/* Items are their own index, fetched after the first paint and merged in -
   they would more than double index.json, which is downloaded before anything
   is drawn. A search run in the meantime simply has no items in it yet and is
   re-run once they land. The same trick searchText already uses.

   MERGED, not concatenated. Every essence and tracery used to be in both
   files, and since nameOf() rebuilt its id map front to back the item entry
   won: 1,624 records silently changed type the moment this landed, so an
   essence appeared twice in the results, a property page called it a tracery,
   and isGearSource() stopped recognising it. normalize.py no longer emits the
   duplicates; this keeps the richer record whatever the data does.

   The file is written column-wise - a category table plus [id, name, category
   index, icon] per row - because 99,459 copies of the same six keys is most of
   a megabyte of nothing. */
var ITEMS_IN = false;
function loadItemIndex() {
  if (ITEMS_IN) return Promise.resolve();
  ITEMS_IN = true;
  return getJSON(dataUrl("data/itemIndex.json")).then(function (blob) {
    var cats = (blob && blob.c) || [];
    var rows = (blob && blob.r) || blob || [];
    nameOf(0);                       // force BY_ID to exist before we test it
    var add = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var e = row && row.length !== undefined && row.i === undefined
        ? { i: row[0], n: row[1], t: "i", c: cats[row[2]] || "Item",
            k: row[3] || 0, h: 0 }
        : row;
      // an id index.json already names is that record, not an item
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

/* A page is drawn as soon as its own data is in hand, and the item index is
   several megabytes behind it - so a skill that hands you an item drew the
   link as "#1879216028". Rather than make every page wait for a file most of
   them do not need, the links that could not be named say which id they are
   waiting for, and are filled in when it arrives. */
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

/* Mark a link (and its icon) as still waiting for a name. */
function pending(a, img, id) {
  a.setAttribute("data-nameid", id);
  if (img) img.setAttribute("data-nameid", id);
}

/* ---------------- boot ---------------- */

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
/* "/" from anywhere puts the cursor in the search box, the way every search
   -first site does. */
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
/* One delegated handler turns every in-site link into a client-side
   navigation, so nothing else has to know it is inside a single-page app.
   Anything that is not a plain left click on a same-origin link under BASE is
   left to the browser: modified clicks, new tabs, downloads and outbound links
   all behave the way the reader expects them to. */
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

/* Every link ever shared was "...#/skill/123". Rewrite one into the real path
   in place, so an old bookmark still lands on the page it named. */
function migrateHash() {
  var m = /^#\/(.*)$/.exec(location.hash || "");
  if (!m) return;
  history.replaceState({}, "", urlFor(m[1]));
}

/* ---------------- the panel that follows the pointer ---------------- */

/* Every link on the site names a record that has a panel of its own, and until
   now the only way to read one was to open the page. Hovering anything that
   points at a skill, an effect or a trait - the text, the link, or the icon
   beside it - draws that record's panel where the pointer is, built by the
   SAME function the record's own page uses. There is no second wording to
   keep in step with the first: change tooltipPanel and the hover changes too.

   Only those three kinds. Items, sets, traceries, classes, properties and
   stacking groups have pages but no panel, and inventing one here would be
   exactly the second wording this avoids.

   Everything a panel needs is the set the record route already loads, and all
   of it is behind a cached promise - so the first hover may fetch one shard
   and every hover after it is instant. */

var HOVER_DELAY = 180;   // long enough that crossing a list opens nothing
var HOVER_GAP = 14;      // clear of the pointer on both axes
var HOVER = { box: null, token: 0, timer: null, key: null, x: 0, y: 0 };

/* The record a link names, or null where it names something else. Deliberately
   the same checks the click handler makes - a target, a download, another
   origin and an off-site scheme are all somebody else's link. */
function hoverRoute(a) {
  if (!a || a.target || a.hasAttribute("download")) return null;
  var href = a.getAttribute("href");
  if (!href || href.charAt(0) === "#" || /^[a-z]+:/i.test(href)) return null;
  var u;
  try { u = new URL(a.href); } catch (e) { return null; }
  if (u.origin !== location.origin || u.pathname.indexOf(BASE) !== 0) return null;
  var m = /^(skill|effect|trait)\/(\d+)$/.exec(u.pathname.slice(BASE.length));
  return m ? { kind: m[1], id: parseInt(m[2], 10) } : null;
}

/* What the pointer is over. A link answers for itself - a search row wraps its
   own icon, so that case is covered too. Every list built by linkList puts the
   icon BESIDE the link rather than inside it, so an image with no link of its
   own asks the row it sits in. */
function hoverSubject(node) {
  if (!node || node.nodeType !== 1) return null;
  var a = node.closest ? node.closest("a[href]") : null;
  // a link to something without a panel is not a miss to fall through from
  if (a) return hoverRoute(a);
  if (node.tagName === "IMG" && node.parentElement) {
    return hoverRoute(node.parentElement.querySelector("a[href]"));
  }
  return null;
}

/* The side files a panel reads, assigned to the same globals the record route
   assigns them to. Every one resolves to the object the route would have put
   there, so doing it from a hover cannot disagree with the page underneath. */
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

/* One panel, built exactly as its page builds it - the same preload, the same
   level. A skill reads its own top level the way its page does; an effect and
   a trait read the level box's preference against the cap. */
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

/* Beside the pointer, flipped to whichever side it fits. A panel taller than
   the window is pinned to the top and clipped, with a fade saying so - it
   cannot be scrolled, because the box takes no pointer events at all and must
   not, or moving onto it would count as leaving the link it belongs to. */
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
    // the pointer has moved on: this answer is for a hover that is over
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
  }, function () { /* a shard that would not load is not worth a message */ });
}

if (window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.addEventListener("mouseover", function (ev) {
    var sub = hoverSubject(ev.target);
    if (!sub) { if (HOVER.key) hoverHide(); return; }
    var key = sub.kind + "/" + sub.id;
    // the icon and the name beside it are one subject, so crossing between
    // them must not restart the wait
    if (key === HOVER.key) return;
    hoverHide();
    HOVER.key = key;
    HOVER.x = ev.clientX;
    HOVER.y = ev.clientY;
    var token = HOVER.token;
    HOVER.timer = setTimeout(function () { hoverOpen(sub, token); },
                             HOVER_DELAY);
  });
  // Track the pointer only while the panel is still coming: once it is up it
  // stays where it was drawn, the way the game's own tooltips do.
  document.addEventListener("mousemove", function (ev) {
    if (HOVER.key && (!HOVER.box || HOVER.box.hidden)) {
      HOVER.x = ev.clientX;
      HOVER.y = ev.clientY;
    }
  });
  document.addEventListener("mouseleave", hoverHide);
  document.addEventListener("click", hoverHide, true);
  // capture, so a scroll inside the results list or the page counts too
  document.addEventListener("scroll", hoverHide, true);
  window.addEventListener("blur", hoverHide);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hoverHide();
  });
}
