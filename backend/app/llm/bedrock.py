"""Anthropic Claude via AWS Bedrock — used by planner, intent, MoA, aggregator, validator."""
import os
from typing import Iterator
from anthropic import AnthropicBedrock

_client: AnthropicBedrock | None = None


def get_client() -> AnthropicBedrock:
    """Singleton AnthropicBedrock client.

    If AWS_BEARER_TOKEN_BEDROCK is set, force bearer-token auth by clearing
    legacy AWS credentials from the boto3 chain AND pointing the shared
    credentials/config files at /dev/null. Otherwise stale ~/.aws/credentials
    files take precedence and produce expired-token 403 errors.
    """
    global _client
    if _client is None:
        if os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
            for legacy in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE"):
                os.environ.pop(legacy, None)
            os.environ["AWS_SHARED_CREDENTIALS_FILE"] = "/dev/null"
            os.environ["AWS_CONFIG_FILE"] = "/dev/null"
        _client = AnthropicBedrock(aws_region=os.environ.get("AWS_REGION", "us-east-1"))
    return _client


def get_sonnet_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")


def get_haiku_model_id() -> str:
    # Bedrock requires the dated, versioned model ID (not the bare slug).
    return os.environ.get("BEDROCK_MODEL_ID_HAIKU", "us.anthropic.claude-haiku-4-5-20251001-v1:0")


def stream_with_thinking(
    prompt: str,
    *,
    model: str | None = None,
    max_tokens: int = 2048,
    thinking_budget: int = 1500,
    system: str | None = None,
) -> Iterator[tuple[str, str]]:
    """Stream a Sonnet response with extended thinking enabled.

    Yields (kind, text) tuples where kind is 'thinking' or 'text'.
    Caller is responsible for converting to SSE events.
    """
    client = get_client()
    kwargs: dict = {
        "model": model or get_sonnet_model_id(),
        "max_tokens": max_tokens,
        "thinking": {"type": "enabled", "budget_tokens": thinking_budget},
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    with client.messages.stream(**kwargs) as stream:
        for event in stream:
            if event.type == "content_block_delta":
                delta = event.delta
                if delta.type == "thinking_delta":
                    yield ("thinking", delta.thinking)
                elif delta.type == "text_delta":
                    yield ("text", delta.text)
