# Connect brokers to Watchlist Pulse

The portfolio uses a SnapTrade OAuth application. Each person connects brokerages in their SnapTrade Personal dashboard, then chooses **Connect broker** in Watchlist Pulse and grants read access. All brokerages available to that person through SnapTrade Personal are eligible. A user with multiple accounts can switch between them or view them together. Manual portfolios appear in a separate view to avoid counting a linked account twice.

## Local setup

1. Sign in to the [SnapTrade Commercial Dashboard](https://dashboard.snaptrade.com/), open **OAuth Apps**, and register a **Test** app with the exact callback below. Keep the port and hostname consistent.
   ```
   http://127.0.0.1:8787/api/broker/callback
   ```
2. From the project directory, run the following. The setup prompt stores the two app credentials in the ignored local `.dev.vars` file. Existing local keys are preserved.
   ```sh
   npm ci && npm run broker:setup && npm run dev
   ```
3. Open [the local portfolio](http://127.0.0.1:8787/#/portfolio). Choose **Link a broker in SnapTrade** to add a brokerage, then **Connect broker** to authorize the dashboard. Keep the Worker running during authorization. Internet access is required. Wrangler emulates the per-browser session storage locally. The static Python preview serves frontend files only.

## Production setup

Complete the SnapTrade Production Access Application in the Commercial Dashboard and register a **Production** OAuth app. Use this callback for the current deployment:
```
https://supply-chain-shock-map.xingjianzhang700.workers.dev/api/broker/callback
```
From an authenticated Cloudflare CLI in the project directory, set the two Worker secrets with the **production** app credentials:
```sh
npx wrangler secret put SNAPTRADE_OAUTH_CLIENT_ID
npx wrangler secret put SNAPTRADE_OAUTH_CLIENT_SECRET
```
**Connect broker** appears once both credentials and the session binding are present. Each user authorizes their own account. Local and hosted sessions are separate.

## Data handling

The app requests only the OAuth `read` scope and uses PKCE. An HttpOnly cookie selects a private Durable Object that holds the provider tokens for that browser for up to 30 days. Broker balances and positions are fetched on opening or refreshing the portfolio and held in page memory. Disconnect revokes the grant and clears the browser session. For a lost device, revoke app access in SnapTrade. Only ticker symbols are used in the existing quote and event lookups.

The page shows the provider's position timestamp when available. Refresh retrieves the latest data SnapTrade has for the brokerage. Cash equivalents already counted in the cash balance are excluded from equity totals. Where the dashboard cannot value the entire portfolio in USD, it shows the reported positions and balances in their own currencies and leaves combined USD metrics blank. Historical charts remain available for manually maintained portfolios.

[SnapTrade OAuth registration and limits](https://docs.snaptrade.com/docs/oauth-apps)
