import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    collection, query, where, doc, updateDoc, 
    onSnapshot, increment, getDoc, deleteDoc
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

const viewDashboard = document.getElementById('view-dashboard');
const viewRequests = document.getElementById('view-requests');
const viewProfile = document.getElementById('view-profile');

function hideAllViews() {
    [tabDashboard, tabRequests, tabProfile].forEach(t => t.classList.remove('active'));
    [viewDashboard, viewRequests, viewProfile].forEach(v => v.style.display = 'none');
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
});

function loadMentorRequests() {
    // Use the admin's real contact email from their profile (not the Firebase Auth dummy email)
    const adminContactEmail = currentProfile.email;
    const q = query(
        collection(db, "projects"), 
        where("status", "==", "pending_mentor"),
        where("admin_email", "==", adminContactEmail)
    );
    
    onSnapshot(q, (snapshot) => {
        pendingCount.textContent = snapshot.size;
        pendingContainer.innerHTML = '';
        
        if (snapshot.empty) {
            pendingContainer.innerHTML = '<p style="color: var(--muted-text); font-size: 14px; text-align: center;">No pending requests at the moment.</p>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const project = docSnap.data();
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

            card.innerHTML = `
                <div class="item-details">
                    <h4>${project.name || project.title || 'Untitled Project'}</h4>
                    <p>Team Size: ${project.team_members?.length || 0} / ${project.team_size || 'N/A'}</p>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 5px; font-weight: 500;">
                        Description: <span style="font-weight: 400; font-style: italic;">${project.description || 'No description provided.'}</span>
                    </p>
                    <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">Invite Code: <strong style="color: var(--primary-blue);">${project.project_code || 'N/A'}</strong></p>
                    <p style="font-size: 0.8rem; margin-top: 8px;">Presentation: ${pptHtml}</p>
                </div>
                <div class="card-actions" style="display: flex; gap: 10px;">
                    ${project.leader_uid ? `<button class="btn-secondary" onclick="window.viewMemberProfile('${project.leader_uid}')"><i class="fa-solid fa-user" style="margin-right: 4px;"></i> View Profile</button>` : ''}
                    <button class="btn-secondary" onclick="window.acceptMentor('${docSnap.id}')">Accept</button>
                    <button class="btn-secondary" style="background: var(--danger); color: white;" onclick="window.declineMentor('${docSnap.id}')">Decline</button>
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
            card.innerHTML = `
                <div class="item-details" style="flex: 1;">
                    <h4>${project.name || project.title || 'Untitled Project'}</h4>
                    <p>Active Submissions: ${project.submission_count || 0}</p>
                    <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">Invite Code: <strong style="color: var(--primary-blue);">${project.project_code || 'N/A'}</strong></p>
                </div>
                <div class="card-actions" style="display: flex; gap: 10px;">
                    ${project.leader_uid ? `<button class="btn-secondary" onclick="window.viewMemberProfile('${project.leader_uid}')"><i class="fa-solid fa-user" style="margin-right: 4px;"></i> View Profile</button>` : ''}
                    <button class="btn-secondary" onclick="window.location.href='/html/project-workspace.html?id=${docSnap.id}'">Workspace</button>
                    <button class="btn-secondary" style="background: var(--primary-blue); color: white;" onclick="window.openCompletionModal('${docSnap.id}', '${teamArrayStr}')">✔ Finish</button>
                </div>
            `;
            activeContainer.appendChild(card);
        });
    });
}

// Global scope functions for inline HTML calls
window.acceptMentor = async (projectId) => {
    try {
        await updateDoc(doc(db, "projects", projectId), {
            status: "ongoing",
            mentor_id: currentUser.uid
        });
    } catch (e) {
        console.error("Failed to accept project", e);
        alert("Failed to accept project. Check permissions.");
    }
};

window.declineMentor = async (projectId) => {
    if(!confirm("Are you sure you want to decline and delete this project request?")) return;
    try {
        await deleteDoc(doc(db, "projects", projectId));
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
    ratingModal.classList.add('active'); // using new active model overlay class
    
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
    ratingModal.classList.remove('active');
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
        
        ratingModal.classList.remove('active');
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

// Logout
logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => window.location.href = "/html/login.html");
});
