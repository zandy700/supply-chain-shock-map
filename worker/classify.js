// Rules are copied verbatim from scsm/news.py; tests verify source parity.
import rules from './rules.json' with {type:'json'};
export function classify(text) {
  const clean = text.replace(/\b(?:not a|not an|no|averted|avoided)\s+(?:cyberattack|strike|recall|explosion)\b/gi,'')
    .replace(/\b(?:strike|recall|explosion)\s+(?:averted|avoided)\b/gi,'');
  for (const [event_type, pattern, severity] of rules.RULES) {
    if (new RegExp(pattern,'i').test(clean)) return {event_type,sign:-1,severity,classification_method:'headline keyword heuristic v1'};
  }
  if (!/\b(?:no|not|without|rules? out|delays?|delayed|cancels?|cancelled|canceled|postpones?|postponed)\b/i.test(clean)) {
    for (const [event_type, pattern, severity] of rules.POSITIVE_RULES) {
      if (new RegExp(pattern,'i').test(clean)) return {event_type,sign:1,severity,classification_method:'headline keyword heuristic v2; positive scenario'};
    }
  }
  return {event_type:'unclassified',sign:0,severity:0,classification_method:'headline keyword heuristic v1'};
}
