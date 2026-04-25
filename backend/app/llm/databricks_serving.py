"""Databricks Model Serving (Llama 3.3, Qwen 3, embeddings) — OpenAI-compatible client."""
import os
from openai import OpenAI

_client: OpenAI | None = None


def get_client() -> OpenAI:
    """Return a singleton Databricks Model Serving client."""
    global _client
    if _client is None:
        host = os.environ["DATABRICKS_HOST"].rstrip("/")
        _client = OpenAI(
            api_key=os.environ["DATABRICKS_TOKEN"],
            base_url=f"{host}/serving-endpoints",
        )
    return _client


def get_llama_endpoint() -> str:
    return os.environ.get("DATABRICKS_LLAMA_ENDPOINT", "databricks-meta-llama-3-3-70b-instruct")


def get_embedding_endpoint() -> str:
    return os.environ.get("DATABRICKS_EMBEDDING_ENDPOINT", "databricks-gte-large-en")


def embed_query(text: str) -> list[float]:
    """Embed a single string with gte-large-en."""
    resp = get_client().embeddings.create(
        model=get_embedding_endpoint(),
        input=[text],
    )
    return list(resp.data[0].embedding)
