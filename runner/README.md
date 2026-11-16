# BigQuery SQL Runner v0.4.4

Language can now read user-editable external keyword, function and snippet dictionaries. Runner still includes the same default shared Core but does not access the external Language dictionary directory. Existing BigQuery catalog, Explorer UI, CLI calls, execution, and column completion are unchanged.

---

# BigQuery SQL Runner v0.4.3

The shared GoogleSQL Core now reads separate keyword/function `.txt` lists and `snippets.json` from `shared/googlesql-core/dictionaries/`, packaged in both extensions. The Explorer catalog, BigQuery CLI, registered metadata, and SQL runner features remain unchanged.

---

# BigQuery SQL Runner v0.4.2: Shared GoogleSQL Core

The SQL parser has moved to the canonical shared/googlesql-core/sql-scope.js. The Runner code re-exports that module; catalog, CREATE metadata, CTE and scope completion, Explorer UI, BigQuery commands, and stored registrations are unchanged. Runner ships its own copy of the common library; Language is not a runtime dependency.

---

# BigQuery SQL Runner v0.4.1

Fix: repair GitHub-published v0.4.0 malformed JavaScript, restore sidebar activation, and complete unquoted CREATE FUNCTION/PROCEDURE/TABLE FUNCTION snippet project and dataset placeholders. The Language extension continues to own SQL syntax; catalog UI and persisted registrations are unchanged. All distribution JavaScript must pass `node --check` before packaging.

---

# BigQuery SQL Runner v0.4.0

## v0.4.0: CREATE target catalog completion, without SQL syntax duplication

- BigQuery GoogleSQL Language v0.2.4 continues to own CREATE SQL snippets. Runner only supplies registered project/dataset/table names at CREATE declaration targets.
- The CREATE OR REPLACE TABLE/VIEW snippets can use cached project/dataset/table completions. FUNCTION, PROCEDURE and TABLE FUNCTION offer project/dataset names only.
- The selected `project`, `dataset`, `table_name` snippet tab stops can trigger VSCode suggestions without requiring typing. Existing dots and closing backticks are preserved.
- No hard inter-extension dependency; both completion providers use VSCode APIs independently. No BigQuery I/O during completion. Explorer sidebar remains unchanged.

---

# BigQuery SQL Runner v0.3.9

## Corrected extension responsibilities

- Runner provides only opt-in BigQuery metadata and CTE completion (project/dataset/table/column), including backtick-triggered path completion. It does not offer CREATE syntax snippets or keywords.
- BigQuery GoogleSQL Language v0.2.4 owns all SQL syntax keyword/function and CREATE templates.
- Existing v0.3.7 Explorer UI, Enter-only dataset/table search, checkboxes, descriptions, run/dry-run and CTE/column features remain unchanged.
- Registration is persisted as VSCode workspaceState under `bigquerySqlRunner.catalog.v1`; the sidebar Export action saves a JSON/YAML file.

---

## Explorer-style UI restored, inline search retained

This release repairs the regressed v0.3.6 sidebar by keeping the **Project → Dataset → Table → Column** hierarchy with disclosure arrows, per-table/per-column checkboxes, table/column icons, registered counts, and description-edit actions. The Webview is only used to embed search inputs inside the otherwise familiar tree layout; the four-level hierarchy is not split into separate sections.

- **Project:** Always-visible `＋ プロジェクトを追加` action inside the view, plus the original VSCode view-title `+` action. Both use the original project-ID input dialog. Project registration works even when a workspace is not trusted (but BigQuery CLI requests require trust). Newly registered projects auto-expand.
- **Dataset:** Expand a project to reveal a search field. Enter **at least 3 characters**, then **press Enter** to search. Expanding the project or typing without Enter never calls BigQuery.
- **Table:** Expand a dataset to reveal the same **3+ characters + Enter** search. Server-side substring matching against `INFORMATION_SCHEMA.TABLES` avoids downloading all table names. Expanding a dataset or typing does not call BigQuery.
- **Column:** Expand a specific table to load only its schema. An optional text filter narrows the displayed columns locally. Checking a table registers only the table; checking an individual column registers only that field and its parent table.
- **Previously registered items:** Stay visible even before a search; registration, description, aliases, CTE-scoped completion, JSON/YAML export, and SQL-run/dry-run features remain intact. Refresh clears search results and schema caches, **not registrations**.

**Validation:** 38 Node tests passed plus a headless Chromium test of the actual packaged sidebar JavaScript: project add; expand-without-fetch; Enter-triggered dataset/table search; table/column checked states; schema loading; optional column search; and state persistence across rerender. The browser test uses simulated BigQuery data; **actual Windows VSCode UI and a live BigQuery connection have not been tested**.

**Known limitation:** Dataset search is initiated only by Enter but currently filters up to 1,000 returned datasets client-side; the warning is shown when the discovery cap is reached. Table search uses `INFORMATION_SCHEMA` on the server. Windows CLI/PATH hardening is a separate unresolved issue.

---

## Dataset / table: search only after pressing Enter

The **BigQuery Completion** view stays inside Explorer, as one Project → Dataset → Table → Column hierarchy.
The view uses a dedicated search input at both the **dataset** and **table** levels:

1. Add a project from the `+` action. Expand it. No BigQuery call occurs merely from expanding.
2. Enter at least **three characters** of a dataset name in the **データセット名検索** input and **press Enter**. A case-insensitive substring search is run **only at that moment**. Results appear as datasets below the project.
3. Expand a dataset. No BigQuery call occurs merely from expanding. Enter at least **three characters** in **テーブル名検索** and **press Enter**. The registered search runs against `INFORMATION_SCHEMA.TABLES` with a `STRPOS(LOWER(table_name), ...)` predicate and returns up to 200 matching tables; no full table listing is downloaded.
4. Expand an individual table to fetch its columns on demand. Use **カラム検索（任意）** to filter the loaded column list locally. Column search is **optional** and does not call BigQuery on every keystroke.
5. Check only the desired table/column entries for completions. Checking the table alone does not check its columns. Existing registered table/column entries remain visible without a new search; they are read from VSCode workspace state.
6. Use the refresh action to **clear search results and cached metadata without making new requests**. Enter a search phrase again to re-query BigQuery. Description editing and JSON/YAML export are retained.

Search terms must be 3–80 ASCII letters/digits/underscores/hyphens (to match the currently supported BigQuery identifier subset). Dataset discovery uses `bq ls --max_results=1000` **only after Enter** and filters the returned names locally; when more than 1000 datasets exist, matches beyond this cap are not covered. Table search is performed on the server and requires BigQuery `INFORMATION_SCHEMA` query permissions and correct dataset/query location. The query may have minor BigQuery metadata-query costs. No SQL is executed on tree expansion, and no metadata calls are made by completion keystrokes.

**Security:** The Explorer uses VSCode `WebviewViewProvider` with a restrictive Content Security Policy, local packaged scripts/styles, DOM `textContent` rendering of metadata, and a fixed allowlist of extension-host actions. Search terms and resource identifiers are validated before CLI use; the table-search SQL is passed by stdin, not the shell command line. The older Windows `bq.cmd`/`gcloud.cmd` command-discovery/PATH hardening issue remains open. No live BigQuery or Windows VSCode GUI testing has been performed.

---

## Previous v0.3.5 behavior (archived for reference)

A separate VSCode extension for Google Cloud CLI login, BigQuery dry runs, explicit SQL execution and **opt-in table / column completions**.

## Project → dataset → table → column Explorer tree

The **BigQuery Completion** view appears inside VSCode's **Explorer** (not a separate sidebar icon). This version replaces the v0.2.0 "テーブル登録" and "カラム登録" folders and transient QuickPick wizard with **one stable four-level tree**.

```text
BIGQUERY COMPLETION                  [+] [Refresh] [Save]
  ▾ my-project                       (Project)
    ▾ mart                           (Dataset)
      ▾ sales                    [x] (Table: registered)
          customer_id            [x] (Column: registered)
          sales_amount           [x] (Column: registered)
          updated_at             [ ] (Column: not registered)
      ▸ customers                [ ] (Table: not registered)
    ▸ staging                        (Dataset)
```

1. Open **Explorer → BigQuery Completion**. Click **+** in the view title to add a Google Cloud **project ID**; the field defaults to the existing `gcloud` project when available.
2. Expand the **project** to load available **datasets** from BigQuery (`bq ls`).
3. Expand a **dataset** to load its **tables** (`bq ls`).
4. Check a **table** to register only its table name and description. Checking a table does **not** register every column.
5. Expand the **table** to load **columns** and their data types/descriptions (`bq show`). Check only the columns that should appear in suggestions. Checking a column automatically registers its parent table if necessary.
6. Uncheck an item to unregister it. Unchecking a table that has registered columns requires confirmation. Right-click registered tables/columns to edit the local **description** or unregister them.
7. Use the **refresh** icon to re-query BigQuery if new schemas were created. **Refresh does not delete registrations**. Use **save** to export registrations to `.json`, `.yaml` or `.yml` explicitly.

The tree remains visible between interactions. All checked registrations are automatically persisted in **VSCode workspace state**, **not source files**. Existing v0.2.0 table/column registrations are read from the same workspace-state key and displayed in the new tree. Users can also see previously registered metadata when the CLI is unavailable. Google Cloud metadata is only fetched on expansion/checking/refresh, never on every editor keystroke.

If a registered table does not appear in suggestions, run **BigQuery: 補完状態を診断** from the Command Palette or the magnifying-glass icon on the BigQuery Completion view. It reports whether there are registered tables, the editor language ID, and whether candidate names are generated at the cursor. The diagnostic does not execute SQL or connect to BigQuery. If candidates are generated but not displayed, try **Ctrl+Space** and check `editor.quickSuggestions`.

Registered table suggestions appear after `FROM` / `JOIN` / `UPDATE` / `INTO`. Registered column suggestions appear both after a recognized table alias and `.`, and without an alias in SELECT, WHERE, ON, HAVING, QUALIFY, GROUP BY and ORDER BY when their registered tables appear in the current query’s FROM/JOIN. Duplicate column names across joined tables are offered with their source alias to avoid ambiguous SQL. The remote table/column **description** is displayed in tooltips and completion documentation, and can be locally edited without modifying BigQuery.

## v0.3.5: unqualified columns in SELECT/WHERE/HAVING and CTE output columns

- For `SELECT sales_ FROM ... AS t1`, `WHERE sales_`, `HAVING sales_`, `ON sales_`, `GROUP BY sales_`, `ORDER BY sales_` and `QUALIFY sales_`, suggest registered columns from the **current SELECT block's** `FROM` / `JOIN` sources. You no longer need to type `t1.` first.
- Resolve relations after the cursor, so `SELECT sales_|` is supported even when the `FROM` is on later lines.
- Offer `WITH sales_cte AS (...)` names after `FROM` and inferred CTE output columns when that CTE is used as a source. Column inference uses explicit selected names, `AS` aliases and `SELECT *`/`alias.*` over registered fields; it does **not** execute or dry-run the query.
- Keep CTE-local aliases and source tables isolated from sibling CTE bodies. Nested SELECT blocks do not leak aliases.
- When a column name is duplicated across joined sources, offer qualified suggestions such as `s.customer_id` and `c.customer_id` instead of inserting an ambiguous bare column name.
- No new external dependencies, network calls or BigQuery metadata requests during completion. Existing registered tables and columns are retained.

## v0.3.4: multiline FROM and CTE-scoped aliases

- Registered table completions work with line breaks and tabs after `FROM` and `JOIN` (e.g. `FROM\n    sa`).
- Column completions resolve `SELECT t1.` even when the corresponding `FROM \`project.dataset.table\` AS t1` appears **after the cursor**.
- A lightweight SQL lexical/parenthesis scope analyzer isolates aliases in separate CTE bodies and nested SELECT blocks. An alias `t1` declared in one CTE does not supply columns in a sibling CTE or the outer SELECT.
- Catalog entries and descriptions remain unchanged; no additional BigQuery calls are made during completion.
- This is a lightweight structural scanner rather than a complete GoogleSQL parser. v0.3.5 adds CTE-name and inferred-output-column suggestions; complex expressions without explicit aliases and advanced GoogleSQL syntax may need manual entry. The separate Language extension continues to handle syntax highlighting.

**Limitations:** For now, projects are added by specifying their ID (the current configured project is suggested). Only top-level fields and standard ASCII identifiers are supported, with up to 1,000 results from a dataset/table listing, 200 registered tables and 500 columns per table. The separate Language VSIX still handles highlighting; the Runner parses common WITH/CTE structures only for completion. Actual Windows GUI and live Google Cloud integration are not verified by these local tests.

## Requirements

- Official Google Cloud CLI (`gcloud` and `bq`) installed and available in the VSCode environment.
- Google Cloud login using **BigQuery: Log in with Google Cloud CLI** (`gcloud auth login`).
- Permission to list requested datasets/tables and view their schema.
- A trusted VSCode workspace is required before invoking the metadata CLI. Previously saved registrations remain visible without a CLI connection.

## Query commands

- **BigQuery: Dry Run SQL**: validates the selection, or whole SQL document if nothing is selected.
- **BigQuery: Execute SQL**: runs selection or whole SQL document after modal confirmation. Execution may alter data or incur charges.

SQL is passed to the `bq` CLI through **stdin** rather than a command argument. Output appears in the **BigQuery SQL Runner** output channel.

### Settings

```json
{
  "bigquerySqlRunner.projectId": "my-project",
  "bigquerySqlRunner.location": "asia-northeast1",
  "bigquerySqlRunner.maxRows": 100,
  "bigquerySqlRunner.maximumBytesBilled": "1000000000"
}
```

`maximumBytesBilled` limits billing, **not destructive SQL**.

## Security

- No listening socket, direct outbound HTTP call, third-party npm runtime package, stored access token or service-account key is added by this extension. The installed Google Cloud CLI communicates with Google Cloud.
- BigQuery descriptions are rendered as plain text; do not export metadata to a public repository unless approved.
- The **Windows CLI command-discovery / PATH substitution concern remains open** in this version. Use trusted directories and least-privilege credentials; command path hardening is a separate change.
- Unit tests exercise VSCode API mocks and metadata parsing; no actual VSCode GUI or production BigQuery authentication was tested.

## License

MIT (see `LICENSE`).

## v0.3.2: SQL補完の起動修正

- `sql` / `googlesql` ファイルを開くとRunnerを自動的に起動し、補完プロバイダーを登録します。サイドバーを開く必要はありません。
- `FROM ` などの入力途中では候補リストを再計算するため、初回に候補が空でも補完されるよう改善しました。
- テーブル名・カラム名は、引き続き **BigQuery Completionでチェック登録した項目だけ** が対象です。
- 補完は `Ctrl+Space` でも開けます。出ない場合は `BigQuery: 補完状態を診断` を実行してください。
- Language v0.2.3との併用は可能です。既存の登録データはそのまま引き継ぎます。

**検証範囲:** ローカル単体テスト。Windowsの実機VSCodeと認証済みBigQueryへの接続は未検証です。

## v0.3.3: VSCode completion host compatibility and diagnostics

- Completion provider now returns an actual VSCode `CompletionList`, not a plain `{items,isIncomplete}` object.
- Table and column completion candidates include `BigQuery Runner · Table/Column` in the suggestion detail to distinguish them from syntax and function suggestions.
- **BigQuery: 補完状態を診断** now also invokes `vscode.executeCompletionItemProvider` to verify whether registered candidates reach the VSCode completion pipeline (where a document URI is available). It does not send SQL or account details externally.
- Catalog registration failures are shown explicitly instead of being silently skipped.

### Known limits

VSCode GUI and live cloud access have not been validated in this build; unit tests alone do not demonstrate that the suggestions render in the user's editor. The existing Windows CLI path search hardening issue is unchanged.
