const API = '';

// ─── State ────────────────────────────────
const selectedTickers = new Set();   // multi-select
let lastClickedTicker = null;        // for company card
let allCompanies = [];
let simulation = null;
let fetchController = null;          // AbortController for API requests
let fetchTimeout = null;             // Debounce timer for loadMultiGraph
const hiddenSectors = new Set();     // Active sector filters for the legend

// ─── Init ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await checkHealth();
    await loadCompanies();
    setupSearch();
    setupChips();
    setupFilters();
    setupTopK();
    updateSelectionBadge();
});

// ─── Health ───────────────────────────────
async function checkHealth() {
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    try {
        const r = await fetch(`${API}/api/health`);
        badge.className = r.ok ? 'status-badge status-ok' : 'status-badge status-error';
        text.textContent = r.ok ? 'API Connected' : 'API Error';
    } catch {
        badge.className = 'status-badge status-error';
        text.textContent = 'API Offline';
    }
}

// ─── Load Companies ───────────────────────
async function loadCompanies() {
    try {
        const r = await fetch(`${API}/api/companies?limit=1000`);
        allCompanies = await r.json();
    } catch { allCompanies = []; }
}

// ─── Search ───────────────────────────────
function setupSearch() {
    const input = document.getElementById('search-input');
    const dropdown = document.getElementById('search-dropdown');

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { dropdown.classList.add('hidden'); return; }
        const matches = allCompanies.filter(c =>
            c.ticker?.toLowerCase().includes(q) || c.longName?.toLowerCase().includes(q)
        ).sort((a, b) => {
            // Prioritize exact ticker match (e.g., 'v' -> 'V')
            const aExact = a.ticker?.toLowerCase() === q;
            const bExact = b.ticker?.toLowerCase() === q;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            // Then prioritize prefix ticker match (e.g., 'aa' -> 'AAPL')
            const aPrefix = a.ticker?.toLowerCase().startsWith(q);
            const bPrefix = b.ticker?.toLowerCase().startsWith(q);
            if (aPrefix && !bPrefix) return -1;
            if (!aPrefix && bPrefix) return 1;

            // Otherwise sort alphabetically by ticker
            return (a.ticker || '').localeCompare(b.ticker || '');
        }).slice(0, 8);

        if (!matches.length) { dropdown.classList.add('hidden'); return; }
        dropdown.innerHTML = matches.map(c => `
      <div class="dropdown-item${selectedTickers.has(c.ticker) ? ' selected' : ''}" data-ticker="${c.ticker}">
        <span class="dropdown-ticker">${c.ticker}</span>
        <span class="dropdown-name">${c.longName || ''}</span>
        ${selectedTickers.has(c.ticker) ? '<span class="dropdown-check">✓</span>' : ''}
      </div>
    `).join('');
        dropdown.classList.remove('hidden');
        dropdown.querySelectorAll('.dropdown-item').forEach(el => {
            el.addEventListener('click', () => {
                toggleTicker(el.dataset.ticker);
                input.value = '';
                dropdown.classList.add('hidden');
            });
        });
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.search-wrapper')) dropdown.classList.add('hidden');
    });
}

// ─── Chips ────────────────────────────────
function setupChips() {
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => toggleTicker(chip.dataset.ticker));
    });
}

function renderChips() {
    document.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('active', selectedTickers.has(c.dataset.ticker));
    });
}

// ─── Toggle ───────────────────────────────
function toggleTicker(ticker) {
    ticker = ticker.toUpperCase();

    if (selectedTickers.has(ticker)) {
        selectedTickers.delete(ticker);
    } else {
        selectedTickers.add(ticker);
        lastClickedTicker = ticker;
    }
    renderChips();
    updateSelectionBadge();

    if (selectedTickers.size === 0) {
        showEmpty();
        hideCompanyCard();
        clearGraph();
        return;
    }

    // Load info card for last-clicked
    if (selectedTickers.has(ticker) && ticker === lastClickedTicker) {
        loadCompanyInfo(ticker);
    } else if (lastClickedTicker && selectedTickers.has(lastClickedTicker)) {
        loadCompanyInfo(lastClickedTicker);
    }

    queueLoadMultiGraph();
}

function updateSelectionBadge() {
    const badge = document.getElementById('selection-badge');
    const clearBtn = document.getElementById('clear-selection');
    if (selectedTickers.size === 0) {
        badge.textContent = 'None selected';
        badge.className = 'selection-badge empty';
        clearBtn.classList.add('hidden');
    } else {
        badge.textContent = [...selectedTickers].join(', ');
        badge.className = 'selection-badge active';
        clearBtn.classList.remove('hidden');
    }
}

// ─── Filters ──────────────────────────────
function setupFilters() {
    ['similarity', 'ownership', 'supply-chain'].forEach(type => {
        document.getElementById(`cb-${type}`).addEventListener('change', () => {
            updateSliderVisibility();
            if (selectedTickers.size > 0) {
                queueLoadMultiGraph();
            }
        });
    });
    // Set initial visibility
    updateSliderVisibility();

    // Add All Companies Button
    const btnAll = document.getElementById('btn-add-all');
    if (btnAll) {
        btnAll.addEventListener('click', () => {
            if (!allCompanies || allCompanies.length === 0) return;
            allCompanies.forEach(c => {
                if (c.ticker) selectedTickers.add(c.ticker);
            });
            renderChips();
            updateSelectionBadge();
            hideCompanyCard();
            queueLoadMultiGraph();
        });
    }
}

function updateSliderVisibility() {
    const filters = getFilters();
    document.getElementById('group-similarity').style.display = filters.similarity ? 'block' : 'none';
    document.getElementById('group-ownership').style.display = filters.ownership ? 'block' : 'none';
    document.getElementById('group-supply-chain').style.display = filters.supplyChain ? 'block' : 'none';
}

function getFilters() {
    return {
        similarity: document.getElementById('cb-similarity').checked,
        ownership: document.getElementById('cb-ownership').checked,
        supplyChain: document.getElementById('cb-supply-chain').checked,
    };
}

function setupTopK() {
    const simSlider = document.getElementById('similarity-top-k-slider');
    const simVal = document.getElementById('similarity-top-k-value');
    simSlider.addEventListener('input', () => {
        simVal.textContent = simSlider.value;
        if (selectedTickers.size > 0) {
            queueLoadMultiGraph();
        }
    });

    const simThresholdSlider = document.getElementById('similarity-threshold-slider');
    const simThresholdVal = document.getElementById('similarity-threshold-value');
    if (simThresholdSlider) {
        simThresholdSlider.addEventListener('input', () => {
            simThresholdVal.textContent = simThresholdSlider.value + '%';
            if (selectedTickers.size > 0) {
                queueLoadMultiGraph();
            }
        });
    }

    const ownSlider = document.getElementById('ownership-top-k-slider');
    const ownVal = document.getElementById('ownership-top-k-value');
    ownSlider.addEventListener('input', () => {
        ownVal.textContent = ownSlider.value;
        if (selectedTickers.size > 0) {
            queueLoadMultiGraph();
        }
    });

    const supSlider = document.getElementById('supply-chain-top-k-slider');
    const supVal = document.getElementById('supply-chain-top-k-value');
    supSlider.addEventListener('input', () => {
        supVal.textContent = supSlider.value;
        if (selectedTickers.size > 0) {
            queueLoadMultiGraph();
        }
    });
}
function getSimilarityTopK() { return parseInt(document.getElementById('similarity-top-k-slider').value); }
function getSimilarityThreshold() { return parseInt(document.getElementById('similarity-threshold-slider').value) / 100.0; }
function getOwnershipTopK() { return parseInt(document.getElementById('ownership-top-k-slider').value); }
function getSupplyChainTopK() { return parseInt(document.getElementById('supply-chain-top-k-slider').value); }

// ─── Company Info ─────────────────────────
async function loadCompanyInfo(ticker) {
    try {
        const info = await fetch(`${API}/api/companies/${ticker}`).then(r => r.json());
        renderCompanyCard(info);
    } catch { }
}

// ─── Multi-graph load ─────────────────────
function queueLoadMultiGraph() {
    // Debounce the call to avoid premature fetching while user is actively sliding/clicking
    if (fetchTimeout) clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(() => {
        loadMultiGraph();
    }, 250);
}

async function loadMultiGraph() {
    // Cancel any active fetch requests
    if (fetchController) {
        fetchController.abort();
    }
    fetchController = new AbortController();
    const signal = fetchController.signal;

    showLoading(true);
    hideEmpty();
    try {
        const tickers = [...selectedTickers];
        const f = getFilters();
        const simTopK = getSimilarityTopK();
        const simThreshold = getSimilarityThreshold();
        const ownTopK = getOwnershipTopK();
        const supTopK = getSupplyChainTopK();
        const params = new URLSearchParams({
            similarity_top_k: simTopK,
            similarity_threshold: simThreshold,
            ownership_top_k: ownTopK,
            supply_chain_top_k: supTopK,
            include_similarity: f.similarity,
            include_ownership: f.ownership,
            include_supply_chain: f.supplyChain,
        });

        // Use the highly optimized endpoints if all available companies are selected
        // (threshold set to 90% of allCompanies to catch most "add all" scenarios)
        const isAllMode = selectedTickers.size > 0 && selectedTickers.size >= (allCompanies.length * 0.9);

        // Make requests
        let results = [];
        let centerSet;

        if (isAllMode) {
            // Fetch everything in one highly optimized query
            const graph = await fetch(`${API}/api/relations/graph-all?${params}`, { signal }).then(r => r.json());
            results = [graph];
            centerSet = new Set(allCompanies.map(c => c.ticker));
        } else {
            // Fetch graph for each selected ticker in parallel
            results = await Promise.all(
                tickers.map(t => fetch(`${API}/api/relations/graph/${t}?${params}`, { signal }).then(r => r.json()))
            );
            centerSet = new Set(tickers);
        }

        // Merge graphs: union nodes, union edges (deduplicate)
        const mergedNodes = new Map();   // id → node
        const mergedEdges = new Map();   // key → edge

        // Abort render if user clicked 'Clear' while API fetch was in progress
        if (selectedTickers.size === 0) {
            showLoading(false);
            return;
        }

        results.forEach(graph => {
            (graph.nodes || []).forEach(n => {
                const existing = mergedNodes.get(n.id);
                // Mark as center if it's a selected ticker
                mergedNodes.set(n.id, {
                    ...n,
                    is_center: centerSet.has(n.id),
                    is_external: existing ? existing.is_external && n.is_external : n.is_external,
                });
            });
            (graph.edges || []).forEach(e => {
                // Deduplicate: normalize source/target order for undirected edge types
                const key = [e.relation_type, e.source, e.target].join('|');
                const keyRev = [e.relation_type, e.target, e.source].join('|');
                if (!mergedEdges.has(key) && !mergedEdges.has(keyRev)) {
                    mergedEdges.set(key, e);
                }
            });
        });

        const merged = {
            nodes: [...mergedNodes.values()],
            edges: [...mergedEdges.values()],
        };

        renderGraph(merged, centerSet);
        renderRelationsList(merged);
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log("Fetch aborted for new request.");
            return; // Don't hide loading yet, new request is running
        }
        console.error(e);
    } finally {
        // Only clear loading state if we haven't started a new fetch
        if (!signal.aborted) {
            showLoading(false);
            fetchController = null;
        }
    }
}

// ─── Company Card ─────────────────────────
function renderCompanyCard(info) {
    document.getElementById('info-ticker').textContent = info.ticker || '—';
    document.getElementById('info-name').textContent = info.longName || '—';
    document.getElementById('info-sector').textContent = info.sector || '';

    // Market
    document.getElementById('info-price').textContent = info.currentPrice ? `$${info.currentPrice.toFixed(2)}` : '—';
    document.getElementById('info-mktcap').textContent = formatLarge(info.marketCap);
    document.getElementById('info-52h').textContent = info.fiftyTwoWeekHigh ? `$${info.fiftyTwoWeekHigh.toFixed(2)}` : '—';
    document.getElementById('info-52l').textContent = info.fiftyTwoWeekLow ? `$${info.fiftyTwoWeekLow.toFixed(2)}` : '—';
    document.getElementById('info-50d').textContent = info.fiftyDayAverage ? `$${info.fiftyDayAverage.toFixed(2)}` : '—';
    document.getElementById('info-200d').textContent = info.twoHundredDayAverage ? `$${info.twoHundredDayAverage.toFixed(2)}` : '—';

    // Valuation
    document.getElementById('info-pe').textContent = info.trailingPE ? info.trailingPE.toFixed(1) : '—';
    document.getElementById('info-fpe').textContent = info.forwardPE ? info.forwardPE.toFixed(1) : '—';
    document.getElementById('info-pb').textContent = info.priceToBook ? info.priceToBook.toFixed(1) : '—';
    document.getElementById('info-ps').textContent = info.priceToSalesTrailing12Months ? info.priceToSalesTrailing12Months.toFixed(1) : '—';
    document.getElementById('info-evebitda').textContent = info.enterpriseToEbitda ? info.enterpriseToEbitda.toFixed(1) : '—';
    document.getElementById('info-peg').textContent = info.trailingPegRatio ? info.trailingPegRatio.toFixed(2) : '—';

    // Profitability & Growth
    document.getElementById('info-margin').textContent = info.profitMargins ? (info.profitMargins * 100).toFixed(1) + '%' : '—';
    document.getElementById('info-gmargin').textContent = info.grossMargins ? (info.grossMargins * 100).toFixed(1) + '%' : '—';
    document.getElementById('info-omargin').textContent = info.operatingMargins ? (info.operatingMargins * 100).toFixed(1) + '%' : '—';
    document.getElementById('info-roe').textContent = info.returnOnEquity ? (info.returnOnEquity * 100).toFixed(1) + '%' : '—';
    document.getElementById('info-growth').textContent = info.revenueGrowth ? (info.revenueGrowth * 100).toFixed(1) + '%' : '—';
    document.getElementById('info-epsgrowth').textContent = info.earningsGrowth ? (info.earningsGrowth * 100).toFixed(1) + '%' : '—';

    // Financials
    document.getElementById('info-revenue').textContent = formatLarge(info.totalRevenue);
    document.getElementById('info-fcf').textContent = formatLarge(info.freeCashflow);
    document.getElementById('info-cash').textContent = formatLarge(info.totalCash);
    document.getElementById('info-debt').textContent = formatLarge(info.totalDebt);
    document.getElementById('info-de').textContent = info.debtToEquity ? info.debtToEquity.toFixed(1) : '—';
    document.getElementById('info-cr').textContent = info.currentRatio ? info.currentRatio.toFixed(2) : '—';

    // Analyst
    const ratingColors = { 'strongBuy': '#10b981', 'buy': '#6ee7b7', 'hold': '#f59e0b', 'sell': '#f87171', 'strongSell': '#ef4444' };
    const ratingEl = document.getElementById('info-rating');
    if (info.recommendationKey) {
        ratingEl.textContent = info.recommendationKey.replace(/([A-Z])/g, ' $1').trim();
        ratingEl.style.color = ratingColors[info.recommendationKey] || '#e8eaf0';
    } else { ratingEl.textContent = '—'; ratingEl.style.color = ''; }
    document.getElementById('info-target').textContent = info.targetMeanPrice ? `$${info.targetMeanPrice.toFixed(0)}` : '—';
    document.getElementById('info-beta').textContent = info.beta ? info.beta.toFixed(2) : '—';
    document.getElementById('info-short').textContent = info.shortRatio ? info.shortRatio.toFixed(1) + 'x' : '—';
    document.getElementById('info-insiders').textContent = info.heldPercentInsiders ? (info.heldPercentInsiders * 100).toFixed(1) + '%' : '—';
    document.getElementById('info-inst').textContent = info.heldPercentInstitutions ? (info.heldPercentInstitutions * 100).toFixed(1) + '%' : '—';

    document.getElementById('company-card').style.display = 'block';
    document.getElementById('card-hint').textContent = selectedTickers.size > 1
        ? `(click node to switch · ${selectedTickers.size} selected)` : '';
}

function formatLarge(v) {
    if (!v) return '—';
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
}

function hideCompanyCard() {
    document.getElementById('company-card').style.display = 'none';
}

// ─── Relations List ───────────────────────
function renderRelationsList(graph) {
    const list = document.getElementById('relations-list');
    const section = document.getElementById('relations-section');
    list.innerHTML = '';
    const colors = { similarity: '#6366f1', ownership: '#f59e0b', supply_chain: '#10b981' };
    const edges = graph.edges || [];
    if (!edges.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    edges.forEach(edge => {
        const color = colors[edge.relation_type] || '#888';
        // D3 forceLink mutates source/target from string IDs to node objects
        const src = edge.source?.id ?? edge.source;
        const tgt = edge.target?.id ?? edge.target;
        const item = document.createElement('div');
        item.className = 'relation-item';
        item.innerHTML = `
      <span class="relation-type-dot" style="background:${color}"></span>
      <span class="relation-ticker">${src}</span>
      <span style="color:#555;font-size:10px;margin:0 2px">→</span>
      <span class="relation-ticker">${tgt}</span>
      <span class="relation-score">${edge.relation_type === 'similarity' ? (edge.weight * 100).toFixed(0) + '%' : (edge.direction || '')}</span>
    `;
        list.appendChild(item);
    });
}

// ─── D3 Graph ─────────────────────────────
const COLORS = {
    similarity: '#6366f1',
    ownership: '#f59e0b',
    supply_chain: '#10b981',
};

const SECTOR_COLORS = {
    'Technology': '#6366f1',           // Indigo
    'Information Technology': '#6366f1',
    'Health Care': '#ef4444',          // Red
    'Healthcare': '#ef4444',
    'Financials': '#10b981',           // Emerald
    'Financial': '#10b981',
    'Financial Services': '#10b981',
    'Consumer Discretionary': '#ec4899', // Pink
    'Consumer Cyclical': '#ec4899',
    'Communication Services': '#8b5cf6', // Violet
    'Industrials': '#f59e0b',          // Amber
    'Consumer Staples': '#84cc16',       // Lime
    'Consumer Defensive': '#84cc16',
    'Energy': '#f97316',               // Orange
    'Utilities': '#06b6d4',            // Cyan
    'Real Estate': '#14b8a6',          // Teal
    'Materials': '#a8a29e',            // Stone
    'Basic Materials': '#a8a29e',
    default: '#8b8fa8',
};

function getSectorColor(sector) {
    return SECTOR_COLORS[sector] || SECTOR_COLORS.default;
}

function clearGraph() {
    if (simulation) {
        simulation.stop();
    }
    hiddenSectors.clear();
    d3.select('#graph-svg').selectAll('*').remove();
    document.getElementById('relation-legend').style.display = 'none';
    document.getElementById('node-legend').style.display = 'none';
    document.getElementById('sector-legend').style.display = 'none';
    document.getElementById('relations-section').style.display = 'none';
}

window.highlightSector = function (sector) {
    // Dim unrelated nodes and links slightly for contrast
    d3.selectAll('.node').attr('opacity', d => d.sector === sector ? 1 : 0.4);
    d3.selectAll('.link').attr('opacity', d =>
        (d.source.sector === sector && d.target.sector === sector) ? 1 : 0.1
    );
};

window.highlightRelation = function (relType) {
    d3.selectAll('.link').attr('opacity', d => d.relation_type === relType ? 1 : 0.1);

    const activeNodes = new Set();
    d3.selectAll('.link').each(d => {
        if (d.relation_type === relType) {
            activeNodes.add(d.source.id);
            activeNodes.add(d.target.id);
        }
    });

    d3.selectAll('.node').attr('opacity', d => activeNodes.has(d.id) ? 1 : 0.4);
};

window.highlightNodeType = function (nodeType) {
    d3.selectAll('.link').attr('opacity', 0.1);

    d3.selectAll('.node').attr('opacity', d => {
        if (nodeType === 'center' && d.is_center) return 1;
        if (nodeType === 'external' && d.is_external) return 1;
        if (nodeType === 'known' && !d.is_center && !d.is_external) return 1;
        return 0.4;
    });

    d3.selectAll('.node circle')
        .attr('stroke-width', d => {
            const match = (nodeType === 'center' && d.is_center) ||
                (nodeType === 'external' && d.is_external) ||
                (nodeType === 'known' && !d.is_center && !d.is_external);
            return match ? 3 : (d.is_center ? 2.5 : 1.5);
        });
};

window.unhighlightAll = function () {
    // Restore opacities
    d3.selectAll('.node').attr('opacity', 1);
    d3.selectAll('.link').attr('opacity', 1);

    // Restore original stroke widths
    d3.selectAll('.node circle')
        .attr('stroke-width', d => d.is_center ? 2.5 : 1.5);
};
function renderGraph({ nodes = [], edges = [] }, centerSet = new Set()) {
    const svg = d3.select('#graph-svg');
    svg.selectAll('*').remove();
    if (!nodes.length) return;

    // Force strict external node checking against all known companies
    nodes.forEach(n => {
        const hasInfo = allCompanies.some(c => c.ticker === n.id);
        if (!hasInfo) n.is_external = true;
    });

    const el = document.getElementById('graph-svg');
    const W = el.clientWidth;
    const H = el.clientHeight;

    const defs = svg.append('defs');
    Object.entries(COLORS).forEach(([type, color]) => {
        defs.append('marker')
            .attr('id', `arrow-${type}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 30).attr('refY', 0)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path').attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', color).attr('opacity', 0.6);
    });

    // Remove old zoom behavior to prevent conflicts
    svg.on('.zoom', null);
    // Explicitly clear cached zoom state so our initial zoom triggers correctly
    if (svg.node()) {
        delete svg.node().__zoom;
    }

    const g = svg.append('g').attr('class', 'graph-root');
    const zoomBehavior = d3.zoom().scaleExtent([0.05, 4]).on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoomBehavior);

    const tooltip = document.getElementById('tooltip');

    // Pre-position nodes in a radial layout to reduce initial chaos
    const centerNodes = nodes.filter(n => n.is_center);
    const outerNodes = nodes.filter(n => !n.is_center);
    const initRadius = Math.min(W, H) * 0.3;
    if (centerNodes.length === 1) {
        centerNodes[0].x = W / 2; centerNodes[0].y = H / 2;
    } else {
        centerNodes.forEach((n, i) => {
            const a = (2 * Math.PI / centerNodes.length) * i - Math.PI / 2;
            n.x = W / 2 + Math.cos(a) * initRadius * 0.45;
            n.y = H / 2 + Math.sin(a) * initRadius * 0.45;
        });
    }
    outerNodes.forEach((n, i) => {
        const a = (2 * Math.PI / Math.max(outerNodes.length, 1)) * i - Math.PI / 2;
        n.x = W / 2 + Math.cos(a) * initRadius;
        n.y = H / 2 + Math.sin(a) * initRadius;
    });

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id)
            .distance(d => d.relation_type === 'similarity' ? 120 * (1 - (d.weight || 0) * 0.4) : 160)
            .strength(0.6))
        .force('charge', d3.forceManyBody().strength(-600).distanceMax(400))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide(50).strength(0.9))
        .alphaDecay(0.02)
        .stop();

    // Run 300 ticks before rendering → graph appears already untangled
    for (let i = 0; i < 300; i++) simulation.tick();

    // Zoom to fit all nodes instantly to avoid partial frame rendering
    const minX = d3.min(nodes, d => d.x) || -100;
    const maxX = d3.max(nodes, d => d.x) || 100;
    const minY = d3.min(nodes, d => d.y) || -100;
    const maxY = d3.max(nodes, d => d.y) || 100;
    const width = maxX - minX;
    const height = maxY - minY;

    // Fallbacks if graph is tiny or 1 node, plus 60px bounds buffer for nodes
    const safeWidth = (width > 0 ? width : 100) + 60;
    const safeHeight = (height > 0 ? height : 100) + 60;

    const midX = minX + width / 2;
    const midY = minY + height / 2;
    const padding = 40;

    const safeW = W || 800;
    const safeH = H || 600;

    let scale = Math.min((safeW - padding * 2) / safeWidth, (safeH - padding * 2) / safeHeight);
    scale = Math.min(Math.max(scale, 0.05), safeW > 500 ? 1.5 : 0.8);

    const initialTransform = d3.zoomIdentity
        .translate(safeW / 2 - scale * midX, safeH / 2 - scale * midY)
        .scale(scale);

    // Call MUST be instant so initial draw is perfectly scaled without __zoom cache preventing it
    svg.call(zoomBehavior.transform, initialTransform);

    // Links
    const link = g.append('g').selectAll('line').data(edges).join('line')
        .attr('class', 'link')
        .attr('stroke', d => COLORS[d.relation_type] || '#888')
        .attr('stroke-width', d => d.relation_type === 'similarity' ? 3 + (d.weight || 0) * 3 : 4)
        .attr('stroke-dasharray', d => d.relation_type === 'ownership' ? '8 4' : d.relation_type === 'supply_chain' ? '5 3' : null)
        .attr('marker-end', d => `url(#arrow-${d.relation_type})`)
        .on('mouseover', (e, d) => {
            const color = COLORS[d.relation_type];
            let html = `<div style="color:${color};font-weight:700;text-transform:capitalize;">${d.relation_type.replace('_', ' ')}</div>`;
            html += `<div style="margin:4px 0;color:#8b8fa8;">${d.source.id || d.source} → ${d.target.id || d.target}</div>`;
            if (d.direction) html += `<div style="font-size:10px">${d.direction}</div>`;
            if (d.note) html += `<div class="tooltip-note">${d.note}</div>`;
            if (d.relation_type === 'similarity') html += `<div style="font-family:monospace;color:#10b981;">Score: ${(d.weight * 100).toFixed(1)}%</div>`;
            showTooltip(e, html);
        })
        .on('mousemove', moveTooltip)
        .on('mouseout', hideTooltip);

    // Nodes
    const node = g.append('g').selectAll('g').data(nodes).join('g')
        .attr('class', d => `node${d.is_center ? ' center' : ''}`)
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .call(d3.drag()
            .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.15).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
        )
        .on('click', (e, d) => {
            if (d.is_center) {
                // Click on center node → show its info card
                lastClickedTicker = d.id;
                loadCompanyInfo(d.id);
            } else if (!d.is_external) {
                // Click on neighbour → toggle into selection only if company info exists
                const hasInfo = allCompanies.some(c => c.ticker === d.id);
                if (hasInfo) {
                    toggleTicker(d.id);
                }
            }
        })
        .on('mouseover', (e, d) => {
            let html = `<div class="tooltip-ticker">${d.id}</div>`;
            html += `<div class="tooltip-name">${d.name || d.id}</div>`;
            if (d.sector) html += `<span class="tooltip-tag" style="background:${getSectorColor(d.sector)}22;color:${getSectorColor(d.sector)};border:1px solid ${getSectorColor(d.sector)}44">${d.sector}</span>`;
            if (d.is_center) html += `<div class="tooltip-note" style="color:#6366f1;">Selected (click to view info)</div>`;
            else if (!d.is_external) {
                const hasInfo = allCompanies.some(c => c.ticker === d.id);
                if (hasInfo) {
                    html += `<div class="tooltip-note">Click to add to selection</div>`;
                } else {
                    html += `<div class="tooltip-note">External company (No info)</div>`;
                }
            }
            if (d.is_external) html += `<div class="tooltip-note">External company</div>`;
            showTooltip(e, html);
        })
        .on('mousemove', moveTooltip)
        .on('mouseout', hideTooltip);

    // Circle — center nodes are larger and filled, neighbor nodes hollow
    node.append('circle')
        .attr('r', d => d.is_center ? 26 : d.is_external ? 13 : 18)
        .attr('fill', d => {
            const base = getSectorColor(d.sector);
            return d.is_center ? base : `${base}18`;
        })
        .attr('stroke', d => getSectorColor(d.sector))
        .attr('stroke-width', d => d.is_center ? 2.5 : 1.5)
        .attr('stroke-dasharray', d => d.is_external ? '3 2' : null);

    // Ring around center nodes for emphasis
    node.filter(d => d.is_center).append('circle')
        .attr('r', 33)
        .attr('fill', 'none')
        .attr('stroke', d => getSectorColor(d.sector))
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 3')
        .attr('opacity', 0.4);

    // Label
    node.append('text')
        .attr('dy', d => d.is_center ? 44 : d.is_external ? 23 : 31)
        .text(d => d.ticker || d.id)
        .attr('fill', d => d.is_center ? '#e8eaf0' : '#8b8fa8')
        .attr('font-weight', d => d.is_center ? '700' : '400');

    // Set initial link positions from pre-computed tick
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

    // Resume with low alpha for gentle final settling + drag support
    simulation.on('tick', () => {
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        node.attr('transform', d => `translate(${d.x},${d.y})`);
    }).alpha(0.1).restart();

    // Build Dynamic Legends
    buildRelationLegend(edges);
    buildNodeLegend(nodes);
    buildSectorLegend(nodes);
}

function buildRelationLegend(edges) {
    const presentRelations = new Set(edges.map(e => e.relation_type));
    const relationLegend = document.getElementById('relation-legend');

    if (presentRelations.size > 0) {
        let html = '';
        if (presentRelations.has('similarity')) {
            html += `<span class="legend-item clickable" onmouseenter="highlightRelation('similarity')" onmouseleave="unhighlightAll()">
                        <span class="legend-arrow" style="color:#6366f1">→</span>Similarity
                     </span>`;
        }
        if (presentRelations.has('ownership')) {
            html += `<span class="legend-item clickable" onmouseenter="highlightRelation('ownership')" onmouseleave="unhighlightAll()">
                        <span class="legend-arrow" style="color:#f59e0b">→</span>Ownership
                     </span>`;
        }
        if (presentRelations.has('supply_chain')) {
            html += `<span class="legend-item clickable" onmouseenter="highlightRelation('supply_chain')" onmouseleave="unhighlightAll()">
                        <span class="legend-arrow" style="color:#10b981">→</span>Supply Chain
                     </span>`;
        }
        relationLegend.innerHTML = html;
        relationLegend.style.display = 'flex';
    } else {
        relationLegend.style.display = 'none';
    }
}

function buildNodeLegend(nodes) {
    const hasCenter = nodes.some(n => n.is_center);
    const hasExternal = nodes.some(n => n.is_external);
    const hasKnown = nodes.some(n => !n.is_center && !n.is_external);
    const nodeLegend = document.getElementById('node-legend');

    if (hasCenter || hasExternal || hasKnown) {
        let html = '';
        if (hasCenter) {
            html += `<span class="legend-item clickable" onmouseenter="highlightNodeType('center')" onmouseleave="unhighlightAll()">
                        <span class="legend-circle focus"></span>Selected Company
                     </span>`;
        }
        if (hasKnown) {
            html += `<span class="legend-item clickable" onmouseenter="highlightNodeType('known')" onmouseleave="unhighlightAll()">
                        <span class="legend-circle known" style="border-color:#8b8fa8"></span>Data Available
                     </span>`;
        }
        if (hasExternal) {
            html += `<span class="legend-item clickable" onmouseenter="highlightNodeType('external')" onmouseleave="unhighlightAll()">
                        <span class="legend-circle external"></span>External Company
                     </span>`;
        }
        nodeLegend.innerHTML = html;
        nodeLegend.style.display = 'flex';
    } else {
        nodeLegend.style.display = 'none';
    }
}

function buildSectorLegend(nodes) {
    const presentSectors = new Set(nodes.map(n => n.sector).filter(Boolean));
    const sectorLegend = document.getElementById('sector-legend');
    if (presentSectors.size > 0) {
        const sorted = [...presentSectors].sort();
        sectorLegend.innerHTML = sorted.map(s => {
            const color = getSectorColor(s);
            const safeSector = s.replace(/'/g, "\\'");
            return `<span class="legend-item clickable" onmouseenter="highlightSector('${safeSector}')" onmouseleave="unhighlightAll()">
                <span class="legend-dot" style="background:${color}"></span>${s}
            </span>`;
        }).join('');
        sectorLegend.style.display = 'flex';
    } else {
        sectorLegend.style.display = 'none';
    }
}

// ─── Tooltip ──────────────────────────────
function showTooltip(e, html) {
    const t = document.getElementById('tooltip');
    t.innerHTML = html; t.classList.remove('hidden'); moveTooltip(e);
}
function moveTooltip(e) {
    const t = document.getElementById('tooltip');
    t.style.left = `${e.clientX + 14}px`;
    t.style.top = `${e.clientY - 10}px`;
}
function hideTooltip() { document.getElementById('tooltip').classList.add('hidden'); }

// ─── UI helpers ───────────────────────────
function showLoading(show) { document.getElementById('loading-state').classList.toggle('hidden', !show); }
function showEmpty() { document.getElementById('empty-state').classList.remove('hidden'); }
function hideEmpty() { document.getElementById('empty-state').classList.add('hidden'); }
