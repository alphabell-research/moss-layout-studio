"""Package the canonical Studio evaluator as a standalone static Space."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
STANDALONE = Path(__file__).resolve().parent
EDITOR = 'https://huggingface.co/spaces/alphabell/MOSS-Layout-Studio'
SHARED = ['evaluate.mjs','evaluate-core.mjs','evaluate.css','layout.mjs','favicon.svg','verify_evaluator.py','tests/evaluate.test.mjs']


def build(destination: Path):
    destination = Path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('The output directory must be empty.')
    destination.mkdir(parents=True, exist_ok=True)
    for name in SHARED:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    html = (ROOT / 'evaluate.html').read_text()
    if html.count('href="index.html"') != 4:
        raise ValueError('Editor navigation changed; review the standalone rewrite.')
    html = html.replace('href="index.html"', f'href="{EDITOR}"')
    for name in ['index.html','evaluate.html']:
        (destination / name).write_text(html)
    for source, target in [('README.template.md','README.md'),('NOTICE','NOTICE'),('thumbnail.png','thumbnail.png'),('thumbnail.html','thumbnail.html')]:
        shutil.copyfile(STANDALONE / source, destination / target)
    shutil.copyfile(ROOT / 'LICENSE', destination / 'LICENSE')
    package = {'name':'alphabell-moss-blind-layout-check','private':True,'version':'1.0.0','author':'alphaBell','license':'Apache-2.0','scripts':{'test':'node --test tests/evaluate.test.mjs'}}
    (destination / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
    hashes = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in SHARED}
    manifest = {'canonical_source':'https://github.com/alphabell-research/moss-layout-studio','entry_source':'evaluate.html','copied_files_sha256':hashes,'navigation_rewrite':'relative editor links point to '+EDITOR}
    (destination / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return destination


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 standalone/build.py OUTPUT_DIRECTORY')
    path = build(Path(sys.argv[1]))
    print(json.dumps({'directory':str(path),'files':sorted(p.relative_to(path).as_posix() for p in path.rglob('*') if p.is_file())}))
