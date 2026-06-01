"""
Minimal dotenv shim to satisfy `from dotenv import load_dotenv` in the app.

This only supports loading simple `KEY=VALUE` lines from a `.env` file
located relative to the repository root. It's intentionally small and safe
for development only.
"""
from __future__ import annotations

import os
from typing import Optional


def load_dotenv(dotenv_path: Optional[str] = None, override: bool = False) -> bool:
    """Load key/value pairs from a .env file into the environment.

    Parameters
    - dotenv_path: optional path to the .env file (defaults to './flask-ml/.env' if present)
    - override: if True, existing environment variables will be overwritten
    """
    candidates = []
    if dotenv_path:
        candidates.append(dotenv_path)
    # prefer flask-ml/.env when present, otherwise root .env
    if os.path.exists(os.path.join(os.getcwd(), 'flask-ml', '.env')):
        candidates.append(os.path.join(os.getcwd(), 'flask-ml', '.env'))
    candidates.append(os.path.join(os.getcwd(), '.env'))

    for path in candidates:
        if not path or not os.path.exists(path):
            continue
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' not in line:
                        continue
                    key, val = line.split('=', 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if override or key not in os.environ:
                        os.environ[key] = val
            return True
        except Exception:
            continue
    return False
