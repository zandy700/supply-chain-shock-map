// Browser re-implementation of scsm/ledger.py verification.
// Hash input: RFC 8785 (JCS) canonical JSON of the record without "hash", UTF-8, SHA-256.
// JCS serializes primitives exactly like ECMAScript JSON.stringify and sorts object keys
// by UTF-16 code units, which is Array.prototype.sort's default order.

export const GENESIS = "0".repeat(64);

export function canonical(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort()
    .map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

export async function digest(record) {
  const rest = {};
  for (const [k, v] of Object.entries(record)) if (k !== "hash") rest[k] = v;
  const bytes = new TextEncoder().encode(canonical(rest));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns per-record results plus overall status, mirroring scsm.ledger.verify. */
export async function verifyChain(records) {
  if (!globalThis.crypto || !crypto.subtle) {
    return { valid: false, unsupported: true, rows: [], count: 0, error: "Web Crypto unavailable (needs HTTPS or localhost)" };
  }
  let previous = GENESIS;
  let firstBad = null;
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const computed = await digest(r);
    const linkOk = r.prev_hash === previous;
    const hashOk = r.hash === computed;
    const ok = linkOk && hashOk && firstBad === null;
    if (!(linkOk && hashOk) && firstBad === null) firstBad = i;
    rows.push({ index: i + 1, computed, linkOk, hashOk, ok });
    previous = r.hash;
  }
  return {
    valid: firstBad === null,
    count: firstBad === null ? records.length : firstBad,
    head: records.length ? records[records.length - 1].hash : GENESIS,
    firstBad,
    rows,
  };
}
