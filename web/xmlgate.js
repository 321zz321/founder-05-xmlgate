/* xmlgate.js — the browser port of assets/xmlgate/xmlgate.py.
 *
 * Same verdicts, same refusals, same arithmetic. Two deliberate differences:
 *
 *  1. It never uploads anything. The file is read with FileReader and every byte
 *     stays in the tab. That is the one premium a buyer here can name, because the
 *     file on their desk is usually somebody else's copyrighted score.
 *
 *  2. A repair is a surgical text edit, not a re-serialization. The Python version
 *     parses to an ElementTree and writes the tree back out, which reflows the whole
 *     document even where nothing changed. This one records byte offsets while
 *     parsing and splices, so a repaired file differs from the original in exactly
 *     the spans that had to change and nowhere else. An engraver diffing the two
 *     files sees the repair and no noise.
 *
 * Runs unchanged in a browser and in Node (module.exports at the bottom).
 * No dependencies, no network calls, no DOM.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- fractions
   * Exact rationals, because divisions=30 makes a 16th note 7.5 divisions and a
   * tool that rounds there reports damage in files that have none. */
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a; }

  function Fr(n, d) {
    if (d === undefined) d = 1;
    if (d === 0) throw new Error('zero denominator');
    if (d < 0) { n = -n; d = -d; }
    var g = gcd(n, d) || 1;
    this.n = n / g; this.d = d / g;
  }
  Fr.prototype.add = function (o) { return new Fr(this.n * o.d + o.n * this.d, this.d * o.d); };
  Fr.prototype.mul = function (o) { return new Fr(this.n * o.n, this.d * o.d); };
  Fr.prototype.sub = function (o) { return new Fr(this.n * o.d - o.n * this.d, this.d * o.d); };
  Fr.prototype.isInt = function () { return this.d === 1; };
  Fr.prototype.toInt = function () { return this.n; };
  function fr(n, d) { return new Fr(n, d); }

  // quarter-note length of every note type MusicXML defines
  var TYPE_QUARTERS = {
    maxima: fr(32), long: fr(16), breve: fr(8), whole: fr(4), half: fr(2),
    quarter: fr(1), eighth: fr(1, 2), '16th': fr(1, 4), '32nd': fr(1, 8),
    '64th': fr(1, 16), '128th': fr(1, 32), '256th': fr(1, 64),
    '512th': fr(1, 128), '1024th': fr(1, 256)
  };

  var CLEAN = 'CLEAN', MARKUP = 'MARKUP', UNSCALED = 'UNSCALED',
      REFUSED = 'REFUSED', UNCHECKABLE = 'UNCHECKABLE';
  var RANK = { CLEAN: 0, MARKUP: 1, UNSCALED: 1, UNCHECKABLE: 1, REFUSED: 2 };

  /* ------------------------------------------------------------------ parser
   * A minimal XML reader that keeps source offsets. It exists instead of
   * DOMParser because DOMParser gives no offsets, so there would be nothing to
   * splice against and every repair would have to reflow the document. */
  function parse(text) {
    var root = null, stack = [], i = 0, n = text.length;

    function node(tag, attrs, openStart, openEnd, selfClosing) {
      return {
        tag: tag, attrs: attrs, children: [], parent: null,
        openStart: openStart, openEnd: openEnd,
        closeStart: selfClosing ? openEnd : -1,
        closeEnd: selfClosing ? openEnd : -1,
        selfClosing: !!selfClosing
      };
    }

    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt < 0) break;
      i = lt;

      if (text.startsWith('<!--', i)) { var e = text.indexOf('-->', i); i = e < 0 ? n : e + 3; continue; }
      if (text.startsWith('<![CDATA[', i)) { var c = text.indexOf(']]>', i); i = c < 0 ? n : c + 3; continue; }
      if (text.startsWith('<?', i)) { var p = text.indexOf('?>', i); i = p < 0 ? n : p + 2; continue; }
      if (text.startsWith('<!', i)) {
        // DOCTYPE, possibly with an internal subset in [ ]
        var j = i + 2, depth = 0;
        while (j < n) {
          var ch = text[j];
          if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '>' && depth <= 0) { j++; break; }
          j++;
        }
        i = j; continue;
      }

      if (text[i + 1] === '/') {
        var gt = text.indexOf('>', i);
        if (gt < 0) throw new Error('unterminated closing tag at ' + i);
        var name = text.slice(i + 2, gt).trim();
        var top = stack[stack.length - 1];
        if (!top) throw new Error('closing tag </' + name + '> with nothing open');
        if (top.tag !== name) throw new Error('</' + name + '> closes <' + top.tag + '>');
        top.closeStart = i; top.closeEnd = gt + 1;
        stack.pop();
        i = gt + 1; continue;
      }

      // an opening tag
      var k = i + 1, nameStart = k;
      while (k < n && !/[\s/>]/.test(text[k])) k++;
      var tag = text.slice(nameStart, k);
      var attrs = {}, selfClosing = false;
      while (k < n) {
        while (k < n && /\s/.test(text[k])) k++;
        if (text[k] === '/' && text[k + 1] === '>') { selfClosing = true; k += 2; break; }
        if (text[k] === '>') { k += 1; break; }
        var aStart = k;
        while (k < n && !/[\s=/>]/.test(text[k])) k++;
        var aName = text.slice(aStart, k);
        while (k < n && /\s/.test(text[k])) k++;
        if (text[k] === '=') {
          k++;
          while (k < n && /\s/.test(text[k])) k++;
          var q = text[k];
          if (q === '"' || q === "'") {
            var vEnd = text.indexOf(q, k + 1);
            if (vEnd < 0) throw new Error('unterminated attribute value at ' + k);
            attrs[aName] = decode(text.slice(k + 1, vEnd));
            k = vEnd + 1;
          } else {
            var vs = k;
            while (k < n && !/[\s/>]/.test(text[k])) k++;
            attrs[aName] = decode(text.slice(vs, k));
          }
        } else if (aName) {
          attrs[aName] = aName;
        }
      }
      var el = node(tag, attrs, i, k, selfClosing);
      var parent = stack[stack.length - 1];
      if (parent) { el.parent = parent; parent.children.push(el); }
      else if (!root) root = el;
      if (!selfClosing) stack.push(el);
      i = k;
    }
    if (!root) throw new Error('no root element');
    if (stack.length) throw new Error('<' + stack[stack.length - 1].tag + '> is never closed');
    return root;
  }

  function decode(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>';
      if (g === 'quot') return '"'; if (g === 'apos') return "'";
      return g[1] === 'x' || g[1] === 'X'
        ? String.fromCodePoint(parseInt(g.slice(2), 16))
        : String.fromCodePoint(parseInt(g.slice(1), 10));
    });
  }

  /* -------------------------------------------------------------- tree access
   * Mirrors the ElementTree calls the Python version uses: find/findall are
   * direct children, findtext is the leading text, iter walks descendants. */
  function find(el, tag) {
    for (var i = 0; i < el.children.length; i++) if (el.children[i].tag === tag) return el.children[i];
    return null;
  }
  function findAll(el, tag) {
    var out = [];
    for (var i = 0; i < el.children.length; i++) if (el.children[i].tag === tag) out.push(el.children[i]);
    return out;
  }
  function findAllPath(el, path) {
    var parts = path.split('/'), cur = [el];
    for (var p = 0; p < parts.length; p++) {
      var next = [];
      for (var i = 0; i < cur.length; i++) next = next.concat(findAll(cur[i], parts[p]));
      cur = next;
    }
    return cur;
  }
  function iter(el, tag, out) {
    out = out || [];
    if (el.tag === tag) out.push(el);
    for (var i = 0; i < el.children.length; i++) iter(el.children[i], tag, out);
    return out;
  }
  // text span of a leaf element: everything between > and </
  function textSpan(el, src) {
    if (el.selfClosing || el.closeStart < 0) return null;
    var end = el.children.length ? el.children[0].openStart : el.closeStart;
    return { start: el.openEnd, end: end, text: src.slice(el.openEnd, end) };
  }
  function textOf(el, src) {
    var s = textSpan(el, src);
    return s === null ? null : decode(s.text);
  }
  function findText(el, tag, src) {
    var c = find(el, tag);
    return c === null ? null : textOf(c, src);
  }
  function intOf(el, tag, src, dflt) {
    var c = find(el, tag);
    if (!c) return dflt;
    var t = textOf(c, src);
    if (t === null) return dflt;
    var v = parseInt(String(t).trim(), 10);
    return isNaN(v) ? dflt : v;
  }

  /* ----------------------------------------------------------------- the logic
   * Line for line the Python version. Every comment there explains why a check
   * is shaped the way it is; the reasons have not changed. */

  function notatedDuration(note, divisions, src) {
    var t = findText(note, 'type', src);
    if (t === null) return null;
    t = t.trim();
    if (!Object.prototype.hasOwnProperty.call(TYPE_QUARTERS, t)) return null;
    var dots = findAll(note, 'dot').length;
    var dotFactor = fr(2).sub(fr(1, Math.pow(2, dots)));
    return fr(divisions).mul(TYPE_QUARTERS[t]).mul(dotFactor);
  }

  function isNested(measure) {
    var open = {};
    var notes = findAll(measure, 'note');
    for (var i = 0; i < notes.length; i++) {
      var ts = findAllPath(notes[i], 'notations/tuplet');
      for (var j = 0; j < ts.length; j++) {
        var num = ts[j].attrs.number || '1';
        if (ts[j].attrs.type === 'start') {
          open[num] = true;
          if (Object.keys(open).length > 1) return true;
        } else if (ts[j].attrs.type === 'stop') {
          delete open[num];
        }
      }
    }
    return false;
  }

  function countsTowardTime(note) {
    return find(note, 'chord') === null && find(note, 'grace') === null;
  }

  function tupletGroups(measure, divisionsAtStart, src) {
    var divisions = divisionsAtStart;
    var groups = [], cur = [], curKey = null, curDiv = divisions;
    for (var i = 0; i < measure.children.length; i++) {
      var el = measure.children[i];
      if (el.tag === 'attributes') { divisions = intOf(el, 'divisions', src, divisions); continue; }
      if (el.tag !== 'note') continue;
      if (!countsTowardTime(el)) continue;
      var tm = find(el, 'time-modification');
      var key = null;
      if (tm !== null) {
        var a = intOf(tm, 'actual-notes', src, null), nn = intOf(tm, 'normal-notes', src, null);
        if (a && nn && a !== nn) key = a + ':' + nn;
      }
      if (key !== curKey) {
        if (curKey !== null && cur.length) groups.push(mkGroup(curKey, cur, curDiv));
        cur = []; curKey = key; curDiv = divisions;
      }
      cur.push(el);
    }
    if (curKey !== null && cur.length) groups.push(mkGroup(curKey, cur, curDiv));
    return { groups: groups, divisions: divisions };
  }
  function mkGroup(key, notes, div) {
    var p = key.split(':');
    return { actual: parseInt(p[0], 10), normal: parseInt(p[1], 10), notes: notes.slice(), div: div };
  }

  function unclosedBrackets(measure) {
    var openAt = {};
    var notes = findAll(measure, 'note');
    for (var i = 0; i < notes.length; i++) {
      var ts = findAllPath(notes[i], 'notations/tuplet');
      for (var j = 0; j < ts.length; j++) {
        var num = ts[j].attrs.number || '1';
        if (ts[j].attrs.type === 'start') openAt[num] = notes[i];
        else if (ts[j].attrs.type === 'stop') delete openAt[num];
      }
    }
    return openAt;
  }

  function groupContaining(groups, note) {
    for (var i = 0; i < groups.length; i++) if (groups[i].notes.indexOf(note) >= 0) return groups[i];
    return null;
  }

  /* check(src) -> { findings, edits, changed, worst }
   * A finding is { part, measure, verdict, detail }.
   * An edit is { start, end, text } against the original source string. */
  function check(src) {
    var root = parse(src);
    var findings = [], edits = [];

    var parts = findAll(root, 'part');
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi], pid = part.attrs.id;
      var divisions = null;
      var measures = findAll(part, 'measure');
      for (var mi = 0; mi < measures.length; mi++) {
        var measure = measures[mi], num = measure.attrs.number;
        var attrs = find(measure, 'attributes');
        if (attrs !== null) divisions = intOf(attrs, 'divisions', src, divisions);
        if (divisions === null) {
          if (tupletGroups(measure, 1, src).groups.length) {
            findings.push(F(pid, num, UNCHECKABLE,
              'a tuplet appears before any <divisions> is declared'));
          }
          continue;
        }

        var tg = tupletGroups(measure, divisions, src);
        var groups = tg.groups; divisions = tg.divisions;
        var before = findings.length;

        if (groups.length && isNested(measure)) {
          findings.push(F(pid, num, UNCHECKABLE,
            'nested tuplets. MusicXML gives a nested note one combined time-modification whose ' +
            'meaning is ambiguous, so this measure is left unchecked rather than judged either way'));
          continue;
        }

        // 1. duration consistency, group by group
        var verdictOf = new Map();
        for (var gi = 0; gi < groups.length; gi++) {
          var g = groups[gi], actual = g.actual, normal = g.normal, notes = g.notes, div = g.div;
          var actualSum = 0;
          for (var q = 0; q < notes.length; q++) actualSum += intOf(notes[q], 'duration', src, 0);
          var notated = [], unknown = false;
          for (var q2 = 0; q2 < notes.length; q2++) {
            var nd = notatedDuration(notes[q2], div, src);
            if (nd === null) { unknown = true; break; }
            notated.push(nd);
          }
          if (unknown) {
            findings.push(F(pid, num, UNCHECKABLE, actual + ':' + normal +
              ' tuplet has a note with no <type> this tool knows; not checked'));
            verdictOf.set(g, UNCHECKABLE); continue;
          }
          var notatedSum = notated.reduce(function (a, b) { return a.add(b); }, fr(0));
          var scaled = notatedSum.mul(fr(normal, actual));
          if (!scaled.isInt() || !notatedSum.isInt()) {
            findings.push(F(pid, num, UNCHECKABLE, actual + ':' + normal +
              ' tuplet does not land on a whole number of divisions; not checked'));
            verdictOf.set(g, UNCHECKABLE); continue;
          }
          var expected = scaled.toInt();
          var notatedSumI = notatedSum.toInt();

          if (actualSum === expected) { verdictOf.set(g, CLEAN); continue; }

          if (actualSum === notatedSumI) {
            var rescaled = notated.map(function (w) { return w.mul(fr(normal, actual)); });
            if (rescaled.some(function (r) { return !r.isInt(); })) {
              findings.push(F(pid, num, UNCHECKABLE, actual + ':' + normal +
                ' tuplet looks unscaled, but rescaling a note in it would not land on a whole ' +
                'division; not repaired'));
              verdictOf.set(g, UNCHECKABLE); continue;
            }
            for (var r2 = 0; r2 < notes.length; r2++) {
              var durEl = find(notes[r2], 'duration');
              var span = textSpan(durEl, src);
              edits.push({ start: span.start, end: span.end, text: String(rescaled[r2].toInt()) });
            }
            verdictOf.set(g, UNSCALED);
            findings.push(F(pid, num, UNSCALED, actual + ':' + normal + ' tuplet summed to ' +
              actualSum + ', the duration it would have outside a tuplet. Rescaled by ' + normal +
              '/' + actual + ' to ' + expected + ', which is what its own time-modification asks for'));
            continue;
          }

          var durList = notes.map(function (nn2) { return intOf(nn2, 'duration', src, 0); });
          verdictOf.set(g, REFUSED);
          findings.push(F(pid, num, REFUSED, actual + ':' + normal + ' tuplet sums to ' + actualSum +
            ' where its time-modification wants ' + expected + '. Durations are [' +
            durList.join(', ') + ']. Neither a rescale nor a bracket error accounts for this, so ' +
            'it is reported rather than repaired'));
        }

        // 2. bracket markup, only where the durations were found sound
        var openAt = unclosedBrackets(measure);
        var numbers = Object.keys(openAt).sort();
        for (var bi = 0; bi < numbers.length; bi++) {
          var number = numbers[bi], startNote = openAt[number];
          var grp = groupContaining(groups, startNote);
          if (grp === null) {
            findings.push(F(pid, num, UNCHECKABLE, 'tuplet bracket ' + number +
              ' is left open on a note that is not part of a time-modified group; not repaired'));
            continue;
          }
          var v = verdictOf.get(grp);
          if (v !== CLEAN && v !== UNSCALED) {
            findings.push(F(pid, num, UNCHECKABLE, 'tuplet bracket ' + number +
              ' is left open in a group whose durations are already in doubt; not repaired'));
            continue;
          }
          var last = grp.notes[grp.notes.length - 1];
          var notations = find(last, 'notations');
          var stopTag = '<tuplet type="stop" number="' + number + '"/>';
          if (notations !== null) {
            edits.push({ start: notations.closeStart, end: notations.closeStart, text: stopTag });
          } else {
            edits.push({ start: last.closeStart, end: last.closeStart,
                         text: '<notations>' + stopTag + '</notations>' });
          }
          findings.push(F(pid, num, MARKUP, 'tuplet bracket ' + number + ' was opened and never ' +
            'closed. The durations in that group are sound, so the closing bracket is not a guess'));
        }

        if (findings.length === before && groups.length) {
          findings.push(F(pid, num, CLEAN, groups.length +
            ' tuplet group(s), all consistent with their time-modification'));
        }
      }
    }

    var worst = 0;
    for (var f = 0; f < findings.length; f++) worst = Math.max(worst, RANK[findings[f].verdict]);
    return { findings: findings, edits: edits, changed: edits.length > 0, worst: worst };
  }

  function F(part, measure, verdict, detail) {
    return { part: part, measure: measure, verdict: verdict, detail: detail };
  }

  /* repair(src, edits) -> the repaired source.
   * Applied back to front so earlier offsets stay valid. Every byte outside an
   * edit span is the byte that was there before. */
  function repair(src, edits) {
    if (!edits.length) return src;
    var sorted = edits.slice().sort(function (a, b) { return b.start - a.start || b.end - a.end; });
    var out = src;
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
    }
    return out;
  }

  function summary(findings) {
    var counts = {};
    for (var i = 0; i < findings.length; i++) {
      counts[findings[i].verdict] = (counts[findings[i].verdict] || 0) + 1;
    }
    return counts;
  }

  var api = {
    check: check, repair: repair, parse: parse, summary: summary,
    CLEAN: CLEAN, MARKUP: MARKUP, UNSCALED: UNSCALED, REFUSED: REFUSED,
    UNCHECKABLE: UNCHECKABLE, RANK: RANK,
    _internal: { find: find, findAll: findAll, iter: iter, textOf: textOf, intOf: intOf, Fr: Fr }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.xmlgate = api;
})(typeof self !== 'undefined' ? self : this);
