# OnePercent Real Estate — PWA

A Progressive Web App (PWA) for buying and selling properties in Hyderabad, India.
Built with vanilla JavaScript + Firebase. Works on web and mobile. Installable as an app.

## Tech Stack

- **Frontend**: HTML + CSS + Vanilla JS (no framework — fast, simple)
- **Backend**: Firebase (Firestore + Auth + Storage + Hosting)
- **PWA**: Service Worker + Web App Manifest (installable on Android/iOS)
- **CI/CD**: GitHub Actions → auto deploy to Firebase + Vercel on every push
- **Hosting**: Firebase Hosting (primary) + Vercel (backup)

## Features

- Property listings grid with search and filter
- Grid view and list view toggle
- Property detail sheet with dimensions (L × W)
- Google Sign-In (free, no SMS)
- Post property form with photo upload
- Admin approval panel (approve/reject with reason)
- PWA — installable on Android home screen
- Offline support via Service Worker
- Dark orange + black theme

---

## Setup — Step by Step

### Step 1 — Create Firebase project

1. Go to console.firebase.google.com
2. Add project → name: `onepercent-realestate`
3. Enable:
   - Authentication → Google provider
   - Firestore Database → Start in test mode → Mumbai region
   - Storage → Start in test mode
   - Hosting → Get started

### Step 2 — Get Firebase config

Firebase Console → Project Settings → Your apps → Web app → Register → copy config object

### Step 3 — Add config to index.html

Open `index.html`, find the `firebaseConfig` object and replace with your values:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "onepercent-xxx.firebaseapp.com",
  projectId:         "onepercent-xxx",
  storageBucket:     "onepercent-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

### Step 4 — Add Firestore security rules

Firebase Console → Firestore → Rules → paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role
        in ['admin', 'superadmin'];
    }

    match /properties/{id} {
      allow read: if resource.data.status == 'approved'
                  || request.auth.uid == resource.data.ownerId
                  || isAdmin();
      allow create: if request.auth != null
                    && request.resource.data.ownerId == request.auth.uid;
      allow update: if isAdmin()
                    || (request.auth.uid == resource.data.ownerId
                        && resource.data.status == 'pending');
    }

    match /users/{uid} {
      allow read, write: if request.auth.uid == uid || isAdmin();
    }

    match /notifications/{id} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Step 5 — Add Storage rules

Firebase Console → Storage → Rules → paste:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /properties/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

### Step 6 — Make yourself admin

1. Sign in to the app with Google
2. Go to Firebase Console → Firestore → `users` collection
3. Find your user document → edit `role` field → change to `"admin"`
4. Refresh the app — Admin button appears in header

---

## Deploy — Firebase Hosting (free)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize (select Hosting, use existing project)
firebase init hosting

# Deploy
firebase deploy --only hosting
```

Your app is live at: `https://onepercent-realestate.web.app`

---

## Deploy — Vercel (alternative, also free)

1. Push your code to GitHub
2. Go to vercel.com → New Project → Import your repo
3. No build settings needed (static site)
4. Click Deploy

Your app is live at: `https://onepercent.vercel.app`

---

## GitHub Actions — Auto Deploy (CI/CD)

Every time you push to `main`, GitHub automatically deploys to both Firebase and Vercel.

### Setup secrets in GitHub

Go to your repo → Settings → Secrets → Actions → add these:

| Secret | How to get |
|--------|-----------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Console → Project Settings → Service accounts → Generate new private key → copy JSON |
| `VERCEL_TOKEN` | vercel.com → Settings → Tokens → Create |
| `VERCEL_ORG_ID` | vercel.com → Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | Your Vercel project → Settings → General → Project ID |

After adding secrets, push any change to `main` → GitHub Actions deploys automatically.

---

## PWA — Install on Android

1. Open the web app in Chrome on Android
2. Chrome shows "Add to Home Screen" banner at bottom
3. Tap "Install App"
4. The app installs like a native app — icon on home screen, no browser chrome, works offline

---

## File Structure

```
onepercent-pwa/
├── index.html          ← entire app (HTML + CSS + JS)
├── manifest.json       ← PWA manifest (name, icons, theme)
├── sw.js               ← Service Worker (offline + caching)
├── firebase.json       ← Firebase Hosting config
├── .firebaserc         ← Firebase project reference
├── vercel.json         ← Vercel deployment config
├── .github/
│   └── workflows/
│       └── deploy.yml  ← GitHub Actions CI/CD
└── icons/
    ├── icon-72.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-192.png    ← Android home screen icon
    └── icon-512.png    ← Play Store / splash icon
```

---

## Create App Icons

Go to **canva.com** → create a 512×512 design:
- Background: #E85D04 (orange)
- Text: "1%" in white, Playfair Display bold, large
- Download as PNG

Then go to **pwa-image-generator.vercel.app** → upload your 512px icon → download all sizes → put in `icons/` folder.

---

## Costs

| Service | Cost |
|---------|------|
| Firebase Hosting | Free (10GB/month) |
| Firestore | Free (50k reads/day) |
| Firebase Auth | Free (unlimited) |
| Firebase Storage | Free (5GB) |
| Vercel | Free |
| GitHub Actions | Free (2000 min/month) |
| **Total** | **₹0** |
