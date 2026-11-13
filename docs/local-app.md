# Ultimater on your computer

This download includes the news-tracking dashboard, manual and CSV portfolios, the Analyzer, prediction markets, and API setup inside the app. Your watchlist and portfolios are stored in your browser. Your API credentials stay in this installation’s local `.dev.vars` file.

1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/).
2. Download **ultimater-local-app.zip** from the [latest GitHub release](https://github.com/zandy700/supply-chain-shock-map/releases/latest), then unzip it.
3. Open a terminal in the extracted `ultimater-local-app` folder and run:

   ```sh
   npm start
   ```

4. Open **http://127.0.0.1:8820/#/home**. First launch installs the locked runtime dependencies and needs an internet connection. No Cloudflare account or app hosting is needed.
5. Open **API setup** in the app. Follow the provider instructions, enter your own credentials, and save. The local server restarts automatically. A saved key means configured; use the connection check to confirm provider access.

Keep the terminal running while using Ultimater. Press **Ctrl+C** to stop. To use a different port, set `PORT` and a different `ULTIMATER_WORKER_PORT` before running `npm start`; the defaults are 8820 and 8822. Never expose either server to a public network.

## Available connections

- **Finnhub:** news tracking, company lookup and portfolio quotes. Public Analyzer sources and manual portfolios remain usable without it.
- **Alpaca:** optional indicative options-chain quotes. It does not place trades. The indicative feed does not include volume/open interest or the separate transaction-flow tape.
- **Anthropic:** Ultimater AI and recaps. API billing is separate from a Claude chat plan; requests may incur charges.
- **Unusual Whales:** optional individual options trades. Requires an eligible API subscription.
- **SnapTrade:** optional read-only broker linking through OAuth app credentials. Register the callback URL shown in the app with the provider. Manual portfolios and CSV imports work without broker setup or approval.

Provider plans, permissions, data delays and coverage still apply. Saving credentials does not purchase a subscription or prove the connection works. The hosted Ultimater website does not accept or store visitors’ API keys.

## Privacy and backup

- Never upload `.dev.vars`, `.wrangler`, or browser profile data to GitHub or share them in a zip. The downloadable release excludes credentials and user account data.
- Private keys are not returned to the browser after saving. The API setup page displays configuration status only. Removing a provider removes its keys from `.dev.vars`.
- To back up holdings and layouts, use the app’s portfolio/workspace export. Downloaded source files do not contain your browser’s saved stocks or portfolios.
- Browser data belongs to an origin. Changing the local port creates a different browser workspace; export your data before moving ports or computers.

For an offline saved-event board with no dependencies, use the separate **ultimater-local-pack** artifact. That lightweight pack does not include the full Worker APIs or editable API setup.
