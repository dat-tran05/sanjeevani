"""Run from repo root: `python scripts/sanity_check.py`. All three checks must pass."""
import os
import sys
from pathlib import Path

# Load .env
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")


def check_bedrock() -> bool:
    """Verify Bedrock credentials and Sonnet 4.6 invocation."""
    print("[1/3] Bedrock + Claude Sonnet 4.6...", end=" ", flush=True)
    try:
        from anthropic import AnthropicBedrock
        client = AnthropicBedrock(
            aws_region=os.environ["AWS_REGION"],
        )
        resp = client.messages.create(
            model=os.environ["BEDROCK_MODEL_ID"],
            max_tokens=20,
            messages=[{"role": "user", "content": "Reply with exactly: PONG"}],
        )
        text = resp.content[0].text.strip()
        if "PONG" in text:
            print(f"OK ({text!r})")
            return True
        print(f"FAIL — unexpected response: {text!r}")
        return False
    except Exception as e:
        print(f"FAIL — {type(e).__name__}: {e}")
        return False


def check_databricks_sql() -> bool:
    """Verify Databricks SQL Warehouse connection."""
    print("[2/3] Databricks SQL Warehouse...", end=" ", flush=True)
    try:
        from databricks import sql
        with sql.connect(
            server_hostname=os.environ["DATABRICKS_HOST"].replace("https://", ""),
            http_path=os.environ["DATABRICKS_HTTP_PATH"],
            access_token=os.environ["DATABRICKS_TOKEN"],
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ping")
                row = cur.fetchone()
                if row[0] == 1:
                    print("OK")
                    return True
        print("FAIL — unexpected result")
        return False
    except Exception as e:
        print(f"FAIL — {type(e).__name__}: {e}")
        return False


def check_databricks_serving() -> bool:
    """Verify Llama 3.3 endpoint via OpenAI-compatible API."""
    print("[3/3] Databricks Model Serving (Llama 3.3)...", end=" ", flush=True)
    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.environ["DATABRICKS_TOKEN"],
            base_url=f"{os.environ['DATABRICKS_HOST']}/serving-endpoints",
        )
        resp = client.chat.completions.create(
            model=os.environ["DATABRICKS_LLAMA_ENDPOINT"],
            messages=[{"role": "user", "content": "Reply with exactly: PONG"}],
            max_tokens=20,
        )
        text = resp.choices[0].message.content.strip()
        if "PONG" in text:
            print(f"OK ({text!r})")
            return True
        print(f"FAIL — unexpected response: {text!r}")
        return False
    except Exception as e:
        print(f"FAIL — {type(e).__name__}: {e}")
        return False


if __name__ == "__main__":
    results = [check_bedrock(), check_databricks_sql(), check_databricks_serving()]
    if not all(results):
        print("\n❌ Some checks failed. Fix before proceeding.")
        sys.exit(1)
    print("\n✅ All connections healthy. Ready to build.")
