// Public provider metadata only. Credential values never belong in this module.
export const API_PROVIDERS = [
  { id: 'finnhub', name: 'Finnhub', purpose: 'News tracker, company lookup and portfolio quotes',
    url: 'https://finnhub.io/dashboard', link: 'Open Finnhub dashboard',
    instructions: 'Create a Finnhub account, then copy the API key from your dashboard.',
    note: 'Provider limits and coverage apply. The news tracker needs this connection.',
    fields: [{ name: 'FINNHUB_API_KEY', label: 'API key' }], probe: '/api/resolve?q=AAPL' },
  { id: 'alpaca', name: 'Alpaca', purpose: 'Indicative options-chain quotes',
    url: 'https://app.alpaca.markets/', link: 'Open Alpaca dashboard',
    instructions: 'Open your Paper Trading account’s API Keys panel. Generate a key ID and secret, and copy both here.',
    note: 'This app uses the indicative data feed. Quotes are modified, trades are delayed, and volume/open interest are unavailable. It does not place orders.',
    fields: [{ name: 'ALPACA_API_KEY', label: 'API key ID' }, { name: 'ALPACA_API_SECRET', label: 'Secret key' }], probe: '/api/space/options/chain?symbol=SPY' },
  { id: 'anthropic', name: 'Anthropic', purpose: 'Ultimater AI and research recaps',
    url: 'https://platform.claude.com/settings/keys', link: 'Create a Claude API key',
    instructions: 'Create an API key in the Claude Console. API billing is separate from a Claude chat subscription.',
    note: 'AI requests can incur API charges. Saving a key does not send a paid request.',
    fields: [{ name: 'ANTHROPIC_API_KEY', label: 'API key' }], destination: '/space?view=analysis', action: 'Open Ultimater AI' },
  { id: 'unusual-whales', name: 'Unusual Whales', purpose: 'Individual options trades and flow screening',
    url: 'https://api.unusualwhales.com/docs', link: 'Read flow API setup',
    instructions: 'Get an API token from a subscription with Unusual Whales API access.',
    note: 'This is separate from Alpaca’s chain data. The flow panel needs an eligible API subscription.',
    fields: [{ name: 'UNUSUAL_WHALES_API_KEY', label: 'API token' }], probe: '/api/space/options/flow?limit=25' },
  { id: 'snaptrade', name: 'SnapTrade', purpose: 'Optional read-only broker linking',
    url: 'https://docs.snaptrade.com/docs/getting-started', link: 'Read OAuth app setup',
    instructions: 'Register a Test OAuth app in SnapTrade and set its redirect URI to your local app origin followed by /api/broker/callback. Use the OAuth client ID and client secret.',
    note: 'These are OAuth app credentials, rather than a Personal API key. Provider approval and a separate broker connection may be needed. Manual portfolios and CSV imports work without this.',
    fields: [{ name: 'SNAPTRADE_OAUTH_CLIENT_ID', label: 'OAuth client ID' }, { name: 'SNAPTRADE_OAUTH_CLIENT_SECRET', label: 'OAuth client secret' }], destination: '/#/portfolio', action: 'Open Portfolio' }
];

export function providerStatus(env = {}) {
  return Object.fromEntries(API_PROVIDERS.map(provider => [provider.id, {
    configured: provider.fields.every(field => typeof env[field.name] === 'string' && env[field.name].trim().length > 0)
  }]));
}
