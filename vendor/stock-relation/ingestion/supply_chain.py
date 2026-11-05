"""
Supply Chain: extract supplier/customer relationships from SEC EDGAR 10-K filings.
"""

import logging
import os
import re
import time
import warnings
from collections import defaultdict

import httpx
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from tqdm import tqdm

from api.db import get_db

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

logging.getLogger("transformers").setLevel(logging.ERROR)

EDGAR_SEARCH = "https://efts.sec.gov/LATEST/search-index"
EDGAR_ARCHIVE = "https://www.sec.gov/Archives/edgar"
HEADERS = {"User-Agent": "stock-relation-bot contact@example.com"}


class SupplyChainIngester:
    def __init__(self, use_classifier=False):
        self.classifier = None
        if not use_classifier:
            return
        try:
            from transformers import pipeline
            import torch

            device = (
                "cuda"
                if torch.cuda.is_available()
                else "mps"
                if torch.backends.mps.is_available()
                else "cpu"
            )
            print(f"[supply_chain] Loading zero-shot classifier on: {device}")
            self.classifier = pipeline(
                "zero-shot-classification",
                model="typeform/distilbert-base-uncased-mnli",
                device=device,
            )
        except Exception as e:
            print(f"[supply_chain] Warning: could not load classifier: {e}")
            self.classifier = None

    def _build_aliases(self, tickers: list[str], profiles: list[dict]) -> dict[str, list[str]]:
        aliases_map = {}
        profile_map = {p["ticker"]: p for p in profiles} if profiles else {}

        for t in tickers:
            prof = profile_map.get(t, {})
            short_name = prof.get("shortName", "")
            long_name = prof.get("longName", "")

            aliases = {short_name, long_name, t}
            cleaned = set()
            for name in aliases:
                if not name:
                    continue
                name_clean = re.sub(
                    r"(?i)[,\s]+(inc\.|inc|corporation|corp\.|corp|llc|plc|ltd\.|ltd|company|co\.|co)\b",
                    "",
                    name,
                ).strip()
                cleaned.add(name_clean)
                cleaned.add(name)

            aliases_map[t] = sorted([a for a in cleaned if len(a) > 2], key=len, reverse=True)
        return aliases_map

    def _edgar_combined_search(self, combined_queries: list[str]) -> list[dict]:
        PAGE_SIZE = 100
        seen = set()
        all_hits = []

        for query in combined_queries:
            page_from, total_pages = 0, 1
            while page_from < total_pages * PAGE_SIZE:
                try:
                    r = httpx.get(
                        EDGAR_SEARCH,
                        params={
                            "q": query,
                            "forms": "10-K,20-F",
                            "dateRange": "custom",
                            "startdt": os.getenv("SEC_FILING_START_DATE", "2023-01-01"),
                            "enddt": os.getenv("SEC_FILING_END_DATE", "2025-12-31"),
                            "from": page_from,
                            "size": PAGE_SIZE,
                        },
                        headers=HEADERS,
                        timeout=20,
                    )
                    r.raise_for_status()
                    data = r.json()
                    total = data.get("hits", {}).get("total", {}).get("value", 0)
                    raw = data.get("hits", {}).get("hits", [])
                    if page_from == 0:
                        total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE

                    for h in raw:
                        src = h.get("_source", {})
                        adsh = src.get("adsh") or h["_id"].split(":")[0]
                        if adsh in seen:
                            continue
                        seen.add(adsh)
                        filename = h["_id"].split(":", 1)[1] if ":" in h["_id"] else ""
                        cik = (src.get("ciks") or [""])[0]
                        disp = (src.get("display_names") or ["?"])[0]
                        clean = disp.split("(")[0].strip() if disp else "?"
                        tick = (
                            re.search(r"\(([A-Z]{1,5})\)", disp or "")
                            or type("", (), {"group": lambda s, n: ""})()
                        ).group(1)
                        all_hits.append(
                            {
                                "entity_name": clean,
                                "ticker": tick,
                                "cik": cik,
                                "adsh": adsh,
                                "filename": filename,
                                "form": src.get("form", "?"),
                                "file_date": src.get("file_date", "?"),
                            }
                        )

                    if len(raw) < PAGE_SIZE:
                        break
                    page_from += PAGE_SIZE
                    time.sleep(0.3)
                except Exception as e:
                    print(f"[supply_chain] EDGAR search error (page {page_from}): {e}")
                    break

        # Dedup by entity (latest filing)
        best = {}
        for h in all_hits:
            if not h["cik"] or not h["filename"]:
                continue
            key = h["entity_name"]
            if key not in best or h["file_date"] > best[key]["file_date"]:
                best[key] = h
        return list(best.values())

    def _fetch_filing_text(self, hit: dict) -> str:
        cik_plain = hit["cik"].lstrip("0") or "0"
        acc_clean = hit["adsh"].replace("-", "")
        url = f"{EDGAR_ARCHIVE}/data/{cik_plain}/{acc_clean}/{hit['filename']}"
        try:
            r = httpx.get(url, headers=HEADERS, timeout=25)
            if r.status_code != 200:
                return ""
            soup = BeautifulSoup(r.text, "lxml")
            for tag in soup(["script", "style", "link", "meta"]):
                tag.decompose()
            text = soup.get_text(separator="\n")
            text = re.sub(r"[ \t]+", " ", text)
            return re.sub(r"\n{3,}", "\n\n", text).strip()
        except Exception:
            return ""

    def ingest(self, tickers: list[str], profiles: list[dict] = None) -> int:
        """Ingest supply chain edges for given tickers."""
        # Dynamic Discovery
        aliases_map = self._build_aliases(tickers, profiles)
        queries = []
        for _t, aliases in aliases_map.items():
            for brand in aliases:
                queries.append(f'"{brand}"')

        print(f"[supply_chain] Searching EDGAR EFTS with {len(queries)} explicit queries...")
        deduped_hits = self._edgar_combined_search(queries)

        # Filter out the target tickers themselves from results
        all_target_names = {n.lower() for aliases in aliases_map.values() for n in aliases}
        deduped_hits = [
            h
            for h in deduped_hits
            if not any(n in h["entity_name"].lower() for n in all_target_names)
        ]

        print(f"[supply_chain] Found {len(deduped_hits)} potential supplier filings to analyze.")

        results = defaultdict(list)

        for hit in tqdm(deduped_hits, desc="  ...analyzing 10-K filings"):
            text = self._fetch_filing_text(hit)
            if not text:
                continue

            entity = hit["entity_name"]

            for ticker, aliases in aliases_map.items():
                sents = []
                for sent in re.split(r"(?<=[.!?])\s+|\n\n", text):
                    sent_lower = sent.lower()
                    if any(n.lower() in sent_lower for n in aliases):
                        clean = sent.strip().replace("\n", " ")
                        if 20 < len(clean) < 600:
                            sents.append(clean)

                sents = list(dict.fromkeys(sents))

                best_evidence = None
                best_score = -1.0

                for s in sents:
                    score = 0.0
                    if self.classifier:
                        res = self.classifier(
                            s,
                            [
                                "customer or supplier relationship",
                                "competitor or partner",
                                "irrelevant or general mention",
                            ],
                        )
                        labels = res["labels"]
                        scores = res["scores"]

                        target_idx = labels.index("customer or supplier relationship")
                        score = scores[target_idx]
                    else:
                        if (
                            "customer" in s.lower()
                            or "revenue" in s.lower()
                            or "sales" in s.lower()
                        ):
                            score = 0.8

                    if score > best_score and score > 0.4:  # Threshold
                        best_score = score
                        best_evidence = s

                if best_evidence:
                    results[ticker].append(
                        {
                            "supplier": entity,
                            "ticker": hit["ticker"],
                            "evidence": best_evidence,
                            "confidence": best_score,
                        }
                    )
            time.sleep(0.2)

        # Write to SQLite
        conn = get_db()
        inserted = 0

        for ticker, suppliers in results.items():
            # Fetch old data for this ticker
            old_rows = conn.execute(
                "SELECT * FROM supply_chain WHERE source = ?", (ticker,)
            ).fetchall()
            merged_sups = {}

            # Load old data
            for row in old_rows:
                target = row["target"]
                merged_sups[target] = {
                    "supplier": target,
                    "ticker": row["target_ticker"],
                    "evidence": row["evidence"],
                    "confidence": row["confidence"],
                }

            # Overwrite/Add with new data
            for sup in suppliers:
                merged_sups[sup["supplier"]] = sup

            # Sort combined dataset
            combined_sups = list(merged_sups.values())
            combined_sups.sort(key=lambda x: x["confidence"], reverse=True)

            for rank, sup in enumerate(combined_sups, start=1):
                try:
                    conn.execute(
                        """INSERT INTO supply_chain
                           (source, target, target_ticker, direction, note, evidence, confidence, rank)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(source, target) DO UPDATE SET
                               direction=excluded.direction, note=excluded.note,
                               evidence=excluded.evidence, confidence=excluded.confidence,
                               rank=excluded.rank
                        """,
                        (
                            ticker,
                            sup["supplier"],
                            sup["ticker"] if sup["ticker"] else None,
                            "supplier",
                            # Use existing Note if it's from old data, otherwise generate new one
                            sup.get("note") or f"Discovered via 10-K: {sup['evidence'][:100]}...",
                            sup["evidence"],
                            float(sup["confidence"]),
                            rank,
                        ),
                    )
                    inserted += 1
                except Exception as e:
                    print(f"[supply_chain] DB insert error: {e}")

        conn.commit()
        conn.close()
        print(f"[supply_chain] Wrote {inserted} supply chain edges to SQLite.")
        return inserted

    def get_supply_chain(self, ticker: str) -> list[dict]:
        """Get supply chain edges for a company (both directions) from SQLite."""
        ticker = ticker.upper()
        conn = get_db()
        # As source (M7 company has suppliers)
        source_rows = conn.execute(
            "SELECT * FROM supply_chain WHERE source = ? ORDER BY rank",
            (ticker,),
        ).fetchall()
        # As target (M7 company is a customer of the filer)
        target_rows = conn.execute(
            "SELECT * FROM supply_chain WHERE target_ticker = ? ORDER BY rank",
            (ticker,),
        ).fetchall()
        conn.close()

        edges = [dict(r) for r in source_rows]
        for r in target_rows:
            p = dict(r)
            p["perspective"] = "reverse"
            edges.append(p)
        return edges
