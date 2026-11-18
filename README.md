# WhelkMail Installer

One command to provision and deploy [WhelkMail](https://github.com/WhelkMail/WhelkMail) on Cloudflare Pages.

- Runs on Windows, macOS and Linux with Node.js 22 or newer.
- Uses only your own Cloudflare account and a GitHub release. No paid service is required by the installer.
- Never writes secrets to disk and never commits them.

## What it does

1. Downloads the latest WhelkMail release, or copies a local checkout.
2. Installs dependencies and builds the app.
3. Creates or reuses the D1 database `mail-client`.
4. Creates or reuses the Pages project `whelkmail`.
5. Generates and uploads `APP_PASSWORD`, `TOKEN_ENC_KEY`, and optionally `CRON_SECRET` and the VAPID keys.
6. Applies `db/schema.sql` on a fresh database, or the pending migrations on an existing one.
7. Deploys the Pages project.
8. Verifies `GET /api/health`.
9. Optionally creates an R2 bucket and deploys the 5-minute cron worker.

## Requirements

- Node.js 22 or newer.
- A Cloudflare account.
- A `tar` command. Windows 10 1803+, macOS and Linux include one.
- For the GitHub Actions flow: repository secrets listed below.

## Quick start

```bash
npx whelkmail-installer
```

Without a published npm package, use the repository directly:

```bash
npx github:WhelkMail/installer
```

The installer opens the Cloudflare login flow when no API token is present, asks for the login password, generates `TOKEN_ENC_KEY` when missing, and prints every generated value to the terminal.

Non-interactive local run:

```bash
APP_PASSWORD='choose-a-strong-password' TOKEN_ENC_KEY='<base64-32-bytes>' \
  npx whelkmail-installer --yes
```

Generate the key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Options

| Flag | Purpose |
|---|---|
| `--source <dir>` | Use a local WhelkMail checkout instead of downloading a release. The checkout is copied to a temporary directory first. |
| `--ref <tag\|branch>` | Source ref. Default: the latest GitHub release. |
| `--project-name <name>` | Pages project name. Default: `whelkmail`. |
| `--db-name <name>` | D1 database name. Default: `mail-client`. |
| `--branch <name>` | Production branch for the Pages project. Default: `main`. |
| `--r2` | Create an R2 bucket and bind it as `BUCKET`. |
| `--r2-bucket <name>` | R2 bucket name, implies `--r2`. Default: `<project>-archive`. |
| `--cron` | Deploy the 5-minute cron worker. |
| `--push` | Generate VAPID keys and deploy the cron worker. Implies `--cron`. |
| `--push-subject <value>` | VAPID subject, `mailto:...` or `https://...`. Default: the deployment URL. |
| `--account-id <id>` | Cloudflare account id. Usually resolved from `wrangler whoami`. |
| `--yes` | Non-interactive. Secrets must come from the environment. |
| `--dry-run` | Validate the options and print the plan. No network calls, no changes. |
| `--no-health` | Skip the post-deploy health check. |
| `--keep` | Keep the temporary workspace for inspection. |
| `--verbose` | Print every command and its full output. |
| `--help` | Show the built-in help. |

Environment variables: `APP_PASSWORD`, `TOKEN_ENC_KEY`, `CRON_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GITHUB_TOKEN`, `VAPID_SUBJECT`.

Examples:

```bash
npx whelkmail-installer --r2
npx whelkmail-installer --cron
npx whelkmail-installer --push --push-subject mailto:you@example.com
npx whelkmail-installer --ref 1.0.1
npx whelkmail-installer --dry-run
npx whelkmail-installer --source ../mail-client
```

## GitHub Actions

1. Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | Provisioning and deployment |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Account that owns the resources |
| `APP_PASSWORD` | yes | WhelkMail login password |
| `TOKEN_ENC_KEY` | yes | 32 random bytes, base64 |
| `CRON_SECRET` | when cron/push is enabled | Shared secret for the cron worker |
| `NPM_TOKEN` | only for publishing | npm publish workflow |

2. Open **Actions → Install WhelkMail → Run workflow** and fill the inputs.
3. The run creates the resources, deploys, and writes a summary with the URL.

The workflow performs a **direct upload** deployment. Pushing to the installer repository does not redeploy the app. To update, rerun the workflow with a newer `ref`, or connect the Pages project to the WhelkMail repository once in the Cloudflare dashboard for push-to-deploy.

### Cloudflare API token scope

Create a token at **dash.cloudflare.com/profile/api-tokens** with these account permissions:

| Scope | Permission |
|---|---|
| Account → Workers Scripts | Edit |
| Account → Cloudflare Pages | Edit |
| Account → D1 | Edit |
| Account → Account Settings | Read |
| Account → R2 | Edit (only with `--r2`) |

No zone permissions are needed.

## Free plan notes

The installer itself is free. The deployment can also run on free tiers, with one important caveat.

| Service | Free tier | Notes |
|---|---|---|
| Cloudflare Pages | 500 builds/month, unlimited static requests | Git integration and custom domains included |
| Workers / Pages Functions | 100,000 requests/day, 10 ms CPU per invocation | IMAP/SMTP TLS handshakes can exceed 10 ms |
| D1 | 5 GB, daily read/write quotas | Fine for personal use |
| R2 | 10 GB, free egress | Enabling R2 requires billing information on the account |
| GitHub Actions | Unlimited on public repos, 2,000 minutes/month on private | The installer run takes a few minutes |
| Cron worker | ~288 invocations/day | Well within the free quota |

**IMAP on the free plan is best-effort.** If a request exceeds 10 ms of CPU the deployment returns `CPU time limit exceeded`. Relay accounts that send over HTTP APIs avoid IMAP entirely and are the safest free configuration. Workers Paid (from $5/month) is the reliable option for IMAP.

## Security

- Secrets are sent to `wrangler` through standard input, never as command line arguments.
- Secrets are removed from the environment of every other child process, so `npm ci` and build scripts cannot read them.
- The password prompt hides input; generated values are printed to the terminal and never written to disk.
- Local `--source` copies exclude `.env`, `.dev.vars`, `wrangler.toml`, `node_modules`, `dist` and `.git`.
- The temporary workspace is deleted after the run unless `--keep` is used.
- The installer collects no telemetry.

## Development

```bash
npm test
npm run check
node bin/whelkmail-installer.mjs --dry-run --source ../mail-client
node bin/whelkmail-installer.mjs --help
```

If the `whelkmail-installer` npm name is unavailable, change `name` in `package.json` and the install command before publishing.

Layout:

```
bin/                   CLI entry point
src/args.mjs           option parsing and help
src/install.mjs        provisioning flow
src/wrangler.mjs       wrangler commands
src/source.mjs         local copy and release download
src/config.mjs         generated wrangler.toml files
src/migrate.mjs        schema and migration runner over D1
src/secrets.mjs        key and password generation
action/install.mjs     GitHub Actions adapter
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `CPU time limit exceeded` | IMAP on Workers Free. Use relay accounts or Workers Paid. |
| `Cloudflare authentication failed` | Check `CLOUDFLARE_API_TOKEN`, or run `npx wrangler login`. |
| `Could not create the D1 database` | Token lacks D1 Edit, or the account id is wrong. |
| `Could not create the R2 bucket` | R2 is not enabled for billing on the account; drop `--r2`. |
| Health check fails | Check the D1 binding and secrets in the Pages dashboard, then read Deployments → Logs. |
| `Could not resolve the latest WhelkMail release` | GitHub rate limit. Set `GITHUB_TOKEN` or pass `--ref`. |
| `tar` not found | Install `tar`. Windows 10 1803+ and macOS include it. |
| `Dependency installation failed` | Run `npm ci` in the WhelkMail source once to inspect the error. |
| Actions run cannot find secrets | The required repository secrets are missing; the preflight step lists them. |

## Cross-platform

The installer has no platform-specific code. It uses Node APIs, `npm`/`npx`, and the system `tar`. It does not use PowerShell, bash scripts, or native build tools. Windows, macOS and Linux are supported; GitHub Actions runs it on `ubuntu-latest`.

## License

MIT.
