"""
routes/admin.py — Admin-only API endpoints.
All routes require a valid Firebase ID token where isAdmin == true.
"""
from flask import Blueprint, request, jsonify
from datetime import datetime, timezone, timedelta
from backend.firebase_admin_init import get_db, get_auth

admin_bp = Blueprint("admin_api", __name__)


# ── Auth helper ───────────────────────────────────────────────
def _require_admin(req):
    """Returns (uid, None) or (None, (message, status_code))."""
    token = req.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return None, ("Missing Authorization header", 401)

    try:
        decoded = get_auth().verify_id_token(token)
    except Exception as e:
        return None, (f"Invalid token: {e}", 401)

    uid      = decoded["uid"]
    db       = get_db()
    user_doc = db.collection("users").document(uid).get()

    if not user_doc.exists or not user_doc.to_dict().get("isAdmin"):
        return None, ("Admin privileges required", 403)

    return uid, None


# ── POST /api/admin/cancel-listing ───────────────────────────
@admin_bp.route("/api/admin/cancel-listing", methods=["POST"])
def cancel_listing():
    uid, err = _require_admin(request)
    if err:
        return jsonify({"error": err[0]}), err[1]

    body       = request.get_json(silent=True) or {}
    listing_id = body.get("listingId")
    if not listing_id:
        return jsonify({"error": "listingId is required"}), 400

    db  = get_db()
    ref = db.collection("listings").document(listing_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify({"error": "Listing not found"}), 404

    ref.update({"status": "cancelled"})
    return jsonify({"ok": True, "listingId": listing_id})


# ── POST /api/admin/ban-user ─────────────────────────────────
@admin_bp.route("/api/admin/ban-user", methods=["POST"])
def ban_user():
    uid, err = _require_admin(request)
    if err:
        return jsonify({"error": err[0]}), err[1]

    body       = request.get_json(silent=True) or {}
    target_uid = body.get("uid")
    ban        = body.get("ban", True)   # pass ban=false to unban
    if not target_uid:
        return jsonify({"error": "uid is required"}), 400

    db  = get_db()
    ref = db.collection("users").document(target_uid)
    doc = ref.get()
    if not doc.exists:
        return jsonify({"error": "User not found"}), 404

    ref.update({"isBanned": bool(ban)})
    return jsonify({"ok": True, "uid": target_uid, "isBanned": bool(ban)})


# ── POST /api/admin/toggle-killswitch ────────────────────────
@admin_bp.route("/api/admin/toggle-killswitch", methods=["POST"])
def toggle_killswitch():
    uid, err = _require_admin(request)
    if err:
        return jsonify({"error": err[0]}), err[1]

    body    = request.get_json(silent=True) or {}
    active  = body.get("active")          # explicit true/false
    message = body.get("message", "")

    db  = get_db()
    ref = db.collection("siteSettings").document("global")
    doc = ref.get()

    if active is None:
        # Toggle current value
        current = doc.to_dict().get("killSwitchActive", False) if doc.exists else False
        active  = not current

    if doc.exists:
        ref.update({"killSwitchActive": bool(active), "maintenanceMessage": message})
    else:
        ref.set({"killSwitchActive": bool(active), "maintenanceMessage": message})

    return jsonify({"ok": True, "killSwitchActive": bool(active)})
