"""Anthropic Claude via AWS Bedrock — used by the answer agent."""
import os
from anthropic import AnthropicBedrock

_client: AnthropicBedrock | None = None


def get_client() -> AnthropicBedrock:
    """Return a singleton AnthropicBedrock client."""
    global _client
    if _client is None:
        _client = AnthropicBedrock(aws_region=os.environ.get("AWS_REGION", "us-east-1"))
    return _client


def get_sonnet_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")
