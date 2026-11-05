from scsm.news import classify, load_companies, match_companies


def test_company_names_have_word_boundaries():
    companies = [
        {"ticker": "CAT", "name": "Caterpillar", "aliases": ["Caterpillar"]},
        {"ticker": "AAPL", "name": "Apple Inc.", "aliases": ["Apple Inc.", "Apple"]},
    ]
    assert match_companies("Apple supplier faces a recall", companies) == ["AAPL"]
    assert match_companies("A catalog of applications", companies) == []
    assert match_companies("caterpillar factory fire", companies) == ["CAT"]


def test_ticker_symbols_do_not_match_ordinary_words():
    assert match_companies("A strike on the factory floor") == []


def test_real_universe_is_shipped():
    assert len(load_companies()) >= 500
    assert "NVDA" in match_companies("NVIDIA faces export ban")


def test_classification_and_negation():
    assert classify("Boeing factory workers strike")["event_type"] == "strike"
    assert classify("NVIDIA faces export restrictions")["event_type"] == "export_ban"
    assert classify("Clorox cyberattack shuts production")["sign"] == -1
    assert classify("The outage was not a cyberattack")["event_type"] == "unclassified"
    assert classify("No strike occurred at Boeing")["event_type"] == "unclassified"


def test_gdelt_or_query_and_successful_cache(tmp_path, monkeypatch):
    import gdeltdoc
    import pandas as pd

    import scsm.news as module

    monkeypatch.setattr(module, "DATA", tmp_path)
    monkeypatch.setattr(module, "match_companies", lambda _: ["BA"])

    def search(self, filters):
        assert filters.query_string.startswith("(fire OR explosion")
        return pd.DataFrame(
            [
                {
                    "title": "Boeing workers strike",
                    "url": "https://example.test/news",
                    "seendate": "20261104T120000Z",
                }
            ]
        )

    monkeypatch.setattr(gdeltdoc.GdeltDoc, "article_search", search)
    events = module.ingest()
    assert events[0]["tickers"] == ["BA"]
    assert events[0]["date"] == "2026-11-04"


def test_event_keywords_have_boundaries_and_skip_averted_events():
    assert classify("Boeing strikeout at charity baseball game")["event_type"] == "unclassified"
    assert classify("Boeing strike averted")["event_type"] == "unclassified"
