import { THEME_CATALOG as THEMES } from './themes.js';
// Built-in Ultimater views and theme views. Owned by the shell builder.
// Layouts use the 12-column grid (x, w) and 40px rows (y, h). Panel type ids come from docs/space-contract.md.
// `group: 'A'` = the view's primary link group (the symbol chips in the view header). null = the panel keeps its own symbol.

const P = (type, x, y, w, h, extra = {}) => ({ type, x, y, w, h, group: 'A', state: {}, ...extra });

export const VIEWS = [
  {
    id: 'markets', name: 'Markets', icon: 'pulse', symbols: ['NVDA'],
    panels: [
      P('chart', 0, 0, 8, 13),
      P('quote', 8, 0, 4, 13),
      P('index-movers', 0, 13, 4, 11),
      P('stock-movers', 4, 13, 4, 11),
      P('crypto-movers', 8, 13, 4, 11),
      P('news', 0, 24, 12, 12, { group: null, state: { mode: 'market' } })
    ]
  },
  {
    id: 'analysis', name: 'Analysis', icon: 'analysis', symbols: ['NVDA'],
    panels: [
      P('chart', 0, 0, 8, 13),
      P('quote', 8, 0, 4, 13),
      P('fundamentals', 0, 13, 8, 13),
      P('analyst', 8, 13, 4, 13),
      P('news', 0, 26, 12, 12, { state: { mode: 'ticker' } })
    ]
  },
  {
    id: 'news', name: 'News', icon: 'news', symbols: ['NVDA'],
    panels: [
      P('news', 0, 0, 6, 26, { state: { mode: 'ticker' } }),
      P('predictions', 6, 0, 6, 12),
      P('news', 6, 12, 6, 14, { group: null, state: { mode: 'top' } }),
      P('market-video', 0, 26, 12, 12, { group: null })
    ]
  },
  {
    id: 'prediction-board', name: 'Prediction Markets', icon: 'target', symbols: ['NVDA'], symbolFree: true,
    panels: [P('prediction-markets', 0, 0, 12, 22, { group: null })]
  },
  {
    id: 'my-portfolio', name: 'My Portfolio', icon: 'portfolio', symbols: ['NVDA'],
    panels: [
      P('portfolio-summary', 0, 0, 6, 5),
      P('portfolio-performance', 0, 5, 6, 9),
      P('portfolio-holdings', 0, 14, 6, 12),
      P('chart', 6, 0, 6, 14),
      P('news', 6, 14, 6, 12, { state: { mode: 'ticker' } }),
      P('portfolio-allocation', 0, 26, 6, 10),
      P('ai-recap', 6, 26, 6, 10)
    ]
  },
  {
    id: 'earnings', name: 'Earnings Hub', icon: 'calendar', symbols: ['NVDA'],
    panels: [
      P('earnings-calendar', 0, 0, 12, 14),
      P('earnings-detail', 0, 14, 8, 15),
      P('news', 8, 14, 4, 15, { state: { mode: 'ticker' } }),
      P('economic-calendar', 0, 29, 12, 9)
    ]
  },
  {
    id: 'options', name: 'Options', icon: 'options', symbols: ['NVDA'],
    panels: [
      P('options-chain', 0, 0, 8, 14),
      P('options-overview', 8, 0, 4, 14),
      P('options-flow', 0, 14, 8, 14),
      P('contract-detail', 8, 14, 4, 14)
    ]
  }
];

// Theme ids, labels, sidebar icons and seed symbols for the header chips.
export { THEME_CATALOG as THEMES } from './themes.js';


// Theme view layout: chart + news on top, the theme list, its heatmap, then a synced multi-chart.
// Sector themes add Top ETFs / Top Mutual Funds lists like the traced sector views.
export function themeLayout(t) {
  const theme = t.id;
  const panels = [
    P('chart', 0, 0, 6, 13),
    P('news', 6, 0, 6, 13, { group: null, state: { mode: 'theme', theme } }),
    P('theme-overview', 0, 13, 12, 12, { state: { theme, list: 'companies' } })
  ];
  let y = 25;
  if (t.sector) {
    panels.push(P('theme-overview', 0, y, 12, 10, { state: { theme, list: 'etfs' } }));
    y += 10;
    panels.push(P('theme-overview', 0, y, 12, 5, { state: { theme, list: 'funds' } }));
    y += 5;
  }
  panels.push(P('heatmap', 0, y, 12, 12, { state: { theme } }));
  y += 12;
  panels.push(P('multi-chart', 0, y, 12, 12, { state: { symbols: t.symbols.slice(0, 4), count: 4 } }));
  return { id: theme, name: t.name, icon: t.icon, theme, kind: 'theme', symbols: t.symbols.slice(), panels };
}

const builtins = new Map();
for (const v of VIEWS) builtins.set(v.id, { kind: 'builtin', ...v });
for (const t of THEMES) builtins.set(t.id, themeLayout(t));

export const isBuiltin = id => builtins.has(id);
// Deep copy so callers can mutate freely. Panel ids are assigned here (stable per position).
export function getBuiltin(id) {
  const v = builtins.get(id);
  if (!v) return null;
  const copy = JSON.parse(JSON.stringify(v));
  copy.panels.forEach((p, i) => { p.id = `${id}-${i}`; });
  return copy;
}
export const themeById = id => THEMES.find(t => t.id === id) || null;

// Goals offered by onboarding and the "Select a template" dialog.
export const GOALS = [
  { id: 'monitor', view: 'markets', title: 'Monitor Markets', text: 'Follow indexes, movers, crypto and headlines in one glance.' },
  { id: 'portfolio', view: 'my-portfolio', title: 'Track My Portfolio', text: 'See holdings, performance, allocation and news for what you own.' },
  { id: 'analysis', view: 'analysis', title: 'Stock Analysis', text: 'Dig into a company: chart, fundamentals, analyst targets and news.' }
];
