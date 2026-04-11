#!/usr/bin/env python3
"""
NKK Secure Access — API Server

Läuft als Docker Container auf der NetBird Debian 12 VM.
Zwei Aufgaben:
  1. Enrollment Reports empfangen (POST /api/enrollment)
  2. News JSON ausliefern (GET /api/news)

Daten werden persistent unter /data gespeichert (Docker Volume).
"""

from flask import Flask, request, jsonify, send_file
from datetime import datetime
import json
import os

app = Flask(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
ENROLLMENTS_DIR = os.path.join(DATA_DIR, "enrollments")
NEWS_FILE = os.path.join(DATA_DIR, "news.json")

os.makedirs(ENROLLMENTS_DIR, exist_ok=True)

# Default News falls noch keine Datei existiert
DEFAULT_NEWS = [
    {
        "id": "welcome",
        "date": "11. April 2026",
        "type": "announcement",
        "title": "Willkommen bei NKK Secure Access!",
        "body": "Euer neuer VPN Client ist da. Terminalserver Button klicken und arbeiten."
    }
]

if not os.path.exists(NEWS_FILE):
    with open(NEWS_FILE, "w") as f:
        json.dump(DEFAULT_NEWS, f, indent=2, ensure_ascii=False)


# ── Enrollment ──────────────────────────────────────────────

@app.route("/api/enrollment", methods=["POST"])
def receive_enrollment():
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "invalid json"}), 400

    hostname = data.get("hostname", "unknown").replace(" ", "_").replace("/", "_")[:50]
    os_user = data.get("os_user", "unknown")[:50]
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{hostname}_{os_user}_{ts}.json"
    filepath = os.path.join(ENROLLMENTS_DIR, filename)

    data["_received_at"] = datetime.utcnow().isoformat()
    data["_filename"] = filename

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"[ENROLLMENT] {os_user}@{hostname} → {filename}")
    return jsonify({"status": "ok", "file": filename}), 200


@app.route("/api/enrollments", methods=["GET"])
def list_enrollments():
    """Alle Enrollments als JSON Liste (letzte 100)."""
    files = sorted(os.listdir(ENROLLMENTS_DIR), reverse=True)[:100]
    result = []
    for f in files:
        try:
            with open(os.path.join(ENROLLMENTS_DIR, f)) as fh:
                result.append(json.load(fh))
        except Exception:
            pass
    return jsonify(result), 200


# ── News ────────────────────────────────────────────────────

@app.route("/api/news", methods=["GET"])
def get_news():
    """News JSON für die Clients ausliefern."""
    if os.path.exists(NEWS_FILE):
        return send_file(NEWS_FILE, mimetype="application/json")
    return jsonify(DEFAULT_NEWS), 200


@app.route("/api/news", methods=["POST"])
def update_news():
    """News JSON direkt aktualisieren (für Admin)."""
    try:
        data = request.get_json(force=True)
        if not isinstance(data, list):
            return jsonify({"error": "must be array"}), 400
    except Exception:
        return jsonify({"error": "invalid json"}), 400

    with open(NEWS_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"[NEWS] Updated with {len(data)} entries")
    return jsonify({"status": "ok", "entries": len(data)}), 200


# ── Health ──────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    enrollment_count = len(os.listdir(ENROLLMENTS_DIR))
    return jsonify({
        "status": "ok",
        "enrollments": enrollment_count,
        "news_exists": os.path.exists(NEWS_FILE),
    }), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 9876))
    print(f"NKK API Server auf Port {port}")
    print(f"  POST /api/enrollment  — Report empfangen")
    print(f"  GET  /api/enrollments — Alle Reports listen")
    print(f"  GET  /api/news        — News JSON ausliefern")
    print(f"  POST /api/news        — News JSON updaten")
    print(f"  GET  /api/health      — Status")
    print(f"  Data: {DATA_DIR}")
    app.run(host="0.0.0.0", port=port)
