"""Compare browser compilation with the pinned, unmodified OpenMOSS compiler.

No network, model weights, inference runtime or credentials are needed.
This tests accepted layout drafts and compiled output, not generated images.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import subprocess

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / 'tests/vendor/compile_prompt.py'
EXPECTED_SHA256 = '1d75780cf9f22f9ebed1a33d8100158f8d73ebfe59a5d435c1cc8c8e1374a8a3'
assert hashlib.sha256(REFERENCE.read_bytes()).hexdigest() == EXPECTED_SHA256
spec = importlib.util.spec_from_file_location('upstream_compile_prompt', REFERENCE)
upstream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upstream)

BASE = {'width': 1536, 'height': 1024, 'bbox_coord_space': 'abs', 'bbox_format': 'xyxy',
        'summary': {'caption': 'A ceramic campaign.', 'meta': ['poster'], 'canvas': 'single', 'palette': ['ivory']},
        'items': [{'label': 'text', 'caption': 'Green type.', 'text': '把日常，过成诗。\n"MOSS" 🪴',
                   'bbox': [928, 272, 1408, 448], 'tags': ['title'], 'palette': ['green']}]}
cases = []

def add(name, source):
    cases.append((name, json.dumps(source, ensure_ascii=False, allow_nan=False, separators=(',', ':'))))

add('landscape with Unicode and optional metadata', BASE)
rng = random.Random(20261023)
for i in range(400):
    source = copy.deepcopy(BASE)
    width, height = rng.choice([(1536, 1024), (768, 1344), (1024, 1024), (512, 512), (2048, 2048)])
    source['width'], source['height'] = width, height
    source['items'] = []
    for j in range(rng.randint(1, 5)):
        x1, x2 = sorted(rng.uniform(0, width) for _ in range(2))
        y1, y2 = sorted(rng.uniform(0, height) for _ in range(2))
        source['items'].append({'label': rng.choice(['object', 'character', 'text']), 'caption': 'A deliberately overlapping layer.', 'text': f'行 {i}\n🌿 {j}', 'bbox': [x1, y1, x2, y2]})
    add(f'random layout {i}', source)

# Fractional coordinates around integer edges exercise Python round(..., 9).
for edge in [0, 1, 2, 99, 768, 1023]:
    for offset in [-1e-8, -1e-9, -5e-10, -1e-11, 0, 1e-11, 5e-10, 1e-9, 1e-8]:
        source = copy.deepcopy(BASE)
        x1 = max(0, edge + offset)
        source['items'][0]['bbox'] = [x1, 0.0009765625, min(1536, x1 + 10), 100.0009765625]
        add(f'precision edge {edge} {offset}', source)

mutations = [
    lambda d: d.update(width=1535), lambda d: d.update(width=True), lambda d: d.update(width=0),
    lambda d: d.update(bbox_format='yxyx'), lambda d: d.update(bbox_coord_space='relative'),
    lambda d: d.update(extra='unknown'), lambda d: d.update(items=[]),
    lambda d: d['summary'].update(caption=' '), lambda d: d['summary'].update(meta=[None]),
    lambda d: d['summary'].update(canvas='unknown'), lambda d: d['summary'].update(id=1),
    lambda d: d['items'][0].update(bbox=[0, 0, 0, 1]),
    lambda d: d['items'][0].update(bbox=[0, 0, 1537, 100]),
    lambda d: d['items'][0].update(bbox=[False, 0, 100, 100]),
    lambda d: d['items'][0].update(bbox=[1, 0, 1.00000000001, 100]),
    lambda d: d['items'][0].update(label='face'), lambda d: d['items'][0].update(text=''),
    lambda d: d['items'][0].pop('text'), lambda d: d['items'][0].update(tags=[3]),
    lambda d: d['items'][0].update(children=[]), lambda d: d['items'][0].update(id='ui-id'),
]
for i, mutate in enumerate(mutations):
    source = copy.deepcopy(BASE); mutate(source); add(f'invalid draft {i}', source)
for point in [0x09, 0x1c, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2007, 0x2028, 0x202f, 0x205f, 0x3000, 0xfeff]:
    source = copy.deepcopy(BASE); source['summary']['caption'] = chr(point)
    add(f'Unicode whitespace U+{point:04X}', source)
base_json = json.dumps(BASE, ensure_ascii=False, separators=(',', ':'))
cases.extend([
    ('float width literal', base_json.replace('"width":1536', '"width":1536.0')),
    ('exponent height literal', base_json.replace('"height":1024', '"height":1.024e3')),
    ('duplicate root key', base_json.replace('"width":1536', '"width":1536,"width":1024')),
    ('escaped duplicate key', base_json.replace('"width":1536', '"width":1536,"\\u0077idth":1024')),
    ('duplicate nested key', base_json.replace('"canvas":"single"', '"canvas":"single","canvas":"collage"')),
])

proc = subprocess.run(['node', str(ROOT / 'tests/bridge.mjs')], input='\n'.join(raw for _, raw in cases)+'\n', text=True, capture_output=True, check=True)
actual = [json.loads(line) for line in proc.stdout.splitlines()]
assert len(actual) == len(cases), (len(actual), len(cases))
errors = []; accepted = rejected = 0
for (name, raw), result in zip(cases, actual):
    try:
        source = json.loads(raw, object_pairs_hook=upstream.unique_object, parse_constant=upstream.reject_constant)
        expected = json.loads(upstream.compile_prompt(source)); ok = True
    except (ValueError, TypeError, OverflowError):
        ok = False; expected = None
    accepted += ok; rejected += not ok
    if ok != result['ok'] or (ok and expected != result.get('result')):
        errors.append({'name': name, 'expected_ok': ok, 'expected': expected, 'actual': result})
report = {'source_revision': '52b87fca23acedc399d062d593bec388aee9926a', 'comparisons': len(cases), 'accepted': accepted, 'rejected': rejected, 'mismatches': len(errors), 'scope': 'Pinned layout compiler acceptance and parsed output equivalence, not image-generation quality'}
print(json.dumps(report, indent=2))
if errors:
    print(json.dumps(errors[:5], ensure_ascii=False, indent=2)); raise SystemExit(1)
