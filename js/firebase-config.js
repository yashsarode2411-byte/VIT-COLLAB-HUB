import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCmNlAdzSv6dzjejUsD6DB_SitkBd2PbC8",
    authDomain: "vit-collab-hub-e5e1e.firebaseapp.com",
    projectId: "vit-collab-hub-e5e1e",
    storageBucket: "vit-collab-hub-e5e1e.firebasestorage.app",
    messagingSenderId: "685274150301",
    appId: "1:685274150301:web:86fb9104a6e1b0e722eb74"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
