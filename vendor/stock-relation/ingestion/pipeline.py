"""
Pipeline: orchestrate all three ingestion pipelines.
"""

from ingestion.embedder import Embedder
from ingestion.fetcher import fetch_companies
from ingestion.ownership import OwnershipIngester
from ingestion.supply_chain import SupplyChainIngester


def run_pipeline(
    tickers: list[str],
    qdrant_host: str = "localhost",
    qdrant_port: int = 6333,
    skip_similarity: bool = False,
    skip_ownership: bool = False,
    skip_supply_chain: bool = False,
):
    print(f"\n{'=' * 60}")
    print("  Stock Relation Ingestion Pipeline")
    print(f"  Tickers: {tickers}")
    print(f"{'=' * 60}\n")

    # 1. Fetch company profiles
    print("📡 [1/4] Fetching company profiles from yfinance...")
    profiles = fetch_companies(tickers, delay=1.5)
    print(f"  → Fetched {len(profiles)}/{len(tickers)} profiles\n")

    # 2. Embed + store (similarity relation)
    if not skip_similarity:
        print("🧠 [2/4] Embedding profiles → Qdrant (Similarity)...")
        embedder = Embedder(qdrant_host=qdrant_host, qdrant_port=qdrant_port)
        n = embedder.embed_and_store(profiles)
        print(f"  → Stored {n} vectors\n")

    # 3. Ownership relations
    if not skip_ownership:
        print("💰 [3/4] Ingesting ownership/investment edges...")
        ownership = OwnershipIngester()
        n = ownership.ingest(tickers)
        print(f"  → Stored {n} ownership edges\n")

    # 4. Supply chain relations
    if not skip_supply_chain:
        print("🔗 [4/4] Ingesting supply chain edges...")
        supply = SupplyChainIngester()
        n = supply.ingest(tickers, profiles)
        print(f"  → Stored {n} supply chain edges\n")

    print("✅ Pipeline complete!\n")
