# Corpus provenance

**60 MusicXML files.** 22 fetched 2026-08-24 by run `2026-08-24-1038-founder-05`; 38 more fetched
2026-09-01 by run `2026-09-01-1908-founder-05`, all 38 HTTP 200, from the same source.

- **Source:** `https://raw.githubusercontent.com/cuthbertLab/musicxmlTestSuite/main/xmlFiles/<name>.musicxml`
- **Repository:** https://github.com/cuthbertLab/musicxmlTestSuite (181 `.musicxml` files upstream)
- **License:** MIT, copied verbatim to `LICENSE` in this folder. Copyright (c) 2016-2026
  Michael Scott Asato Cuthbert. Free for any use as long as the license remains intact.
- **What it is:** a fork of LilyPond's MusicXML test suite by Reinhold Kainhofer, donated in
  2026 to the W3C Music Notation Community Group, and used by the main MusicXML repository to
  validate its XSD schemas.

## Why these files and not others

These are known-good files written by other people to exercise the specification. They are the
control group: every measure in them is valid MusicXML, so **any alarm xmlgate raises here is
xmlgate's bug, not damage in the file.**

The first 22 were chosen to stress the parts of the walk most likely to be wrong — backup and
multiple voices, divisions changing mid-measure, dotted durations, compound and absent time
signatures, chords, nested tuplets, many parts.

The 38 added on 2026-09-01 were chosen for one reason: each one can break duration arithmetic.
Grace notes, which legally carry no `<duration>` at all (24a–24h, 8 files); `<forward>`;
`03e-Rhythm-No-Divisions`; senza misura, single-number and complex time signatures; pickup,
incomplete, overfull and empty measures; multi-voice and multi-staff files where a `<backup>`
precedes a time signature; chords with an element in between and chords split across voices;
percussion and tablature staves. None was taken because it was next in the listing.

**What that widening bought, stated honestly.** Only **7 of the 60** files contain a
`<time-modification>` or a `<tuplet>` at all, so only 7 reach the arithmetic this tool sells. The
other 53 test that the *walk* survives odd input and stays quiet: 289 measures, zero alarms, zero
crashes. That is a real result — a grace note with no `<duration>` is exactly the shape that makes a
duration checker throw — but it is not 38 new tests of the tuplet check, and counting it as one
would be flattering the corpus.

## Three files that changed the design

`03b-Rhythm-Backup` and `21a-Chord-Basic` both say in their own `<miscellaneous-field>` that the
measure deliberately does not fill its bar — "There is no rest or note for uncovered beats", and
"A chord consisting of two quarter notes followed by a quarter rest". The first version of xmlgate
compared measure totals against the time signature and called both of them damaged. That check was
wrong and is gone.

`33j-Beams-Tremolos`, added 2026-09-01, is the only one of the 38 that reaches the tuplet code, and
it is a new class: **double-note tremolos carrying `time-modification 2/1`**, plus a real six-note
`<tuplet>` bracket at 3/1 in measure 2. xmlgate calls the whole file clean and that is correct.

It also came close to being written up as a bug. An ad-hoc script written in this run to audit the
corpus reported four notes in measure 1 as damaged: `type=quarter`, `time-modification 2/1`,
`duration 9` where 2/1 implies 6. The audit script was wrong — it ignored `<dot>`. The notes are
dotted quarters, notated value 18, and the MusicXML 4.0 spec on `<tremolo>` says *"the duration of
each note in the tremolo should correspond to half of the notated type value"* — 9 exactly.
Both ports handle dots (`notated_duration` in `xmlgate.py`, `dotFactor` in `web/xmlgate.js`) and
both got it right. **The five-minute instrument written to check the product was worse than the
product**; the file is spec-conformant and the tool knew it.

## Not redistributed

These files stay here as the test fixture they are. Nothing built on top of them republishes
them, and no product page serves them.
