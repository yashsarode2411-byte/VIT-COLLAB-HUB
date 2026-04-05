import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCmNlAdzSv6dzjejUsD6DB_SitkBd2PbC8",
    authDomain: "vit-collab-hub-e5e1e.firebaseapp.com",
    projectId: "vit-collab-hub-e5e1e",
    storageBucket: "vit-collab-hub-e5e1e.firebasestorage.app",
    messagingSenderId: "685274150301",
    appId: "1:685274150301:web:86fb9104a6e1b0e722eb74"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Enable offline persistence
enableMultiTabIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
    } else if (err.code === 'unimplemented') {
        console.warn('The current browser does not support all of the features required to enable persistence.');
    }
});

export { auth, db, storage };
