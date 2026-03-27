"""
firebase_admin_init.py — Initialize Firebase Admin SDK once.
Set GOOGLE_APPLICATION_CREDENTIALS in your .env file to point to
your service-account JSON, OR pass the credentials dict directly.
"""
import os
import firebase_admin
from firebase_admin import credentials, firestore, auth as admin_auth

_initialized = False


def get_db():
    _ensure_initialized()
    return firestore.client()


def get_auth():
    _ensure_initialized()
    return admin_auth


def _ensure_initialized():
    global _initialized
    if _initialized:
        return

    cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
    else:
        # Fallback: use application default credentials (e.g. Cloud Run / GCE)
        cred = credentials.ApplicationDefault()

    firebase_admin.initialize_app(cred, {
        "projectId": os.getenv("FIREBASE_PROJECT_ID", "sparksites-hmsbbay"),
    })
    _initialized = True
