# GoogleSQL Core

This is the single canonical shared JavaScript library for Language and Runner. It contains the GoogleSQL tokenizer, SQL clause analyzer, CTE and alias scope parser, and keyword, function and syntax template dictionary.

It depends only on the canonical grammar file at syntaxes/googlesql.tmLanguage.json in the repository root. No VSCode API, BigQuery SDK or network calls are used.

The two VSIX artifacts both embed the exact same shared library and grammar. Their modules are independent at runtime: Language owns syntax highlighting and SQL snippets; Runner owns BigQuery connection, catalog persistence, UI and catalog/CTE completion.

When changing this library, rebuild and test both VSIX packages.
