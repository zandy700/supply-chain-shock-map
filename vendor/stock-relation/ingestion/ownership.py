"""
Ownership: extract equity investments made BY each company.

Sources:
  1. SC 13D/13G — when company holds >5% of a public company
  2. 13F-HR    — all institutional equity holdings with market values (if company files as investment manager)
  3. Gemini + Google Search — recent news investment discovery via LLM web search

Storage: SQLite via api.db
"""

import re
import time

import httpx

from api.db import get_db
from ingestion.fetcher import get_ciks

EDGAR_DATA = "https://data.sec.gov"
EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
HEADERS = {"User-Agent": "stock-relation-bot contact@example.com"}

SC13_FORMS = {"SC 13D", "SC 13G", "SC 13G/A", "SC 13D/A"}


# ─────────────────────────────────────────────────────────────────
# SC 13D/13G — large equity stakes (>5%)
# ─────────────────────────────────────────────────────────────────


def _parse_sgml_names(sgml_text: str) -> tuple[str, str]:
    """Returns (subject_company_name, filer_name) from SGML header."""
    subject = ""
    filer = ""
    subj_match = re.search(
        r"SUBJECT COMPANY:.*?COMPANY CONFORMED NAME:\s+(.+?)[\r\n]",
        sgml_text,
        re.DOTALL | re.IGNORECASE,
    )
    if subj_match:
        subject = subj_match.group(1).strip()
    filed_match = re.search(
        r"FILED BY:.*?COMPANY CONFORMED NAME:\s+(.+?)[\r\n]",
        sgml_text,
        re.DOTALL | re.IGNORECASE,
    )
    if filed_match:
        filer = filed_match.group(1).strip()
    return subject, filer


def fetch_sc13_investments(cik: str, ticker: str, max_filings: int = 30) -> list[dict]:
    """
    Find SC 13D/G filings filed BY this company as a large investor.
    Confirms filer via CIK match in SGML header, then extracts subject company.
    Returns edges: (ticker → subject_company).
    """
    edges: list[dict] = []
    try:
        url = f"{EDGAR_DATA}/submissions/CIK{cik}.json"
        r = httpx.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        data = r.json()

        filings = data.get("filings", {}).get("recent", {})
        forms = filings.get("form", [])
        accessions = filings.get("accessionNumber", [])
        cik_plain = cik.lstrip("0") or "0"

        seen_subjects: set[str] = set()
        fetched = 0

        for i, form in enumerate(forms):
            if form not in SC13_FORMS:
                continue
            if fetched >= max_filings:
                break
            if i >= len(accessions):
                continue

            acc = accessions[i]
            acc_nodash = acc.replace("-", "")
            sgml_url = f"{EDGAR_ARCHIVES}/{cik_plain}/{acc_nodash}/{acc}.txt"

            try:
                sgml_r = httpx.get(sgml_url, headers=HEADERS, timeout=15)
                if sgml_r.status_code != 200:
                    continue
                header = sgml_r.text[:6000]
                subject, filer = _parse_sgml_names(header)
                fetched += 1

                # Confirm this company is the FILER (investor), not just the subject
                filed_cik_match = re.search(
                    r"FILED BY:.*?CENTRAL INDEX KEY:\s*(\d+)",
                    header,
                    re.DOTALL | re.IGNORECASE,
                )
                filed_cik = filed_cik_match.group(1).lstrip("0") if filed_cik_match else ""
                if filed_cik != cik_plain:
                    continue

                if not subject or subject in seen_subjects:
                    continue
                seen_subjects.add(subject)

                edges.append(
                    {
                        "source": ticker,
                        "target": subject,
                        "target_ticker": None,
                        "direction": "invests_in",
                        "note": f"SEC {form} — >5% equity stake",
                        "source_filing": "sc13",
                        "value_usd": None,
                        "shares": None,
                    }
                )
                time.sleep(0.15)

            except Exception:
                continue

        time.sleep(0.5)
    except Exception as e:
        print(f"[ownership] SC 13 error for {ticker}: {e}")
    return edges


# ─────────────────────────────────────────────────────────────────
# 13F-HR — all institutional equity holdings with market values
# ─────────────────────────────────────────────────────────────────


def fetch_13f_holdings(cik: str, ticker: str, max_holdings: int = 50) -> list[dict]:
    """
    Parse most recent 13F-HR infotable XML for all equity holdings + USD market values.
    Returns edges: (ticker → holding_company).
    """
    edges: list[dict] = []
    try:
        sub_url = f"{EDGAR_DATA}/submissions/CIK{cik}.json"
        r = httpx.get(sub_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()

        filings = data.get("filings", {}).get("recent", {})
        forms = filings.get("form", [])
        accessions = filings.get("accessionNumber", [])
        cik_plain = cik.lstrip("0") or "0"

        latest_acc = None
        for i, form in enumerate(forms):
            if form == "13F-HR":
                latest_acc = accessions[i]
                break
        if not latest_acc:
            return []

        acc_nodash = latest_acc.replace("-", "")
        sgml_url = f"{EDGAR_ARCHIVES}/{cik_plain}/{acc_nodash}/{latest_acc}.txt"
        sgml_r = httpx.get(sgml_url, headers=HEADERS, timeout=20)
        if sgml_r.status_code != 200:
            return []

        # Find infotable XML filename
        infotable_match = re.search(
            r"<FILENAME>([^\n]*(?:infotable|informationtable|form13f)[^\n]*\.xml)",
            sgml_r.text,
            re.IGNORECASE,
        )
        if not infotable_match:
            xml_files = re.findall(r"<FILENAME>([^\n]+\.xml)", sgml_r.text, re.IGNORECASE)
            infotable_xml = next((f for f in xml_files if "cover" not in f.lower()), None)
            if not infotable_xml:
                return []
            infotable_xml = infotable_xml.strip()
        else:
            infotable_xml = infotable_match.group(1).strip()

        xml_url = f"{EDGAR_ARCHIVES}/{cik_plain}/{acc_nodash}/{infotable_xml}"
        xml_r = httpx.get(xml_url, headers=HEADERS, timeout=20)
        if xml_r.status_code != 200:
            return []

        xml_text = xml_r.text
        names = re.findall(r"<nameOfIssuer>\s*(.*?)\s*</nameOfIssuer>", xml_text, re.IGNORECASE)
        values = re.findall(r"<value>\s*(\d+)\s*</value>", xml_text, re.IGNORECASE)
        shares = re.findall(r"<sshPrnamt>\s*(\d+)\s*</sshPrnamt>", xml_text, re.IGNORECASE)

        seen: set[str] = set()
        for i, name in enumerate(names[:max_holdings]):
            if name in seen:
                continue
            seen.add(name)
            val_usd = int(values[i]) if i < len(values) else None
            edges.append(
                {
                    "source": ticker,
                    "target": name,
                    "target_ticker": None,
                    "direction": "invests_in",
                    "note": "13F-HR institutional holding",
                    "source_filing": "13f",
                    "value_usd": val_usd,
                    "shares": int(shares[i]) if i < len(shares) else None,
                }
            )
        time.sleep(0.5)
    except Exception as e:
        print(f"[ownership] 13F error for {ticker}: {e}")
    return edges


# ─────────────────────────────────────────────────────────────────
# Gemini + Google Search — web news investment discovery
# ─────────────────────────────────────────────────────────────────

_INVEST_PROMPT = """\
You are a financial analyst with knowledge of major corporate investments and acquisitions.
List all notable equity investments and strategic stakes made BY {company} ({ticker}) in OTHER companies.
Include all: venture investments, minority stakes, strategic investments, equity method investments.

Return ONLY a JSON array — no markdown, no commentary:
[
  {{"company": "<investee company name>", "amount_usd": <integer USD or null>, "note": "<brief context ≤ 80 chars>"}},
  ...
]

Rules:
- Only include named external companies that {company} invested IN (not investors in {company})
- Exclude {company}'s own subsidiaries and wholly-owned divisions
- Include both public and private company investments
- Include the dollar amount in USD (as integer) if known, otherwise null
- Include ALL notable investments you know about, not just recent ones
- If nothing found, return []
"""


def fetch_gemini_investments(cik: str, ticker: str, company_name: str = "") -> list[dict]:
    """
    Use an LLM (default: Gemini 2.5 Flash) to discover equity investments made by the company.
    If a Gemini model is used, Google Search grounding is enabled for live news discovery.
    Requires GEMINI_API_KEY in environment.
    """
    import json as _json
    import os

    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or api_key == "your_key_here":
        print(f"[ownership] GEMINI_API_KEY not set — skipping Gemma search for {ticker}.")
        return []

    display_name = company_name or ticker
    prompt = _INVEST_PROMPT.format(company=display_name, ticker=ticker)

    try:
        from google import genai
        from google.genai import types

        model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        config_args = {"temperature": 0.1}
        if "gemini" in model_name.lower():
            config_args["tools"] = [types.Tool(google_search=types.GoogleSearch())]

        client = genai.Client(api_key=api_key)
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(**config_args),
            )
        except Exception as e:
            if "429" in str(e) and model_name != "gemma-3-27b-it":
                print(
                    f"[ownership] {model_name} quota exhausted (429). Falling back to gemma-3-27b-it..."
                )
                response = client.models.generate_content(
                    model="gemma-3-27b-it",
                    contents=prompt,
                    config=types.GenerateContentConfig(temperature=0.1),
                )
            else:
                raise e

        raw = response.text.strip()
        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        items = _json.loads(raw)
    except Exception as e:
        print(f"[ownership] LLM extraction error for {ticker}: {e}")
        return []

    edges: list[dict] = []
    seen: set[str] = set()
    for item in items:
        company = str(item.get("company", "")).strip()
        if not company or len(company) < 2:
            continue
        if company.lower() in (
            ticker.lower(),
            display_name.lower(),
            "company",
            "we",
            "",
        ):
            continue
        if company in seen:
            continue
        seen.add(company)

        raw_amount = item.get("amount_usd")
        try:
            val_usd = int(float(raw_amount)) if raw_amount is not None else None
        except (ValueError, TypeError):
            val_usd = None

        edges.append(
            {
                "source": ticker,
                "target": company,
                "target_ticker": None,
                "direction": "invests_in",
                "note": str(item.get("note", "Gemini web search"))[:200],
                "source_filing": "web_search",
                "value_usd": val_usd,
                "shares": None,
            }
        )

    print(f"[ownership] {ticker}: {len(edges)} investments found via LLM.")
    return edges


# ─────────────────────────────────────────────────────────────────
# Ingester
# ─────────────────────────────────────────────────────────────────


class OwnershipIngester:
    def ingest(self, tickers: list[str]) -> int:
        """
        Ingest ownership edges for given tickers into SQLite.
        Sources (in priority order): SC 13D/G → 13F-HR → Gemini web search.
        """
        ciks_map = get_ciks(tickers)
        all_edges: list[dict] = []

        for ticker in tickers:
            cik = ciks_map.get(ticker)
            if not cik:
                print(f"[ownership] No CIK for {ticker}, skipping.")
                continue

            sc13_edges = fetch_sc13_investments(cik, ticker)
            print(f"[ownership] {ticker}: {len(sc13_edges)} SC 13 investments.")
            all_edges.extend(sc13_edges)

            f13_edges = fetch_13f_holdings(cik, ticker)
            if f13_edges:
                sc13_targets = {e["target"].lower() for e in sc13_edges}
                new_13f = [e for e in f13_edges if e["target"].lower() not in sc13_targets]
                print(f"[ownership] {ticker}: {len(new_13f)} new from 13F (after dedup).")
                all_edges.extend(new_13f)

            # LLM knowledge/search-based investment discovery
            gemini_edges = fetch_gemini_investments(cik, ticker)
            if gemini_edges:
                known = {e["target"].lower() for e in all_edges if e["source"] == ticker}
                new_gemini = [e for e in gemini_edges if e["target"].lower() not in known]
                print(f"[ownership] {ticker}: {len(new_gemini)} new from LLM extraction.")
                all_edges.extend(new_gemini)

        # Write to SQLite — rank by USD amount descending, nulls last
        from collections import defaultdict as _dd

        by_source: dict[str, list] = _dd(list)
        for edge in all_edges:
            by_source[edge["source"]].append(edge)

        conn = get_db()
        inserted = 0

        for source, edges in by_source.items():
            # Fetch old data to merge for re-ranking
            old_rows = conn.execute(
                "SELECT * FROM ownership WHERE source = ?", (source,)
            ).fetchall()
            merged_edges = {}

            # Load old data first
            for row in old_rows:
                target = row["target"]
                merged_edges[target] = {
                    "source": row["source"],
                    "target": target,
                    "target_ticker": row["target_ticker"],
                    "direction": row["direction"],
                    "note": row["note"],
                    "source_filing": row["source_filing"],
                    "value_usd": row["value_usd"],
                    "shares": row["shares"],
                }

            # Overwrite/Add with new data
            for edge in edges:
                merged_edges[edge["target"]] = edge

            # Sort combined dataset
            combined = list(merged_edges.values())
            combined.sort(key=lambda e: e.get("value_usd") or -1, reverse=True)

            for rank, edge in enumerate(combined, start=1):
                try:
                    conn.execute(
                        """INSERT INTO ownership
                           (source, target, target_ticker, direction, note, source_filing, value_usd, shares, rank)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(source, target) DO UPDATE SET
                               direction=excluded.direction, note=excluded.note,
                               source_filing=excluded.source_filing, value_usd=excluded.value_usd,
                               shares=excluded.shares, rank=excluded.rank
                        """,
                        (
                            source,
                            edge.get("target"),
                            edge.get("target_ticker"),
                            edge.get("direction", "invests_in"),
                            edge.get("note"),
                            edge.get("source_filing"),
                            edge.get("value_usd"),
                            edge.get("shares"),
                            rank,
                        ),
                    )
                    inserted += 1
                except Exception as e:
                    print(f"[ownership] DB insert error: {e}")

        conn.commit()
        conn.close()
        print(f"[ownership] Wrote {inserted} ownership edges to SQLite.")
        return inserted

    def get_investments(self, ticker: str) -> list[dict]:
        """Get all equity investments made by a company from SQLite."""
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM ownership WHERE source = ? ORDER BY rank",
            (ticker.upper(),),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
