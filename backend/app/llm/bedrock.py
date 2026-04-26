"""Anthropic Claude via AWS Bedrock — used by planner, intent, MoA, aggregator, validator."""
import os
from typing import Iterator
from anthropic import AnthropicBedrock

_client: AnthropicBedrock | None = None


def get_client() -> AnthropicBedrock:
    """Singleton AnthropicBedrock client."""
    global _client
    if _client is None:
        _client = AnthropicBedrock(aws_region=os.environ.get("AWS_REGION", "us-east-1"))
    return _client


def get_sonnet_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")


def get_haiku_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID_HAIKU", "us.anthropic.claude-haiku-4-5")


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
