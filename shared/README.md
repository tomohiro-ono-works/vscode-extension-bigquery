# GoogleSQL Core

This is the single canonical shared JavaScript library for Language and Runner. It contains the GoogleSQL tokenizer, SQL clause analyzer, CTE and alias scope parser, and keyword, function and syntax template dictionary.

It depends only on the canonical grammar file at syntaxes/googlesql.tmLanguage.json in the repository root. No VSCode API, BigQuery SDK or network calls are used.

The two VSIX artifacts both embed the exact same shared library and grammar. Their modules are independent at runtime: Language owns syntax highlighting and SQL snippets; Runner owns BigQuery connection, catalog persistence, UI and catalog/CTE completion.

When changing this library, rebuild and test both VSIX packages.

## Completion dictionary maintenance

Edit `googlesql-core/dictionaries/keywords.txt` and `functions.txt` (one uppercase entry per line), or `snippets.json` (multi-line templates and snippet placeholders). SQL completions load these at extension initialization and use in-memory arrays for every request. Run `python scripts/sync_grammar.py --write` when changing the keyword/function lists; this rewrites only their three TextMate grammar patterns. CI enforces `--check`. Both VSIX packages embed the same dictionaries. Do not hand-maintain a duplicate keyword/function dictionary in `completion.js`.
