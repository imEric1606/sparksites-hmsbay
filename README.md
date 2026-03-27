# HMSBay — School Auction Website

An eBay-style auction platform for schools, built with vanilla JS + Firebase + Python/Flask.

---

## Quick Start

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → your project.
2. **Firestore**: Create database in production mode, then deploy `firestore.rules`:
   ```
   firebase deploy --only firestore:rules
   ```
3. **Authentication**: Enable **Email/Password** sign-in method.
4. **Storage**: Enable Firebase Storage (default rules are fine to start).
5. **First admin user**: After registering on the site, manually set `isAdmin: true` on your user document in Firestore console → `users/{uid}`.

---

### 2. Frontend (Firebase credentials are already set)

Open `firebase-config.js` in the project root — credentials are already filled in.

To customise branding, edit **`config.js`** only:
```js
const SITE_CONFIG = {
  name:         "HMSBay",
  tagline:      "Your School Marketplace",
  primaryColor: "#003087",
  accentColor:  "#F5AF02",
  contactEmail: "admin@hmsbay.com",
};
```
Every page reads from this file — no other changes needed.

---

### 3. Python Backend

```bash
cd hmsbay/backend
pip install -r requirements.txt
```

Create a `.env` file in `hmsbay/`:
```
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
FIREBASE_PROJECT_ID=sparksites-hmsbbay
FLASK_DEBUG=1
PORT=5000
```

Download your **service account key** from Firebase Console → Project Settings → Service Accounts → Generate new private key. Save it as `hmsbay/serviceAccountKey.json`.

> ⚠️ Never commit `serviceAccountKey.json` or `.env` to version control.

Run the server from the `hmsbay/` directory:
```bash
cd hmsbay
python -m backend.app
```

Visit **http://localhost:5000**

---

## Project Structure

```
hmsbay/
├── config.js               ← EDIT THIS to rebrand the site
├── firebase-config.js      ← Firebase credentials + SDK init
├── firestore.rules         ← Security rules (deploy via Firebase CLI)
├── index.html              ← Homepage / listings feed
├── listing.html            ← Auction item detail + bidding
├── create-listing.html     ← Create a new auction
├── profile.html            ← User profile + their listings
├── messages.html           ← In-app buyer/seller messaging
├── admin/
│   └── dashboard.html      ← Admin panel (admin users only)
├── css/
│   └── style.css
├── js/
│   ├── auth.js             ← Auth state, login/register modal
│   ├── listings.js         ← All listing + bidding logic
│   ├── messages.js         ← Real-time messaging
│   ├── admin.js            ← Admin dashboard logic
│   └── utils.js            ← Shared helpers
└── backend/
    ├── app.py              ← Flask entry point
    ├── firebase_admin_init.py
    ├── routes/
    │   ├── auctions.py     ← Expiry processing, bid validation
    │   └── admin.py        ← Admin API (cancel, ban, kill switch)
    └── requirements.txt
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/process-expired-auctions` | None | Mark ended auctions, create message threads |
| `POST` | `/api/place-bid` | Firebase token | Server-side bid validation |
| `POST` | `/api/admin/cancel-listing` | Admin token | Cancel a listing |
| `POST` | `/api/admin/ban-user` | Admin token | Ban or unban a user |
| `POST` | `/api/admin/toggle-killswitch` | Admin token | Enable/disable maintenance mode |
| `GET`  | `/api/health` | None | Health check |

---

## Automating Auction Expiry

To automatically process expired auctions, set up a cron job that calls the endpoint:

```bash
# Every 5 minutes (Linux/macOS crontab)
*/5 * * * * curl -s -X POST http://localhost:5000/api/process-expired-auctions
```

Or use a service like [cron-job.org](https://cron-job.org) for hosted deployments.

---

## Deploying to Production

- **Frontend**: Deploy the `hmsbay/` folder to Firebase Hosting or any static host.
- **Backend**: Deploy `backend/` to Cloud Run, Heroku, Railway, etc.
- Update CORS origins in `app.py` to your actual domain.
- Set `FLASK_DEBUG=0` in production.
