# xmlgate

One check on a MusicXML file: do the note durations inside a tuplet add up to what the
`<time-modification>` on those notes claims they add up to?

Run it at **https://founder-05-xmlgate.netlify.app** — one HTML page, the file stays in your
browser tab, nothing is uploaded.

## Why a schema-valid file can still be wrong

A MusicXML file is usually checked against the published XSD. That check answers "is this document
the right shape" — the elements exist, in the right order, with the right types. It cannot answer
"do these four `<duration>` values, multiplied by the `<time-modification>` sitting next to them,
come out to the space the measure has". XSD has no arithmetic across sibling elements. So a file
that lost a note or lost a scaling factor during somebody's export passes validation and then
opens in your notation program short a beat, silently.

Karim Ratib put the boundary plainly in 2020: *"XSD validation is not enough to ensure that your
generated XML is valid semantically."*

## The three answers, and the fourth one

- **MARKUP** — the bracket is open or malformed, the durations are consistent. Repairable, and the
  repair touches the bracket only.
- **UNSCALED** — the durations were never scaled by the time-modification. Repairable, and the
  repair touches durations only.
- **REFUSED** — the arithmetic does not resolve to one answer. The tool names the part, the
  measure and the offending durations, and changes nothing.

The fourth is **UNCHECKABLE**: nested tuplets are declined by name rather than judged.

That refusal is the point. A repair guessed wrong inside a client's score is worse than no repair,
because you will not find it until the part is on a stand.

## Who should not use this

Anyone who wants a general MusicXML validator. This checks tuplet duration arithmetic and nothing
else, and the honest answer to "what else does it catch" is nothing else. If your file will not
open at all, or your problem is layout, lyrics, or a part that vanished entirely, this will tell
you the file is clean and it will be telling you the truth about the one thing it looks at.

## What it has been run against

60 MusicXML files from a third-party test suite somebody else wrote and called correct, plus 4
fixtures of my own. Zero false alarms.

The number that deserves the asterisk: **7 of those 60 files contain a tuplet at all.** In them the
tool judged 21 tuplet groups CLEAN and declined 3 nested ones. The other 53 files exercise the
parser and prove it stays quiet, which is worth something, but they are not 53 tests of the check.

Two implementations — `xmlgate.py` and the browser port in `web/xmlgate.js` — are compared
verdict-for-verdict across all 64 files on every run, because the page in the browser is the one
people use and the Python one is the one I test against.

```
python corpus/fetch.py        # pulls the 60 files; they are not stored here
python acceptance_test.py     # 9 of 9
node web/acceptance_test.js   # 11 of 11
python compare_ports.py       # 64 files, both ports agreeing
```

The corpus is not redistributed here. `corpus/fetch.py` pulls the exact 60 files named in
`corpus/FILES.txt` from the source in `corpus/PROVENANCE.md`, and exits non-zero if any of them is
missing — a corpus that is quietly short would let acceptance test 6 pass on 40 files and still
report no false alarms. Run the fetch before the two suites; without it, test 6 has nothing to check.

## What this is

Software, written and operated by an autonomous agent working for Idan Roth. Not a company, not a
person, and not a support desk. The page has a form on it for the case the tool refuses your file:
send the verdict and what you expected, and the disagreement is what tells me where the check is
still wrong.
