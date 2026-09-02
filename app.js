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

function classData() {
  return Promise.all([sideFile("classes"), sideFile("traits"), sideFile("traitTrees")])
    .then(function (r) { return { classes: r[0], traits: r[1], trees: r[2] }; });
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
  return s.replace(/\.?0+$/, "");
}

function secs(n) { return n === undefined || n === null ? "-" : fmt(n) + "s"; }

function titleCase(s) {
  if (Array.isArray(s)) return s.map(titleCase).join(", ");
  return String(s).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) {
    return c.toUpperCase();
  });
}

/* ---------------- search ---------------- */

var typeOn = { s: true, e: true, c: true };
var catFilter = "";

function score(name, q) {
  var n = name.toLowerCase();
  if (n === q) return 0;
  if (n.indexOf(q) === 0) return 1;
  var w = n.indexOf(" " + q);
  if (w >= 0) return 2;
  var i = n.indexOf(q);
  if (i >= 0) return 3 + i / 100;
  return -1;
}

function runSearch() {
  var q = document.getElementById("q").value.trim().toLowerCase();
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
      var s = score(r.n, q);
      if (s < 0) continue;
      out.push([s, r]);
    } else {
      // With no query, put properly-named content first: the DAT is full of
      // internal entries like "a melee attack" that would otherwise fill the list.
      out.push([/^[A-Z]/.test(r.n) ? 0 : 1, r]);
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
    var kindWord = r.t === "s" ? "Skill" : r.t === "e" ? "Effect" : "Class";
    txt.appendChild(el("div", "mt", kindWord +
      (r.c && r.c !== "Class" ? " - " + titleCase(r.c) : "")));
    row.appendChild(img);
    row.appendChild(txt);
    row.onclick = function () {
      location.hash = "#/" + (r.t === "s" ? "skill" : r.t === "e" ? "effect" : "class") + "/" + r.i;
    };
    frag.appendChild(row);
  });
  box.appendChild(frag);
  document.getElementById("count").textContent =
    total + " match" + (total === 1 ? "" : "es") + (total > 300 ? ", showing 300" : "");
}

/* ---------------- progression chart ---------------- */

/* Progression arrays are a fixed-width table, so a curve with 5 real values is
   stored as 5 values and 155 zeros. Plotting the padding is misleading. */
function trimPadding(pts) {
  var end = pts.length;
  while (end > 2 && pts[end - 1][1] === 0) end--;
  return end === pts.length ? pts : pts.slice(0, end);
}

function curvePoints(p) {
  if (!p) return null;
  if (p.type === "linear") {
    return trimPadding(p.points.filter(function (pt) {
      return typeof pt[0] === "number" && typeof pt[1] === "number";
    }));
  }
  if (p.type === "array") {
    var min = p.minIndex === undefined ? 1 : p.minIndex;
    return trimPadding(p.values.map(function (v, i) { return [min + i, v]; })
      .filter(function (pt) { return typeof pt[1] === "number"; }));
  }
  return null;
}

/* A few discrete steps read better as a table than as a line - a trait with
   five ranks is a comparison of five values, not a trend. */
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
  var cap = el("div", "muted", label);
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
    (xLabel || "level").toLowerCase() + " " + x0 + " to " + x1);
  cap.style.fontSize = "11.5px";
  wrap.appendChild(cap);
  return wrap;
}

/* ---------------- rendering ---------------- */

function nameOf(id) {
  for (var i = 0; i < INDEX.length; i++) if (INDEX[i].i === id) return INDEX[i];
  return null;
}

function linkList(refs, kindGuess) {
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
    var a = el("a", null, meta ? meta.n : "#" + id);
    var kind = meta ? (meta.t === "s" ? "skill" : meta.t === "e" ? "effect" : "class") : kindGuess;
    a.href = "#/" + kind + "/" + id;
    li.appendChild(a);
    var bits = [];
    if (r && r.duration !== undefined) bits.push(fmt(r.duration) + "s");
    if (r && r.spellcraft !== undefined) bits.push("sc " + fmt(r.spellcraft));
    if (r && r.via) bits.push(r.via);
    if (bits.length) li.appendChild(el("span", "via", bits.join("  ")));
    ul.appendChild(li);
  });
  return ul;
}

function section(host, title, node) {
  if (!node) return;
  host.appendChild(el("h3", "sec", title));
  host.appendChild(node);
}

function statRow(pairs) {
  var box = el("div", "stats");
  pairs.forEach(function (p) {
    if (p[1] === undefined || p[1] === null || p[1] === "-") return;
    var s = el("div", "stat");
    s.appendChild(el("div", "k", p[0]));
    s.appendChild(el("div", "v", p[1]));
    box.appendChild(s);
  });
  return box.children.length ? box : null;
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
  var pts = curvePoints(progs[String(progId)]);
  if (!pts || pts.length < 2) return false;
  host.appendChild(chart(pts, label, "Level"));
  return true;
}

function renderSkill(s, progs, D, MS) {
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

  if (s.desc) host.appendChild(richPara("desc", s.desc));

  if (D) section(host, "How you get it", obtainedBlock(s, D));

  var range = s.maxRange !== undefined
    ? (s.minRange !== undefined ? fmt(s.minRange) + " - " : "") + fmt(s.maxRange) + "m"
    : null;
  section(host, "At a glance", statRow([
    ["Cooldown", s.cooldown !== undefined ? secs(s.cooldown) : null],
    ["Range", range],
    ["Threat", s.threat],
    ["Pip change", s.pipChange],
    ["Resist", s.resistCategory]
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
    var at = el("table", "t");
    at.innerHTML = "<tr><th>#</th><th>Qualifier</th><th>Type</th><th>Modifier</th>" +
      "<th>Max damage</th><th>Crit</th><th>Positional</th><th>Implement</th></tr>";
    s.attacks.forEach(function (a, i) {
      var tr = el("tr");
      var imp = ["usesPrimary", "usesSecondary", "usesRanged", "usesNatural", "usesTactical"]
        .filter(function (k) { return a[k]; })
        .map(function (k) { return k.replace("uses", ""); }).join(", ");
      tr.innerHTML = "<td>" + (i + 1) + "</td>" +
        "<td>" + esc(a.damageQualifier || "-") + "</td>" +
        "<td>" + esc(a.damageType || "-") + "</td>" +
        '<td class="num">' + fmt(a.damageModifier) + "</td>" +
        '<td class="num">' + (a.damageMax !== undefined ? fmt(a.damageMax) :
          a.damageMaxProgression ? "progression " + a.damageMaxProgression : "-") + "</td>" +
        '<td class="num">' + (a.critMultiplier !== undefined ? "x" + fmt(a.critMultiplier) : "-") + "</td>" +
        '<td class="num">' + (a.positionalMultiplier !== undefined && a.positionalMultiplier !== 1
          ? "x" + fmt(a.positionalMultiplier) : "-") + "</td>" +
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
    if (hookEffects.length) section(host, "Effects applied on hit", linkList(hookEffects, "effect"));
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
    if (s[pair[0]]) section(host, pair[1], linkList(s[pair[0]], "effect"));
  });

  if (s.combos) section(host, "Combos", linkList(s.combos.map(function (c) {
    return { id: c.skill, via: c.mode };
  }), "skill"));

  if (D && MS) section(host, "Modifiers", modsBlock(s, D, MS));

  host.appendChild(el("h3", "sec", "Source data"));
  host.appendChild(rawBlock("skill", s.id));
  return host;
}

function renderEffect(e, progs, MS) {
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
  ["debuff", "permanent", "combatOnly", "curable", "uiVisible",
   "removeOnDefeat", "removeOnAwaken"].forEach(function (f) {
    if (e[f]) tags.appendChild(el("span", "tag", titleCase(f)));
  });
  host.appendChild(tags);

  if (e.desc) host.appendChild(richPara("desc", e.desc));
  if (e.applied && e.applied !== e.desc) {
    var ap = el("p", "muted");
    ap.appendChild(document.createTextNode("On application: "));
    ap.appendChild(richText(e.applied));
    host.appendChild(ap);
  }

  section(host, "At a glance", statRow([
    ["Duration", e.duration !== undefined ? secs(e.duration) : (e.permanent ? "permanent" : null)],
    ["Pulses", e.pulseCount],
    ["Probability", (e.probability !== undefined && e.probability < 0.999)
      ? fmt(e.probability * 100, 1) + "%" : null],
    ["Resist", e.resistCategory]
  ]));

  section(host, "Stat modifiers", grantsBlock(e.stats, MS, progs));

  if (e.nested) section(host, "Applies these effects", linkList(e.nested, "effect"));
  if (e.parentEffects) section(host, "Applied by these effects", linkList(e.parentEffects, "effect"));
  if (e.usedBySkills) section(host, "Applied by these skills", linkList(e.usedBySkills, "skill"));

  host.appendChild(el("h3", "sec", "Source data"));
  host.appendChild(rawBlock("effect", e.id));
  return host;
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
    var grid = el("div", "stats");
    grid.style.marginTop = "18px";
    Object.keys(D.classes).map(function (k) { return D.classes[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (c) { grid.appendChild(classCard(c)); });
    landing.appendChild(grid);
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
  t.appendChild(el("div", "mt", (c.skills || []).length + " trained skills"));
  a.appendChild(t);
  return a;
}

function renderClassList(D) {
  var host = el("div");
  host.appendChild(el("h3", "sec", "Classes"));
  var grid = el("div", "stats");
  Object.keys(D.classes).map(function (k) { return D.classes[k]; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); })
    .forEach(function (c) { grid.appendChild(classCard(c)); });
  host.appendChild(grid);
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
  if (c.desc) host.appendChild(richPara("desc", c.desc));

  // --- skills trained by level ---
  if (c.skills) {
    var byLevel = {};
    c.skills.forEach(function (e) { (byLevel[e.level] = byLevel[e.level] || []).push(e); });
    var t = el("table", "t");
    t.innerHTML = "<tr><th>Level</th><th>Skill</th><th>Prerequisite</th></tr>";
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
          var pm = e.prerequisite ? nameOf(e.prerequisite) : null;
          var td2 = el("td", "muted", pm ? pm.n : "");
          tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
          t.appendChild(tr);
        });
      });
    section(host, "Skills trained by level", t);
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
      host.appendChild(hh);
    });
  });

  // --- passive class traits earned at a level ---
  if (c.traits) {
    var ul2 = el("ul", "links");
    c.traits.forEach(function (e) {
      ul2.appendChild(traitLink(D.traits[String(e.id)], "level " + e.level));
    });
    section(host, "Class traits by level", ul2);
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
  section(host, "What it changes", grantsBlock(t.stats, MS, progs, "Rank"));

  if (t.skills) {
    section(host, "Skills granted", linkList(t.skills.map(function (g) {
      return { id: g.id, via: g.rank ? "at rank " + g.rank : "" };
    }), "skill"));
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

function sourceCell(prop, MS, D) {
  var td = el("td");
  var src = MS[prop];
  if (!src) {
    td.appendChild(el("span", "muted", "no source in this dataset"));
    return td;
  }
  var shown = 0, LIMIT = 6;
  (src.traits || []).forEach(function (id) {
    if (shown >= LIMIT) return;
    var t = D.traits[String(id)];
    if (!t) return;
    if (shown) td.appendChild(document.createTextNode(", "));
    var a = el("a", null, t.name);
    a.href = "#/trait/" + id;
    td.appendChild(a);
    shown++;
  });
  (src.effects || []).forEach(function (id) {
    if (shown >= LIMIT) return;
    var meta = nameOf(id);
    if (shown) td.appendChild(document.createTextNode(", "));
    var a = el("a", null, meta ? meta.n : "#" + id);
    a.href = "#/effect/" + id;
    a.className = "eff";
    td.appendChild(a);
    shown++;
  });
  var total = (src.traits || []).length + (src.effects || []).length +
              (src.traitsMore || 0) + (src.effectsMore || 0);
  if (total > shown) {
    td.appendChild(el("span", "via", "  +" + (total - shown) + " more"));
  }
  return td;
}

function grantsBlock(stats, MS, progs, xLabel) {
  if (!stats || !stats.length) return null;
  var wrap = el("div");
  var t = el("table", "t");
  t.innerHTML = "<tr><th>Property</th><th>How</th><th>Amount</th><th>What it scales</th></tr>";

  stats.forEach(function (st) {
    var tr = el("tr");
    var td0 = el("td");
    td0.appendChild(el("code", "pn", st.stat));
    if (st.description) td0.appendChild(el("div", "muted", st.description));
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

    // which skill values this property feeds into
    var td3 = el("td");
    var used = MS && MS[st.stat] && MS[st.stat].skills;
    if (!used || !used.length) {
      td3.appendChild(el("span", "muted", "no skill in this dataset reads it"));
    } else {
      var byField = {};
      used.forEach(function (u) { (byField[u[1]] = byField[u[1]] || []).push(u[0]); });
      Object.keys(byField).sort().forEach(function (field) {
        var ids = byField[field];
        var line = el("div");
        line.appendChild(el("strong", null, field));
        line.appendChild(document.createTextNode(" on "));
        var SHOW = 10;
        ids.slice(0, SHOW).forEach(function (id, i) {
          if (i) line.appendChild(document.createTextNode(", "));
          var meta = nameOf(id);
          var a = el("a", null, meta ? meta.n : "#" + id);
          a.href = "#/skill/" + id;
          line.appendChild(a);
        });
        var extra = ids.length - SHOW + (MS[st.stat].skillsMore || 0);
        if (extra > 0) line.appendChild(el("span", "via", "  +" + extra + " more"));
        td3.appendChild(line);
      });
    }
    tr.appendChild(td3);
    t.appendChild(tr);
  });
  wrap.appendChild(t);

  if (progs) {
    stats.forEach(function (st) {
      if (!st.progression) return;
      var pts = curvePoints(progs[String(st.progression)]);
      if (pts && pts.length >= 2) wrap.appendChild(chart(pts, st.stat, xLabel));
    });
  }
  return wrap;
}

function modsBlock(s, D, MS) {
  var groups = [];
  (s.mods || []).forEach(function (g) { groups.push([g, null]); });
  (s.attacks || []).forEach(function (a, i) {
    (a.mods || []).forEach(function (g) { groups.push([g, "attack " + (i + 1)]); });
  });
  if (!groups.length) return null;

  var t = el("table", "t");
  t.innerHTML = "<tr><th>Value</th><th>Scaled by</th><th>Which comes from</th></tr>";
  groups.forEach(function (pair) {
    var g = pair[0], where = pair[1];
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
      tr.appendChild(sourceCell(prop, MS, D));
      t.appendChild(tr);
    });
  });
  var wrap = el("div");
  wrap.appendChild(t);
  wrap.appendChild(el("div", "muted",
    "A value listed here is not always active - it applies only while "
    + "something grants the property beside it."));
  wrap.lastChild.style.cssText = "font-size:11.5px;margin-top:8px";
  return wrap;
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
  var jobs = [loadRecord(kind, id), progressions(), classData(), modSources()];
  Promise.all(jobs).then(function (res) {
    detail.textContent = "";
    var rec = res[0];
    if (!rec) {
      detail.appendChild(el("div", "empty", "No " + kind + " with id " + id + "."));
      return;
    }
    var progs = res[1] || {};
    detail.appendChild(kind === "skill" ? renderSkill(rec, progs, res[2], res[3])
                                        : renderEffect(rec, progs, res[3]));
    detail.scrollTop = 0;
    document.title = rec.name + " - LOTRO Skills and Effects";
  });
  runSearch();
}

/* ---------------- boot ---------------- */

Promise.all([getJSON("data/meta.json"), getJSON("data/index.json")])
  .then(function (r) {
    META = r[0];
    INDEX = r[1];
    BUCKETS = META.buckets || 128;
    document.getElementById("meta").textContent =
      META.skills.toLocaleString() + " skills, " + META.effects.toLocaleString() +
      " effects, " + META.progressions.toLocaleString() + " scaling curves";
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
["fSkill", "fEffect", "fClass"].forEach(function (id) {
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
