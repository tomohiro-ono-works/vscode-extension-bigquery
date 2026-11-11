# BigQuery SQL Runner

A separate Visual Studio Code extension for BigQuery queries using the **Google Cloud CLI already installed on your computer**. Complements the offline **BigQuery GoogleSQL Language** syntax and suggestion extension.

## Requirements

- Install the official [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) with `gcloud` and `bq` available on your `PATH`.
- Your Google account needs the appropriate BigQuery IAM permissions and a valid Google Cloud project.
- No Google Cloud key, secret, token, or local credential file is packaged in this extension.

## Commands

Run commands from the VSCode Command Palette (`Ctrl+Shift+P`) or the SQL editor right-click menu where offered:

- **BigQuery: Log in with Google Cloud CLI** opens a terminal and starts `gcloud auth login`. Existing CLI login remains usable; you do not need to log in again each time.
- **BigQuery: Dry Run SQL** validates the query without executing it.
- **BigQuery: Execute SQL** asks for confirmation and then submits the query. A running query can incur charges or modify data.

The SQL command uses the active selection or, when nothing is selected, the entire `.sql` / BigQuery GoogleSQL editor. Query text is supplied to `bq` through **standard input**, never via a shell command line. Results and CLI diagnostics appear in the local **BigQuery SQL Runner** output channel.

## Configuration

```json
{
  "bigquerySqlRunner.projectId": "my-project",
  "bigquerySqlRunner.location": "asia-northeast1",
  "bigquerySqlRunner.maxRows": 100,
  "bigquerySqlRunner.maximumBytesBilled": "1000000000"
}
```

If `projectId` is empty, the runner uses `gcloud config get-value project`. `location` is optional. The execution command requires a positive billing limit (default 1 billion bytes); dry run does not run the SQL. Results are limited to 100 rows by default, and subprocess output is capped to 1 MiB.

## Security and limitations

- Authentication is performed only by Google's installed CLI, with credentials under the CLI's management. Never commit local credential files.
- SQL execution is **manual and confirmed**. Dry runs are separate, explicitly invoked commands.
- This extension executes **the SQL you select**, including DDL/DML if provided. Review it carefully: the maximum billed bytes setting does not make destructive SQL safe.
- For interactive browser-based `gcloud auth login`, use the terminal as prompted. Installed `gcloud` and `bq` must be available to VSCode's environment.
- Automated tests validate local command creation and process handling. Live Google Cloud login and BigQuery execution must be tested by the user in their authenticated environment.

## License

MIT. See `LICENSE`.
