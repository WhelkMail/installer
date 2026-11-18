# WhelkMail Installer (beta)

Set up your own [WhelkMail](https://github.com/WhelkMail/WhelkMail) on Cloudflare in a few minutes.

> **Beta: the installer is in beta.** Behavior, flags and defaults may change between releases, and installs may fail in edge cases. Back up anything important and expect occasional breaking changes. Bug reports and feedback are welcome.

> **This is not a website and not an app you download.** The installer is a small tool that creates a WhelkMail deployment inside **your** Cloudflare account. There is nothing to upload to a site, and the WhelkMail maintainers never see your credentials.

## The short version

You get your own webmail at an address like `https://your-site.pages.dev`, connected to the mailboxes you already own. Everything runs on your Cloudflare account.

What you need:

| You need | Why | Cost |
|---|---|---|
| A Cloudflare account | Owns the database and the website | Free |
| A GitHub account | Runs the installer from the browser (Path A) | Free |
| A password for WhelkMail | It is the login for your deployment | You choose it |
| Node.js 22 or newer | Only for the terminal path (Path B) | Free |

You do **not** need a server, a domain, or a credit card. A credit card is requested by Cloudflare only if you enable the optional R2 archive.

What the installer does, in plain words:

1. Takes the WhelkMail source from a GitHub release.
2. Creates a small database and a website project in your Cloudflare account.
3. Stores two secrets: your login password and an encryption key.
4. Builds and publishes WhelkMail, then checks that it answers correctly.

There are two ways to install it. Both end with the same result.

| Path | Who it is for | What you use |
|---|---|---|
| **A. Browser** | Most people | GitHub Actions, no software installed |
| **B. Terminal** | Developers | Node.js and one command |

After the install, open the URL, sign in with your password, and add your first mailbox. The free Cloudflare plan works, with one caveat about IMAP that is explained in [Free plan notes](#free-plan-notes).

## Path A: install from the browser

You need a GitHub account and a Cloudflare account. No software is installed on your computer. The installer runs on GitHub Actions inside your copy; public repositories have free Actions minutes.

### 1. Copy the installer repository

Open [github.com/WhelkMail/installer](https://github.com/WhelkMail/installer) and choose **Use this template** (or **Fork** if the template button is not available).

The installer runs inside your copy, with your GitHub account. If you forked instead of using the template, open the **Actions** tab once and enable workflows for the fork.

### 2. Create a Cloudflare API token

The token is the key that lets the installer create resources in your account. You can delete it after the installation.

1. Open [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Choose **Create Token** and then **Create Custom Token**.
3. Add these account permissions:
   - Account → Workers Scripts → Edit
   - Account → Cloudflare Pages → Edit
   - Account → D1 → Edit
   - Account → Account Settings → Read
   - Account → R2 → Edit (only if you want the optional R2 archive)
4. Set **Account Resources** to your account.
5. Create the token and copy it once. It is not shown again.

Copy your **Account ID** too. You can find it on the Cloudflare dashboard home, in the URL after `dash.cloudflare.com/`, or under **Workers & Pages**.

### 3. Add four secrets to your GitHub copy

In your copy, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The token you just created |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |
| `APP_PASSWORD` | The password you want to use to sign in to WhelkMail |
| `TOKEN_ENC_KEY` | 32 random bytes encoded in base64 |

To generate `TOKEN_ENC_KEY` without installing anything, open the browser developer console (F12) on any page and run:

```js
btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
```

Copy the output as the secret value. If you have a terminal, `openssl rand -base64 32` produces the same kind of value. Keep a copy somewhere safe: changing this key later invalidates stored mailbox credentials.

If you plan to enable the cron worker or Web Push, also add `CRON_SECRET` (any long random string).

### 4. Run the workflow

1. Open the **Actions** tab of your copy.
2. Select **Install WhelkMail**.
3. Choose **Run workflow** and confirm.
4. Leave the inputs at their defaults unless you want a different project name, a custom branch, or R2.

The run installs dependencies, creates the resources, deploys, and checks the health endpoint. It takes a few minutes.

### 5. Open your WhelkMail

At the end of the run, open the summary page: it shows the URL, for example `https://whelkmail.pages.dev`. Open it, sign in with `APP_PASSWORD`, and add your first account in **Settings → Accounts**.

If the run fails, open the failed step in the log. The [Troubleshooting](#troubleshooting) table covers the common cases.

### Updating a browser installation

The workflow uses a direct upload: pushing to the installer repository does not update your WhelkMail. To update, run the workflow again with `ref` set to the new WhelkMail release tag. The D1 database and the secrets are reused.

## Path B: install from the terminal

Requirements: Node.js 22 or newer. Windows, macOS and Linux are supported.

### 1. Run the installer

From the GitHub repository:

```bash
npx github:WhelkMail/installer
```

Or, once the package is published on npm:

```bash
npx whelkmail-installer
```

### 2. Follow the prompts

The installer opens the Cloudflare login in your browser when no API token is present, asks for the WhelkMail password, and generates the encryption key when it is missing. Every generated value is printed to the terminal once.

To keep the generated values, copy them before closing the terminal.

### 3. Open your WhelkMail

The installer prints the deployment URL and checks `GET /api/health`. Open the URL and sign in with the password you chose.

### Non-interactive example

Useful for scripts and CI:

```bash
APP_PASSWORD='choose-a-strong-password' \
TOKEN_ENC_KEY='<base64-32-bytes>' \
CLOUDFLARE_API_TOKEN='<token>' \
CLOUDFLARE_ACCOUNT_ID='<account-id>' \
npx whelkmail-installer --yes
```

Generate the key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

On PowerShell, set the variables with `$env:NAME='value'` on separate lines, then run `npx whelkmail-installer --yes`.

### Useful commands

If the npm package is not published yet, replace `npx whelkmail-installer` with `npx github:WhelkMail/installer`.

```bash
npx whelkmail-installer --dry-run          # show the plan, change nothing
npx whelkmail-installer --r2               # include the optional R2 archive
npx whelkmail-installer --cron             # deploy the 5-minute background worker
npx whelkmail-installer --push             # Web Push keys and the cron worker
npx whelkmail-installer --ref 1.0.1        # install a specific release
npx whelkmail-installer --project-name mymail
npx whelkmail-installer --source ../mail-client   # use a local checkout
```

## What the installer creates

| Resource | Where | Notes |
|---|---|---|
| Pages project | Your Cloudflare account | The website and API, named `whelkmail` by default |
| D1 database | Your Cloudflare account | Named `mail-client`, keeps accounts and mail metadata |
| Secrets | The Pages project | `APP_PASSWORD`, `TOKEN_ENC_KEY`, optional `CRON_SECRET` and VAPID keys |
| R2 bucket | Optional | Only with `--r2`; Cloudflare asks for billing to enable R2 |
| Cron worker | Optional | Only with `--cron` or `--push`; runs every 5 minutes |

Nothing is stored in the installer repository. The temporary workspace used to build the app is deleted at the end.

---

# Technical reference

Everything below is for operators and developers. You do not need it to complete Path A or Path B.

## Provisioning flow

1. Download the latest WhelkMail release tarball from GitHub, or copy a local checkout to a temporary directory. Local copies exclude `.env`, `.dev.vars`, `wrangler.toml`, `node_modules`, `dist`, `.git` and editor folders.
2. Run `npm ci` and `npm run build`.
3. Create or reuse the D1 database (`mail-client` by default) and read its id.
4. Create or reuse the Pages project with the selected production branch.
5. Write a temporary `wrangler.toml` with the `DB` binding and the optional `BUCKET` binding.
6. Upload `APP_PASSWORD`, `TOKEN_ENC_KEY`, and optionally `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
7. Apply `db/schema.sql` if the database is new, then record or apply migrations in `db/migrations` using `schema_migrations`.
8. Deploy `dist` with `wrangler pages deploy`, using the Wrangler configuration as the source of truth for bindings.
9. Verify `GET /api/health` returns `ok: true`.
10. Optionally create the R2 bucket, deploy the cron worker, set its `CRON_SECRET`, and point `APP_URL` at the deployment.

Re-running the installer is safe: resources are reused, secrets are overwritten with the new values, and database migrations are idempotent through `schema_migrations`.

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

## GitHub Actions reference

| Secret | Required | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | Provisioning and deployment |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Account that owns the resources |
| `APP_PASSWORD` | yes | WhelkMail login password |
| `TOKEN_ENC_KEY` | yes | 32 random bytes, base64 |
| `CRON_SECRET` | when cron/push is enabled | Shared secret for the cron worker |
| `NPM_TOKEN` | only for publishing | npm publish workflow |

Workflow inputs: `project_name`, `ref`, `db_name`, `branch`, `enable_r2`, `r2_bucket`, `deploy_cron`, `enable_push`, `push_subject`. Empty inputs use the defaults listed in the options table.

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
| The run deployed but the URL is not ready | The health check retries for about 50 seconds. Check Deployments → Logs if it still fails. |

## Cross-platform

The installer has no platform-specific code. It uses Node APIs, `npm`/`npx`, and the system `tar`. It does not use PowerShell, bash scripts, or native build tools. Windows, macOS and Linux are supported; GitHub Actions runs it on `ubuntu-latest`.

## License

MIT.
