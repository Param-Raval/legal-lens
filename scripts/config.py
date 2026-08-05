"""
Configuration helpers for GPT-4o and Azure demo scripts.
Loads environment variables from .env file.
"""

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def _env(name: str, default: str | None = None) -> str | None:
    """Read env var and normalize quotes/whitespace for .env inconsistencies."""
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().strip('"').strip("'")
    return value or default

# GPT-4o Configuration
GPT4O_ENDPOINT = _env("GPT4O_ENDPOINT")
GPT4O_API_KEY = _env("GPT4O_API_KEY")
GPT4O_DEPLOYMENT = _env("GPT4O_DEPLOYMENT")

# Azure Document Intelligence + Translation (demo script)
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = _env("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
AZURE_DOCUMENT_INTELLIGENCE_KEY = _env("AZURE_DOCUMENT_INTELLIGENCE_KEY")

AZURE_DOCUMENT_TRANSLATION_ENDPOINT = _env("AZURE_DOCUMENT_TRANSLATION_ENDPOINT")
AZURE_DOCUMENT_TRANSLATION_KEY = _env("AZURE_DOCUMENT_TRANSLATION_KEY")

AZURE_TRANSLATOR_TEXT_ENDPOINT = _env("AZURE_TRANSLATOR_TEXT_ENDPOINT")
AZURE_TRANSLATOR_TEXT_KEY = _env("AZURE_TRANSLATOR_TEXT_KEY")
AZURE_TRANSLATOR_TEXT_REGION = _env("AZURE_TRANSLATOR_TEXT_REGION")
AZURE_VISION_LOCATION = _env("AZURE_VISION_LOCATION")

# Optional storage config for document translation async jobs
AZURE_STORAGE_CONNECTION_STRING = _env("AZURE_STORAGE_CONNECTION_STRING")
AZURE_DOC_TRANSLATION_SOURCE_CONTAINER = _env("AZURE_DOC_TRANSLATION_SOURCE_CONTAINER")
AZURE_DOC_TRANSLATION_TARGET_CONTAINER = _env("AZURE_DOC_TRANSLATION_TARGET_CONTAINER")
AZURE_DOCUMENT_TRANSLATION_SOURCE_SAS_URL = _env("AZURE_DOCUMENT_TRANSLATION_SOURCE_SAS_URL")
AZURE_DOCUMENT_TRANSLATION_TARGET_SAS_URL = _env("AZURE_DOCUMENT_TRANSLATION_TARGET_SAS_URL")

# Validate configuration
def validate_config():
    """Check that all required environment variables are set."""
    missing = []
    if not GPT4O_ENDPOINT:
        missing.append("GPT4O_ENDPOINT")
    if not GPT4O_API_KEY:
        missing.append("GPT4O_API_KEY")
    if not GPT4O_DEPLOYMENT:
        missing.append("GPT4O_DEPLOYMENT")
    
    if missing:
        raise EnvironmentError(f"Missing required environment variables: {', '.join(missing)}")
    
    return True


def validate_azure_demo_config():
    """
    Validate required env vars for the Azure demo script.
    This checks DI and translation credentials. Storage requirements are checked
    separately because the script can still run partial tests without them.
    """
    missing = []
    if not AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
        missing.append("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    if not AZURE_DOCUMENT_INTELLIGENCE_KEY:
        missing.append("AZURE_DOCUMENT_INTELLIGENCE_KEY")
    if not AZURE_DOCUMENT_TRANSLATION_ENDPOINT:
        missing.append("AZURE_DOCUMENT_TRANSLATION_ENDPOINT")
    if not AZURE_DOCUMENT_TRANSLATION_KEY:
        missing.append("AZURE_DOCUMENT_TRANSLATION_KEY")
    if not AZURE_TRANSLATOR_TEXT_ENDPOINT:
        missing.append("AZURE_TRANSLATOR_TEXT_ENDPOINT")
    if not AZURE_TRANSLATOR_TEXT_KEY:
        missing.append("AZURE_TRANSLATOR_TEXT_KEY")

    if missing:
        raise EnvironmentError(
            f"Missing required Azure demo environment variables: {', '.join(missing)}"
        )

    return True
