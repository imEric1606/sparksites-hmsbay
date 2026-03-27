// firebase-config.js — Firebase project credentials + SDK initialization.
// All other JS modules import { db, auth, storage } from here.

import { initializeApp }    from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js';
import { getFirestore }     from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import { getAuth }          from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';
import { getStorage }       from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js';

const firebaseConfig = {
  apiKey:            "AIzaSyDkG4XpudHop5xQa2hbLCE05lCaGekgDA8",
  authDomain:        "sparksites-hmsbbay.firebaseapp.com",
  projectId:         "sparksites-hmsbbay",
  storageBucket:     "sparksites-hmsbbay.firebasestorage.app",
  messagingSenderId: "873409757393",
  appId:             "1:873409757393:web:b8d49e8a227535308b85f0",
  measurementId:     "G-RQ9FDNNV4C"
};

const app = initializeApp(firebaseConfig);

export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);
