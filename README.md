# BigQuery GoogleSQL Language

An offline VSCode language mode for BigQuery GoogleSQL. Provides keyword, function, data type, parameter and identifier highlighting, comment support, bracket auto-closing, basic indentation and a screenshot-matched reference palette.

## Download VSIX

Download [BigQuery GoogleSQL Language v0.2.3](vsix/bigquery-sql-language-0.2.3.vsix) and install it with **Extensions → ... → Install from VSIX** in VSCode.

SHA-256: `7abc62101bd56927291ae71a160b55cc81c400218087b86c5614916b98fddbfa`

## BigQuery SQL Runner (separate VSIX)

For authentication, BigQuery dry runs and explicit SQL execution, install the independent [BigQuery SQL Runner v0.1.0](vsix/bigquery-sql-runner-0.1.0.vsix).

SHA-256: `6799c2e04c3b49cce272e254e2851122e388f2496289bd4da4aea2a7efb15d74`

This runner requires the official Google Cloud CLI (`gcloud` and `bq`) on your computer. It uses the CLI's existing login, prompts for confirmation before executing SQL, and does not package credentials. See [Runner setup and safety notes](runner/README.md).

## Reference palette

The extension applies foreground colors, italic styling, and subtle inline backgrounds **only to GoogleSQL editors**:

- Comments: purple on lavender.
- Keywords and data types: italic purple.
- Functions: italic pink; numbers: pink.
- Strings and parameters: pink on pale pink.
- Table and CTE names: italic underlined blue on pale blue.

These extra decorations are intentionally lexical approximations, not schema-aware. The original TextMate grammar is still active. To restore the colors from your current VSCode theme, configure:

```json
{
  "bigquerySqlLanguage.referencePalette.enabled": false
}
```

For responsiveness on unusually large files (over 500,000 characters), the extension displays only the original TextMate colors.

## Yellow selection highlight (v0.2.1)

When text is selected in the active `BigQuery GoogleSQL` editor, the exact non-empty selection is given a yellow `#FFF176` background, like a highlighter pen. Other occurrences of the same word are not highlighted. Clearing the selection removes the yellow decoration, and the feature does not change global VSCode selection colors or affect editors in other language modes. Multiple selected ranges are supported.

The existing token foreground colors remain in effect.

## Keyword and function suggestions (v0.2.2)

Offline suggestions use the existing GoogleSQL TextMate keyword and function definitions, without a BigQuery connection or new dependencies:

| Number of characters typed in the current word | Suggestions |
| --- | --- |
| 1 | Keywords starting with the character |
| 2 | Keywords and functions starting with the two characters |
| 3 or more | Keywords and functions starting with the text, followed by items containing the text anywhere |

- Matching is case-insensitive. Prefix matches are shown before substring matches.
- Choosing a function inserts its name and `()` with the cursor between the parentheses; namespaced functions such as `NET.IP_FROM_STRING` keep their namespace.
- Comments, SQL strings, quoted identifiers and `@` parameters are excluded from these custom suggestions.
- VSCode's existing word-based suggestions are not disabled or modified.
- This feature is dictionary-based, not schema-aware: table names, column names and custom functions are not queried from BigQuery. Suggestions cover the keyword and function names defined in the bundled GoogleSQL grammar.

## Context-aware SQL syntax snippets (v0.2.3)

The existing offline function/keyword matching stays available. After typing a letter, the completion provider inspects the current SQL line and up to **20 preceding lines** to promote the next likely clause. For example, `SELECT a` followed by `F` promotes `FROM`; `FROM my_table` followed by `W` promotes `WHERE`. The lexical check ignores comments, quoted strings and other query blocks, and falls back to ordinary suggestions when the clause is uncertain. Unrelated matching candidates are not hidden.

Whole-clause snippets replace incomplete standalone suggestions:

- `CREATE TEMP TABLE`, `CREATE TEMP FUNCTION`.
- `CREATE OR REPLACE TABLE`, `CREATE OR REPLACE FUNCTION`, `CREATE OR REPLACE PROCEDURE`, `CREATE OR REPLACE TABLE FUNCTION`, `CREATE OR REPLACE VIEW`.
- `PARTITION BY`, `CLUSTER BY`, `ORDER BY`, `GROUP BY ALL`.
- `JOIN` inserts `JOIN table_name`, then `ON left_column = right_column` on the next line. Use **Tab** to move between the table, left column and right column placeholders.

Standalone `CREATE`, `ORDER`, `GROUP`, `GROUP BY`, `ON`, `PARTITION`, and `CLUSTER` are not offered by this extension's completion provider; this does **not** disable their syntax highlighting. `USING` is omitted from suggestions while completing a `JOIN` context. BigQuery's ordinary column-based `GROUP BY` remains valid SQL even though this extension only offers the `GROUP BY ALL` snippet.

The templates are offline starting points, not SQL validation; fill in names, parameter types and expressions as needed. Temporary table/function templates use unqualified names. Other installed VSCode completion providers may still show their own suggestions independently.

## Usage

1. Install the VSIX using **Extensions → ... → Install from VSIX**.
2. Open any `.sql` file and select **BigQuery GoogleSQL** from the language mode picker at the bottom-right of VSCode.
3. Files ending in `.bqsql` automatically use the language mode.

The existing `.sql` association is intentionally not replaced. To make it the default for a project, add this to `.vscode/settings.json`:

```json
{
  "files.associations": {
    "*.sql": "googlesql"
  }
}
```

This is lexical TextMate highlighting, not a parser. It does not verify identifiers against BigQuery schema; for that use the optional BigQuery Dry Run extension.

## Provenance

Microsoft's official VSCode SQL TextMate grammar (MIT), adapted for GoogleSQL. See `THIRD_PARTY_NOTICES.md`.

## License

MIT. See `LICENSE`.
