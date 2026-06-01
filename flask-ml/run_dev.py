"""Simple developer runner for the Flask app.

Run this to start the Flask app on 0.0.0.0:5000 (accessible via localhost).
It loads `.env` (if present) via `python-dotenv` — ensure your env values are set.
"""
import os
from dotenv import load_dotenv

# Load environment variables before importing app
load_dotenv()

# Import app after env is loaded
from app import app

if __name__ == '__main__':
    # Use 0.0.0.0 so the port is reachable from the host machine
    host = os.getenv('FLASK_RUN_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_RUN_PORT', 5000))
    # Run without debug to avoid Flask's internal dotenv issues
    app.run(host=host, port=port, debug=False)
