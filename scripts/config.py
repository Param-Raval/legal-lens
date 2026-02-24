"""
Configuration module for GPT-4o API access.
Loads environment variables from .env file.
"""

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# GPT-4o Configuration
GPT4O_ENDPOINT = os.getenv("GPT4O_ENDPOINT")
GPT4O_API_KEY = os.getenv("GPT4O_API_KEY")
GPT4O_DEPLOYMENT = os.getenv("GPT4O_DEPLOYMENT")

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
