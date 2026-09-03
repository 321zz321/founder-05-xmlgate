/* Acceptance test for the browser port. The same nine promises as
 * ../acceptance_test.py, driven from the same four fixtures and the same 22-file
 * third-party corpus, plus two the Python version could not make:
 *
 *   10. every repair is a surgical edit — no byte outside an edited span moves.
 *   11. the port agrees with the Python original, verdict for verdict, on all 64 files.
 *
 * Case 11 reads verdicts.json, written by ../compare_ports.py in the same run.
 * Run: node acceptance_test.js   (exit 0 = all pass)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const xmlgate = require('./xmlgate.js');

const HERE = __dirname;
const TESTS = path.join(HERE, '..', 'tests');
const CORPUS = path.join(HERE, '..', 'corpus');
const CASES = [];
const case_ = (name, fn) => CASES.push([name, fn]);

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

function run(fixture) {
  const src = read(path.join(TESTS, fixture));
  const r = xmlgate.check(src);
  return { src, out: xmlgate.repair(src, r.edits), ...r };
}
const verdicts = (f) => f.map((x) => x.verdict);

function durations(text) {
  return xmlgate._internal.iter(xmlgate.parse(text), 'duration')
    .map((el) => parseInt(xmlgate._internal.textOf(el, text), 10));
}
function tupletMarks(text) {
  return xmlgate._internal.iter(xmlgate.parse(text), 'tuplet')
    .map((el) => [el.attrs.type, el.attrs.number || '1'].join(':'));
}

/* Reverse every edit against the repaired text. If the original comes back
 * byte for byte, then nothing outside the edited spans was touched. */
function unchangedOutsideEdits(src, out, edits) {
  const asc = edits.slice().sort((a, b) => a.start - b.start);
  let rebuilt = '', cursorOut = 0, cursorSrc = 0;
  for (const e of asc) {
    const lead = e.start - cursorSrc;
    rebuilt += out.slice(cursorOut, cursorOut + lead);
    cursorOut += lead + e.text.length;
    rebuilt += src.slice(e.start, e.end);
    cursorSrc = e.end;
  }
  rebuilt += out.slice(cursorOut);
  return rebuilt === src;
}

case_('1. clean control passes through byte-identical', () => {
  const r = run('a-clean.musicxml');
  assert(JSON.stringify(verdicts(r.findings)) === '["CLEAN"]', verdicts(r.findings));
  assert(r.changed === false, 'the tool modified a healthy file');
  assert(r.out === r.src, 'clean file came back changed');
});

case_('2a. open tuplet bracket is classified MARKUP, repaired, and re-checks clean', () => {
  const r = run('b-markup.musicxml');
  assert(JSON.stringify(verdicts(r.findings)) === '["MARKUP"]', verdicts(r.findings));
  assert(r.changed === true, 'nothing was repaired');
  const again = xmlgate.check(r.out);
  assert(JSON.stringify(verdicts(again.findings)) === '["CLEAN"]',
    'repaired file does not re-check clean: ' + verdicts(again.findings));
});

case_('2b. unscaled durations are classified UNSCALED, repaired, and re-check clean', () => {
  const r = run('c-unscaled.musicxml');
  assert(JSON.stringify(verdicts(r.findings)) === '["UNSCALED"]', verdicts(r.findings));
  assert(r.changed === true, 'nothing was repaired');
  const again = xmlgate.check(r.out);
  assert(JSON.stringify(verdicts(again.findings)) === '["CLEAN"]',
    'repaired file does not re-check clean: ' + verdicts(again.findings));
});

case_('3a. MARKUP repair touches the bracket and nothing else', () => {
  const r = run('b-markup.musicxml');
  assert(JSON.stringify(durations(r.src)) === JSON.stringify(durations(r.out)),
    'durations were altered by a markup repair');
  assert(JSON.stringify(tupletMarks(r.src)) === '["start:1"]', tupletMarks(r.src));
  assert(JSON.stringify(tupletMarks(r.out)) === '["start:1","stop:1"]', tupletMarks(r.out));
});

case_('3b. UNSCALED repair touches durations and nothing else', () => {
  const r = run('c-unscaled.musicxml');
  assert(JSON.stringify(durations(r.src)) === '[12,12,12,24,24,24]', durations(r.src));
  assert(JSON.stringify(durations(r.out)) === '[8,8,8,24,24,24]', durations(r.out));
  assert(JSON.stringify(tupletMarks(r.src)) === JSON.stringify(tupletMarks(r.out)),
    'a duration repair moved a bracket');
});

case_('4. unknowable damage is REFUSED and the file is left untouched', () => {
  const r = run('d-unknowable.musicxml');
  assert(JSON.stringify(verdicts(r.findings)) === '["REFUSED"]', verdicts(r.findings));
  assert(r.changed === false, 'the tool guessed at damage it cannot know');
  assert(r.out === r.src, 'a refused file was still rewritten');
});

case_('5. refusal names part, measure and the offending durations', () => {
  const r = run('d-unknowable.musicxml');
  const f = r.findings[0];
  assert(f.part === 'P1' && f.measure === '1', f.part + ' ' + f.measure);
  assert(f.detail.includes('[8, 9, 8]'), 'the refusal does not show the durations: ' + f.detail);
  assert(f.detail.includes('25') && f.detail.includes('24'),
    'the refusal does not show the sums: ' + f.detail);
});

case_('6. no false alarm on any file of the third-party corpus', () => {
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.musicxml')).sort();
  assert(files.length >= 60, 'corpus is missing; see corpus/PROVENANCE.md (' + files.length + ')');
  const alarms = [];
  for (const f of files) {
    const src = read(path.join(CORPUS, f));
    let r;
    try { r = xmlgate.check(src); }
    catch (e) { alarms.push(f + ' crashed: ' + e.message); continue; }
    assert(r.changed === false, f + ': a valid file was modified');
    for (const x of r.findings) {
      if (x.verdict === 'REFUSED' || x.verdict === 'MARKUP' || x.verdict === 'UNSCALED') {
        alarms.push(f + ' part ' + x.part + ' m' + x.measure + ': ' + x.verdict);
      }
    }
  }
  assert(!alarms.length, 'valid files raised ' + alarms.length + ' alarm(s):\n          ' +
    alarms.join('\n          '));
});

case_('7. nested tuplets are declined by name, not judged', () => {
  const p = path.join(CORPUS, '23d-Tuplets-Nested.musicxml');
  assert(fs.existsSync(p), 'corpus is missing; see corpus/PROVENANCE.md');
  const r = xmlgate.check(read(p));
  assert(r.changed === false, 'a nested-tuplet file was modified');
  assert(r.findings.length && r.findings.every((x) => x.verdict === 'UNCHECKABLE'),
    JSON.stringify(verdicts(r.findings)));
  assert(r.findings.every((x) => x.detail.includes('nested')),
    'the reason given is not nesting');
});

case_('10. every repair is a surgical edit - no byte outside an edited span moves', () => {
  for (const fixture of ['b-markup.musicxml', 'c-unscaled.musicxml']) {
    const r = run(fixture);
    assert(r.edits.length > 0, fixture + ': expected edits');
    assert(unchangedOutsideEdits(r.src, r.out, r.edits),
      fixture + ': the repair moved bytes outside its own edit spans');
  }
});

case_('11. the port agrees with the Python original, verdict for verdict, on all 64 files', () => {
  const ref = path.join(HERE, 'verdicts.json');
  assert(fs.existsSync(ref), 'verdicts.json missing - run ../compare_ports.py first');
  const expected = JSON.parse(read(ref));
  const names = Object.keys(expected).sort();
  assert(names.length >= 64, 'expected at least 64 files, got ' + names.length);
  const mismatches = [];
  for (const name of names) {
    const dir = name.startsWith('tests/') ? TESTS : CORPUS;
    const src = read(path.join(dir, path.basename(name)));
    const r = xmlgate.check(src);
    const mine = r.findings.map((x) => [x.part, x.measure, x.verdict].join('|'));
    const theirs = expected[name];
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      mismatches.push(name + '\n            python: ' + JSON.stringify(theirs) +
                             '\n            js:     ' + JSON.stringify(mine));
    }
  }
  assert(!mismatches.length, mismatches.length + ' file(s) disagree:\n          ' +
    mismatches.join('\n          '));
});

function main() {
  console.log('xmlgate browser-port acceptance test');
  console.log('-'.repeat(74));
  let failed = 0;
  for (const [name, fn] of CASES) {
    try { fn(); console.log('  PASS  ' + name); }
    catch (e) { failed++; console.log('  FAIL  ' + name + '\n          ' + e.message); }
  }
  console.log('-'.repeat(74));
  console.log((CASES.length - failed) + ' of ' + CASES.length + ' passed');
  process.exit(failed ? 1 : 0);
}
main();
