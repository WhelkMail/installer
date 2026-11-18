export function envOptions(env = process.env) {
  return {
    appPassword: env.APP_PASSWORD?.trim() || undefined,
    tokenEncKey: env.TOKEN_ENC_KEY?.trim() || undefined,
    cronSecret: env.CRON_SECRET?.trim() || undefined,
    apiToken: env.CLOUDFLARE_API_TOKEN?.trim() || undefined,
    accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined,
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    isActions: env.GITHUB_ACTIONS === 'true',
  }
}
