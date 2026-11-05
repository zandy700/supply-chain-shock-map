"""
Embedder: convert company profile into vector embeddings and upsert to Qdrant.
"""

import hashlib

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from sentence_transformers import SentenceTransformer

COLLECTION_NAME = "companies"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
VECTOR_DIM = 384


def build_text(profile: dict) -> str:
    """
    Build semantic embedding text from NATURAL LANGUAGE fields only.
    NLP models understand meaning of words, NOT numeric magnitudes.
    "P/E: 28.5" and "P/E: 200" look almost identical to a sentence transformer.
    So we embed only: business description, sector, industry, geography.
    """
    parts = []
    name = profile.get("longName") or profile.get("ticker", "")
    ticker = profile.get("ticker", "")

    if name:
        parts.append(f"{name} ({ticker}) is a company")
    if profile.get("sector"):
        parts.append(f"in the {profile['sector']} sector")
    if profile.get("industry"):
        parts.append(f"operating in the {profile['industry']} industry")
    if profile.get("country"):
        parts.append(f"headquartered in {profile['country']}.")
    if profile.get("state"):
        parts.append(f"State: {profile['state']}.")
    if profile.get("longBusinessSummary"):
        # Use full description — this is the main semantic signal
        parts.append(f"Business description: {profile['longBusinessSummary'][:800]}")

    return " ".join(parts)


def build_numeric_vector(profile: dict) -> list[float]:
    """
    Build a normalized numeric feature vector for financial similarity.
    Each feature is clipped to a reasonable range then min-max scaled to [0,1].
    This is separate from the NLP embedding and can be used for a second
    'finance' similarity dimension in Qdrant's multi-vector search.
    """

    def clamp(v, lo, hi):
        if v is None:
            return 0.5  # missing → midpoint
        return max(lo, min(hi, v))

    features = [
        clamp(profile.get("trailingPE"), 0, 200) / 200,
        clamp(profile.get("forwardPE"), 0, 200) / 200,
        clamp(profile.get("priceToBook"), 0, 50) / 50,
        clamp(profile.get("priceToSalesTrailing12Months"), 0, 30) / 30,
        clamp(profile.get("enterpriseToEbitda"), 0, 100) / 100,
        clamp(profile.get("trailingPegRatio"), 0, 5) / 5,
        clamp(profile.get("profitMargins"), -0.5, 1) / 1.5 + 0.33,
        clamp(profile.get("grossMargins"), 0, 1),
        clamp(profile.get("operatingMargins"), -0.5, 1) / 1.5 + 0.33,
        clamp(profile.get("returnOnEquity"), -1, 5) / 6 + 0.17,
        clamp(profile.get("returnOnAssets"), -0.5, 1) / 1.5 + 0.33,
        clamp(profile.get("revenueGrowth"), -0.5, 2) / 2.5 + 0.2,
        clamp(profile.get("earningsGrowth"), -1, 5) / 6 + 0.17,
        clamp(profile.get("debtToEquity"), 0, 500) / 500,
        clamp(profile.get("currentRatio"), 0, 5) / 5,
        clamp(profile.get("beta"), -1, 4) / 5 + 0.2,
        clamp(profile.get("recommendationMean"), 1, 5) / 5,
        clamp(profile.get("shortPercentOfFloat"), 0, 0.3) / 0.3,
        clamp(profile.get("heldPercentInstitutions"), 0, 1),
        clamp(profile.get("dividendYield"), 0, 0.1) / 0.1,
    ]
    return features


class Embedder:
    def __init__(self, qdrant_host: str = "localhost", qdrant_port: int = 6333):
        import torch

        device = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if torch.backends.mps.is_available()
            else "cpu"
        )
        print(f"[embedder] Loading model: {EMBEDDING_MODEL} on {device}")
        self.model = SentenceTransformer(EMBEDDING_MODEL, device=device)
        self.client = QdrantClient(host=qdrant_host, port=qdrant_port)
        self._ensure_collection()

    def _ensure_collection(self):
        existing = [c.name for c in self.client.get_collections().collections]
        if COLLECTION_NAME not in existing:
            self.client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
            )
            print(f"[embedder] Created collection: {COLLECTION_NAME}")

    def embed_and_store(self, profiles: list[dict]) -> int:
        """Embed profiles and upsert to Qdrant. Returns count upserted."""
        if not profiles:
            return 0

        texts = [build_text(p) for p in profiles]
        vectors = self.model.encode(texts, show_progress_bar=True).tolist()

        points = []
        for i, profile in enumerate(profiles):
            # Stable deterministic ID via MD5 — safe across processes
            point_id = int(hashlib.md5(profile["ticker"].upper().encode()).hexdigest()[:16], 16)
            payload = {k: v for k, v in profile.items() if v is not None}
            # Store numeric vector in payload for blended financial similarity
            payload["_numeric_vec"] = build_numeric_vector(profile)
            points.append(
                PointStruct(
                    id=point_id,
                    vector=vectors[i],
                    payload=payload,
                )
            )

        self.client.upsert(collection_name=COLLECTION_NAME, points=points)
        print(f"[embedder] Upserted {len(points)} vectors into '{COLLECTION_NAME}'")
        return len(points)

    def get_similar(self, ticker: str, top_k: int = 5) -> list[dict]:
        """Find similar companies to a given ticker by vector search."""
        # First retrieve the ticker's vector
        point_id = int(hashlib.md5(ticker.upper().encode()).hexdigest()[:16], 16)
        results = self.client.retrieve(
            collection_name=COLLECTION_NAME,
            ids=[point_id],
            with_vectors=True,
        )
        if not results:
            return []

        vector = results[0].vector
        hits = self.client.query_points(
            collection_name=COLLECTION_NAME,
            query=vector,
            limit=top_k + 1,
        ).points
        return [
            {
                "ticker": h.payload.get("ticker"),
                "name": h.payload.get("longName"),
                "score": round(h.score, 4),
                "sector": h.payload.get("sector"),
            }
            for h in hits
            if h.payload.get("ticker") != ticker
        ][:top_k]
