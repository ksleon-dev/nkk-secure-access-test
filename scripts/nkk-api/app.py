from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
import json, os, re, time, urllib.request

app = Flask(__name__)
DATA_DIR = "/data"
DOWNLOAD_DIR = "/downloads"
os.makedirs(DATA_DIR, exist_ok=True)

# Aktivitaets-/Zugriffsprotokoll: append-only JSON-Lines. Eine Zeile je RDP-/SMB-/
# SSH-Start (die App POSTet nach bestandener Allowlist). Bei Ueberlauf rotiert die
# Datei einmal (.1), so bleibt der Plattenbedarf auf ~2x Cap begrenzt.
ACTIVITY_FILE = f"{DATA_DIR}/activity.jsonl"
ACTIVITY_MAX_BYTES = 8 * 1024 * 1024
_ACTIVITY_KINDS = {"rdp", "smb", "ssh", "url", "connect", "disconnect"}


def _clip(v, n):
    # Fremdeingabe begrenzen: nie None, nie Riesen-Strings ins Log (Speicher-/Injektions-Schutz).
    return ("" if v is None else str(v))[:n]


# Update-Log: die App holt den Changelog HIER (synced), damit er nicht in der App
# eingebacken ist. Quelle = das repo-CHANGELOG.md auf GitHub (release.sh pflegt es bei
# JEDEM Release), daher immer aktuell ohne Handarbeit. Kurzer In-Memory-Cache, damit
# nicht jeder App-Start GitHub trifft. Fallback: lokale Kopie unter /data.
CHANGELOG_URL = "https://raw.githubusercontent.com/ksleon-dev/nkk-secure-access-test/main/CHANGELOG.md"
CHANGELOG_FALLBACK = f"{DATA_DIR}/changelog.md"
CHANGELOG_TTL = 600  # 10 Min
_changelog_cache = {"at": 0.0, "data": None}


def _parse_changelog(raw, limit=20):
    # "## [x.y.z] - datum" -> {version, date, notes:[...]}. [Unreleased]/leere Blocks raus.
    out = []
    ms = list(re.finditer(r"^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$", raw, re.M))
    for i, m in enumerate(ms):
        ver = (m.group(1) or "").strip()
        if ver.lower() == "unreleased":
            continue
        start = m.end()
        end = ms[i + 1].start() if i + 1 < len(ms) else len(raw)
        notes = [ln.strip()[2:].strip() for ln in raw[start:end].splitlines() if ln.strip().startswith("- ")]
        if notes:
            out.append({"version": ver, "date": (m.group(2) or "").strip(), "notes": notes})
        if len(out) >= limit:
            break
    return out


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
    # News (und alle /api-Antworten) NIE cachen: sonst zeigt die App-WebView nach
    # einer Panel-Aenderung die alte gecachte Version -> "Panel und App driften".
    # No-store macht jede Panel-News sofort in der App sichtbar, fuer JEDE App-Version.
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
    return resp


@app.route("/api/news", methods=["OPTIONS"])
@app.route("/api/enrollment", methods=["OPTIONS"])
@app.route("/api/activity", methods=["OPTIONS"])
@app.route("/api/changelog", methods=["OPTIONS"])
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

@app.route("/api/activity", methods=["POST"])
def activity():
    # Ingest fuer das Zugriffsprotokoll. Bewusst OHNE oeffentlichen GET - die
    # Auswertung laeuft ausschliesslich ueber das admin-gated Panel (server.py liest
    # dieselbe Datei). Maszgeblich ist die SERVER-Zeit; unbekannte Typen werden leise
    # verworfen. Ein Fehler hier darf den Client nie stoeren -> immer 200.
    data = request.get_json(silent=True) or {}
    kind = _clip(data.get("kind"), 16)
    if kind not in _ACTIVITY_KINDS:
        return jsonify({"status": "ignored"})
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "kind": kind,
        "target": _clip(data.get("target"), 128),
        "label": _clip(data.get("label"), 128),
        "hostname": _clip(data.get("hostname"), 128),
        "os_user": _clip(data.get("os_user"), 128),
        "os_name": _clip(data.get("os_name"), 32),
        "role": _clip(data.get("role"), 32),
        "local_ip": _clip(data.get("local_ip"), 64),
        "version": _clip(data.get("version"), 32),
        "client_ts": _clip(data.get("timestamp"), 40),
        # Nur die echte Peer-Adresse (kein X-Forwarded-For): dieser oeffentliche Endpunkt
        # hat keinen vertrauenswuerdigen Proxy, der XFF setzt, ein Client koennte XFF sonst
        # frei faelschen. src ist ohnehin nur informativ (Identitaet = Peer-Korrelation im Panel).
        "src": _clip(request.remote_addr, 64),
    }
    try:
        if os.path.exists(ACTIVITY_FILE) and os.path.getsize(ACTIVITY_FILE) > ACTIVITY_MAX_BYTES:
            os.replace(ACTIVITY_FILE, ACTIVITY_FILE + ".1")
        # append + O_APPEND: eine Zeile < 4 KiB ist auf POSIX prozess-atomar -> kein
        # Verschachteln bei parallelen Requests.
        with open(ACTIVITY_FILE, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return jsonify({"status": "ok"})


@app.route("/api/changelog", methods=["GET"])
def changelog():
    # Immer aktueller Update-Log fuer die App (per Version). Quelle GitHub-CHANGELOG.md
    # (release.sh pflegt es je Release), kurz gecacht; bei GitHub-Ausfall lokale Kopie
    # bzw. letzter Cache-Stand. no-store/CORS setzt der after_request-Hook.
    now = time.time()
    if _changelog_cache["data"] is not None and (now - _changelog_cache["at"]) < CHANGELOG_TTL:
        return jsonify(_changelog_cache["data"])
    raw = None
    try:
        with urllib.request.urlopen(CHANGELOG_URL, timeout=8) as r:
            raw = r.read().decode("utf-8", "replace")
    except Exception:
        try:
            with open(CHANGELOG_FALLBACK) as f:
                raw = f.read()
        except Exception:
            raw = None
    if raw is None:
        return jsonify(_changelog_cache["data"] or [])
    data = _parse_changelog(raw)
    # Leeres Ergebnis (transiente GitHub-Statusseite / nur [Unreleased] / leerer Body)
    # NICHT als frischen Cache setzen - sonst liefert der Worker bis zum TTL weiter []
    # und der Update-Verlauf verschwindet, obwohl die Quelle laengst wieder ok ist.
    # Stattdessen letzten guten Stand liefern; der naechste Request versucht GitHub erneut.
    if data:
        _changelog_cache["at"] = now
        _changelog_cache["data"] = data
        return jsonify(data)
    return jsonify(_changelog_cache["data"] or data)


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