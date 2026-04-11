#!/usr/bin/env python3
"""
NKK Secure Access — Enrollment Webhook Receiver

Empfängt POST Requests mit Enrollment Diagnostics von NKK Clients
und speichert sie als JSON Dateien. Läuft auf dem MultiVM Host.

Setup:
  pip3 install flask
  python3 enrollment-receiver.py

Oder als systemd Service:
  sudo cp enrollment-receiver.service /etc/systemd/system/
  sudo systemctl enable --now enrollment-receiver

Port: 9876 (änderbar unten)
Speichert unter: /opt/kronsolutions/enrollments/
"""

from flask import Flask, request, jsonify
from datetime import datetime
import json
import os

app = Flask(__name__)

SAVE_DIR = "/opt/kronsolutions/enrollments"
PORT = 9876

os.makedirs(SAVE_DIR, exist_ok=True)


@app.route("/enrollment", methods=["POST"])
def receive_enrollment():
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "invalid json"}), 400

    # Dateiname: hostname_timestamp.json
    hostname = data.get("hostname", "unknown").replace(" ", "_").replace("/", "_")
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{hostname}_{ts}.json"
    filepath = os.path.join(SAVE_DIR, filename)

    # Speichern
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"[{ts}] Enrollment von {data.get('os_user', '?')}@{hostname} gespeichert → {filename}")

    return jsonify({"status": "ok", "file": filename}), 200


@app.route("/enrollments", methods=["GET"])
def list_enrollments():
    """Alle gespeicherten Enrollments als JSON Liste abrufen."""
    files = sorted(os.listdir(SAVE_DIR), reverse=True)
    enrollments = []
    for f in files[:50]:  # letzte 50
        try:
            with open(os.path.join(SAVE_DIR, f)) as fh:
                enrollments.append(json.load(fh))
        except Exception:
            pass
    return jsonify(enrollments), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "enrollments": len(os.listdir(SAVE_DIR))}), 200


if __name__ == "__main__":
    print(f"NKK Enrollment Receiver läuft auf Port {PORT}")
    print(f"Speichert nach: {SAVE_DIR}")
    print(f"POST → http://0.0.0.0:{PORT}/enrollment")
    print(f"GET  → http://0.0.0.0:{PORT}/enrollments")
    app.run(host="0.0.0.0", port=PORT)
