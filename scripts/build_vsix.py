"""Build Language and Runner VSIX with the same checked-in GoogleSQL Core.
Requires only Python standard library. Usage: python scripts/build_vsix.py
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse, json

ROOT=Path(__file__).resolve().parents[1]
CORE=ROOT/"shared/googlesql-core"
GRAMMAR=ROOT/"syntaxes/googlesql.tmLanguage.json"

def build(kind):
    parent=ROOT if kind=="language" else ROOT/"runner"
    version=json.loads((parent/"package.json").read_text(encoding="utf-8"))["version"]
    output=ROOT/"vsix"/f"bigquery-sql-{kind}-{version}.vsix"
    output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(output,"w",compression=ZIP_DEFLATED,compresslevel=9) as z:
        def add(src,dst):
            z.write(ROOT/src,dst)
        if kind=="language":
            add("packaging/language-content-types.xml","[Content_Types].xml")
            add("packaging/language.vsixmanifest","extension.vsixmanifest")
            for n in ("package.json","README.md","LICENSE","THIRD_PARTY_NOTICES.md","language-configuration.json"):
                add(n,"extension/"+n)
            add("licenses/microsoft-vscode-MIT.txt","extension/licenses/microsoft-vscode-MIT.txt")
            for p in sorted((ROOT/"src").glob("*.js")):
                z.write(p,"extension/src/"+p.name)
        else:
            add("runner/packaging/[Content_Types].xml","[Content_Types].xml")
            add("runner/packaging/extension.vsixmanifest","extension.vsixmanifest")
            for n in ("package.json","README.md","LICENSE"):
                add("runner/"+n,"extension/"+n)
            for p in sorted((ROOT/"runner/src").glob("*.js")):
                if p.name=="sql-scope.js":
                    text=p.read_text(encoding="utf-8")
                    before="require('../../shared/googlesql-core/sql-scope')"
                    assert before in text
                    z.writestr("extension/src/sql-scope.js",
                        text.replace(before,"require('../shared/googlesql-core/sql-scope')"))
                else:
                    z.write(p,"extension/src/"+p.name)
            for p in sorted((ROOT/"runner/media").iterdir()):
                if p.is_file(): z.write(p,"extension/media/"+p.name)
        z.write(GRAMMAR,"extension/syntaxes/googlesql.tmLanguage.json")
        for p in sorted(CORE.glob("*.js")):
            z.write(p,"extension/shared/googlesql-core/"+p.name)
    print(output)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--only",choices=("language","runner"))
    args=parser.parse_args()
    for name in (("language","runner") if args.only is None else (args.only,)):
        build(name)
