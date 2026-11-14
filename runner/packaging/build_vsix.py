"""Build standalone VSIX with Python's standard zipfile module.

Run from runner/: python packaging/build_vsix.py
"""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
version = package['version']
target = root.parent / 'vsix' / f"bigquery-sql-runner-{version}.vsix"
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
    for source, destination in [
        ('packaging/[Content_Types].xml', '[Content_Types].xml'),
        ('packaging/extension.vsixmanifest', 'extension.vsixmanifest'),
        ('package.json', 'extension/package.json'),
        ('LICENSE', 'extension/LICENSE'),
        ('README.md', 'extension/README.md'),
    ]:
        archive.write(root / source, destination)
    for source in sorted((root / 'src').glob('*.js')):
        archive.write(source, 'extension/src/' + source.name)
print(target)
