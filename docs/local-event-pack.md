# Ultimater local event pack

Prediction events work without deploying or paying for a hosted Worker. GitHub Actions re-discovers open stock-relevant Polymarket and Kalshi events on a 15-minute schedule, saves public normalized snapshots in the repository, and builds this downloadable pack. Your computer does not need to stay on for the GitHub job.

## Start the downloaded pack

Install Node.js 22 or newer, unzip the **ultimater-local-pack** artifact, open a terminal in its folder, and run:

```sh
npm start
```

Open the address printed in the terminal, normally:

`http://127.0.0.1:8830/space?view=prediction-board&onboarding=0&marketData=snapshot`

No npm install, API key, Cloudflare account or app hosting is needed for this pack. It runs a static server bound to your own computer. Opening the HTML with `file://` is not supported because browser modules require HTTP.

Watchlists save in this browser on this device. Ticker additions and removals save immediately, including when quote services are unavailable; saved tickers stay visible with unavailable prices. Company-name lookup still needs a live service, so use ticker symbols such as `MSFT` in the standalone pack. Keep using the same browser and local address/port after replacing the pack, since browser storage is separate for different addresses. Your saved stocks are not uploaded to GitHub.

The event board checks the public GitHub snapshot while visible and uses the newest bundled or fetched data. Reads are shared and cached for one minute, so loaded event pages do not each download the whole file. The full question, source link, rules, individual close date and saved timestamp remain available. Polymarket takes priority for recognized overlaps; Kalshi supplements gaps. Saved search covers the downloaded event selection, rather than the full venue catalog.

If GitHub or your internet connection is unavailable, the bundled or previously loaded snapshot remains readable. Data over 45 minutes old is explicitly marked stale. A failed venue sync retains its last successful selection and timestamp. It never fabricates an empty market catalog or stamps old prices as fresh.

## Timing and coverage

GitHub runs are scheduled every 15 minutes, at minutes 7, 22, 37 and 52 UTC. Runs may be delayed or dropped by GitHub. This is periodic discovery and saved pricing, not real-time streaming. The board's label distinguishes saved snapshots from live Worker data. Each scheduled run starts discovery from the beginning to pick up newly listed events, with up to three provider discovery pages per venue. The selection is bounded, not an exhaustive exchange catalog. Saved mode covers open standard events; closed catalogs and Kalshi combos require the live Worker.

The latest pack is attached to each successful **Sync prediction events and build local pack** run under the repository's Actions tab. Artifacts are retained for one day; download the newest successful run. Manual **Run workflow** can request another update. GitHub can disable scheduled workflows in public repositories after 60 days without repository activity; the Actions page exposes that state.

## From a repository checkout

```sh
npm run events:sync
npm run pack:build
npm run pack:start
```

The pack is built in `dist/ultimater-local-pack`. Snapshot refresh and the static server use Node built-ins. The repository's full local Worker setup remains available with `npm ci` and `npm run dev -- --port 8820`; it provides the faster live public APIs and other Analyzer features. Those other APIs, private broker connections, live options and AI are not supplied by this static event pack. Original research code and data remain in the full repository.

Only public event snapshots and frontend assets are packaged. Credentials, `.dev.vars`, account data, node_modules and private workspace files are excluded.
