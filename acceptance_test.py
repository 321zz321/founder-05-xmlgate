#!/usr/bin/env python3
"""Acceptance test for xmlgate, written before the product ships (Article 9.1).

The test is the promise. If any of these fail, the thing does not ship:

  1. The clean control passes through byte-identical. A repair tool that rewrites a
     healthy file is a tool an engraver cannot trust with a finished score.
  2. Each repairable class is repaired, and the repaired file re-checks CLEAN.
     A fix that leaves the file still broken is not a fix.
  3. Repair is lossless where it claims to be: the MARKUP repair changes nothing
     but the closing bracket, and the UNSCALED repair changes nothing but durations.
  4. The unknowable case is REFUSED and the file is left untouched. This is the one
     the product is actually sold on - guessing here corrupts a score silently.
  5. Refusal names the location. "Something is wrong" is not a deliverable.

Run: python acceptance_test.py    (exit 0 = all pass)
"""
import os
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xmlgate

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.join(HERE, 'tests')
CASES = []


def case(name):
    def deco(fn):
        CASES.append((name, fn))
        return fn
    return deco


def run(fixture):
    """Check a fixture, write any repair to a temp file, return (verdicts, out_path, changed)."""
    return run_path(os.path.join(TESTS, fixture), os.path.basename(fixture))


def run_path(src, basename=None):
    tree, findings, changed = xmlgate.check(src)
    out = os.path.join(tempfile.mkdtemp(), basename or os.path.basename(src))
    if changed:
        tree.write(out, encoding='UTF-8', xml_declaration=True)
    else:
        shutil.copyfile(src, out)
    return findings, out, changed


def verdicts(findings):
    return [f[2] for f in findings]


def durations(path):
    return [int(d.text) for d in ET.parse(path).getroot().iter('duration')]


def tuplet_marks(path):
    return [(t.get('type'), t.get('number')) for t in ET.parse(path).getroot().iter('tuplet')]


@case('1. clean control passes through byte-identical')
def _clean():
    findings, out, changed = run('a-clean.musicxml')
    assert verdicts(findings) == ['CLEAN'], verdicts(findings)
    assert changed is False, 'the tool modified a healthy file'
    a = open(os.path.join(TESTS, 'a-clean.musicxml'), 'rb').read()
    b = open(out, 'rb').read()
    assert a == b, 'clean file came back changed (%d vs %d bytes)' % (len(a), len(b))


@case('2a. open tuplet bracket is classified MARKUP, repaired, and re-checks clean')
def _markup():
    findings, out, changed = run('b-markup.musicxml')
    assert verdicts(findings) == ['MARKUP'], verdicts(findings)
    assert changed is True, 'nothing was repaired'
    again, _, _ = run_path(out)
    assert verdicts(again) == ['CLEAN'], 'repaired file does not re-check clean: %s' % verdicts(again)


@case('2b. unscaled durations are classified UNSCALED, repaired, and re-check clean')
def _unscaled():
    findings, out, changed = run('c-unscaled.musicxml')
    assert verdicts(findings) == ['UNSCALED'], verdicts(findings)
    assert changed is True, 'nothing was repaired'
    again, _, _ = run_path(out)
    assert verdicts(again) == ['CLEAN'], 'repaired file does not re-check clean: %s' % verdicts(again)


@case('3a. MARKUP repair touches the bracket and nothing else')
def _markup_lossless():
    src = os.path.join(TESTS, 'b-markup.musicxml')
    _, out, _ = run('b-markup.musicxml')
    assert durations(src) == durations(out), 'durations were altered by a markup repair'
    assert tuplet_marks(src) == [('start', '1')], tuplet_marks(src)
    assert tuplet_marks(out) == [('start', '1'), ('stop', '1')], tuplet_marks(out)


@case('3b. UNSCALED repair touches durations and nothing else')
def _unscaled_lossless():
    src = os.path.join(TESTS, 'c-unscaled.musicxml')
    _, out, _ = run('c-unscaled.musicxml')
    assert durations(src) == [12, 12, 12, 24, 24, 24], durations(src)
    assert durations(out) == [8, 8, 8, 24, 24, 24], durations(out)
    assert tuplet_marks(src) == tuplet_marks(out), 'a duration repair moved a bracket'


@case('4. unknowable damage is REFUSED and the file is left untouched')
def _refused():
    findings, out, changed = run('d-unknowable.musicxml')
    assert verdicts(findings) == ['REFUSED'], verdicts(findings)
    assert changed is False, 'the tool guessed at damage it cannot know'
    a = open(os.path.join(TESTS, 'd-unknowable.musicxml'), 'rb').read()
    assert a == open(out, 'rb').read(), 'a refused file was still rewritten'


@case('5. refusal names part, measure and the offending durations')
def _refusal_names_it():
    findings, _, _ = run('d-unknowable.musicxml')
    pid, num, verdict, detail = findings[0]
    assert pid == 'P1' and num == '1', (pid, num)
    assert '[8, 9, 8]' in detail, 'the refusal does not show the durations: %s' % detail
    assert '25' in detail and '24' in detail, 'the refusal does not show the sums: %s' % detail


@case('6. no false alarm on any file of the third-party corpus')
def _no_false_alarms():
    import glob
    files = sorted(glob.glob(os.path.join(HERE, 'corpus', '*.musicxml')))
    assert len(files) >= 60, 'corpus is missing; see corpus/PROVENANCE.md (%d files)' % len(files)
    alarms = []
    for f in files:
        try:
            _, findings, changed = xmlgate.check(f)
        except Exception as e:
            alarms.append('%s crashed: %s: %s' % (os.path.basename(f), type(e).__name__, e))
            continue
        assert changed is False, '%s: a valid file was modified' % os.path.basename(f)
        for pid, num, v, d in findings:
            if v in (xmlgate.REFUSED, xmlgate.MARKUP, xmlgate.UNSCALED):
                alarms.append('%s part %s m%s: %s' % (os.path.basename(f), pid, num, v))
    assert not alarms, 'valid files raised %d alarm(s):\n          %s' % (
        len(alarms), '\n          '.join(alarms))


@case('7. nested tuplets are declined by name, not judged')
def _nested_declined():
    src = os.path.join(HERE, 'corpus', '23d-Tuplets-Nested.musicxml')
    if not os.path.exists(src):
        raise AssertionError('corpus is missing; see corpus/PROVENANCE.md')
    _, findings, changed = xmlgate.check(src)
    assert changed is False, 'a nested-tuplet file was modified'
    assert findings and all(v == xmlgate.UNCHECKABLE for _, _, v, _ in findings), \
        [f[2] for f in findings]
    assert all('nested' in d for _, _, _, d in findings), \
        'the reason given is not nesting: %s' % [f[3][:40] for f in findings]


def main():
    print('xmlgate acceptance test')
    print('-' * 74)
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print('  PASS  %s' % name)
        except AssertionError as e:
            failed += 1
            print('  FAIL  %s\n          %s' % (name, e))
        except Exception as e:
            failed += 1
            print('  ERROR %s\n          %s: %s' % (name, type(e).__name__, e))
    print('-' * 74)
    print('%d of %d passed' % (len(CASES) - failed, len(CASES)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
