/**
 * project-workspace.js
 * Handles the Project Workspace page: Overview, Tasks, Submissions, Chat, Settings.
 * Uses Firebase Firestore real-time listeners for data synchronization.
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    doc, getDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc,
    getDocs, addDoc, serverTimestamp, orderBy, arrayRemove, arrayUnion, increment
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ─── URL Params & DOM ───
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

const titleDisplay = document.getElementById('project-title');

// Sidebar tabs
const tabOverview = document.getElementById('tab-overview');
const tabTasks = document.getElementById('tab-tasks');
const tabSubmissions = document.getElementById('tab-submissions');
const tabChat = document.getElementById('tab-chat');
const tabSettings = document.getElementById('tab-settings');

// Views
const viewOverview = document.getElementById('view-overview');
const viewTasks = document.getElementById('view-tasks');
const viewSubmissions = document.getElementById('view-submissions');
const viewChat = document.getElementById('view-chat');
const viewSettings = document.getElementById('view-settings');

let currentProjectData = null;
let currentUserRole = null;   // 'student' | 'admin'
let currentUserUid = null;
let currentUserData = null;
let teamMembersCache = {};    // uid -> {name, ...}

// ─── Tab Switching ───
const allTabs = [tabOverview, tabTasks, tabSubmissions, tabChat, tabSettings];
const allViews = [viewOverview, viewTasks, viewSubmissions, viewChat, viewSettings];

function switchView(idx) {
    allTabs.forEach(t => t.classList.remove('active'));
    allViews.forEach(v => v.style.display = 'none');
    allTabs[idx].classList.add('active');
    allViews[idx].style.display = idx === 3 ? 'flex' : 'block'; // Chat uses flex layout
}

tabOverview.addEventListener('click', () => switchView(0));
tabTasks.addEventListener('click', () => switchView(1));
tabSubmissions.addEventListener('click', () => switchView(2));
tabChat.addEventListener('click', () => { switchView(3); scrollChatToBottom(); });
tabSettings.addEventListener('click', () => {
    switchView(4);
    prefillSettings();
});

// ─── Auth Guard & Boot ───
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    if (!projectId) {
        alert("Invalid Project ID in URL.");
        window.location.href = "student-dashboard.html";
        return;
    }
    currentUserUid = user.uid;

    try {
        // Get user profile to determine role
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            window.location.href = "login.html";
            return;
        }
        currentUserData = userDoc.data();
        currentUserRole = currentUserData.role;

        // Set navbar label
        document.getElementById('nav-role-label').textContent =
            currentUserRole === 'admin' ? `${currentUserData.name || 'Mentor'} — Project Workspace` : 'Project Workspace';

        // Back button targets correct dashboard
        const dashboardUrl = currentUserRole === 'admin' ? 'admin-dashboard.html' : 'student-dashboard.html';
        document.getElementById('backBtn').addEventListener('click', () => {
            window.location.href = dashboardUrl;
        });
        document.getElementById('backToDashboardLink').href = dashboardUrl;

        // Realtime project listener
        onSnapshot(doc(db, "projects", projectId), (docSnap) => {
            if (!docSnap.exists()) {
                alert("Project not found or has been deleted.");
                window.location.href = dashboardUrl;
                return;
            }

            const projData = docSnap.data();

            // Check authorization: must be team_member or mentor
            const isTeamMember = projData.team_members && projData.team_members.includes(user.uid);
            const isMentor = projData.mentor_id === user.uid;

            if (!isTeamMember && !isMentor) {
                alert("You are not authorized to view this project workspace.");
                window.location.href = dashboardUrl;
                return;
            }

            currentProjectData = projData;
            renderOverview(projData);
        });

        // Initialize sub-features
        loadTasks();
        loadSubmissions();
        loadChat();

    } catch (err) {
        console.error("Workspace Boot Error:", err);
        titleDisplay.textContent = "Error loading workspace.";
    }
});

// ─── OVERVIEW ───
async function renderOverview(project) {
    titleDisplay.textContent = project.name || project.title || 'Untitled Project';
    document.title = `${project.name || 'Project'} — VIT COLLAB HUB Workspace`;

    // Info bar
    const statusLabels = {
        'pending_mentor': '🟡 Awaiting Mentor',
        'ongoing': '🟢 Ongoing',
        'completed': '🔵 Completed',
        'pending_team': '🟠 Forming Team'
    };
    document.getElementById('proj-info-desc').textContent = project.description || 'No description provided.';
    document.getElementById('proj-info-status').textContent = `📊 ${statusLabels[project.status] || project.status}`;
    document.getElementById('proj-info-code').textContent = `🔑 Code: ${project.project_code || 'N/A'}`;

    // Fetch mentor name
    let mentorName = 'Not assigned';
    if (project.mentor_id) {
        try {
            const mentorSnap = await getDoc(doc(db, "users", project.mentor_id));
            if (mentorSnap.exists()) {
                mentorName = mentorSnap.data().name || 'Mentor';
            }
        } catch (e) { /* ignore */ }
    }
    document.getElementById('proj-info-mentor').textContent = `🎓 Mentor: ${mentorName}`;
    document.getElementById('project-info-bar').style.display = 'block';

    // Skills
    const skillsContainer = document.getElementById('skills-container');
    const skills = Array.isArray(project.skills) ? project.skills : (Array.isArray(project.tags) ? project.tags : []);
    if (skills.length > 0) {
        skillsContainer.innerHTML = skills.map(s =>
            `<span style="background: rgba(13,110,253,0.08); color: var(--primary-blue); padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid rgba(13,110,253,0.15);">${s}</span>`
        ).join('');
    } else {
        skillsContainer.innerHTML = '<span style="color: var(--muted-text); font-size: 14px;">No skills listed.</span>';
    }

    // Team Members
    const teamList = document.getElementById('team-members-list');
    const teamMembers = project.team_members || [];
    document.getElementById('team-count-badge').textContent = `${teamMembers.length} / ${project.team_size || '?'}`;

    let teamHtml = '';
    for (const uid of teamMembers) {
        let memberName = 'Loading...';
        let memberEmail = '';
        if (!teamMembersCache[uid]) {
            try {
                const snap = await getDoc(doc(db, "users", uid));
                if (snap.exists()) {
                    teamMembersCache[uid] = snap.data();
                }
            } catch (e) { /* skip */ }
        }
        if (teamMembersCache[uid]) {
            memberName = teamMembersCache[uid].name || 'Student';
            memberEmail = teamMembersCache[uid].email || '';
        }

        const isLeader = uid === project.leader_uid;
        teamHtml += `
            <div class="application-card" style="padding: 12px 16px; align-items: center;">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <div style="width: 38px; height: 38px; border-radius: 50%; background: ${isLeader ? 'var(--primary-blue)' : '#e2e8f0'}; display: flex; align-items: center; justify-content: center; color: ${isLeader ? 'white' : 'var(--text-secondary)'}; font-weight: 700; font-size: 14px;">
                        ${memberName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 14px; color: var(--dark-text);">
                            ${memberName}
                            ${isLeader ? '<span style="background: var(--primary-blue); color: white; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 6px;">Leader</span>' : ''}
                        </h4>
                        <p style="margin: 0; font-size: 12px; color: var(--muted-text);">${memberEmail}</p>
                    </div>
                </div>
            </div>
        `;
    }

    teamList.innerHTML = teamHtml || '<p style="color: var(--muted-text); font-size: 14px;">No team members found.</p>';

    // Populate task assignee dropdown
    populateAssigneeDropdown(teamMembers);
}

function populateAssigneeDropdown(teamUids) {
    const select = document.getElementById('task-assignee-select');
    if (!select) return;
    select.innerHTML = '<option value="">Unassigned</option>';
    teamUids.forEach(uid => {
        const name = teamMembersCache[uid]?.name || 'Student';
        select.innerHTML += `<option value="${uid}">${name}</option>`;
    });
}

// ─── TASKS (Kanban) ───
function loadTasks() {
    const tasksRef = collection(db, "projects", projectId, "tasks");
    onSnapshot(tasksRef, (snapshot) => {
        const tasks = { todo: [], progress: [], done: [] };
        snapshot.forEach(docSnap => {
            const t = { id: docSnap.id, ...docSnap.data() };
            if (t.status === 'progress') tasks.progress.push(t);
            else if (t.status === 'done') tasks.done.push(t);
            else tasks.todo.push(t);
        });
        renderKanban(tasks);
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
            const assigneeName = teamMembersCache[task.assignee]?.name || '';
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
                ${assigneeName ? `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;"><i class="fa-solid fa-user" style="margin-right: 4px;"></i>${assigneeName}</p>` : ''}
                <div style="display: flex; gap: 6px;">
                    <button class="task-action-btn" onclick="window.moveTask('${task.id}', '${nextStatus[task.status || 'todo']}')">
                        <i class="fa-solid ${nextIcons[task.status || 'todo']}" style="margin-right: 4px;"></i>${nextLabel[task.status || 'todo']}
                    </button>
                    <button class="task-action-btn task-delete-btn" onclick="window.deleteTask('${task.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    });
}

// Global task actions
window.moveTask = async (taskId, newStatus) => {
    try {
        await updateDoc(doc(db, "projects", projectId, "tasks", taskId), { status: newStatus });
    } catch (e) {
        console.error("Move task error:", e);
        alert("Failed to update task status.");
    }
};

window.deleteTask = async (taskId) => {
    if (!confirm("Delete this task?")) return;
    try {
        await deleteDoc(doc(db, "projects", projectId, "tasks", taskId));
    } catch (e) {
        console.error("Delete task error:", e);
        alert("Failed to delete task.");
    }
};

// Add Task Form
const addTaskBtn = document.getElementById('add-task-btn');
const addTaskForm = document.getElementById('add-task-form');
const cancelTaskBtn = document.getElementById('cancel-task-btn');
const saveTaskBtn = document.getElementById('save-task-btn');

addTaskBtn.addEventListener('click', () => {
    addTaskForm.style.display = addTaskForm.style.display === 'none' ? 'block' : 'none';
});
cancelTaskBtn.addEventListener('click', () => {
    addTaskForm.style.display = 'none';
});

saveTaskBtn.addEventListener('click', async () => {
    const title = document.getElementById('task-title-input').value.trim();
    if (!title) return alert("Task title is required.");

    saveTaskBtn.textContent = "Saving...";
    saveTaskBtn.disabled = true;

    try {
        await addDoc(collection(db, "projects", projectId, "tasks"), {
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
        addTaskForm.style.display = 'none';
    } catch (e) {
        console.error("Add task error:", e);
        alert("Failed to add task.");
    } finally {
        saveTaskBtn.textContent = "Save Task";
        saveTaskBtn.disabled = false;
    }
});

// ─── SUBMISSIONS ───
function loadSubmissions() {
    const subsRef = collection(db, "projects", projectId, "submissions");
    onSnapshot(subsRef, (snapshot) => {
        const container = document.getElementById('submissions-list');
        const subs = [];
        snapshot.forEach(docSnap => subs.push({ id: docSnap.id, ...docSnap.data() }));

        // Sort by timestamp descending
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
            const authorName = teamMembersCache[sub.author_uid]?.name || 'Unknown';
            const dateStr = sub.created_at?.toDate ? sub.created_at.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
            return `
                <div class="application-card" style="flex-direction: column; align-items: flex-start; padding: 18px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-start; margin-bottom: 8px;">
                        <h4 style="margin: 0; font-size: 15px; color: var(--dark-text);">${sub.title}</h4>
                        <span style="font-size: 11px; color: var(--muted-text); white-space: nowrap;">${dateStr}</span>
                    </div>
                    ${sub.notes ? `<p style="font-size: 13px; color: var(--muted-text); margin-bottom: 8px;">${sub.notes}</p>` : ''}
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                        <span style="font-size: 12px; color: var(--text-secondary);"><i class="fa-solid fa-user" style="margin-right: 4px;"></i>${authorName}</span>
                        <a href="${sub.link}" target="_blank" class="btn-download" style="padding: 5px 12px; font-size: 12px; text-decoration: none;">
                            <i class="fa-solid fa-arrow-up-right-from-square" style="margin-right: 4px;"></i>Open
                        </a>
                    </div>
                </div>
            `;
        }).join('');
    });
}

// Add Submission Form
const addSubBtn = document.getElementById('add-submission-btn');
const addSubForm = document.getElementById('add-submission-form');
const cancelSubBtn = document.getElementById('cancel-submission-btn');
const saveSubBtn = document.getElementById('save-submission-btn');

addSubBtn.addEventListener('click', () => {
    addSubForm.style.display = addSubForm.style.display === 'none' ? 'block' : 'none';
});
cancelSubBtn.addEventListener('click', () => {
    addSubForm.style.display = 'none';
});

saveSubBtn.addEventListener('click', async () => {
    const title = document.getElementById('submission-title-input').value.trim();
    const link = document.getElementById('submission-link-input').value.trim();
    if (!title || !link) return alert("Title and link are required.");

    saveSubBtn.textContent = "Submitting...";
    saveSubBtn.disabled = true;

    try {
        await addDoc(collection(db, "projects", projectId, "submissions"), {
            title,
            link,
            notes: document.getElementById('submission-notes-input').value.trim(),
            author_uid: currentUserUid,
            created_at: serverTimestamp()
        });
        document.getElementById('submission-title-input').value = '';
        document.getElementById('submission-link-input').value = '';
        document.getElementById('submission-notes-input').value = '';
        addSubForm.style.display = 'none';
    } catch (e) {
        console.error("Add submission error:", e);
        alert("Failed to submit.");
    } finally {
        saveSubBtn.textContent = "Submit";
        saveSubBtn.disabled = false;
    }
});

// ─── CHAT ───
function loadChat() {
    const messagesRef = collection(db, "projects", projectId, "messages");
    onSnapshot(messagesRef, (snapshot) => {
        const container = document.getElementById('chat-messages');
        const messages = [];
        snapshot.forEach(docSnap => messages.push({ id: docSnap.id, ...docSnap.data() }));

        // Sort ascending
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

        const renderMessages = () => {
            container.innerHTML = messages.map(msg => {
                const isMe = msg.sender_uid === currentUserUid;
                let senderName = 'Unknown';
                if (isMe) {
                    senderName = 'You';
                } else {
                    const cachedObj = teamMembersCache[msg.sender_uid] || {};
                    senderName = cachedObj.name || cachedObj.registration_no || cachedObj.email || (msg.sender_uid === currentProjectData?.mentor_id ? 'Mentor' : 'Unknown');
                }
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
        };

        // Check if there are missing names in the cache and fetch them
        messages.forEach(msg => {
            const uid = msg.sender_uid;
            if (uid !== currentUserUid && uid !== currentProjectData?.mentor_id && !teamMembersCache[uid]) {
                teamMembersCache[uid] = { name: 'Loading...' }; // stub to avoid repeat requests
                getDoc(doc(db, "users", uid)).then(snap => {
                    if (snap.exists()) {
                        teamMembersCache[uid] = snap.data();
                        renderMessages(); // re-render once loaded
                    }
                }).catch(e => console.error("Error fetching user name for chat:", e));
            }
        });

        renderMessages();
    });
}

function scrollChatToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

// Send message
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    try {
        await addDoc(collection(db, "projects", projectId, "messages"), {
            text,
            sender_uid: currentUserUid,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Send message error:", e);
        alert("Failed to send message.");
    }
}

// ─── SETTINGS ───
function prefillSettings() {
    if (!currentProjectData) return;
    const p = currentProjectData;

    document.getElementById('settings-invite-code').textContent = p.project_code || '------';
    document.getElementById('edit-proj-name').value = p.name || '';
    document.getElementById('edit-proj-desc').value = p.description || '';
    document.getElementById('edit-proj-ppt').value = p.ppt_url || '';

    const isLeader = p.leader_uid === currentUserUid;
    const isMentor = p.mentor_id === currentUserUid;

    // Show/hide leader-only controls
    document.getElementById('edit-project-card').style.display = (isLeader || isMentor) ? 'block' : 'none';
    document.getElementById('delete-project-btn').style.display = isLeader ? 'inline-flex' : 'none';
    document.getElementById('leave-project-btn').style.display = isLeader ? 'none' : 'inline-flex';
}

// Copy invite code
document.getElementById('copy-code-btn').addEventListener('click', () => {
    const code = currentProjectData?.project_code || '';
    if (code) {
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('copy-code-btn');
            btn.innerHTML = '<i class="fa-solid fa-check" style="margin-right: 4px;"></i>Copied!';
            setTimeout(() => {
                btn.innerHTML = '<i class="fa-solid fa-copy" style="margin-right: 4px;"></i>Copy';
            }, 2000);
        }).catch(() => alert(`Invite code: ${code}`));
    }
});

// Save project settings
document.getElementById('edit-project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-project-settings');
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "projects", projectId), {
            name: document.getElementById('edit-proj-name').value.trim(),
            description: document.getElementById('edit-proj-desc').value.trim(),
            ppt_url: document.getElementById('edit-proj-ppt').value.trim() || null
        });
        alert("Project details updated!");
    } catch (e) {
        console.error("Save settings error:", e);
        alert("Failed to save changes.");
    } finally {
        btn.textContent = "Save Changes";
        btn.disabled = false;
    }
});

// Leave project
document.getElementById('leave-project-btn').addEventListener('click', async () => {
    if (!confirm("Are you sure you want to leave this project? You'll lose access to the workspace.")) return;

    try {
        await updateDoc(doc(db, "projects", projectId), {
            team_members: arrayRemove(currentUserUid)
        });
        alert("You have left the project.");
        window.location.href = currentUserRole === 'admin' ? 'admin-dashboard.html' : 'student-dashboard.html';
    } catch (e) {
        console.error("Leave project error:", e);
        alert("Failed to leave project.");
    }
});

// Delete project (leader only)
document.getElementById('delete-project-btn').addEventListener('click', async () => {
    if (!confirm("PERMANENTLY delete this project and all its data (tasks, submissions, messages)? This cannot be undone.")) return;

    const btn = document.getElementById('delete-project-btn');
    btn.textContent = "Deleting...";
    btn.disabled = true;

    try {
        // If project was completed, reverse the ratings from team members
        if (currentProjectData && currentProjectData.status === 'completed') {
            const teamMembers = currentProjectData.team_members || [];
            const projRating = currentProjectData.project_rating || currentProjectData.rating || 0;
            const individualRatings = currentProjectData.individual_ratings || {};

            for (const uid of teamMembers) {
                const indivRating = individualRatings[uid] || projRating;
                try {
                    await updateDoc(doc(db, "users", uid), {
                        total_stars: increment(-indivRating),
                        project_stars: increment(-projRating),
                        total_reviews: increment(-1),
                        completed_projects: increment(-1)
                    });
                } catch (e) {
                    console.warn(`Could not reverse ratings for user ${uid}:`, e);
                }
            }
        }

        // Delete subcollections
        const subcollections = ['tasks', 'submissions', 'messages'];
        for (const sub of subcollections) {
            const snap = await getDocs(collection(db, "projects", projectId, sub));
            const promises = [];
            snap.forEach(docSnap => promises.push(deleteDoc(doc(db, "projects", projectId, sub, docSnap.id))));
            await Promise.all(promises);
        }

        // Delete project document
        await deleteDoc(doc(db, "projects", projectId));
        alert("Project deleted successfully.");
        window.location.href = currentUserRole === 'admin' ? 'admin-dashboard.html' : 'student-dashboard.html';
    } catch (e) {
        console.error("Delete project error:", e);
        alert("Failed to delete project.");
        btn.textContent = "Delete Project";
        btn.disabled = false;
    }
});

console.log("project-workspace.js loaded ✅");
