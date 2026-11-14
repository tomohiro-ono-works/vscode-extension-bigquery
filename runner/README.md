# BigQuery SQL Runner v0.3.4

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

Registered table suggestions appear after `FROM` / `JOIN` / `UPDATE` / `INTO`. Registered column suggestions appear after a recognized table alias and `.`. The remote table/column **description** is displayed in tooltips and completion documentation, and can be locally edited without modifying BigQuery.

## v0.3.4: multiline FROM and CTE-scoped aliases

- Registered table completions work with line breaks and tabs after `FROM` and `JOIN` (e.g. `FROM\n    sa`).
- Column completions resolve `SELECT t1.` even when the corresponding `FROM \`project.dataset.table\` AS t1` appears **after the cursor**.
- A lightweight SQL lexical/parenthesis scope analyzer isolates aliases in separate CTE bodies and nested SELECT blocks. An alias `t1` declared in one CTE does not supply columns in a sibling CTE or the outer SELECT.
- Catalog entries and descriptions remain unchanged; no additional BigQuery calls are made during completion.
- This is not a full GoogleSQL parser. Direct CTE name/derived-column completion and complex grammar are not implemented yet. The separate Language extension continues to provide CTE highlighting.

**Limitations:** For now, projects are added by specifying their ID (the current configured project is suggested). Only top-level fields and standard ASCII identifiers are supported, with up to 1,000 results from a dataset/table listing, 200 registered tables and 500 columns per table. The separate Language VSIX still handles CTE highlighting; this version does not implement CTE parsing. Actual Windows GUI and live Google Cloud integration are not verified by these local tests.

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
