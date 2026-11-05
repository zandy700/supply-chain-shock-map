// Cloudflare Worker entry: serve the static observatory in web/ via the ASSETS binding.
// Matching asset requests are served directly by Cloudflare; anything else falls through
// here and is delegated to the same binding (yielding its 404). No server-side API and no
// scheduled() handler: the daily cron is a GitHub Action.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
