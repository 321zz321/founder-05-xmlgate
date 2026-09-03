#!/usr/bin/env python3
"""Writes web/verdicts.json: the Python original's verdict for every file in
tests/ and corpus/, as part|measure|verdict triples in document order.

It exists so the browser port is checked against the thing it was ported from,
on files nobody here wrote, rather than against my own opinion of what it should
say. Case 11 of web/acceptance_test.js reads it.
"""
import glob
import json
import os

import xmlgate

HERE = os.path.dirname(os.path.abspath(__file__))

out = {}
for folder in ('tests', 'corpus'):
    for path in sorted(glob.glob(os.path.join(HERE, folder, '*.musicxml'))):
        key = '%s/%s' % (folder, os.path.basename(path))
        _, findings, _ = xmlgate.check(path)
        out[key] = ['%s|%s|%s' % (pid, num, verdict) for pid, num, verdict, _ in findings]

dest = os.path.join(HERE, 'web', 'verdicts.json')
with open(dest, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, indent=1, sort_keys=True)
print('wrote web/verdicts.json: %d files, %d findings' % (len(out), sum(len(v) for v in out.values())))
