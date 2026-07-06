from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
import json, os

app = Flask(__name__)
DATA_DIR = "/data"
DOWNLOAD_DIR = "/downloads"
os.makedirs(DATA_DIR, exist_ok=True)


@app.after_request
def add_cors_headers(resp):
    # Die Desktop-App (Tauri/WKWebView, Origin tauri://localhost) holt /api/news
    # per fetch cross-origin. Ohne diese Header verwirft die WebView die Antwort
    # (CORS) und zeigt nur die eingebauten Fallback-News statt des Live-Feeds.
    # Alle Endpunkte hier sind oeffentliche Read-/Enrollment-Routen, daher ist "*"
    # unbedenklich. curl braucht kein CORS - deshalb fiel es beim Testen nie auf.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/news", methods=["OPTIONS"])
@app.route("/api/enrollment", methods=["OPTIONS"])
def cors_preflight():
    # Preflight (falls je ein Client mit Custom-Header/Content-Type-JSON anfragt):
    # leere 204-Antwort, die CORS-Header setzt der after_request-Hook.
    return ("", 204)

@app.route("/api/enrollment", methods=["POST"])
def enrollment():
    data = request.get_json(silent=True) or {}
    data["received_at"] = datetime.utcnow().isoformat()
    data["remote_ip"] = request.remote_addr
    fname = f"{DATA_DIR}/enrollments.json"
    entries = []
    if os.path.exists(fname):
        with open(fname) as f:
            entries = json.load(f)
    entries.append(data)
    with open(fname, "w") as f:
        json.dump(entries, f, indent=2)
    return jsonify({"status": "ok", "message": "Enrollment received"})

@app.route("/api/enrollments", methods=["GET"])
def get_enrollments():
    fname = f"{DATA_DIR}/enrollments.json"
    if os.path.exists(fname):
        with open(fname) as f:
            return jsonify(json.load(f))
    return jsonify([])

@app.route("/api/news", methods=["GET"])
def get_news():
    fname = f"{DATA_DIR}/news.json"
    if os.path.exists(fname):
        with open(fname) as f:
            return jsonify(json.load(f))
    return jsonify({"title": "Willkommen", "message": "NKK Secure Access"})

@app.route("/api/news", methods=["POST"])
def set_news():
    data = request.get_json(silent=True) or {}
    data["updated_at"] = datetime.utcnow().isoformat()
    with open(f"{DATA_DIR}/news.json", "w") as f:
        json.dump(data, f, indent=2)
    return jsonify({"status": "ok"})

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"service": "NKK Secure API", "status": "healthy", "timestamp": datetime.utcnow().isoformat()})

@app.route("/download/<path:filename>", methods=["GET"])
def download(filename):
    return send_from_directory(DOWNLOAD_DIR, filename, as_attachment=True)

@app.route("/download", methods=["GET"])
def download_list():
    if not os.path.exists(DOWNLOAD_DIR):
        return jsonify({"files": []})
    files = [f for f in os.listdir(DOWNLOAD_DIR) if not f.startswith('.')]
    return jsonify({"files": files})

@app.route("/")
def index():
    return "NKK Secure Access API"