"""
Fetcher: retrieve company profile data from yfinance for a given ticker.
"""

import time

import httpx
import yfinance as yf


def get_ciks(tickers: list[str]) -> dict[str, str]:
    """Fetch CIK numbers for given tickers using SEC company_tickers.json."""
    try:
        url = "https://www.sec.gov/files/company_tickers.json"
        headers = {"User-Agent": "stock-relation-bot contact@example.com"}
        r = httpx.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()

        mapping = {}
        for item in data.values():
            if item["ticker"] in tickers:
                mapping[item["ticker"]] = str(item["cik_str"]).zfill(10)
        return mapping
    except Exception as e:
        print(f"[fetcher] Error fetching CIKs: {e}")
        return {}


from io import StringIO

import pandas as pd


def get_m7() -> list[str]:
    """Return the Magnificent 7 tickers."""
    return ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]


def get_sp500(limit: int = 500) -> list[str]:
    """Fetch current S&P 500 tickers sorted by weight from Slickcharts."""
    try:
        url = "https://www.slickcharts.com/sp500"
        headers = {"User-Agent": "Mozilla/5.0"}
        r = httpx.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        tables = pd.read_html(StringIO(r.text))
        df = tables[0]
        # Slickcharts uses '.' instead of '-' for shares (e.g. BRK.B -> BRK-B)
        symbols = df["Symbol"].str.replace(".", "-", regex=False).tolist()
        return symbols[:limit]
    except Exception as e:
        print(f"[fetcher] Error fetching S&P 500: {e}")
        return []


FIELDS = [
    # Identity
    "longName",
    "shortName",
    "displayName",
    "longBusinessSummary",
    "sector",
    "industry",
    "country",
    "state",
    "website",
    "phone",
    "fullTimeEmployees",
    "symbol",
    # Market
    "marketCap",
    "currentPrice",
    "previousClose",
    "volume",
    "averageVolume",
    "fiftyTwoWeekHigh",
    "fiftyTwoWeekLow",
    "fiftyDayAverage",
    "twoHundredDayAverage",
    "fiftyTwoWeekChangePercent",
    # Valuation multiples
    "trailingPE",
    "forwardPE",
    "priceToBook",
    "priceToSalesTrailing12Months",
    "enterpriseToEbitda",
    "enterpriseToRevenue",
    "enterpriseValue",
    "trailingPegRatio",
    # Profitability
    "profitMargins",
    "grossMargins",
    "operatingMargins",
    "ebitdaMargins",
    "returnOnEquity",
    "returnOnAssets",
    # Growth
    "revenueGrowth",
    "earningsGrowth",
    "earningsQuarterlyGrowth",
    # Per share
    "trailingEps",
    "forwardEps",
    "revenuePerShare",
    "totalCashPerShare",
    # Financials (absolute)
    "totalRevenue",
    "grossProfits",
    "ebitda",
    "operatingCashflow",
    "freeCashflow",
    "totalCash",
    "totalDebt",
    "netIncomeToCommon",
    # Leverage / Liquidity
    "debtToEquity",
    "currentRatio",
    "quickRatio",
    # Dividends
    "dividendRate",
    "dividendYield",
    "payoutRatio",
    "fiveYearAvgDividendYield",
    # Analyst
    "recommendationMean",
    "recommendationKey",
    "numberOfAnalystOpinions",
    "targetMeanPrice",
    "targetHighPrice",
    "targetLowPrice",
    # Short interest
    "shortRatio",
    "shortPercentOfFloat",
    "sharesShort",
    # Shares
    "sharesOutstanding",
    "floatShares",
    "heldPercentInsiders",
    "heldPercentInstitutions",
    # Risk
    "beta",
    "overallRisk",
]


def fetch_company(ticker: str, delay: float = 1.0) -> dict | None:
    """Fetch company profile from yfinance. Returns None on failure."""
    try:
        t = yf.Ticker(ticker)
        info = t.info
        if not info or "longName" not in info:
            print(f"[fetcher] No data for {ticker}")
            return None

        profile = {"ticker": ticker}
        for field in FIELDS:
            profile[field] = info.get(field)

        print(f"[fetcher] ✓ {ticker} — {profile.get('longName', 'N/A')}")
        time.sleep(delay)
        return profile
    except Exception as e:
        print(f"[fetcher] ✗ {ticker} error: {e}")
        return None


def fetch_companies(tickers: list[str], delay: float = 1.0) -> list[dict]:
    """Fetch multiple companies with rate-limit delay."""
    results = []
    for ticker in tickers:
        profile = fetch_company(ticker, delay=delay)
        if profile:
            results.append(profile)
    return results
