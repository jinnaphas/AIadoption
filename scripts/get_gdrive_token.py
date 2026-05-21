#!/usr/bin/env python3
"""
One-time script to get Google Drive OAuth token.
Run locally: python scripts/get_gdrive_token.py
Then copy the printed JSON into GitHub Secret: GDRIVE_TOKEN_JSON
"""
import json
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Paste your OAuth 2.0 client credentials here
# (from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs)
CLIENT_CONFIG = {
    "installed": {
        "client_id": "PASTE_YOUR_CLIENT_ID_HERE",
        "client_secret": "PASTE_YOUR_CLIENT_SECRET_HERE",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

flow = InstalledAppFlow.from_client_config(CLIENT_CONFIG, SCOPES)
creds = flow.run_local_server(port=0)

token_data = {
    "token": creds.token,
    "refresh_token": creds.refresh_token,
    "client_id": creds.client_id,
    "client_secret": creds.client_secret,
    "token_uri": creds.token_uri,
}

print("\n✅ Copy this JSON into GitHub Secret → GDRIVE_TOKEN_JSON:\n")
print(json.dumps(token_data, indent=2))
