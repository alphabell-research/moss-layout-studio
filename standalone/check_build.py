"""Verify standalone output is generated from the canonical evaluator source."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

from build import ROOT, SHARED, EDITOR, build


def main():
    with tempfile.TemporaryDirectory(prefix='moss-blind-space-check-') as directory:
        target = build(Path(directory))
        for name in SHARED:
            source = (ROOT / name).read_bytes()
            published = (target / name).read_bytes()
            if source != published:
                raise ValueError('Shared evaluator file drifted: ' + name)
        html = (target / 'index.html').read_text()
        if (target / 'evaluate.html').read_text() != html:
            raise ValueError('Entry aliases disagree')
        if 'href="index.html"' in html or html.count(f'href="{EDITOR}"') != 4:
            raise ValueError('Standalone editor links were not rewritten')
        metadata = (target / 'README.md').read_text()
        if 'app_file: index.html' not in metadata or 'title: MOSS Blind Layout Check' not in metadata:
            raise ValueError('Space metadata changed')
        png = (target / 'thumbnail.png').read_bytes()
        if png[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', png[16:24]) != (1280, 720):
            raise ValueError('Thumbnail dimensions changed')
        manifest = json.loads((target / 'build-manifest.json').read_text())
        for name, digest in manifest['copied_files_sha256'].items():
            if hashlib.sha256((target / name).read_bytes()).hexdigest() != digest:
                raise ValueError('Build manifest mismatch: ' + name)
        for name in ['README.md','NOTICE','index.html','evaluate.mjs','evaluate-core.mjs','evaluate.css']:
            content = (target / name).read_text().lower()
            if '—' in content:
                raise ValueError('Unexpected long dash in public copy: ' + name)
        subprocess.run(['node','--test',str(target / 'tests/evaluate.test.mjs')],check=True,capture_output=True)
        subprocess.run([sys.executable,str(target / 'verify_evaluator.py')],check=True,capture_output=True)
        print(json.dumps({'shared_files_identical':len(SHARED),'entry_aliases':2,'node_tests':7,'browser_checks':7,'thumbnail':'1280x720'}))


if __name__ == '__main__':
    main()
