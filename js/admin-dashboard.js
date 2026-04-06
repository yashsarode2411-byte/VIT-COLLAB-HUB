import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    collection, query, where, doc, updateDoc, 
    onSnapshot, increment, getDoc, getDocs, deleteDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const logoutBtn = document.getElementById('logout-btn');
const navUserName = document.getElementById('nav-user-name');
const pendingContainer = document.getElementById('mentor-requests-container');
const activeContainer = document.getElementById('active-projects-container');
const pendingCount = document.getElementById('pending-count');
const activeCount = document.getElementById('active-count');
const fabMessages = document.getElementById('fabMessages');

if (fabMessages) {
    fabMessages.addEventListener('click', () => { window.location.href = 'messages.html'; });
}

let currentUser = null;
let currentProfile = null;

const ratingModal = document.getElementById('rating-modal');
const closeModalBtn = document.getElementById('close-modal');
const projectRating = document.getElementById('project-rating');
const submitCompletionBtn = document.getElementById('submit-completion');
let completingProjectId = null;
let currentTeamMembers = [];

// DOM Views & Tabs
const tabDashboard = document.getElementById('tab-dashboard');
const tabRequests = document.getElementById('tab-requests');
const tabProfile = document.getElementById('tab-profile');
const tabHistory = document.getElementById('tab-history');

const viewDashboard = document.getElementById('view-dashboard');
const viewRequests = document.getElementById('view-requests');
const viewProfile = document.getElementById('view-profile');
const viewHistory = document.getElementById('view-history');

function hideAllViews() {
    [tabDashboard, tabRequests, tabProfile, tabHistory].forEach(t => t.classList.remove('active'));
    [viewDashboard, viewRequests, viewProfile, viewHistory].forEach(v => v.style.display = 'none');
}

tabDashboard.addEventListener('click', () => {
    hideAllViews();
    tabDashboard.classList.add('active');
    viewDashboard.style.display = 'block';
});

tabRequests.addEventListener('click', () => {
    hideAllViews();
    tabRequests.classList.add('active');
    viewRequests.style.display = 'block';
});

tabProfile.addEventListener('click', async () => {
    hideAllViews();
    tabProfile.classList.add('active');
    viewProfile.style.display = 'block';
    
    // Auto-fill profile dynamically if data exists
    if (currentProfile) {
        document.getElementById('view-emp-id').value = currentProfile.employee_id || 'N/A';
        document.getElementById('view-name').value = currentProfile.name || 'N/A';
        document.getElementById('view-email').value = currentProfile.email || 'N/A';
        document.getElementById('view-school').value = currentProfile.school_name || 'N/A';
    }
});

tabHistory.addEventListener('click', () => {
    hideAllViews();
    tabHistory.classList.add('active');
    viewHistory.style.display = 'block';
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/html/login.html";
        return;
    }

    currentUser = user;
    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists() || docSnap.data().role !== "admin") {
        window.location.href = "/html/login.html";
        return;
    }

    currentProfile = docSnap.data();
    const empId = currentProfile.employee_id ? ` (${currentProfile.employee_id})` : '';
    navUserName.textContent = currentProfile.name + empId;

    // Load Data
    loadMentorRequests();
    loadActiveProjects();
    loadHistoryProjects();
});

function loadMentorRequests() {
    // Use the admin's real contact email from their profile (not the Firebase Auth dummy email)
    const adminContactEmail = currentProfile.email;
    
    // Query projects where this admin is in admin_emails array
    const q = query(
        collection(db, "projects"), 
        where("status", "==", "pending_mentor"),
        where("admin_emails", "array-contains", adminContactEmail)
    );
    
    // Also keep backward compat query for legacy projects with single admin_email
    const qLegacy = query(
        collection(db, "projects"), 
        where("status", "==", "pending_mentor"),
        where("admin_email", "==", adminContactEmail)
    );

    // Merge results from both queries
    const seenIds = new Set();
    
    const renderCards = (snapshot, isLegacy = false) => {
        snapshot.forEach((docSnap) => {
            if (seenIds.has(docSnap.id)) return;
            seenIds.add(docSnap.id);
            
            const project = docSnap.data();
            
            // Check if this admin already approved
            const approvedBy = project.approved_by || [];
            const alreadyApproved = approvedBy.includes(currentUser.uid);
            
            const card = document.createElement('div');
            card.className = 'item-card';

            // Build PPT link
            let pptHtml = '';
            if (project.ppt_url) {
                pptHtml = `<a href="${project.ppt_url}" target="_blank" style="color: var(--primary-blue); text-decoration: none; font-weight: 600;">
                    📎 ${project.ppt_file_name || 'View PPT'}
                </a>`;
            } else if (project.ppt_file_name) {
                pptHtml = `<span style="color: var(--muted-text);">📎 ${project.ppt_file_name} (uploaded before storage was enabled)</span>`;
            } else {
                pptHtml = `<span style="color: var(--muted-text);">No PPT attached</span>`;
            }
            
            // Show approval progress for multi-admin projects
            const totalAdmins = project.admin_emails ? project.admin_emails.length : 1;
            const approvedCount = approvedBy.length;
            let approvalHtml = '';
            if (totalAdmins > 1) {
                approvalHtml = `<p style="font-size: 0.8rem; color: var(--primary-blue); margin-top: 5px; font-weight: 600;">
                    📋 Collective Approval: ${approvedCount} / ${totalAdmins} admins approved
                </p>`;
            }

            card.innerHTML = `
                <div class="item-details">
                    <h4>${project.name || project.title || 'Untitled Project'}</h4>
                    <p>Team Size: ${project.team_members?.length || 0} / ${project.team_size || 'N/A'}</p>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 5px; font-weight: 500;">
                        Description: <span style="font-weight: 400; font-style: italic;">${project.description || 'No description provided.'}</span>
                    </p>
                    <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">Invite Code: <strong style="color: var(--primary-blue);">${project.project_code || 'N/A'}</strong></p>
                    <p style="font-size: 0.8rem; margin-top: 8px;">Presentation: ${pptHtml}</p>
                    ${approvalHtml}
                </div>
                <div class="card-actions" style="display: flex; gap: 10px;">
                    ${project.leader_uid ? `<button class="btn-secondary" onclick="window.viewMemberProfile('${project.leader_uid}')"><i class="fa-solid fa-user" style="margin-right: 4px;"></i> View Profile</button>` : ''}
                    ${alreadyApproved 
                        ? `<button class="btn-secondary" disabled style="opacity: 0.6; background: var(--success-msg); color: white;">✔ Approved</button>`
                        : `<button class="btn-secondary" onclick="window.acceptMentor('${docSnap.id}')">Accept</button>`
                    }
                    <button class="btn-secondary" style="background: var(--danger); color: white;" onclick="window.declineMentor('${docSnap.id}')">Decline</button>
                </div>
            `;
            pendingContainer.appendChild(card);
        });
    };
    
    onSnapshot(q, (snapshot) => {
        pendingCount.textContent = snapshot.size;
        pendingContainer.innerHTML = '';
        seenIds.clear();
        
        if (snapshot.empty) {
            // Also check legacy query
            getDocs(qLegacy).then(legacySnap => {
                if (legacySnap.empty) {
                    pendingContainer.innerHTML = '<p style="color: var(--muted-text); font-size: 14px; text-align: center;">No pending requests at the moment.</p>';
                    return;
                }
                renderCards(legacySnap, true);
                pendingCount.textContent = legacySnap.size;
            });
            return;
        }

        renderCards(snapshot);
    });
    
    // Also load incoming mentor transfer requests for this admin
    loadMentorTransferRequests();
}

function loadMentorTransferRequests() {
    // Query ongoing projects where a mentor change request targets this admin
    // We need to find projects with mentor_change_request.new_admin_uid == currentUser.uid
    // AND mentor_change_request.old_admin_approved == true
    // Firebase doesn't support nested field queries with onSnapshot well, so we'll use a broader query
    const qTransfer = query(
        collection(db, "projects"),
        where("status", "==", "ongoing")
    );
    
    onSnapshot(qTransfer, (snapshot) => {
        snapshot.forEach((docSnap) => {
            const project = docSnap.data();
            const mcr = project.mentor_change_request;
            
            // Only show if this admin is the NEW admin target AND old admin approved
            if (!mcr || mcr.new_admin_uid !== currentUser.uid || !mcr.old_admin_approved || mcr.new_admin_approved) return;
            
            // Check if card already exists
            if (document.getElementById(`transfer-card-${docSnap.id}`)) return;
            
            const card = document.createElement('div');
            card.className = 'item-card';
            card.id = `transfer-card-${docSnap.id}`;
            card.style.border = "1px solid var(--primary-blue)";
            card.innerHTML = `
                <div class="item-details">
                    <h4 style="color: var(--primary-blue);"><i class="fa-solid fa-arrow-right-arrow-left"></i> Mentor Transfer Incoming</h4>
                    <p style="font-weight: 600; margin-bottom: 5px;">${project.name || project.title || 'Untitled Project'}</p>
                    <p style="font-size: 0.85rem; color: var(--text-secondary);">The previous mentor has approved transferring this project's mentorship to you.</p>
                    <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">Team Size: ${project.team_members?.length || 0} members</p>
                </div>
                <div class="card-actions" style="display: flex; gap: 10px;">
                    ${project.leader_uid ? `<button class="btn-secondary" onclick="window.viewMemberProfile('${project.leader_uid}')"><i class="fa-solid fa-user" style="margin-right: 4px;"></i> View Profile</button>` : ''}
                    <button class="btn-secondary" style="background: var(--primary-blue); color: white;" onclick="window.approveMentorChangeNew('${docSnap.id}')">Accept Mentorship</button>
                    <button class="btn-secondary" style="background: var(--danger); color: white;" onclick="window.rejectMentorChange('${docSnap.id}')">Decline</button>
                </div>
            `;
            pendingContainer.appendChild(card);
        });
    });
}
function loadActiveProjects() {
    const q = query(
        collection(db, "projects"),
        where("status", "==", "ongoing"),
        where("mentor_id", "==", currentUser.uid)
    );

    onSnapshot(q, (snapshot) => {
        activeCount.textContent = snapshot.size;
        activeContainer.innerHTML = '';

        if (snapshot.empty) {
            activeContainer.innerHTML = '<p style="color: var(--muted-text); font-size: 14px; text-align: center;">You are not actively mentoring any projects.</p>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const project = docSnap.data();
            const teamArrayStr = JSON.stringify(project.team_members || []).replace(/"/g, '&quot;');
            
            const card = document.createElement('div');
            card.className = 'item-card';

            if (project.deletion_requested) {
                card.style.border = "1px solid var(--danger-msg)";
                card.innerHTML = `
                    <div class="item-details" style="flex: 1;">
                        <h4 style="color: var(--danger-msg);"><i class="fa-solid fa-triangle-exclamation"></i> Deletion Requested</h4>
                        <p style="font-weight: 600; margin-bottom: 5px;">${project.name || project.title || 'Untitled Project'}</p>
                        <p style="font-size: 0.8rem; color: var(--text-secondary);">A student has requested to permanently delete this project. Submissions and data will be lost.</p>
                    </div>
                    <div class="card-actions" style="display: flex; gap: 10px;">
                        <button class="btn-secondary" style="background: transparent; color: var(--danger-msg); border: 1px solid var(--danger-msg);" onclick="window.rejectDeletion('${docSnap.id}')">Reject</button>
                        <button class="btn-secondary" style="background: var(--danger-msg); color: white;" onclick="window.approveDeletion('${docSnap.id}')">Approve Deletion</button>
                    </div>
                `;
            } else if (project.mentor_change_request && !project.mentor_change_request.old_admin_approved) {
                // Mentor change request — old admin needs to approve
                card.style.border = "1px solid #f59e0b";
                card.innerHTML = `
                    <div class="item-details" style="flex: 1;">
                        <h4 style="color: #f59e0b;"><i class="fa-solid fa-arrows-rotate"></i> Mentor Change Requested</h4>
                        <p style="font-weight: 600; margin-bottom: 5px;">${project.name || project.title || 'Untitled Project'}</p>
                        <p style="font-size: 0.8rem; color: var(--text-secondary);">The team leader wants to transfer mentorship to: <strong style="color: var(--primary-blue);">${project.mentor_change_request.new_admin_email}</strong></p>
                    </div>
                    <div class="card-actions" style="display: flex; gap: 10px;">
                        <button class="btn-secondary" style="background: transparent; color: #f59e0b; border: 1px solid #f59e0b;" onclick="window.rejectMentorChange('${docSnap.id}')">Reject</button>
                        <button class="btn-secondary" style="background: #f59e0b; color: white;" onclick="window.approveMentorChangeOld('${docSnap.id}')">Approve Transfer</button>
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div class="item-details" style="flex: 1;">
                        <h4>${project.name || project.title || 'Untitled Project'}</h4>
                        <p>Active Submissions: ${project.submission_count || 0}</p>
                        <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">Invite Code: <strong style="color: var(--primary-blue);">${project.project_code || 'N/A'}</strong></p>
                    </div>
                    <div class="card-actions" style="display: flex; gap: 10px;">
                        ${project.leader_uid ? `<button class="btn-secondary" onclick="window.viewMemberProfile('${project.leader_uid}')"><i class="fa-solid fa-user" style="margin-right: 4px;"></i> View Profile</button>` : ''}
                        <button class="btn-secondary" onclick="window.location.href='project-workspace.html?id=${docSnap.id}'">Workspace</button>
                        <button class="btn-secondary" style="background: var(--primary-blue); color: white;" onclick="window.openCompletionModal('${docSnap.id}', '${teamArrayStr}')">✔ Finish</button>
                    </div>
                `;
            }
            activeContainer.appendChild(card);
        });
    });
}

// ─── Mentor Change Request Handlers ───
window.approveMentorChangeOld = async (projectId) => {
    if (!confirm("Approve this mentor transfer? The new admin will receive the mentorship request next.")) return;
    try {
        const projSnap = await getDoc(doc(db, "projects", projectId));
        if (!projSnap.exists()) return;
        const mcr = projSnap.data().mentor_change_request;
        
        await updateDoc(doc(db, "projects", projectId), {
            "mentor_change_request.old_admin_approved": true
        });
        
        alert("Transfer approved. The new admin must now accept to complete the change.");
    } catch (e) {
        console.error("Mentor change approval error:", e);
        alert("Failed to approve mentor change.");
    }
};

window.approveMentorChangeNew = async (projectId) => {
    if (!confirm("Accept mentorship for this project? You will become the new mentor.")) return;
    try {
        const projSnap = await getDoc(doc(db, "projects", projectId));
        if (!projSnap.exists()) return;
        const mcr = projSnap.data().mentor_change_request;
        
        // Both approved — complete the transfer
        await updateDoc(doc(db, "projects", projectId), {
            mentor_id: currentUser.uid,
            mentor: currentProfile.name || "Mentor",
            admin_email: mcr.new_admin_email,
            admin_emails: [mcr.new_admin_email],
            admin_uids: [currentUser.uid],
            approved_by: [currentUser.uid],
            mentor_change_request: null // clear the request
        });
        
        alert("Mentor transfer complete! You are now the mentor for this project.");
    } catch (e) {
        console.error("Mentor change accept error:", e);
        alert("Failed to accept mentorship.");
    }
};

window.rejectMentorChange = async (projectId) => {
    if (!confirm("Reject this mentor change request?")) return;
    try {
        await updateDoc(doc(db, "projects", projectId), {
            mentor_change_request: null
        });
        alert("Mentor change request rejected.");
    } catch (e) {
        console.error("Mentor change reject error:", e);
        alert("Failed to reject mentor change.");
    }
};

// Global scope functions for inline HTML calls
window.acceptMentor = async (projectId) => {
    try {
        const projSnap = await getDoc(doc(db, "projects", projectId));
        if (!projSnap.exists()) return alert("Project not found.");
        
        const projData = projSnap.data();
        const adminEmails = projData.admin_emails || [projData.admin_email];
        const approvedBy = projData.approved_by || [];
        
        // Add current admin to approved_by
        if (!approvedBy.includes(currentUser.uid)) {
            approvedBy.push(currentUser.uid);
        }
        
        // Check if ALL admins have now approved
        const adminUids = projData.admin_uids || [];
        const allApproved = adminUids.length > 0 
            ? adminUids.every(uid => approvedBy.includes(uid))
            : approvedBy.length >= adminEmails.length;
        
        if (allApproved) {
            // All admins approved — project goes live with the last approving admin as mentor
            await updateDoc(doc(db, "projects", projectId), {
                status: "ongoing",
                mentor_id: currentUser.uid,
                mentor: currentProfile.name || "Mentor",
                approved_by: approvedBy
            });
            alert("All admins have approved! Project is now ONGOING. You are assigned as the primary mentor.");
        } else {
            // Partial approval — update approved_by and wait for others
            await updateDoc(doc(db, "projects", projectId), {
                approved_by: approvedBy
            });
            alert(`Your approval recorded! Waiting for ${adminEmails.length - approvedBy.length} more admin(s) to approve.`);
        }
    } catch (e) {
        console.error("Failed to accept project", e);
        alert("Failed to accept project. Check permissions.");
    }
};

window.declineMentor = async (projectId) => {
    if(!confirm("Are you sure you want to decline this mentor request?")) return;
    try {
        const projSnap = await getDoc(doc(db, "projects", projectId));
        if (!projSnap.exists()) return;
        
        const projData = projSnap.data();
        const adminEmails = projData.admin_emails || [projData.admin_email];
        const adminUids = projData.admin_uids || [];
        
        // Remove this admin from the lists
        const updatedEmails = adminEmails.filter(e => e !== currentProfile.email);
        const updatedUids = adminUids.filter(uid => uid !== currentUser.uid);
        const updatedApproved = (projData.approved_by || []).filter(uid => uid !== currentUser.uid);
        
        if (updatedEmails.length === 0) {
            // Last admin declined — delete the project
            await deleteDoc(doc(db, "projects", projectId));
            alert("You were the last admin. Project request has been deleted.");
        } else {
            // Remove this admin but keep the project for remaining admins
            await updateDoc(doc(db, "projects", projectId), {
                admin_emails: updatedEmails,
                admin_uids: updatedUids,
                admin_email: updatedEmails[0], // backward compat
                approved_by: updatedApproved
            });
            alert("You have declined this request. The remaining admin(s) can still approve.");
        }
    } catch (e) {
        console.error("Failed to decline project", e);
        alert("Failed to decline project. Check permissions.");
    }
};

window.viewMemberProfile = async (userId) => {
    const profileOverlay = document.getElementById('profileModalOverlay');
    if (!profileOverlay) return;

    try {
        const memSnap = await getDoc(doc(db, "users", userId));
        if (!memSnap.exists()) {
            showToast("User profile not found.", "error");
            return;
        }
        const mem = memSnap.data();

        document.getElementById('modalAvatar').src = mem.avatar_url || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
        document.getElementById('modalName').textContent = mem.name || "Student";
        document.getElementById('modalBranch').textContent = mem.branch || "Branch TBD";

        if (mem.total_reviews && mem.total_reviews > 0) {
            const rating = (mem.total_stars / mem.total_reviews).toFixed(1);
            document.getElementById('modalRatingContainer').innerHTML = `<i class="fa-solid fa-star" style="color: #f59e0b; margin-right: 6px;"></i><span id="modalRating">${rating}</span> / 5.0 Rating`;
        } else {
            document.getElementById('modalRatingContainer').innerHTML = `No Rating`;
        }
        document.getElementById('modalRatingContainer').style.display = 'inline-block';

        const top3Skills = Array.isArray(mem.top3_skills) && mem.top3_skills.length > 0
            ? mem.top3_skills
            : (Array.isArray(mem.skills) ? mem.skills.slice(0, 3) : []);

        const topPillsHTML = top3Skills.map(skill => `<span class="skill-pill" style="display:inline-block; padding:4px 10px; border-radius:12px; font-size:0.8rem; font-weight:500; background:rgba(13,110,253,0.1); color:var(--primary-blue); margin-right:6px; margin-bottom:6px;">${skill}</span>`).join('');
        document.getElementById('modalTopSkills').innerHTML = topPillsHTML || '<span class="text-muted" style="font-size:0.8rem;">No top skills</span>';

        const linksContainer = document.getElementById('modalLinks');
        let linksHTML = '';
        if (mem.github) {
            linksHTML += `<a href="${mem.github}" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: #24292e; color: white; border-radius: 10px; text-decoration: none; font-size: 13px; font-weight: 600; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                <i class="fa-brands fa-github" style="font-size: 16px;"></i> GitHub
            </a>`;
        }
        if (mem.linkedin) {
            linksHTML += `<a href="${mem.linkedin}" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: #0a66c2; color: white; border-radius: 10px; text-decoration: none; font-size: 13px; font-weight: 600; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                <i class="fa-brands fa-linkedin" style="font-size: 16px;"></i> LinkedIn
            </a>`;
        }
        if (!linksHTML) {
            linksHTML = '<span class="text-muted" style="font-size: 0.8rem;">No profile links available</span>';
        }
        linksContainer.innerHTML = linksHTML;

        const viewFullBtn = document.getElementById('viewFullProfileBtn');
        if (viewFullBtn) {
            viewFullBtn.onclick = () => {
                window.location.href = `profile-view.html?uid=${userId}`;
            };
        }

        const modalMsgBtn = document.getElementById('modalMessageBtn');
        if (modalMsgBtn) {
            modalMsgBtn.onclick = () => {
                window.location.href = `messages.html?userId=${userId}`;
            };
        }

        profileOverlay.style.display = 'flex';
    } catch(err) {
        console.error("Error fetching user profile", err);
        alert("Failed to load user profile");
    }
};

// Modal Close logic
document.addEventListener("DOMContentLoaded", () => {
    const closeBtn = document.getElementById('closeProfileModalBtn');
    if(closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('profileModalOverlay').style.display = 'none';
        });
    }
    const overlay = document.getElementById('profileModalOverlay');
    if(overlay) {
        overlay.addEventListener('click', (e) => {
            if(e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    }
});

window.openCompletionModal = async (projectId, teamArrayStr) => {
    completingProjectId = projectId;
    try {
        currentTeamMembers = JSON.parse(teamArrayStr);
    } catch(e) {
        currentTeamMembers = [];
    }
    ratingModal.style.display = 'flex';
    
    // Load student names dynamically to render individualized rating selectors
    const container = document.getElementById('individual-ratings-container');
    container.innerHTML = '<p style="font-size: 13px; color: var(--muted-text); text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading team members...</p>';
    
    let htmlBuffer = '';
    
    for (const uid of currentTeamMembers) {
        let memberName = "Student";
        try {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists() && userSnap.data().name) {
                memberName = userSnap.data().name;
            }
        } catch (err) {
            console.error(err);
        }
        
        htmlBuffer += `
            <div style="margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                <label style="font-size: 13px; font-weight: 500; color: var(--dark-text); max-width: 50%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${memberName}</label>
                <select class="input-field individual-student-rating" data-uid="${uid}" style="width: 50%; max-width: 180px; padding: 6px; font-size: 13px; cursor: pointer; height: auto;">
                    <option value="5">⭐⭐⭐⭐⭐ 5</option>
                    <option value="4">⭐⭐⭐⭐ 4</option>
                    <option value="3">⭐⭐⭐ 3</option>
                    <option value="2">⭐⭐ 2</option>
                    <option value="1">⭐ 1</option>
                </select>
            </div>
        `;
    }
    
    if (htmlBuffer === '') {
        container.innerHTML = '<p style="font-size: 13px; color: var(--danger);">No team members found.</p>';
    } else {
        container.innerHTML = htmlBuffer;
    }
};

closeModalBtn.addEventListener('click', () => {
    ratingModal.style.display = 'none';
    completingProjectId = null;
    currentTeamMembers = [];
});

submitCompletionBtn.addEventListener('click', async () => {
    if (!completingProjectId) return;
    const projRating = parseInt(projectRating.value, 10);
    
    submitCompletionBtn.textContent = "Processing...";
    submitCompletionBtn.disabled = true;

    try {
        // Collect all individual ratings
        const selectElements = document.querySelectorAll('.individual-student-rating');
        const individualRatingsMap = {};
        selectElements.forEach(select => {
            const uid = select.getAttribute('data-uid');
            individualRatingsMap[uid] = parseInt(select.value, 10);
        });

        console.log("Step 1: Updating project status...");
        await updateDoc(doc(db, "projects", completingProjectId), {
            status: "completed",
            project_rating: projRating,
            individual_ratings: individualRatingsMap,
            rating: projRating
        });
        console.log("Step 1 SUCCESS: Project marked completed.");

        // Apply individual rating to each team member's profile
        for (const uid of currentTeamMembers) {
            const indivRating = individualRatingsMap[uid] || projRating;
            console.log(`Step 2: Updating user ${uid} with rating ${indivRating}...`);
            await updateDoc(doc(db, "users", uid), {
                total_stars: increment(indivRating),
                project_stars: increment(projRating),
                total_reviews: increment(1),
                completed_projects: increment(1)
            });
            console.log(`Step 2 SUCCESS: User ${uid} updated.`);
        }
        
        ratingModal.style.display = 'none';
        alert("Project completed successfully! Ratings have been appropriately applied to all students.");
    } catch (e) {
        console.error("Failed to complete project:", e.code, e.message);
        alert(`Failed to complete project.\nError: ${e.code || 'unknown'}\nDetails: ${e.message}`);
    } finally {
        submitCompletionBtn.textContent = "Finalize Project";
        submitCompletionBtn.disabled = false;
        completingProjectId = null;
        currentTeamMembers = [];
    }
});

// Navigate back
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (e) {
        console.error("Logout failed", e);
    }
});

// ─── Project Deletion Approval Handlers ───
window.rejectDeletion = async (projectId) => {
    if(!confirm("Reject this deletion request? The project will remain active.")) return;
    try {
        await updateDoc(doc(db, "projects", projectId), {
            deletion_requested: deleteField(),
            deletion_requested_by: deleteField()
        });
        alert("Deletion request rejected. Project re-activated.");
    } catch(e) {
        console.error(e);
        alert("Failed to reject deletion request.");
    }
};

window.approveDeletion = async (projectId) => {
    if(!confirm("WARNING: Approving this will permanently delete the project and all associated sub-data. Continue?")) return;
    try {
        const projSnap = await getDoc(doc(db, "projects", projectId));
        let pData = null;
        if(projSnap.exists()) pData = projSnap.data();

        // Attempt to clean orphaned subcollections
        try {
            const subcollections = ['tasks', 'submissions', 'messages'];
            for (const sub of subcollections) {
                const snap = await getDocs(collection(db, "projects", projectId, sub));
                const promises = [];
                snap.forEach(docSnap => promises.push(deleteDoc(doc(db, "projects", projectId, sub, docSnap.id))));
                await Promise.all(promises);
            }
        } catch(e) { console.warn("Failed deleting subcollections during approval.", e); }
        
        // Delete main document
        await deleteDoc(doc(db, "projects", projectId));

        // If the project was already completed, roll back member statistics to prevent inflation
        if (pData && pData.status === "completed") {
            const members = pData.team_members || [];
            const pRating = pData.project_rating || pData.rating || 0;
            const indRatings = pData.individual_ratings || {};
            for(const uid of members) {
                const iRating = indRatings[uid] || pRating;
                try {
                    await updateDoc(doc(db, "users", uid), {
                        total_stars: increment(-iRating),
                        project_stars: increment(-pRating),
                        total_reviews: increment(-1),
                        completed_projects: increment(-1)
                    });
                } catch(err) { console.warn("Failed to rollback stats for " + uid, err); }
            }
        }

        alert("Deletion approved and project destroyed.");
    } catch(e) {
        console.error(e);
        alert("Failed to delete project.");
    }
};

function loadHistoryProjects() {
    const historyContainer = document.getElementById('history-container');
    const q = query(
        collection(db, "projects"),
        where("status", "==", "completed"),
        where("mentor_id", "==", currentUser.uid)
    );

    onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            historyContainer.innerHTML = '<p style="color: var(--muted-text); font-size: 14px; text-align: center;">No completed projects found in your history.</p>';
            return;
        }

        historyContainer.innerHTML = ''; // prevent flickering from async loops

        for (const docSnap of snapshot.docs) {
            const project = docSnap.data();
            
            // Build member list securely
            let membersHtml = '';
            if (project.team_members && project.team_members.length > 0) {
                for (const uid of project.team_members) {
                    try {
                        const userSnap = await getDoc(doc(db, "users", uid));
                        let name = "Student";
                        let reg = "N/A";
                        if (userSnap.exists()) {
                            name = userSnap.data().name || "Student";
                            reg = userSnap.data().registration_number || uid.substring(0,6);
                        }
                        
                        let starGiven = project.project_rating || 0;
                        if (project.individual_ratings && project.individual_ratings[uid]) {
                            starGiven = project.individual_ratings[uid];
                        }

                        membersHtml += `
                            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: rgba(0,0,0,0.03); border-radius: 8px; margin-top: 4px;">
                                <div style="font-size: 13px;">
                                    <strong>${name}</strong> <span style="color: var(--muted-text);">(${reg})</span>
                                </div>
                                <div>
                                    <span style="font-size: 12px; font-weight: bold; color: var(--gold); margin-right: 15px;"><i class="fa-solid fa-star"></i> ${starGiven}</span>
                                    <a href="#" onclick="window.viewMemberProfile('${uid}'); return false;" style="font-size: 12px; color: var(--primary-blue); font-weight: 600; text-decoration: none;">View Profile</a>
                                </div>
                            </div>
                        `;
                    } catch (e) {
                        console.error(e);
                    }
                }
            } else {
                membersHtml = '<p style="font-size: 13px; color: var(--muted-text);">No team members recorded.</p>';
            }

            const card = document.createElement('div');
            card.className = 'item-card';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'stretch';
            
            if (project.deletion_requested) {
                card.style.border = "1px solid var(--danger-msg)";
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--danger-msg); padding-bottom: 10px;">
                        <div>
                            <h4 style="margin: 0; font-size: 16px; color: var(--danger-msg);"><i class="fa-solid fa-triangle-exclamation"></i> Deletion Requested</h4>
                            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">This completed project relies on your approval to be permanently deleted.</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <button class="btn-secondary" style="flex: 1; background: transparent; color: var(--danger-msg); border: 1px solid var(--danger-msg);" onclick="window.rejectDeletion('${docSnap.id}')">Reject Deletion</button>
                        <button class="btn-secondary" style="flex: 1; background: var(--danger-msg); color: white;" onclick="window.approveDeletion('${docSnap.id}')">Approve and Destroy</button>
                    </div>
                    <div style="background: var(--card-bg); border-radius: 8px;">
                        <p style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px;">AFFECTED MEMBER RATINGS</p>
                        ${membersHtml}
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                        <div>
                            <h4 style="margin: 0; font-size: 16px;">${project.name || project.title || 'Untitled Project'}</h4>
                            <p style="font-size: 12px; color: var(--muted-text); margin-top: 2px;">Completed on ${project.completed_at ? new Date(project.completed_at.toDate()).toLocaleDateString() : 'Unknown Date'}</p>
                        </div>
                        <div style="background: rgba(245, 158, 11, 0.1); color: #b45309; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 14px; border: 1px solid rgba(245, 158, 11, 0.2);">
                            <i class="fa-solid fa-star" style="color: #f59e0b; margin-right: 4px;"></i>${project.project_rating || 0} / 5
                        </div>
                    </div>
                    <div style="background: var(--card-bg); border-radius: 8px;">
                        <p style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px;">MEMBER RATINGS</p>
                        ${membersHtml}
                    </div>
                `;
            }
            historyContainer.appendChild(card);
        }
    });
}
