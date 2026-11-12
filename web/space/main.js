// Entry point: load panels, AI assistant and alerts, then start the shell.
import './panels/index.js';
import './scout.js';
import './alerts.js';
import { start } from './shell.js';
start(document.getElementById('space-root'));
