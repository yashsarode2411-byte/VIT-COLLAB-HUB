/**
 * student-dashboard.js
 * Handles populating the student dashboard UI elements including Active Projects,
 * Pending Invites, and Upcoming Hackathons. Interfaces with Firebase Firestore.
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit, addDoc, updateDoc, serverTimestamp, arrayUnion, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";


function setupUI() {
    // New Project Modal
    const newProjBtn = document.getElementById('createNewProjectBtn');
    const newProjModal = document.getElementById('newProjectModal');
    console.log("Setting up New Project Button:", newProjBtn);
    console.log("Setting up New Project Modal:", newProjModal);
    
    if (newProjBtn && newProjModal) {
        newProjBtn.addEventListener('click', (e) => {
            newProjModal.style.display = 'flex';
            setTimeout(() => newProjModal.classList.add('active'), 10);
        });
        document.getElementById('closeNewProjectModalBtn').addEventListener('click', () => {
            newProjModal.classList.remove('active');
            setTimeout(() => newProjModal.style.display = 'none', 300);
        });
    }

    // Join Project Modal
    const joinProjBtn = document.getElementById('joinProjectBtn');
    const joinProjModal = document.getElementById('joinProjectModal');
    if (joinProjBtn && joinProjModal) {
        joinProjBtn.addEventListener('click', () => {
            joinProjModal.style.display = 'flex';
            setTimeout(() => joinProjModal.classList.add('active'), 10);
        });
        document.getElementById('closeJoinProjectModalBtn').addEventListener('click', () => {
            joinProjModal.classList.remove('active');
            setTimeout(() => joinProjModal.style.display = 'none', 300);
        });
    }

    // Modal Overlays Click-to-close
    window.addEventListener('click', (e) => {
        if (e.target === newProjModal) {
            newProjModal.classList.remove('active');
            setTimeout(() => newProjModal.style.display = 'none', 300);
        }
        if (e.target === joinProjModal) {
            joinProjModal.classList.remove('active');
            setTimeout(() => joinProjModal.style.display = 'none', 300);
        }
    });

    handleFormsHooks();

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(auth).then(() => {
                window.location.href = 'login.html';
            });
        });
    }

    // Profile Dropdown Toggle
    const profileMenu = document.getElementById('profileMenu');
    const profileDropdownContent = document.getElementById('profileDropdownContent');
    if (profileMenu && profileDropdownContent) {
        profileMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdownContent.style.display = profileDropdownContent.style.display === 'block' ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!profileMenu.contains(e.target) && !profileDropdownContent.contains(e.target)) {
                profileDropdownContent.style.display = 'none';
            }
        });
    }

    // Side Chat Panel Toggle
    const fabMessages = document.getElementById('fabMessages');
    const sideChatPanel = document.getElementById('sideChatPanel');
    const sideChatOverlay = document.getElementById('sideChatOverlay');
    const closeChatPanelBtn = document.getElementById('closeChatPanelBtn');

    if (fabMessages && sideChatPanel && sideChatOverlay && closeChatPanelBtn) {
        const toggleChatPanel = (show) => {
            sideChatPanel.style.right = show ? '0' : '-450px';
            sideChatOverlay.style.display = show ? 'block' : 'none';
        };

        fabMessages.addEventListener('click', () => toggleChatPanel(true));
        closeChatPanelBtn.addEventListener('click', () => toggleChatPanel(false));
        sideChatOverlay.addEventListener('click', () => toggleChatPanel(false));
    }
}

function handleFormsHooks() {
    const newForm = document.getElementById('newProjectForm');
    const fetchForm = document.getElementById('fetchProjectForm');
    const confirmJoinForm = document.getElementById('confirmJoinForm');

    // Dynamic member reg number inputs for project creation
    const projTeamSize = document.getElementById('projTeamSize');
    const projMembersContainer = document.getElementById('projMembersContainer');
    if (projTeamSize && projMembersContainer) {
        projTeamSize.addEventListener('change', () => {
            const size = parseInt(projTeamSize.value, 10);
            projMembersContainer.innerHTML = '';
            // size includes the leader, so generate (size - 1) member fields
            for (let i = 1; i < size; i++) {
                projMembersContainer.innerHTML += `
                    <div class="form-group" style="margin-top: 10px;">
                        <label class="form-label">Reg No. of Member ${i} <span style="color: var(--danger);">*</span></label>
                        <input type="text" class="form-input proj-member-reg" placeholder="e.g. 24BCE100${i}" required>
                    </div>
                `;
            }
        });
    }

    if (newForm) {
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submitProjectBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Checking Admin...';
            btn.disabled = true;

            try {
                // 1. Verify Admin Email
                const adminEmail = document.getElementById('projAdminEmail').value.trim();
                const qAdmin = query(collection(db, "users"), where("email", "==", adminEmail), where("role", "==", "admin"));
                const adminSnap = await getDocs(qAdmin);
                
                if (adminSnap.empty) {
                    alert("Invalid Admin Email. No active admin matches this address.");
                    return;
                }
                const adminId = adminSnap.docs[0].id;

                // 2. Generate 6-char Alpha-numeric code
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let code = '';
                for (let i = 0; i < 6; i++) {
                    code += chars.charAt(Math.floor(Math.random() * chars.length));
                }

                // 3. Post to Projects Collection
                btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating...';
                
                const pptLink = document.getElementById('projPptLink').value.trim();

                // Collect member reg numbers
                const memberRegInputs = document.querySelectorAll('.proj-member-reg');
                const membersReg = [];
                memberRegInputs.forEach(input => {
                    if (input.value.trim()) membersReg.push(input.value.trim());
                });

                const projData = {
                    name: document.getElementById('projTitle').value.trim(),
                    description: document.getElementById('projDesc').value.trim(),
                    team_size: parseInt(document.getElementById('projTeamSize').value),
                    skills: document.getElementById('projSkills').value.split(',').map(s=>s.trim()).filter(Boolean),
                    leader_reg: document.getElementById('projLeaderReg').value.trim(),
                    leader_uid: auth.currentUser.uid,
                    ppt_url: pptLink || null,
                    members_reg: membersReg,
                    team_members: [auth.currentUser.uid],
                    admin_email: adminEmail,
                    admin_uid: adminId,
                    project_code: code,
                    status: "pending_mentor",
                    created_at: serverTimestamp(),
                    tags: document.getElementById('projSkills').value.split(',').map(s=>s.trim()).filter(Boolean).slice(0, 3)
                };

                await addDoc(collection(db, "projects"), projData);
                
                alert(`Project request sent to Admin!\n\nYour Unique Invite Code is: ${code}\nShare this with members to allow them to join.`);
                document.getElementById('newProjectModal').style.display = 'none';
                newForm.reset();
                
                // Refresh list locally
                if (auth.currentUser) fetchActiveProjects(auth.currentUser.uid);

            } catch (err) {
                console.error("Project Creation Error:", err);
                alert("Failed to create project.");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    if (fetchForm) {
        fetchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('fetchProjectBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Fetching...';
            btn.disabled = true;

            try {
                const joinCode = document.getElementById('joinProjectCode').value.trim().toUpperCase();
                const qJoin = query(collection(db, "projects"), where("project_code", "==", joinCode));
                const snapJoin = await getDocs(qJoin);

                if (snapJoin.empty) {
                    alert("Invalid or expired Project Code.");
                    document.getElementById('projectDetailsCard').style.display = 'none';
                    return;
                }

                const projDoc = snapJoin.docs[0];
                const projId = projDoc.id;
                const projData = projDoc.data();

                if (projData.team_members && projData.team_members.includes(auth.currentUser.uid)) {
                    alert("You are already in this project.");
                    return;
                }

                document.getElementById('fetchedProjTitle').textContent = projData.name || projData.title || 'Untitled';
                document.getElementById('fetchedProjDesc').textContent = projData.description || 'No description provided.';
                document.getElementById('fetchedProjLeader').textContent = projData.leader_reg || 'Unknown';
                
                const currentCount = projData.team_members ? projData.team_members.length : 0;
                const maxCount = projData.team_size || 6;
                document.getElementById('fetchedProjSlots').textContent = `${currentCount} / ${maxCount}`;
                
                const confirmBtn = document.getElementById('confirmJoinBtn');
                if (currentCount >= maxCount) {
                    document.getElementById('fetchedProjSlots').style.color = 'var(--danger)';
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = "Team Full";
                } else {
                    document.getElementById('fetchedProjSlots').style.color = 'var(--success-msg)';
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = "Confirm Join";
                }

                document.getElementById('confirmedProjId').value = projId;
                document.getElementById('projectDetailsCard').style.display = 'block';

            } catch (err) {
                console.error("Fetch Project Error:", err);
                alert("Failed to fetch project.");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    if (confirmJoinForm) {
        confirmJoinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('confirmJoinBtn');
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Joining...';
            btn.disabled = true;

            try {
                const projId = document.getElementById('confirmedProjId').value;
                await updateDoc(doc(db, "projects", projId), {
                    team_members: arrayUnion(auth.currentUser.uid)
                });

                alert("You have successfully joined the project!");
                document.getElementById('joinProjectModal').style.display = 'none';
                document.getElementById('projectDetailsCard').style.display = 'none';
                fetchForm.reset();

                if (auth.currentUser) fetchActiveProjects(auth.currentUser.uid);
            } catch (err) {
                console.error("Join Project Error:", err);
                alert("Failed to join project.");
                btn.innerHTML = 'Confirm Join';
                btn.disabled = false;
            }
        });
    }
}

let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            
            if (currentUserData.role !== "student") {
                window.location.href = `${currentUserData.role}-dashboard.html`;
                return;
            }

            // Update greeting
            const fullName = currentUserData.name || "Student";
            const firstName = currentUserData.name ? currentUserData.name.split(' ')[0] : "Student";
            document.getElementById('nav-user-name').textContent = fullName;
            document.getElementById('welcomeMessage').innerHTML = `Welcome back, <span class="text-gradient">${firstName}</span>!`;

            // Setup UI bindings now that auth is ready
            setupUI();

            // Fetch dashboard data concurrently
            await Promise.all([
                fetchActiveProjects(user.uid),
                fetchPendingInvites(user.uid)
            ]);
            
        } else {
            window.location.href = "student-profile-setup.html";
        }
    } catch (error) {
        console.error("Dashboard initialization full-failure:", error);
        showToast("Error loading dashboard data. Please refresh.", "error");
    }
});

/**
 * Fetches and renders active projects for the given user.
 * Real DB: db.collection("projects").where("team_members", "array-contains", uid)
 */
async function fetchActiveProjects(uid) {
    const container = document.getElementById('projectsContainer');
    
    try {
        const q = query(collection(db, "projects"), where("team_members", "array-contains", uid));
        const querySnapshot = await getDocs(q);

        container.innerHTML = ''; // Clear skeleton

        if (querySnapshot.empty) {
            container.innerHTML = `
                <div class="card" style="text-align:center; padding: 40px;">
                    <h3 class="text-muted">No active projects yet.</h3>
                </div>
            `;
            return;
        }

        querySnapshot.forEach(docSnap => {
            const project = docSnap.data();
            const projectId = docSnap.id;

            const statusBadgeClasses = {
                'ongoing': 'status-ongoing',
                'pending_mentor': 'status-pending',
                'pending_team': 'status-pending',
                'completed': 'status-info'
            };
            const statusText = {
                'ongoing': '<i class="fa-solid fa-spinner fa-spin-pulse"></i> Ongoing',
                'pending_mentor': '<i class="fa-solid fa-hourglass-half"></i> Awaiting Mentor',
                'pending_team': '<i class="fa-solid fa-user-plus"></i> Forming Team',
                'completed': '<i class="fa-solid fa-check"></i> Completed'
            };

            const techStack = Array.isArray(project.tags) ? project.tags : [];
            const pillsHTML = techStack.slice(0, 3).map(tech => `<span class="tech-pill">${tech}</span>`).join('');
            const extraPills = techStack.length > 3 ? `<span class="tech-pill">+${techStack.length - 3}</span>` : '';

            const teamCount = project.team_members ? project.team_members.length : 1;
            let avatarsHTML = '';
            for(let i=1; i<=Math.min(3, teamCount); i++) {
                avatarsHTML += `<img src="https://i.pravatar.cc/150?img=${10+i}" alt="Team member" class="team-avatar" title="Team Member">`;
            }
            if(teamCount > 3) {
                avatarsHTML += `<div class="avatar-more">+${teamCount - 3}</div>`;
            }

            const projectElement = document.createElement('div');
            projectElement.className = 'card project-card';
            projectElement.innerHTML = `
                <div class="project-info">
                    <div class="project-header">
                        <div>
                            <h3 class="project-title">${project.name || project.title || 'Untitled Project'}</h3>
                            <span class="status ${statusBadgeClasses[project.status] || 'status-info'}">
                                ${statusText[project.status] || project.status.replace('_', ' ').toUpperCase()}
                            </span>
                        </div>
                    </div>
                    <div style="margin-top: 5px; font-size: 0.85rem; color: var(--text-secondary);">
                        Invite Code: <strong style="color: var(--primary-blue); letter-spacing: 1px;">${project.project_code || 'N/A'}</strong>
                    </div>
                    
                    <div class="project-tech-stack">
                        ${pillsHTML}${extraPills}
                    </div>
                    
                    <div class="project-meta">
                        <div class="team-avatar-group">
                            ${avatarsHTML}
                        </div>
                        <span><i class="fa-solid fa-user-tie"></i> ${project.mentor || 'No Mentor Assigned'}</span>
                    </div>
                </div>
                
                <div class="project-actions">
                    <button class="btn btn-primary" onclick="window.location.href='project-workspace.html?id=${projectId}'">
                        Open Workspace <i class="fa-solid fa-arrow-right"></i>
                    </button>
                    <button class="btn btn-outline" onclick="window.openProjectSettings('${projectId}', '${project.leader_uid||''}')">
                        <i class="fa-solid fa-gear"></i> Settings
                    </button>
                </div>
            `;
            container.appendChild(projectElement);
        });

    } catch (error) {
        console.error("Error fetching projects:", error);
        container.innerHTML = '<div class="text-center text-danger" style="padding:10px;">Error loading projects.</div>';
    }
}

/**
 * Handles Project Settings / Deletion logic for project leaders.
 */
window.openProjectSettings = async (projectId, leaderUid) => {
    if (!auth.currentUser || auth.currentUser.uid !== leaderUid) {
        alert("Only the Project Leader can manage or delete this project.");
        return;
    }
    
    if(confirm("Are you sure you want to permanently delete this project? This action cannot be undone.")) {
        try {
            // Fetch project to see if we need to revert stats
            const projSnap = await getDoc(doc(db, "projects", projectId));
            if(projSnap.exists()) {
                const pData = projSnap.data();
                if(pData.status === "completed") {
                    const pRating = pData.project_rating || pData.rating || 0;
                    const members = pData.team_members || [];
                    const indRatings = pData.individual_ratings || {};
                    
                    // Revert stats for all members
                    for(const uid of members) {
                        const iRating = indRatings[uid] || pRating;
                        await updateDoc(doc(db, "users", uid), {
                            total_stars: increment(-iRating),
                            project_stars: increment(-pRating),
                            total_reviews: increment(-1),
                            completed_projects: increment(-1)
                        });
                    }
                }
            }
            
            await deleteDoc(doc(db, "projects", projectId));
            alert("Project successfully deleted.");
            if (auth.currentUser) fetchActiveProjects(auth.currentUser.uid); // reload
        } catch(e) {
            console.error("Project deletion error:", e);
            alert("Failed to delete project. Please check if you have required permissions.");
        }
    }
};

/**
 * Fetches pending team invites.
 * Real DB: db.collection("notifications").where("user_id", "==", uid).where("type", "==", "invite")
 */
async function fetchPendingInvites(uid) {
    const container = document.getElementById('invitesContainer');
    
    try {
        const q = query(collection(db, "notifications"), where("user_id", "==", uid), where("is_read", "==", false));
        const querySnapshot = await getDocs(q);

        container.innerHTML = '';

        if (querySnapshot.empty) {
            container.innerHTML = `<div class="text-center text-muted" style="padding: 10px;">No pending invites.</div>`;
            return;
        }

        querySnapshot.forEach(docSnap => {
            const invite = docSnap.data();
            const el = document.createElement('div');
            el.className = 'invite-item';
            el.innerHTML = `
                <div class="invite-header">
                    <div class="invite-icon">
                        <i class="fa-solid fa-user-plus"></i>
                    </div>
                    <div class="invite-details">
                        <h4>Notification</h4>
                        <p>${invite.message}</p>
                    </div>
                </div>
                <div class="invite-actions">
                    <button class="btn btn-primary btn-sm accept-btn" data-id="${docSnap.id}">Dismiss</button>
                </div>
            `;
            container.appendChild(el);
        });

        // Add dynamically listeners
        document.querySelectorAll('.accept-btn').forEach(btn => {
            btn.addEventListener('click', (e) => handleInviteAction(e.target.dataset.id, 'dismiss'));
        });
        
    } catch(err) {
        console.error("Error loading notifications:", err);
    }
}

function handleInviteAction(inviteId, action) {
    // DB interaction would happen here
    showToast(`Invite ${action}ed successfully!`, "success");
    // Optimistic UI updates - remove element
    fetchPendingInvites("mockUid"); // reload invites
}



/**
 * Utility: Show Toast Alert
 */
function showToast(message, type = "info") {
    // In production, integrate a proper toast library or custom logic
    console.log(`[Toast - ${type.toUpperCase()}]: ${message}`);
}

console.log("JS LOADED SUCCESSFULLY");
