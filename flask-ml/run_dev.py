"""Simple developer runner for the Flask app.

Run this to start the Flask app on 0.0.0.0:5000 (accessible via localhost).
It loads `.env` (if present) via `python-dotenv` — ensure your env values are set.
"""
from dotenv import load_dotenv
import os

load_dotenv()

from app import app

if __name__ == '__main__':
    # Use 0.0.0.0 so the port is reachable from the host machine
    host = os.getenv('FLASK_RUN_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_RUN_PORT', 5000))
    debug = bool(int(os.getenv('FLASK_DEBUG', '1')))
    app.run(host=host, port=port, debug=debug)
