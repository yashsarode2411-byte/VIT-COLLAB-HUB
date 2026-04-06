/**
 * student-hackathon-workspace.js
 * Student-facing hackathon workspace with: Overview, Tasks, Submissions, Chat, 
 * Announcements (read-only), Round Status, and Winners.
 * Data stored under hackathon_applications/{appId}/tasks, /submissions, /messages subcollections.
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    doc, getDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc,
    getDocs, addDoc, serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ─── URL Params & DOM ───
const urlParams = new URLSearchParams(window.location.search);
const hackathonId = urlParams.get('id');

const titleDisplay = document.getElementById('hackathon-title');

// Sidebar tabs
const tabOverview = document.getElementById('tab-overview');
const tabTasks = document.getElementById('tab-tasks');
const tabSubmissions = document.getElementById('tab-submissions');
const tabChat = document.getElementById('tab-chat');
const tabAnnouncements = document.getElementById('tab-announcements');
const tabRounds = document.getElementById('tab-rounds');
const tabWinners = document.getElementById('tab-winners');

// Views
const viewOverview = document.getElementById('view-overview');
const viewTasks = document.getElementById('view-tasks');
const viewSubmissions = document.getElementById('view-submissions');
const viewChat = document.getElementById('view-chat');
const viewAnnouncements = document.getElementById('view-announcements');
const viewRounds = document.getElementById('view-rounds');
const viewWinners = document.getElementById('view-winners');

let currentHackData = null;
let currentAppData = null;
let currentAppId = null;
let currentUserUid = null;
let currentUserData = null;
let teamMembersCache = {};

// ─── Tab Switching ───
const allTabs = [tabOverview, tabTasks, tabSubmissions, tabChat, tabAnnouncements, tabRounds, tabWinners];
const allViews = [viewOverview, viewTasks, viewSubmissions, viewChat, viewAnnouncements, viewRounds, viewWinners];

function switchView(idx) {
    allTabs.forEach(t => t.classList.remove('active'));
    allViews.forEach(v => v.style.display = 'none');
    allTabs[idx].classList.add('active');
    allViews[idx].style.display = idx === 3 ? 'flex' : 'block'; // Chat uses flex
}

tabOverview.addEventListener('click', () => switchView(0));
tabTasks.addEventListener('click', () => switchView(1));
tabSubmissions.addEventListener('click', () => switchView(2));
tabChat.addEventListener('click', () => { switchView(3); scrollChatToBottom(); });
tabAnnouncements.addEventListener('click', () => switchView(4));
tabRounds.addEventListener('click', () => switchView(5));
tabWinners.addEventListener('click', () => switchView(6));

// ─── Auth Guard & Boot ───
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    if (!hackathonId) {
        alert("Invalid Hackathon ID in URL.");
        window.location.href = "student-hackathons.html";
        return;
    }
    currentUserUid = user.uid;

    try {
        // Get user profile
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            window.location.href = "login.html";
            return;
        }
        currentUserData = userDoc.data();

        // Back button
        document.getElementById('backBtn').addEventListener('click', () => {
            window.location.href = 'student-hackathons.html';
        });

        // Find the student's application for this hackathon
        const appQuery = query(
            collection(db, "hackathon_applications"),
            where("hackathon_id", "==", hackathonId),
            where("team_members", "array-contains", user.uid)
        );
        const appSnap = await getDocs(appQuery);

        if (appSnap.empty) {
            alert("You don't have an application for this hackathon.");
            window.location.href = "student-hackathons.html";
            return;
        }

        currentAppId = appSnap.docs[0].id;
        currentAppData = appSnap.docs[0].data();

        console.log("Hackathon workspace booted. appId:", currentAppId);

        // Listen to hackathon doc for real-time updates
        onSnapshot(doc(db, "hackathons", hackathonId), (docSnap) => {
            if (!docSnap.exists()) {
                alert("Hackathon not found or deleted.");
                window.location.href = "student-hackathons.html";
                return;
            }
            currentHackData = docSnap.data();
            renderOverview();
            renderRounds();
            renderWinners();
        });

        // Listen to application doc for status updates
        onSnapshot(doc(db, "hackathon_applications", currentAppId), (docSnap) => {
            if (docSnap.exists()) {
                currentAppData = docSnap.data();
                renderOverview();
                renderRounds();
            }
        });

        // Initialize features — these all use currentAppId which is now set
        initTasks();
        initSubmissions();
        initChat();
        loadAnnouncements();

    } catch (err) {
        console.error("Workspace Boot Error:", err);
        titleDisplay.textContent = "Error loading workspace.";
    }
});

// ─── OVERVIEW ───
function renderOverview() {
    if (!currentHackData || !currentAppData) return;
    const hack = currentHackData;
    const app = currentAppData;

    titleDisplay.textContent = hack.name || 'Hackathon Workspace';
    document.title = `${hack.name || 'Hackathon'} — VIT COLLAB HUB`;

    const formatDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';

    document.getElementById('hack-info-desc').textContent = hack.description || 'No description.';
    document.getElementById('hack-info-dates').textContent = `📅 ${formatDate(hack.start_date)} → ${formatDate(hack.end_date)}`;
    document.getElementById('hack-info-deadline').textContent = `⏰ Deadline: ${formatDate(hack.deadline)}`;
    document.getElementById('hack-info-round').textContent = `🏁 Round ${app.current_round || 0} / ${hack.total_rounds || '?'}`;
    document.getElementById('hackathon-info-bar').style.display = 'block';

    // Team Info
    const teamContainer = document.getElementById('team-info-container');
    const members = app.members || [];
    let membersHtml = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
            <strong style="color: var(--primary-blue);">${app.team_name || 'Your Team'}</strong>
            <span style="background: var(--primary-blue); color: white; font-size: 11px; padding: 2px 8px; border-radius: 10px;">Leader: ${app.leader_reg || 'N/A'}</span>
            ${app.invite_code ? `<span style="background: rgba(16,185,129,0.1); color: #10b981; font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 700; cursor: pointer; border: 1px solid rgba(16,185,129,0.2);" onclick="navigator.clipboard.writeText('${app.invite_code}'); alert('Invite code copied!');" title="Click to copy">
                <i class="fa-solid fa-copy" style="margin-right: 4px;"></i>Code: ${app.invite_code}
            </span>` : ''}
        </div>
    `;
    if (members.length > 0) {
        membersHtml += '<div style="display: flex; flex-wrap: wrap; gap: 8px;">';
        members.forEach(reg => {
            membersHtml += `<span style="background: rgba(13,110,253,0.08); color: var(--primary-blue); padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid rgba(13,110,253,0.15);">${reg}</span>`;
        });
        membersHtml += '</div>';
    }
    teamContainer.innerHTML = membersHtml;

    // Status
    const statusContainer = document.getElementById('status-container');
    const statusMap = {
        'pending': { text: 'Application Pending', color: '#f59e0b', icon: 'fa-hourglass-half', rgb: '245,158,11' },
        'approved': { text: 'Approved — Active', color: '#10b981', icon: 'fa-check-circle', rgb: '16,185,129' },
        'rejected': { text: 'Application Rejected', color: '#ef4444', icon: 'fa-times-circle', rgb: '239,68,68' },
        'eliminated': { text: 'Eliminated', color: '#ef4444', icon: 'fa-ban', rgb: '239,68,68' }
    };
    const s = statusMap[app.status] || { text: app.status, color: '#6c757d', icon: 'fa-question-circle', rgb: '108,117,125' };
    statusContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; padding: 15px; background: rgba(${s.rgb}, 0.08); border-radius: 10px; border: 1px solid rgba(${s.rgb}, 0.2);">
            <i class="fa-solid ${s.icon}" style="font-size: 1.5rem; color: ${s.color};"></i>
            <div>
                <p style="font-weight: 700; font-size: 15px; color: ${s.color};">${s.text}</p>
                <p style="font-size: 13px; color: var(--muted-text); margin-top: 2px;">Current Round: ${app.current_round || 0} / ${currentHackData.total_rounds || '?'}</p>
            </div>
        </div>
    `;
}

// ─── TASKS (Kanban) ───
function initTasks() {
    // Load tasks with real-time listener
    const tasksRef = collection(db, "hackathon_applications", currentAppId, "tasks");
    onSnapshot(tasksRef, (snapshot) => {
        const tasks = { todo: [], progress: [], done: [] };
        snapshot.forEach(docSnap => {
            const t = { id: docSnap.id, ...docSnap.data() };
            if (t.status === 'progress') tasks.progress.push(t);
            else if (t.status === 'done') tasks.done.push(t);
            else tasks.todo.push(t);
        });
        renderKanban(tasks);
    }, (error) => {
        console.error("Tasks listener error:", error);
        document.getElementById('col-todo').innerHTML = '<p class="kanban-empty">Could not load tasks</p>';
    });

    // Add Task button
    document.getElementById('add-task-btn').addEventListener('click', () => {
        const form = document.getElementById('add-task-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('cancel-task-btn').addEventListener('click', () => {
        document.getElementById('add-task-form').style.display = 'none';
    });

    // Save Task
    document.getElementById('save-task-btn').addEventListener('click', async () => {
        const title = document.getElementById('task-title-input').value.trim();
        if (!title) return alert("Task title is required.");

        const btn = document.getElementById('save-task-btn');
        btn.textContent = "Saving...";
        btn.disabled = true;

        try {
            await addDoc(collection(db, "hackathon_applications", currentAppId, "tasks"), {
                title,
                description: document.getElementById('task-desc-input').value.trim(),
                assignee: document.getElementById('task-assignee-select').value,
                priority: document.getElementById('task-priority-select').value,
                status: 'todo',
                created_by: currentUserUid,
                created_at: serverTimestamp()
            });
            document.getElementById('task-title-input').value = '';
            document.getElementById('task-desc-input').value = '';
            document.getElementById('add-task-form').style.display = 'none';
        } catch (e) {
            console.error("Add task error:", e);
            alert("Failed to add task. Error: " + e.message);
        } finally {
            btn.textContent = "Save Task";
            btn.disabled = false;
        }
    });
}

function renderKanban(tasks) {
    ['todo', 'progress', 'done'].forEach(col => {
        const container = document.getElementById(`col-${col}`);
        const countEl = document.getElementById(`count-${col}`);
        countEl.textContent = tasks[col].length;
        container.innerHTML = '';

        if (tasks[col].length === 0) {
            container.innerHTML = '<p class="kanban-empty">No tasks</p>';
            return;
        }

        tasks[col].forEach(task => {
            const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
            const nextStatus = { todo: 'progress', progress: 'done', done: 'todo' };
            const nextLabel = { todo: 'Start', progress: 'Complete', done: 'Reopen' };
            const nextIcons = { todo: 'fa-play', progress: 'fa-check', done: 'fa-rotate-left' };

            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                    <span style="font-weight: 600; font-size: 14px; color: var(--dark-text); flex: 1;">${task.title}</span>
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${priorityColors[task.priority] || '#6c757d'}; flex-shrink: 0; margin-top: 6px;" title="${task.priority || 'normal'} priority"></span>
                </div>
                ${task.description ? `<p style="font-size: 12px; color: var(--muted-text); margin-bottom: 8px;">${task.description}</p>` : ''}
                <div style="display: flex; gap: 6px;">
                    <button class="task-action-btn" onclick="window.moveHackTask('${task.id}', '${nextStatus[task.status || 'todo']}')">
                        <i class="fa-solid ${nextIcons[task.status || 'todo']}" style="margin-right: 4px;"></i>${nextLabel[task.status || 'todo']}
                    </button>
                    <button class="task-action-btn task-delete-btn" onclick="window.deleteHackTask('${task.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    });
}

window.moveHackTask = async (taskId, newStatus) => {
    try {
        await updateDoc(doc(db, "hackathon_applications", currentAppId, "tasks", taskId), { status: newStatus });
    } catch (e) {
        console.error("Move task error:", e);
        alert("Failed to update task. Error: " + e.message);
    }
};

window.deleteHackTask = async (taskId) => {
    if (!confirm("Delete this task?")) return;
    try {
        await deleteDoc(doc(db, "hackathon_applications", currentAppId, "tasks", taskId));
    } catch (e) {
        console.error("Delete task error:", e);
        alert("Failed to delete task. Error: " + e.message);
    }
};

// ─── SUBMISSIONS ───
function initSubmissions() {
    // Load submissions with real-time listener
    const subsRef = collection(db, "hackathon_applications", currentAppId, "submissions");
    onSnapshot(subsRef, (snapshot) => {
        const container = document.getElementById('submissions-list');
        const subs = [];
        snapshot.forEach(docSnap => subs.push({ id: docSnap.id, ...docSnap.data() }));

        subs.sort((a, b) => {
            const ta = a.created_at?.toMillis?.() || 0;
            const tb = b.created_at?.toMillis?.() || 0;
            return tb - ta;
        });

        if (subs.length === 0) {
            container.innerHTML = '<div class="card" style="text-align: center; padding: 30px;"><p style="color: var(--muted-text);">No submissions yet. Click "New Submission" to submit your work.</p></div>';
            return;
        }

        container.innerHTML = subs.map(sub => {
            const dateStr = sub.created_at?.toDate ? sub.created_at.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
            return `
                <div class="application-card" style="flex-direction: column; align-items: flex-start; padding: 18px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-start; margin-bottom: 8px;">
                        <h4 style="margin: 0; font-size: 15px; color: var(--dark-text);">${sub.title}</h4>
                        <span style="font-size: 11px; color: var(--muted-text); white-space: nowrap;">${dateStr}</span>
                    </div>
                    ${sub.notes ? `<p style="font-size: 13px; color: var(--muted-text); margin-bottom: 8px;">${sub.notes}</p>` : ''}
                    <a href="${sub.link}" target="_blank" class="btn-download" style="padding: 5px 12px; font-size: 12px; text-decoration: none;">
                        <i class="fa-solid fa-arrow-up-right-from-square" style="margin-right: 4px;"></i>Open
                    </a>
                </div>
            `;
        }).join('');
    }, (error) => {
        console.error("Submissions listener error:", error);
    });

    // Add Submission button
    document.getElementById('add-submission-btn').addEventListener('click', () => {
        const form = document.getElementById('add-submission-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('cancel-submission-btn').addEventListener('click', () => {
        document.getElementById('add-submission-form').style.display = 'none';
    });

    // Save Submission
    document.getElementById('save-submission-btn').addEventListener('click', async () => {
        const title = document.getElementById('submission-title-input').value.trim();
        const link = document.getElementById('submission-link-input').value.trim();
        if (!title || !link) return alert("Title and link are required.");

        const btn = document.getElementById('save-submission-btn');
        btn.textContent = "Submitting...";
        btn.disabled = true;

        try {
            await addDoc(collection(db, "hackathon_applications", currentAppId, "submissions"), {
                title,
                link,
                notes: document.getElementById('submission-notes-input').value.trim(),
                author_uid: currentUserUid,
                created_at: serverTimestamp()
            });
            document.getElementById('submission-title-input').value = '';
            document.getElementById('submission-link-input').value = '';
            document.getElementById('submission-notes-input').value = '';
            document.getElementById('add-submission-form').style.display = 'none';
        } catch (e) {
            console.error("Submit error:", e);
            alert("Failed to submit. Error: " + e.message);
        } finally {
            btn.textContent = "Submit";
            btn.disabled = false;
        }
    });
}

// ─── CHAT ───
function initChat() {
    // Load messages with real-time listener
    const messagesRef = collection(db, "hackathon_applications", currentAppId, "messages");
    onSnapshot(messagesRef, (snapshot) => {
        const container = document.getElementById('chat-messages');
        const messages = [];
        snapshot.forEach(docSnap => messages.push({ id: docSnap.id, ...docSnap.data() }));

        messages.sort((a, b) => {
            const ta = a.timestamp?.toMillis?.() || 0;
            const tb = b.timestamp?.toMillis?.() || 0;
            return ta - tb;
        });

        if (messages.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--muted-text); margin-top: 60px;">
                    <i class="fa-solid fa-comment-slash" style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.4; color: var(--primary-blue);"></i>
                    <p style="font-size: 1rem; font-weight: 500;">No messages yet</p>
                    <p style="font-size: 0.85rem; margin-top: 4px;">Start the conversation with your team!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(msg => {
            const isMe = msg.sender_uid === currentUserUid;
            const senderName = isMe ? 'You' : (msg.sender_name || 'Teammate');
            const timeStr = msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

            return `
                <div class="chat-bubble ${isMe ? 'chat-me' : 'chat-other'}">
                    <span class="chat-sender">${senderName}</span>
                    <p class="chat-text">${msg.text}</p>
                    <span class="chat-time">${timeStr}</span>
                </div>
            `;
        }).join('');
        scrollChatToBottom();
    }, (error) => {
        console.error("Chat listener error:", error);
    });

    // Send message button
    document.getElementById('send-chat-btn').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function scrollChatToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    try {
        await addDoc(collection(db, "hackathon_applications", currentAppId, "messages"), {
            text,
            sender_uid: currentUserUid,
            sender_name: currentUserData?.name || 'Student',
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Send message error:", e);
        alert("Failed to send message. Error: " + e.message);
    }
}

// ─── ANNOUNCEMENTS (Read-only from club) ───
function loadAnnouncements() {
    const q = query(
        collection(db, "hackathon_announcements"),
        where("hackathon_id", "==", hackathonId)
    );

    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('announcements-list');
        let announcements = [];
        snapshot.forEach(docSnap => announcements.push(docSnap.data()));

        announcements.sort((a, b) => {
            const timeA = a.timestamp ? a.timestamp.toMillis() : Date.now();
            const timeB = b.timestamp ? b.timestamp.toMillis() : Date.now();
            return timeB - timeA;
        });

        if (announcements.length === 0) {
            container.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">No announcements from the organizers yet.</p>';
            return;
        }

        container.innerHTML = announcements.map(data => {
            const dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Just now";
            return `
                <div class="application-card" style="flex-direction: column; align-items: flex-start;">
                    <p style="margin: 0; font-size: 15px; color: var(--dark-text); white-space: pre-wrap;">${data.message}</p>
                    <span style="font-size: 12px; color: var(--muted-text); margin-top: 8px;">Published: ${dateStr}</span>
                </div>
            `;
        }).join('');
    });
}

// ─── ROUNDS ───
function renderRounds() {
    if (!currentHackData || !currentAppData) return;
    const container = document.getElementById('rounds-timeline');
    const totalRounds = currentHackData.total_rounds || 1;
    const myRound = currentAppData.current_round || 0;
    const isEliminated = currentAppData.status === 'eliminated';

    let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

    for (let i = 1; i <= totalRounds; i++) {
        let bgColor, textColor, icon, label;
        if (isEliminated && i > myRound) {
            bgColor = 'rgba(239,68,68,0.05)';
            textColor = '#ef4444';
            icon = 'fa-lock';
            label = 'Locked (Eliminated)';
        } else if (i < myRound) {
            bgColor = 'rgba(16,185,129,0.08)';
            textColor = '#10b981';
            icon = 'fa-check-circle';
            label = 'Passed ✓';
        } else if (i === myRound) {
            bgColor = 'rgba(13,110,253,0.08)';
            textColor = 'var(--primary-blue)';
            icon = 'fa-circle-dot';
            label = isEliminated ? 'Eliminated here' : 'Current Round';
        } else {
            bgColor = 'rgba(0,0,0,0.02)';
            textColor = 'var(--muted-text)';
            icon = 'fa-circle';
            label = 'Upcoming';
        }

        html += `
            <div style="display: flex; align-items: center; gap: 15px; padding: 14px 18px; background: ${bgColor}; border-radius: 10px; border: 1px solid ${i === myRound ? textColor : 'transparent'};">
                <i class="fa-solid ${icon}" style="font-size: 1.2rem; color: ${textColor};"></i>
                <div style="flex: 1;">
                    <p style="font-weight: 600; font-size: 14px; color: var(--dark-text);">Round ${i}${i === totalRounds ? ' (Final)' : ''}</p>
                    <p style="font-size: 12px; color: ${textColor}; margin-top: 2px;">${label}</p>
                </div>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}

// ─── WINNERS ───
function renderWinners() {
    if (!currentHackData) return;
    const container = document.getElementById('winners-container');
    const winner = currentHackData.winner_team;

    if (!winner) {
        container.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">Winners have not been declared yet. Check back later!</p>';
        return;
    }

    if (typeof winner === 'string') {
        if (winner === 'No participants') {
            container.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">This hackathon was marked as having no participants.</p>';
        } else {
            container.innerHTML = `<p style="font-size: 16px; font-weight: 700; color: var(--primary-blue);"><i class="fa-solid fa-trophy" style="color: #ffd43b; margin-right: 8px;"></i>${winner}</p>`;
        }
        return;
    }

    // Object format: { first, second, third }
    let html = '<div style="display: flex; flex-direction: column; gap: 15px;">';
    
    const places = [
        { key: 'first', label: '🥇 1st Place', color: '#ffd43b' },
        { key: 'second', label: '🥈 2nd Place', color: '#c0c0c0' },
        { key: 'third', label: '🥉 3rd Place', color: '#cd7f32' }
    ];

    places.forEach(p => {
        if (winner[p.key]) {
            const isMyTeam = winner[p.key] === currentAppData?.team_name;
            html += `
                <div style="display: flex; align-items: center; gap: 15px; padding: 16px 20px; background: ${isMyTeam ? 'rgba(255,212,59,0.15)' : 'var(--bg-color)'}; border-radius: 12px; border: 1px solid ${isMyTeam ? '#ffd43b' : 'var(--border-color)'};">
                    <span style="font-size: 1.8rem;">${p.label.split(' ')[0]}</span>
                    <div>
                        <p style="font-weight: 700; font-size: 15px; color: var(--dark-text);">${winner[p.key]}</p>
                        ${isMyTeam ? '<p style="font-size: 12px; color: var(--success-msg); font-weight: 600; margin-top: 2px;">🎉 That\'s your team!</p>' : ''}
                    </div>
                </div>
            `;
        }
    });

    html += '</div>';
    container.innerHTML = html;
}

console.log("student-hackathon-workspace.js loaded ✅");
