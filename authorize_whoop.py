#!/usr/bin/env python3
"""
authorize_whoop.py — One-time OAuth dance to capture a WHOOP refresh_token.

Run this once on your laptop. It opens the WHOOP authorization page, you
approve, and it writes WHOOP_REFRESH_TOKEN to .env. From then on, sync_whoop.py
uses the refresh token to mint fresh access tokens automatically.

Usage:
    python3 authorize_whoop.py

Requires:
    pip install python-dotenv
    Port 8080 free (matches WHOOP_REDIRECT_URI).
"""

import http.server
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

CLIENT_ID = os.getenv("WHOOP_CLIENT_ID")
CLIENT_SECRET = os.getenv("WHOOP_CLIENT_SECRET")
REDIRECT_URI = os.getenv("WHOOP_REDIRECT_URI", "http://localhost:8080/callback")

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
SCOPES = "read:recovery read:sleep read:workout read:cycles read:profile offline"

STATE = secrets.token_urlsafe(16)
RESULT = {}


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != urllib.parse.urlparse(REDIRECT_URI).path:
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        RESULT["code"] = params.get("code", [None])[0]
        RESULT["state"] = params.get("state", [None])[0]
        RESULT["error"] = params.get("error", [None])[0]

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if RESULT["error"]:
            self.wfile.write(b"<h1>WHOOP authorization failed.</h1>"
                             b"<p>Check the terminal. You can close this tab.</p>")
        else:
            self.wfile.write(b"<h1>WHOOP authorized.</h1>"
                             b"<p>You can close this tab and return to the terminal.</p>")

    def log_message(self, *args, **kwargs):
        return  # silence default request logging


def exchange_code_for_tokens(code: str) -> dict:
    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "Calibex/1.0 (+python)")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"\nToken exchange HTTP {e.code} {e.reason}", file=sys.stderr)
        print(f"WHOOP response body: {body}", file=sys.stderr)
        raise


def write_refresh_token(refresh_token: str):
    env_path = Path(".env")
    existing = env_path.read_text().splitlines() if env_path.exists() else []
    out = []
    replaced = False
    for line in existing:
        if line.startswith("WHOOP_REFRESH_TOKEN="):
            out.append(f"WHOOP_REFRESH_TOKEN={refresh_token}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"WHOOP_REFRESH_TOKEN={refresh_token}")
    env_path.write_text("\n".join(out) + "\n")


def main():
    if not CLIENT_ID or not CLIENT_SECRET:
        print("Error: WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set in .env",
              file=sys.stderr)
        sys.exit(1)

    host = urllib.parse.urlparse(REDIRECT_URI).hostname or "127.0.0.1"
    port = urllib.parse.urlparse(REDIRECT_URI).port or 8080

    server = http.server.HTTPServer((host, port), CallbackHandler)

    params = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": STATE,
    })
    auth_url = f"{AUTH_URL}?{params}"

    print(f"Listening for WHOOP callback on {REDIRECT_URI}")
    print("Opening browser for WHOOP authorization...")
    print(f"If the browser doesn't open, paste this URL manually:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    server.handle_request()  # blocks until one request is served, then returns

    if RESULT.get("error"):
        print(f"Authorization failed: {RESULT['error']}", file=sys.stderr)
        sys.exit(1)

    if RESULT.get("state") != STATE:
        print("State mismatch — possible CSRF. Aborting.", file=sys.stderr)
        sys.exit(1)

    if not RESULT.get("code"):
        print("No authorization code returned. Aborting.", file=sys.stderr)
        sys.exit(1)

    print("Got authorization code. Exchanging for tokens...")
    tokens = exchange_code_for_tokens(RESULT["code"])

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    expires_in = tokens.get("expires_in")

    if not refresh_token:
        print("No refresh_token in response. Ensure 'offline' scope is granted.",
              file=sys.stderr)
        print(json.dumps(tokens, indent=2), file=sys.stderr)
        sys.exit(1)

    write_refresh_token(refresh_token)
    print(f"\nRefresh token saved to .env (WHOOP_REFRESH_TOKEN)")
    print(f"Access token valid for {expires_in}s (sanity check: "
          f"{access_token[:12]}...).")
    print("\nDone. You can now run sync_whoop.py whenever you want fresh data.")


if __name__ == "__main__":
    main()
