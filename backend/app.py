"""
backend/app.py — Flask entry point.

Run from the hmsbay/ directory:
    cd hmsbay
    python -m backend.app

Or from backend/:
    python app.py   (adjust imports accordingly)

Serves the frontend static files AND the /api/* endpoints.
"""
import os
import sys

# Make sure the project root (hmsbay/) is on sys.path so
# "from backend.xxx import ..." works when run from any CWD.
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(os.path.join(ROOT_DIR, ".env"))

# ── App setup ────────────────────────────────────────────────
app = Flask(
    __name__,
    static_folder=ROOT_DIR,   # serve hmsbay/ as root
    static_url_path=""
)
CORS(app, origins="*")        # tighten this in production

# ── Register API blueprints ───────────────────────────────────
from backend.routes.auctions import auctions_bp
from backend.routes.admin    import admin_bp

app.register_blueprint(auctions_bp)
app.register_blueprint(admin_bp)

# ── Serve frontend HTML pages ─────────────────────────────────
HTML_PAGES = [
    "/",
    "/index.html",
    "/listing.html",
    "/create-listing.html",
    "/profile.html",
    "/messages.html",
    "/admin/dashboard.html",
]

@app.route("/")
def index():
    return send_from_directory(ROOT_DIR, "index.html")

@app.route("/<path:path>")
def static_files(path):
    # Don't intercept /api/ routes (handled by blueprints above)
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    full = os.path.join(ROOT_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(ROOT_DIR, path)
    # SPA fallback — serve index.html for unknown paths
    return send_from_directory(ROOT_DIR, "index.html")

# ── Health check ──────────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})

# ── Dev server ────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    print(f"\n🚀  HMSBay running at http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)
