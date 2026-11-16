"""Check VSIX contents and ensure both carry identical shared source."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import json, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(ROOT/'scripts/sync_grammar.py'),'--check'],check=True)
versions={
 "language":json.loads((ROOT/"package.json").read_text())["version"],
 "runner":json.loads((ROOT/"runner/package.json").read_text())["version"]
}
contents={}
for kind,version in versions.items():
    f=ROOT/"vsix"/f"bigquery-sql-{kind}-{version}.vsix"
    with ZipFile(f) as z:
        assert z.testzip() is None, f
        manifest=json.loads(z.read("extension/package.json"))
        assert manifest["version"]==version
        assert z.read("extension/syntaxes/googlesql.tmLanguage.json")==(
            ROOT/"syntaxes/googlesql.tmLanguage.json").read_bytes()
        contents[kind]={}
        for source in sorted((ROOT/"shared/googlesql-core").glob("*.js")):
            b=z.read("extension/shared/googlesql-core/"+source.name)
            assert b==source.read_bytes(), source
            contents[kind][source.name]=b
        for dictionary in sorted((ROOT/'shared/googlesql-core/dictionaries').iterdir()):
            if dictionary.is_file():
                key='extension/shared/googlesql-core/dictionaries/'+dictionary.name
                raw=z.read(key)
                assert raw==dictionary.read_bytes(), key
                contents[kind][dictionary.name]=raw
        with TemporaryDirectory() as temporary:
            z.extractall(temporary)
            root=Path(temporary)/"extension"
            for js in root.rglob("*.js"):
                subprocess.run(["node","--check",str(js)],check=True,capture_output=True)
            if kind=="language":
                js="const c=require(process.argv[1]);if(!c.findCompletions('CRE').some(x=>x.label==='CREATE OR REPLACE TABLE'))process.exit(1)"
                module=root/"src/completion.js"
            else:
                js="const c=require(process.argv[1]);if(typeof c.getSuggestions!=='function')process.exit(1)"
                module=root/"src/catalog.js"
            subprocess.run(["node","-e",js,str(module)],check=True,capture_output=True)
assert contents["language"]==contents["runner"],"Shared module content mismatch"
print("Both VSIXs valid, shared Core identical, syntax and module imports checked")
