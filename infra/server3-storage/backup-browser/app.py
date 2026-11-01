#!/usr/bin/env python3
"""Source Easy backup browser (server 3).

Lists dumps with timestamps and sizes to admins. Download links are rendered
ONLY for the super admin, and the /download endpoint enforces the same rule
server-side. There is deliberately no restore button (restore is CLI-only).

Auth: HTTP Basic over TLS (put Caddy/nginx in front). Users live in a JSON
file of {"username": {"role": "...", "hash": "pbkdf2_sha256$iter$salt$hex"}}.
Create entries with:  python3 app.py hash-password
Stdlib only, no dependencies.
"""
import base64, getpass, hashlib, hmac, html, json, os, secrets, sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BACKUP_ROOT = os.environ.get("BACKUP_ROOT", "/srv/backups")
USERS_FILE = os.environ.get("USERS_FILE", "/etc/source-easy/backup-users.json")
ADMIN_ROLES = {"super_admin", "india_admin", "china_admin"}
SUPER = "super_admin"


def hash_password(pw, salt=None, iters=260000):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), iters)
    return f"pbkdf2_sha256${iters}${salt}${dk.hex()}"


def verify(pw, stored):
    try:
        _, iters, salt, _h = stored.split("$")
        return hmac.compare_digest(hash_password(pw, salt, int(iters)), stored)
    except ValueError:
        return False


def load_users():
    with open(USERS_FILE) as f:
        return json.load(f)


def list_backups(root=BACKUP_ROOT):
    out = []
    for tier in ("daily", "weekly"):
        tdir = os.path.join(root, tier)
        if not os.path.isdir(tdir):
            continue
        for app in sorted(os.listdir(tdir)):
            adir = os.path.join(tdir, app)
            if not os.path.isdir(adir):
                continue
            for name in os.listdir(adir):
                if not name.endswith(".sql.gz"):
                    continue
                st = os.stat(os.path.join(adir, name))
                out.append({"tier": tier, "app": app, "name": name,
                            "rel": f"{tier}/{app}/{name}", "size": st.st_size,
                            "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc)})
    out.sort(key=lambda b: b["mtime"], reverse=True)
    return out


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def render(user, role, backups):
    is_super = role == SUPER
    rows = []
    for b in backups:
        link = (f'<a href="/download?f={html.escape(b["rel"])}">Download</a>'
                if is_super else "")
        rows.append(f"<tr><td>{b['app']}</td><td>{b['tier']}</td><td>{html.escape(b['name'])}</td>"
                    f"<td>{b['mtime']:%Y-%m-%d %H:%M} UTC</td><td>{human(b['size'])}</td>"
                    + (f"<td>{link}</td>" if is_super else "") + "</tr>")
    head = "<th>App</th><th>Tier</th><th>File</th><th>Taken</th><th>Size</th>" + ("<th></th>" if is_super else "")
    note = "" if is_super else "<p class=n>Downloads are available to the super admin only.</p>"
    return f"""<!doctype html><html><head><meta charset=utf-8><title>Source Easy backups</title>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>body{{font-family:system-ui;margin:2rem;color:#1b1b1f}}table{{border-collapse:collapse;width:100%}}
td,th{{padding:.4rem .6rem;border-bottom:1px solid #ddd;text-align:left}}.n{{color:#666}}</style></head>
<body><h1>Source Easy backups</h1><p>Signed in as {html.escape(user)} ({role}). Restores are CLI-only.</p>{note}
<table><thead><tr>{head}</tr></thead><tbody>{''.join(rows) or '<tr><td colspan=6>No backups yet</td></tr>'}</tbody></table></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "SourceEasyBackups/1"

    def _auth(self):
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                u, p = base64.b64decode(h[6:]).decode().split(":", 1)
                rec = load_users().get(u)
                if rec and verify(p, rec["hash"]):
                    return u, rec["role"]
            except Exception:
                pass
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Source Easy backups"')
        self.end_headers()
        return None, None

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/healthz":
            return self._send(200, "ok", "text/plain")
        user, role = self._auth()
        if not user:
            return
        if role not in ADMIN_ROLES:
            return self._send(403, "Admins only")
        if url.path == "/":
            return self._send(200, render(user, role, list_backups()))
        if url.path == "/download":
            if role != SUPER:
                return self._send(403, "Super admin only")
            rel = parse_qs(url.query).get("f", [""])[0]
            valid = {b["rel"] for b in list_backups()}
            if rel not in valid:  # whitelist prevents path traversal
                return self._send(404, "Not found")
            path = os.path.join(BACKUP_ROOT, rel)
            self.send_response(200)
            self.send_header("Content-Type", "application/gzip")
            self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(rel)}"')
            self.send_header("Content-Length", str(os.path.getsize(path)))
            self.end_headers()
            with open(path, "rb") as f:
                while chunk := f.read(1 << 16):
                    self.wfile.write(chunk)
            return
        self._send(404, "Not found")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "hash-password":
        print(hash_password(getpass.getpass("Password: ")))
        return
    port = int(os.environ.get("PORT", "8088"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"backup browser on {host}:{port}, root={BACKUP_ROOT}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
