"""
routes/auctions.py
  POST /api/process-expired-auctions  — mark ended auctions, create message threads
  POST /api/place-bid                 — server-side bid validation (optional double-check)
"""
from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from google.cloud.firestore_v1 import ArrayUnion, SERVER_TIMESTAMP
from backend.firebase_admin_init import get_db, get_auth

auctions_bp = Blueprint("auctions", __name__)


# ── Helper: verify a Firebase ID token ────────────────────────
def _verify_token(req):
    token = req.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return None, ("Missing Authorization header", 401)
    try:
        decoded = get_auth().verify_id_token(token)
        return decoded, None
    except Exception as e:
        return None, (f"Invalid token: {e}", 401)


# ── POST /api/process-expired-auctions ────────────────────────
@auctions_bp.route("/api/process-expired-auctions", methods=["POST"])
def process_expired_auctions():
    db  = get_db()
    now = datetime.now(timezone.utc)

    listings_ref = db.collection("listings")
    expired = listings_ref \
        .where("status", "==", "active") \
        .where("endTime", "<", now) \
        .stream()

    processed = 0
    for doc in expired:
        data = doc.to_dict()
        listing_id = doc.id

        # Mark as ended
        doc.reference.update({"status": "ended"})

        # Create a buyer↔seller message thread if there's a winner
        winner_uid  = data.get("currentBidderUid")
        seller_uid  = data.get("sellerId")
        winner_name = data.get("currentBidderName", "Buyer")
        seller_name = data.get("sellerName", "Seller")
        title       = data.get("title", "Item")
        winning_bid = data.get("currentBid", 0)

        if winner_uid and seller_uid and winner_uid != seller_uid:
            # Check if thread already exists
            existing = db.collection("messages") \
                .where("listingId", "==", listing_id) \
                .limit(1).stream()

            if not any(True for _ in existing):
                db.collection("messages").add({
                    "participants":  [seller_uid, winner_uid],
                    "listingId":     listing_id,
                    "listingTitle":  title,
                    "otherNames": {
                        seller_uid: seller_name,
                        winner_uid: winner_name,
                    },
                    "messages": [{
                        "senderUid":  "system",
                        "senderName": "HMSBay",
                        "text": (
                            f"🏆 Congratulations! {winner_name} won \"{title}\" "
                            f"with a bid of ${winning_bid:.2f}. "
                            f"Use this chat to arrange collection."
                        ),
                        "timestamp": now,
                    }],
                    "createdAt": SERVER_TIMESTAMP,
                })

        processed += 1

    return jsonify({"ok": True, "processed": processed})


# ── POST /api/place-bid ────────────────────────────────────────
@auctions_bp.route("/api/place-bid", methods=["POST"])
def place_bid():
    decoded, err = _verify_token(request)
    if err:
        return jsonify({"error": err[0]}), err[1]

    uid  = decoded["uid"]
    body = request.get_json(silent=True) or {}
    listing_id = body.get("listingId")
    amount     = body.get("amount")

    if not listing_id or amount is None:
        return jsonify({"error": "listingId and amount are required"}), 400

    try:
        amount = float(amount)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid amount"}), 400

    db = get_db()

    # Fetch user doc — check banned
    user_doc = db.collection("users").document(uid).get()
    if not user_doc.exists or user_doc.to_dict().get("isBanned"):
        return jsonify({"error": "Account is banned"}), 403

    # Fetch listing
    listing_ref = db.collection("listings").document(listing_id)
    listing_doc = listing_ref.get()
    if not listing_doc.exists:
        return jsonify({"error": "Listing not found"}), 404

    data = listing_doc.to_dict()

    if data.get("status") != "active":
        return jsonify({"error": "Auction is not active"}), 400

    end_time = data.get("endTime")
    if end_time and end_time.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return jsonify({"error": "Auction has ended"}), 400

    if data.get("sellerId") == uid:
        return jsonify({"error": "Sellers cannot bid on their own listings"}), 400

    current = data.get("currentBid") or data.get("startingPrice") or 0
    min_bid = round(current + 0.25, 2)
    if amount < min_bid:
        return jsonify({"error": f"Bid must be at least ${min_bid:.2f}"}), 400

    # Write bid
    user_name = decoded.get("name") or user_doc.to_dict().get("displayName") or uid
    from google.cloud.firestore_v1 import ArrayUnion
    from datetime import datetime as dt

    bid_entry = {
        "bidderUid":  uid,
        "bidderName": user_name,
        "amount":     amount,
        "timestamp":  datetime.now(timezone.utc),
    }

    listing_ref.update({
        "currentBid":        amount,
        "currentBidderUid":  uid,
        "currentBidderName": user_name,
        "bids":              ArrayUnion([bid_entry]),
    })

    return jsonify({"ok": True, "newBid": amount})
