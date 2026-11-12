// These are text filters over loaded provider headlines, not subscriptions to named editorial feeds.
const topic = (id, label, pattern) => ({ id, label, pattern });
export const NEWS_TOPIC_GROUPS = [
  { label: 'Markets & Investing', topics: [
    topic('stock-market', 'Stock Market News', /\b(stocks?|equities|nasdaq|s&p|dow jones|wall street)\b/i),
    topic('us-economy', 'US Economic News: Inflation, Jobs, the Fed, and More', /\b(inflation|jobs|payrolls?|employment|federal reserve|the fed|interest rates?|cpi|pce|gdp|economy|economic)\b/i),
    topic('earnings', 'Earnings Reports, Whispers & Company Earnings News', /\b(earnings|eps|revenue|quarterly|guidance)\b/i),
    topic('etfs', 'ETF Report', /\b(etfs?|exchange.traded funds?)\b/i),
    topic('sectors', 'Sector Spotlight', /\b(sectors?|industr(?:y|ies)|rotation)\b/i),
    topic('tariffs', 'Tariffs: Trade Policy, Import Taxes, & Effect on Prices', /\b(tariffs?|trade policy|import taxes?|trade war|export controls?)\b/i),
    topic('options-pit', 'Options Pit', /\boptions pit\b/i),
    topic('options-unlocked', 'Options Unlocked', /\boptions unlocked\b/i),
    topic('premium-news', 'Premium News', /\bpremium news\b/i)
  ] },
  { label: 'Tech & AI', topics: [
    topic('technology', 'Technology', /\b(tech(?:nology)?|software|semiconductors?|chips?|chipmakers?|cloud computing|cybersecurity)\b/i),
    topic('ai', 'Artificial intelligence', /\b(artificial intelligence|ai|machine learning|large language models?|generative)\b/i),
    topic('crypto', 'Latest Crypto & Bitcoin News', /\b(crypto(?:currenc(?:y|ies))?|bitcoin|ethereum|blockchain|digital assets?)\b/i),
    topic('autos', 'Auto industry', /\b(auto(?:motive|makers?|mobiles?)?|cars?|evs?|electric vehicles?|tesla|vehicles?)\b/i)
  ] },
  { label: 'Personal Finance', topics: [
    topic('personal-finance', 'Personal Finance News', /\b(personal finance|savings|retirement|retirees?|budget|credit cards?|mortgages?|insurance|households?)\b/i),
    topic('taxes', 'Taxes', /\b(tax(?:es|ation|able)?|irs)\b/i),
    topic('housing', 'Housing market', /\b(housing|homes?|homebuyers?|homebuilders?|real estate|mortgages?|rents?|rental|property)\b/i)
  ] },
  { label: 'Shows & Originals', topics: [
    topic('morning-brief', 'Yahoo Finance Morning Brief', /\b(?:yahoo finance )?morning brief\b/i),
    topic('newsroom', 'From the Yahoo Finance Newsroom', /\byahoo finance newsroom\b/i),
    topic('opening-bell', 'Opening Bell Coverage', /\bopening bell\b/i),
    topic('closing-bell', 'Closing Bell Coverage', /\bclosing bell\b/i),
    topic('good-buy', 'Good Buy or Goodbye', /\bgood buy or goodbye\b/i)
  ] },
  { label: 'Personalities', topics: [
    topic('buffett', 'Warren Buffett', /\b(?:warren )?buffett\b/i),
    topic('musk', 'Elon Musk', /\b(?:elon )?musk\b/i),
    topic('huang', 'Jensen Huang', /\b(?:jensen )?huang\b/i),
    topic('dimon', 'Jamie Dimon', /\b(?:jamie )?dimon\b/i),
    topic('bezos', 'Jeff Bezos', /\b(?:jeff )?bezos\b/i)
  ] }
];
const topics = new Map(NEWS_TOPIC_GROUPS.flatMap(group => group.topics.map(t => [t.id, t])));
export const newsTopic = id => topics.get(id) || null;
export function matchesNewsTopic(item, id) {
  if (!id) return true;
  const selected = newsTopic(id); if (!selected) return false;
  const text = [item?.title, item?.summary, item?.category, ...(Array.isArray(item?.tags) ? item.tags : [])]
    .filter(value => typeof value === 'string').join(' ');
  return selected.pattern.test(text);
}
