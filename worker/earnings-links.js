// Each pair is one hop. The explanation must make sense from either company's calendar.
const cloudReport = 'https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Fourth-Quarter-and-Fiscal-2026/';
const links = [
  ['ASML','AMAT','Equipment peers','Both sell equipment to chipmakers. Watch for changes in what fabs plan to spend on new production lines.','https://www.sec.gov/Archives/edgar/data/1680062/000114036120012790/ex99_01.htm'],
  ['ASML','INTC','Equipment customer','Intel uses ASML lithography systems. Intel’s fab spending and ASML’s equipment orders offer two views of manufacturing demand.','https://investor.asml.com/news-releases/news-release-details/intel-foundry-and-asml-collaborate-accelerate-industry-readiness-high-na-euv'],
  ['AAPL','AVGO','Chip supply agreement','Broadcom makes wireless components and custom silicon for Apple. Watch for changes in device demand or component orders.','https://www.apple.com/newsroom/2026/07/apple-to-increase-spend-with-broadcom-to-produce-billions-more-us-chips/'],
  ['META','NVDA','AI infrastructure','Meta plans to deploy NVIDIA chips in its data centers. Meta’s spending plans and NVIDIA’s delivery outlook can shed light on that rollout.','https://investor.nvidia.com/news/press-release-details/2026/Meta-Builds-AI-Infrastructure-With-NVIDIA/default.aspx'],
  ...[['MSFT','Azure'],['AMZN','AWS'],['GOOGL','Google Cloud'],['ORCL','Oracle Cloud']].map(([ticker,cloud]) =>
    [ticker,'NVDA','Cloud infrastructure',cloud + ' is among the announced customers for NVIDIA’s Rubin platform. Watch for updates on deployment timing and data-center spending.',cloudReport])
];

export async function earningsConnections(tickers, getPeers) {
  const byReporter = new Map();
  const peerErrors = [];
  function add(reporter, holding, kind, detail, url) {
    if (!byReporter.has(reporter)) byReporter.set(reporter, []);
    byReporter.get(reporter).push({holding,kind,detail,url});
  }
  await Promise.all(tickers.map(async holding => {
    const issuer = holding === 'GOOG' ? 'GOOGL' : holding;
    const known = links.filter(([a,b]) => a === issuer || b === issuer);
    for (const [a,b,kind,detail,url] of known) {
      const other = issuer === a ? b : a;
      const reporter = other === 'GOOGL' && tickers.includes('GOOG') ? 'GOOG' : other;
      add(reporter, holding, kind, detail, url);
    }
    if (known.length || !getPeers) return;
    try {
      const peers = await getPeers(holding);
      // One additional issuer per unmapped holding keeps provider requests bounded.
      const reporter = peers.find(symbol => !tickers.includes(symbol));
      if (reporter) add(reporter, holding, 'Industry peer',
        'Finnhub groups these companies as peers. Compare changes in demand and margins across their earnings reports.',
        'https://finnhub.io/docs/api/company-peers');
    } catch { peerErrors.push(holding); }
  }));
  return {byReporter, peerErrors};
}
