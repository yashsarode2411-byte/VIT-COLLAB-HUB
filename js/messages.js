import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    doc, 
    getDoc, 
    addDoc, 
    updateDoc, 
    onSnapshot, 
    orderBy, 
    serverTimestamp, 
    setDoc,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// -- State Variables --
let currentUserId = null;
let currentUserData = null;
let activeConversationId = null;
let activeChatUser = null; 
let unsubscribeMessages = null;
let unsubscribeConversations = null;
let usersCache = {}; // Cache to avoid multiple queries for the same user

// -- DOM Elements --
const navAvatar = document.getElementById('nav-avatar');
const conversationsList = document.getElementById('conversationsList');
const chatEmptyState = document.getElementById('chatEmptyState');
const chatHeader = document.getElementById('chatHeader');
const chatHeaderAvatar = document.getElementById('chatHeaderAvatar');
const chatHeaderName = document.getElementById('chatHeaderName');
const messagesList = document.getElementById('messagesList');
const chatInputArea = document.getElementById('chatInputArea');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// -- Authentication Guard --
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    
    currentUserId = user.uid;
    
    // Fetch current user data
    try {
        const userDoc = await getDoc(doc(db, "users", currentUserId));
        if (userDoc.exists()) {
            currentUserData = userDoc.data();
            if (navAvatar && currentUserData.avatar_url) {
                navAvatar.src = currentUserData.avatar_url;
            }
        }
    } catch (e) {
        console.error("Error fetching user data", e);
    }
    
    // Start listening to user's conversations
    fetchUserConversations(currentUserId);

    // Check if we came here from a "Message" button with a target userId in URL
    const urlParams = new URLSearchParams(window.location.search);
    const targetUserId = urlParams.get('userId');
    if (targetUserId && targetUserId !== currentUserId) {
        initiateChatWith(targetUserId);
    }
});

// -- Helper: Get User Info --
async function getUserInfo(uid) {
    if (usersCache[uid]) return usersCache[uid];
    
    try {
        const d = await getDoc(doc(db, "users", uid));
        if (d.exists()) {
            const data = d.data();
            usersCache[uid] = {
                id: uid,
                name: data.name || "Unknown User",
                avatar: data.avatar_url || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png"
            };
            return usersCache[uid];
        }
    } catch (e) {
        console.error("Error fetching user", e);
    }
    return { id: uid, name: "Unknown", avatar: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png" };
}

// -- Core Features Logic --

/**
 * 1. fetchUserConversations
 * Listens to all conversations where the current user is a participant.
 */
function fetchUserConversations(userId) {
    const convRef = collection(db, "conversations");
    const q = query(convRef, where("participants", "array-contains", userId));
    
    if (unsubscribeConversations) unsubscribeConversations();
    
    unsubscribeConversations = onSnapshot(q, async (snapshot) => {
        const conversations = [];
        snapshot.forEach((doc) => {
            conversations.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort by lastUpdated desc (locally since cross-field index might be missing)
        conversations.sort((a, b) => {
            const aTime = a.lastUpdated ? a.lastUpdated.toMillis() : 0;
            const bTime = b.lastUpdated ? b.lastUpdated.toMillis() : 0;
            return bTime - aTime;
        });
        
        renderConversationsList(conversations);
    }, (error) => {
        console.error("Error fetching conversations:", error);
        conversationsList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--danger);">Error loading conversations: ${error.message}</div>`;
    });
}

/**
 * Render the conversations list in the left sidebar
 */
async function renderConversationsList(conversations) {
    if (conversations.length === 0) {
        conversationsList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--msg-text-muted);">No conversations yet.</div>`;
        return;
    }
    
    conversationsList.innerHTML = "";
    
    for (const conv of conversations) {
        // Find the other participant's ID
        const otherUserId = conv.participants.find(id => id !== currentUserId);
        if (!otherUserId) continue;
        
        const otherUser = await getUserInfo(otherUserId);
        const dateObj = conv.lastUpdated ? conv.lastUpdated.toDate() : new Date();
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const div = document.createElement('div');
        div.className = `conversation-item ${activeConversationId === conv.id ? 'active' : ''}`;
        div.innerHTML = `
            <img src="${otherUser.avatar}" alt="Avatar" class="conversation-avatar">
            <div class="conversation-info">
                <div class="conversation-name-time">
                    <span class="conversation-name">${otherUser.name}</span>
                    <span class="conversation-time">${timeStr}</span>
                </div>
                <div class="conversation-last-message">${conv.lastMessage || 'New Conversation'}</div>
            </div>
        `;
        
        div.addEventListener('click', () => {
            openConversation(conv.id, otherUser);
        });
        
        conversationsList.appendChild(div);
    }
}

/**
 * 2. getOrCreateConversation
 * Finds an existing conversation between two users, or creates a new one.
 */
async function getOrCreateConversation(uid1, uid2) {
    const convRef = collection(db, "conversations");
    // To find if they have a chat, we check if there's a document where participants contains uid1.
    // Firestore lacks `where(participants, '==', [uid1, uid2])` if order changes, so we fetch and filter.
    const q = query(convRef, where("participants", "array-contains", uid1));
    const snapshot = await getDocs(q);
    
    let existingConvId = null;
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.participants.includes(uid2) && data.participants.length === 2) {
            existingConvId = docSnap.id;
        }
    });

    if (existingConvId) {
        return existingConvId;
    }

    // Create new conversation
    const newConvRef = await addDoc(convRef, {
        participants: [uid1, uid2],
        lastMessage: "",
        lastUpdated: serverTimestamp()
    });
    
    return newConvRef.id;
}

/**
 * 3. listenToMessages
 * Subscribes to the messages subcollection for real-time updates.
 */
function listenToMessages(conversationId) {
    const messagesRef = collection(db, "conversations", conversationId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));
    
    if (unsubscribeMessages) unsubscribeMessages();
    
    messagesList.innerHTML = "";
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                renderMessage(change.doc.data());
                scrollToBottom();
            }
        });
    }, (error) => {
        console.error("Error listening to messages:", error);
        alert("Failed to load messages: " + error.message);
    });
}

function renderMessage(msgData) {
    const isSent = msgData.senderId === currentUserId;
    const div = document.createElement('div');
    div.className = `message-bubble ${isSent ? 'message-sent' : 'message-received'}`;
    
    const timeStr = msgData.createdAt ? 
                    msgData.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
                    'Just now';
                    
    div.innerHTML = `
        ${escapeHtml(msgData.text)}
        <div class="message-time">${timeStr}</div>
    `;
    messagesList.appendChild(div);
}

function scrollToBottom() {
    messagesList.scrollTop = messagesList.scrollHeight;
}

/**
 * 4. sendMessage
 * Adds a message to the subcollection and updates the parent conversation.
 */
async function sendMessage(conversationId, text) {
    if (!text.trim()) return;
    
    const messagesRef = collection(db, "conversations", conversationId, "messages");
    const convDocRef = doc(db, "conversations", conversationId);
    
    try {
        await addDoc(messagesRef, {
            senderId: currentUserId,
            text: text.trim(),
            createdAt: serverTimestamp()
        });
        
        await updateDoc(convDocRef, {
            lastMessage: text.trim(),
            lastUpdated: serverTimestamp()
        });
        
    } catch (e) {
        console.error("Error sending message", e);
        alert("Failed to send message.");
    }
}

// -- UI Interaction Logic --

async function initiateChatWith(targetUserId) {
    if (targetUserId === currentUserId) return;
    
    try {
        const targetUser = await getUserInfo(targetUserId);
        const convId = await getOrCreateConversation(currentUserId, targetUserId);
        openConversation(convId, targetUser);
    } catch (err) {
        console.error("Failed to initiate chat", err);
        alert("Failed to start chat. This might be a missing index or permissions issue: " + err.message);
    }
}

function openConversation(convId, otherUser) {
    // Update active state
    activeConversationId = convId;
    activeChatUser = otherUser;
    
    // UI changes
    chatEmptyState.style.display = 'none';
    chatHeader.style.display = 'flex';
    messagesList.style.display = 'flex';
    chatInputArea.style.display = 'flex';
    
    chatHeaderAvatar.src = otherUser.avatar;
    chatHeaderName.textContent = otherUser.name;
    
    // Re-render conversation list active highlight
    document.querySelectorAll('.conversation-item').forEach(el => {
        const nameEl = el.querySelector('.conversation-name');
        if (nameEl && nameEl.textContent === otherUser.name) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    listenToMessages(convId);
    
    // Clear input
    messageInput.value = "";
    sendMessageBtn.disabled = true;
    messageInput.focus();
}

// -- Input Event Listeners --

messageInput.addEventListener('input', () => {
    sendMessageBtn.disabled = messageInput.value.trim().length === 0;
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendMessageBtn.disabled) {
            handleSend();
        }
    }
});

sendMessageBtn.addEventListener('click', handleSend);

async function handleSend() {
    const text = messageInput.value.trim();
    if (!text || !activeConversationId) return;
    
    messageInput.value = "";
    sendMessageBtn.disabled = true;
    messageInput.focus();
    
    await sendMessage(activeConversationId, text);
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
