// Loads every panel module so each can registerPanel(). Order does not matter.
import './chart.js';
import './company.js';
import './markets.js';
import './news.js';
import './prediction-markets.js';
import './video.js';
import './earnings.js';
import './options.js';
import './options-flow.js';
import './portfolio.js';
import '../scout.js';   // registers ai-recap
import '../alerts.js';  // registers alerts
