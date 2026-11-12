# Alpaca indicative options data

The options workspace can use Alpaca's free indicative feed when both `ALPACA_API_KEY` and `ALPACA_API_SECRET` are configured. Generate a key/secret pair in the API Keys area of the [Alpaca dashboard](https://app.alpaca.markets/) as described in [Alpaca's setup guide](https://docs.alpaca.markets/us/docs/getting-started-with-alpaca-market-data).

## Local credentials

From this project in your own Terminal:

```sh
npm run alpaca:setup
```

Both entries are hidden. The script saves them to ignored `.dev.vars`, preserves existing provider/broker settings, and restricts file permissions. It does not place orders, open accounts, purchase data or send the keys through chat. Restart the local Worker after entering them:

```sh
npm run dev
```

Open `http://127.0.0.1:8787/space.html?view=options`. Check `/api/space/options/status` for configuration and read each panel's source/freshness labels to confirm which provider actually supplied its data. Configuration alone does not establish that a credential pair has been accepted by Alpaca.

## Data meaning

Requests explicitly select `feed=indicative`; they do not opt into paid OPRA data. Alpaca documents free quotes as modified/indicative and trades as derived and delayed by 15 minutes. Quote timestamps describe when those indicative quotes were recorded; do not interpret them as a guarantee of real-time executable OPRA prices. See [feed definitions](https://docs.alpaca.markets/us/docs/historical-option-data) and the [option-chain API](https://docs.alpaca.markets/us/reference/optionchain).

The integration preserves missing fields. If the snapshots do not contain daily volume, open interest or price change, those stay unavailable. They are not filled with unrelated Nasdaq measurements. A volume/open-interest unusual-activity scan cannot run on snapshots without those fields. The separate Unusual Whales transaction-tape adapter still needs its own eligible key and subscription; Alpaca snapshots are not relabeled as that feed.

Provider/fallback notices and contract quote/trade timestamps accompany the response. The underlying stock price may come from Nasdaq and has its own source and timestamp. Pagination coverage is reported so a bounded/partial response is not represented as the complete chain. If a requested expiry is absent from a partial snapshot result, it stays selected with an empty result and a coverage notice rather than silently changing to a different expiry. Nasdaq remains the fallback when Alpaca is unconfigured or unavailable; fallback data keeps Nasdaq's label and does not inherit the Alpaca delay claim.

## Usage and hosting

The UI offers refresh/pause controls. Automatic refresh runs at most once per 60 seconds while the panel is visible, unpaused and inside weekdays 9:30–16:00 Eastern. This clock check is not an exchange-holiday calendar; use manual refresh after close or on holidays. Manual refresh also works while automatic updates are paused. A new request is serialized behind an in-flight request instead of repeatedly aborting a slow provider. Refreshing an indicative quote does not make it an official real-time quote. Shared server caching and in-flight reuse reduce duplicate lookups; a chain may require multiple provider requests because the snapshot API is paginated.

For a later hosted deployment, store the values as Worker secrets from your own Terminal:

```sh
npx wrangler secret put ALPACA_API_KEY
npx wrangler secret put ALPACA_API_SECRET
```

Local and hosted configuration are separate. This integration does not deploy the project or establish data redistribution rights for a public multi-user product. Check the applicable Alpaca plan/terms before that use; the [market-data overview](https://docs.alpaca.markets/us/docs/about-market-data-api) distinguishes individual Trading API access from Broker API access.
