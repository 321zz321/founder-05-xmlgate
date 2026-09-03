#!/usr/bin/env python3
"""xmlgate - finds the tuplet damage that silently kills a MusicXML import, repairs
only what is unambiguous, and refuses the rest by name.

WHAT IT CHECKS, AND WHY IT IS NOT MEASURE TOTALS
------------------------------------------------
The first version of this tool compared each measure's total duration against its
time signature. Run against 22 files of the MIT-licensed MusicXML test suite
(cuthbertLab/musicxmlTestSuite, fetched 2026-08-24) that produced seven false alarms
on 165 valid measures. Two of the files say in their own <miscellaneous-field> that
the measure is deliberately short - 03b-Rhythm-Backup: "covers beats 2 and 3. There
is no rest or note for uncovered beats"; 21a-Chord-Basic: "A chord consisting of two
quarter notes followed by a quarter rest." A measure that does not fill its bar is
ordinary, legal MusicXML. It is not the damage.

The damage is local to the tuplet group: a group whose sounding durations do not add
up to what its own <time-modification> says they should. That check needs no time
signature, no measure total, and no voice bookkeeping - which is also why it survives
files with no time signature at all, with compound meters like <beats>3+2</beats>,
and with divisions changing mid-measure.

VERDICTS, per tuplet group
  CLEAN        the group's durations sum to exactly what its time-modification implies
  MARKUP       durations are sound; the tuplet bracket was opened and never closed.
               Repairable, and lossless - the closing bracket is not a guess.
  UNSCALED     every note in the group carries its notated duration instead of its
               sounding one. Rescaling by normal/actual lands it exactly. Repairable.
  REFUSED      the durations match neither. What was meant is unknowable, so the group
               is reported with its part, measure and durations, and left untouched.
  UNCHECKABLE  a note in the group has no <type>, or a type this tool cannot convert to
               an exact integer duration. Reported as not checked, never as clean.

Reads and writes files only. No network, no dependencies outside the standard library.
"""
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction

# quarter-note lengths of every note type MusicXML defines, as exact fractions.
# Fractions rather than floats because divisions=30 makes a 16th note 7.5 divisions,
# and a tool that rounds there reports damage in files that have none.
TYPE_QUARTERS = {
    'maxima': Fraction(32), 'long': Fraction(16), 'breve': Fraction(8),
    'whole': Fraction(4), 'half': Fraction(2), 'quarter': Fraction(1),
    'eighth': Fraction(1, 2), '16th': Fraction(1, 4), '32nd': Fraction(1, 8),
    '64th': Fraction(1, 16), '128th': Fraction(1, 32), '256th': Fraction(1, 64),
    '512th': Fraction(1, 128), '1024th': Fraction(1, 256),
}

CLEAN, MARKUP, UNSCALED, REFUSED, UNCHECKABLE = \
    'CLEAN', 'MARKUP', 'UNSCALED', 'REFUSED', 'UNCHECKABLE'
RANK = {CLEAN: 0, MARKUP: 1, UNSCALED: 1, UNCHECKABLE: 1, REFUSED: 2}


def _int(el, tag, default=None):
    c = el.find(tag)
    try:
        return int(c.text) if c is not None and c.text else default
    except ValueError:
        return default


def notated_duration(note, divisions):
    """The duration this note would have if it were NOT in a tuplet, in divisions,
    as an exact Fraction. None when the note carries no type this tool knows."""
    t = note.findtext('type')
    if t is None or t not in TYPE_QUARTERS:
        return None
    dots = len(note.findall('dot'))
    dot_factor = Fraction(2) - Fraction(1, 2 ** dots)
    return divisions * TYPE_QUARTERS[t] * dot_factor


def is_nested(measure):
    """True when two tuplet brackets are open at the same time anywhere in the measure.

    Nested tuplets are declined rather than checked. MusicXML gives a nested note one
    combined <time-modification>, and in the canonical test file for this
    (23d-Tuplets-Nested, whose own description reads "a 5:2 tuplet (with 16th notes)
    in the middle of a 3:2 tuple (with eighth notes)") the combined 15:4 does not
    reconcile with the durations actually written. The semantics are ambiguous, so
    this tool says it did not check them instead of pretending either way.
    """
    open_numbers = set()
    for note in measure.findall('note'):
        for t in note.findall('notations/tuplet'):
            num = t.get('number', '1')
            if t.get('type') == 'start':
                open_numbers.add(num)
                if len(open_numbers) > 1:
                    return True
            elif t.get('type') == 'stop':
                open_numbers.discard(num)
    return False


def counts_toward_time(note):
    """Chord members and grace notes carry no time of their own."""
    return note.find('chord') is None and note.find('grace') is None


def tuplet_groups(measure, divisions_at_start):
    """Every tuplet group in the measure, in document order.

    A group is a maximal run of consecutive time-carrying notes sharing an identical
    <time-modification>. Divisions are tracked in document order, because <attributes>
    may appear mid-measure (03c-Rhythm-DivisionChange does exactly that).

    Returns [(actual, normal, [notes], divisions)] and the divisions still in force.
    """
    divisions = divisions_at_start
    groups, cur, cur_key, cur_div = [], [], None, divisions
    for el in measure:
        if el.tag == 'attributes':
            divisions = _int(el, 'divisions', divisions)
            continue
        if el.tag != 'note':
            continue
        if not counts_toward_time(el):
            continue                      # chord members ride on the previous note
        tm = el.find('time-modification')
        key = None
        if tm is not None:
            a, n = _int(tm, 'actual-notes'), _int(tm, 'normal-notes')
            if a and n and a != n:
                key = (a, n)
        if key != cur_key:
            if cur_key is not None and cur:
                groups.append((cur_key[0], cur_key[1], cur, cur_div))
            cur, cur_key, cur_div = [], key, divisions
        cur.append(el)
    if cur_key is not None and cur:
        groups.append((cur_key[0], cur_key[1], cur, cur_div))
    return groups, divisions


def unclosed_brackets(measure):
    """Tuplet bracket numbers opened and never closed, with the note each was opened on.

    Matched by the `number` attribute rather than by grouping, so nested tuplets
    (23d-Tuplets-Nested) close correctly instead of reading as damage.
    """
    open_at = {}
    for note in measure.findall('note'):
        for t in note.findall('notations/tuplet'):
            num = t.get('number', '1')
            if t.get('type') == 'start':
                open_at[num] = note
            elif t.get('type') == 'stop':
                open_at.pop(num, None)
    return open_at


def last_note_of_group_containing(groups, note):
    for actual, normal, notes, _ in groups:
        if note in notes:
            return notes[-1]
    return None


def check(path):
    """Returns (tree, findings, changed). A finding is
    (part_id, measure_number, verdict, detail)."""
    tree = ET.parse(path)
    root = tree.getroot()
    findings, changed = [], False

    for part in root.findall('part'):
        pid = part.get('id')
        divisions = None
        for measure in part.findall('measure'):
            num = measure.get('number')
            attrs = measure.find('attributes')
            if attrs is not None:
                divisions = _int(attrs, 'divisions', divisions)
            if divisions is None:
                groups = tuplet_groups(measure, 1)[0]
                if groups:
                    findings.append((pid, num, UNCHECKABLE,
                                     'a tuplet appears before any <divisions> is declared'))
                continue

            groups, divisions = tuplet_groups(measure, divisions)

            if groups and is_nested(measure):
                findings.append((pid, num, UNCHECKABLE,
                                 'nested tuplets. MusicXML gives a nested note one combined '
                                 'time-modification whose meaning is ambiguous, so this measure '
                                 'is left unchecked rather than judged either way'))
                continue

            # 1. duration consistency, group by group
            group_verdict = {}
            for actual, normal, notes, div in groups:
                actual_sum = sum(_int(n, 'duration', 0) for n in notes)
                notated = [notated_duration(n, div) for n in notes]
                if any(x is None for x in notated):
                    findings.append((pid, num, UNCHECKABLE,
                                     '%d:%d tuplet has a note with no <type> this tool knows; '
                                     'not checked' % (actual, normal)))
                    group_verdict[id(notes[0])] = UNCHECKABLE
                    continue
                notated_sum = sum(notated)
                scaled = notated_sum * normal / actual
                if scaled.denominator != 1 or notated_sum.denominator != 1:
                    findings.append((pid, num, UNCHECKABLE,
                                     '%d:%d tuplet does not land on a whole number of '
                                     'divisions; not checked' % (actual, normal)))
                    group_verdict[id(notes[0])] = UNCHECKABLE
                    continue
                expected = int(scaled)
                notated_sum = int(notated_sum)

                if actual_sum == expected:
                    group_verdict[id(notes[0])] = CLEAN
                    continue
                if actual_sum == notated_sum:
                    rescaled = [w * normal / actual for w in notated]
                    if any(r.denominator != 1 for r in rescaled):
                        findings.append((pid, num, UNCHECKABLE,
                                         '%d:%d tuplet looks unscaled, but rescaling a note in it '
                                         'would not land on a whole division; not repaired'
                                         % (actual, normal)))
                        group_verdict[id(notes[0])] = UNCHECKABLE
                        continue
                    for n, want in zip(notes, rescaled):
                        n.find('duration').text = str(int(want))
                    changed = True
                    group_verdict[id(notes[0])] = UNSCALED
                    findings.append((pid, num, UNSCALED,
                                     '%d:%d tuplet summed to %d, the duration it would have '
                                     'outside a tuplet. Rescaled by %d/%d to %d, which is what '
                                     'its own time-modification asks for'
                                     % (actual, normal, actual_sum, normal, actual, expected)))
                    continue
                group_verdict[id(notes[0])] = REFUSED
                findings.append((pid, num, REFUSED,
                                 '%d:%d tuplet sums to %d where its time-modification wants %d. '
                                 'Durations are %s. Neither a rescale nor a bracket error accounts '
                                 'for this, so it is reported rather than repaired'
                                 % (actual, normal, actual_sum, expected,
                                    [_int(n, 'duration', 0) for n in notes])))

            # 2. bracket markup, only where the durations were found sound
            for number, start_note in sorted(unclosed_brackets(measure).items()):
                last = last_note_of_group_containing(groups, start_note)
                if last is None:
                    findings.append((pid, num, UNCHECKABLE,
                                     'tuplet bracket %s is left open on a note that is not part '
                                     'of a time-modified group; not repaired' % number))
                    continue
                first_id = id(next(ns[0] for _, _, ns, _ in groups if start_note in ns))
                if group_verdict.get(first_id) not in (CLEAN, UNSCALED):
                    findings.append((pid, num, UNCHECKABLE,
                                     'tuplet bracket %s is left open in a group whose durations '
                                     'are already in doubt; not repaired' % number))
                    continue
                notations = last.find('notations')
                if notations is None:
                    notations = ET.SubElement(last, 'notations')
                ET.SubElement(notations, 'tuplet', {'type': 'stop', 'number': number})
                changed = True
                findings.append((pid, num, MARKUP,
                                 'tuplet bracket %s was opened and never closed. The durations in '
                                 'that group are sound, so the closing bracket is not a guess'
                                 % number))

            if not any(f[0] == pid and f[1] == num for f in findings) and groups:
                findings.append((pid, num, CLEAN,
                                 '%d tuplet group(s), all consistent with their '
                                 'time-modification' % len(groups)))
    return tree, findings, changed


def main(argv):
    if len(argv) < 2:
        print('usage: xmlgate.py <file.musicxml> [-o out.musicxml]')
        return 2
    path = argv[1]
    out = argv[argv.index('-o') + 1] if '-o' in argv else None
    tree, findings, changed = check(path)
    worst = 0
    for pid, num, verdict, detail in findings:
        print('  [%-11s] part %s measure %s: %s' % (verdict, pid, num, detail))
        worst = max(worst, RANK[verdict])
    counts = {}
    for _, _, v, _ in findings:
        counts[v] = counts.get(v, 0) + 1
    print('  summary: ' + (', '.join('%s=%d' % kv for kv in sorted(counts.items()))
                           or 'no tuplets in this file'))
    if out:
        if changed:
            tree.write(out, encoding='UTF-8', xml_declaration=True)
            print('  wrote repaired file to %s' % out)
        else:
            import shutil
            shutil.copyfile(path, out)
            print('  nothing to repair; copied unchanged to %s' % out)
    return worst


if __name__ == '__main__':
    sys.exit(main(sys.argv))
