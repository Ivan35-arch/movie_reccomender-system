"""
Minimal dotenv shim for the Flask app directory.

This mirrors a tiny subset of python-dotenv's `load_dotenv` behavior
so the project can run in development without installing the dependency.
"""
from __future__ import annotations

import os
from typing import Optional


def load_dotenv(dotenv_path: Optional[str] = None, override: bool = False) -> bool:
    candidates = []
    if dotenv_path:
        candidates.append(dotenv_path)
    candidates.append(os.path.join(os.getcwd(), '.env'))
    candidates.append(os.path.join(os.getcwd(), 'flask-ml', '.env'))

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
