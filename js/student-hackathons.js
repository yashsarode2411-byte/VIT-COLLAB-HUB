import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, query, onSnapshot, addDoc, serverTimestamp, getDoc, doc, where, getDocs, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

function generateHackCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

const hackathonsContainer = document.getElementById('hackathons-container');
const logoutBtn = document.getElementById('logoutBtn');

// Modal Logic
const joinModal = document.getElementById('joinModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const joinForm = document.getElementById('joinHackathonForm');

let studentRegCache = "";
let myApplications = {}; // hackathon_id -> { status, appId }

document.addEventListener('DOMContentLoaded', () => {
    const profileMenu = document.getElementById('profileMenu');
    const profileDropdownContent = document.getElementById('profileDropdownContent');
    if (profileMenu && profileDropdownContent) {
        profileMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdownContent.style.display = profileDropdownContent.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!profileMenu.contains(e.target) && !profileDropdownContent.contains(e.target)) {
                profileDropdownContent.style.display = 'none';
            }
        });
    }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            studentRegCache = data.registration_number || "";
            if (studentRegCache) {
                document.getElementById('leaderReg').value = studentRegCache;
            }
            const fullName = data.name || "Student";
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) navUserName.textContent = fullName;
        }
    } catch(e) { console.error("Could not fetch user cache", e); }

    // Load student's existing hackathon applications
    await loadMyApplications(user.uid);
    loadHackathons();
});

async function loadMyApplications(uid) {
    try {
        const q = query(collection(db, "hackathon_applications"), where("applicant_uid", "==", uid));
        const snap = await getDocs(q);
        myApplications = {};
        snap.forEach(docSnap => {
            const data = docSnap.data();
            myApplications[data.hackathon_id] = {
                status: data.status,
                appId: docSnap.id,
                team_name: data.team_name
            };
        });
    } catch(e) {
        console.error("Failed to load existing applications", e);
    }
}

let allHackathons = [];
let currentFilter = 'ongoing';

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('btn-primary');
            b.classList.add('btn-outline');
        });
        e.target.classList.remove('btn-outline');
        e.target.classList.add('btn-primary');
        
        currentFilter = e.target.getAttribute('data-filter');
        renderHackathons();
    });
});

function loadHackathons() {
    const q = query(collection(db, "hackathons"));
    
    onSnapshot(q, (snapshot) => {
        allHackathons = [];
        snapshot.forEach(docSnap => {
            allHackathons.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderHackathons();
    });
}

function renderHackathons() {
    hackathonsContainer.innerHTML = '';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filtered = allHackathons.filter(hack => {
        let evalStatus = "upcoming";
        const stDate = hack.start_date ? new Date(hack.start_date) : null;
        const endDate = hack.end_date ? new Date(hack.end_date) : null;
        const dlDate = hack.deadline ? new Date(hack.deadline) : null;
        const completionDate = endDate || dlDate;

        if (stDate && completionDate) {
            if (today < stDate) evalStatus = "upcoming";
            else if (today >= stDate && today <= completionDate) evalStatus = "ongoing";
            else if (today > completionDate) evalStatus = "completed";
        } else if (completionDate) {
            if (today > completionDate) evalStatus = "completed";
            else evalStatus = "ongoing";
        } else {
            evalStatus = hack.status || "upcoming"; 
        }

        if (hack.status === "completed") evalStatus = "completed";
        return evalStatus === currentFilter;
    });

    if (filtered.length === 0) {
        hackathonsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--muted-text); padding: 40px; background: var(--card-bg); border-radius: 12px; border: 1px dashed var(--border-color);">
            <i class="fa-solid fa-face-frown-open" style="font-size: 2rem; color: var(--primary-blue); opacity: 0.5; margin-bottom: 10px;"></i>
            <p>No ${currentFilter} hackathons right now.</p>
        </div>`;
        return;
    }

    filtered.forEach(hack => {
        const hackId = hack.id;
        const isCompleted = currentFilter === "completed";
        const existingApp = myApplications[hackId];
        
        const card = document.createElement('div');
        card.className = 'hackathon-card';
        
        const formatDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'TBA';
        let deadlineStr = hack.deadline ? formatDate(hack.deadline) : 'TBA';
        if (isCompleted) deadlineStr = "Concluded";
        
        const startStr = hack.start_date ? formatDate(hack.start_date) : 'TBA';
        const endStr = hack.end_date ? formatDate(hack.end_date) : (hack.deadline ? formatDate(hack.deadline) : 'TBA');
        
        let btnHTML = '';
        if (isCompleted) {
            btnHTML = `<button class="btn btn-outline btn-sm" disabled style="opacity: 0.5; border-color: var(--muted-text); color: var(--muted-text);">Concluded</button>`;
        } else if (existingApp) {
            if (existingApp.status === 'approved') {
                btnHTML = `<button class="btn btn-primary btn-sm" onclick="window.location.href='student-hackathon-workspace.html?id=${hackId}'">
                    Open Workspace <i class="fa-solid fa-arrow-right"></i>
                </button>`;
            } else if (existingApp.status === 'pending') {
                btnHTML = `<button class="btn btn-outline btn-sm" disabled style="opacity: 0.7; border-color: #f59e0b; color: #f59e0b;">
                    <i class="fa-solid fa-clock" style="margin-right: 4px;"></i>Applied (Pending)
                </button>`;
            } else if (existingApp.status === 'rejected') {
                btnHTML = `<button class="btn btn-outline btn-sm" disabled style="opacity: 0.5; border-color: var(--danger-msg); color: var(--danger-msg);">
                    <i class="fa-solid fa-xmark" style="margin-right: 4px;"></i>Rejected
                </button>`;
            } else if (existingApp.status === 'eliminated') {
                btnHTML = `<button class="btn btn-outline btn-sm" disabled style="opacity: 0.5; border-color: var(--danger-msg); color: var(--danger-msg);">
                    Eliminated
                </button>`;
            } else {
                btnHTML = `<button class="btn btn-outline btn-sm" disabled style="opacity: 0.7;">Applied ✓</button>`;
            }
        } else {
            btnHTML = `<button class="btn btn-primary btn-sm join-btn" 
                data-id="${hackId}" 
                data-club="${hack.club_id}" 
                data-name="${hack.name || 'Hackathon Event'}">
                Apply Now
            </button>`;
        }

        let statusText = isCompleted ? 'Finished' : 'Accepting Applications';
        let statusColor = isCompleted ? 'var(--danger-msg)' : 'var(--success-msg)';
        if (existingApp && !isCompleted) {
            if (existingApp.status === 'approved') { statusText = "You're In!"; statusColor = 'var(--success-msg)'; }
            else if (existingApp.status === 'pending') { statusText = 'Application Pending'; statusColor = '#f59e0b'; }
        }

        card.innerHTML = `
            <div class="hackathon-banner" style="background: linear-gradient(135deg, var(--primary-blue), #1e3a8a);">
                <div class="hackathon-badge">
                    <i class="fa-regular fa-clock"></i> ${isCompleted ? 'Concluded' : 'Apply by: ' + deadlineStr}
                </div>
            </div>
            <div class="hackathon-content">
                <h3 class="hackathon-title">${hack.name || 'Hackathon Event'}</h3>
                <div class="hackathon-club">
                    <i class="fa-solid fa-users"></i> ${hack.club_name || 'VIT Official'}
                </div>
                <p class="hackathon-desc">
                    ${hack.description || 'Join this exciting hackathon to build amazing projects and showcase your skills.'}
                </p>
                <p style="font-size: 0.8rem; color: var(--muted-text); margin-bottom: 15px;">
                    <i class="fa-regular fa-calendar"></i> ${startStr} — ${endStr}
                </p>
                <div class="hackathon-meta">
                    <div class="meta-item" style="color: ${statusColor}; font-weight: 600;">
                        <i class="fa-solid fa-circle-dot" style="font-size: 0.6rem;"></i> 
                        ${statusText}
                    </div>
                    ${btnHTML}
                </div>
            </div>
        `;
        hackathonsContainer.appendChild(card);
    });

    document.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const button = e.currentTarget;
            openModal(button.getAttribute('data-id'), button.getAttribute('data-club'), button.getAttribute('data-name'));
        });
    });
}

async function openModal(hackId, clubId, hackName) {
    // Prevent duplicate applications
    if (myApplications[hackId] && myApplications[hackId].status !== 'rejected') {
        alert("You have already applied to this hackathon. You cannot apply again.");
        return;
    }
    
    document.getElementById('formHackId').value = hackId;
    document.getElementById('formClubId').value = clubId;
    document.getElementById('modalHackName').textContent = `Applying to: ${hackName}`;
    
    document.getElementById('teamName').value = "";
    document.getElementById('teamSize').value = "1";
    document.getElementById('dynamicMembersContainer').innerHTML = "";
    document.getElementById('pptLink').value = "";
    
    document.getElementById('teamSize').dispatchEvent(new Event('change'));
    joinModal.style.display = "flex";
}

document.getElementById('teamSize').addEventListener('change', (e) => {
    const size = parseInt(e.target.value, 10);
    const container = document.getElementById('dynamicMembersContainer');
    container.innerHTML = '';
    
    for (let i = 1; i <= size; i++) {
        container.innerHTML += `
            <div class="form-group" style="margin-top: 10px;">
                <label class="form-label">Registration Number of Team Member ${i} <span style="color: var(--danger);">*</span></label>
                <input type="text" class="form-input member-reg-input" placeholder="e.g. 24BCE100${i}" required>
            </div>
        `;
    }
});

function closeModal() {
    joinModal.style.display = "none";
}

closeModalBtn.addEventListener('click', closeModal);
joinModal.addEventListener('click', (e) => {
    if(e.target === joinModal) closeModal();
});

// Submit Application Logic
joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitJoinBtn');
    submitBtn.textContent = "Submitting...";
    submitBtn.disabled = true;

    const hackId = document.getElementById('formHackId').value;
    const clubId = document.getElementById('formClubId').value;
    
    // Final duplicate check
    if (myApplications[hackId] && myApplications[hackId].status !== 'rejected') {
        alert("You have already applied to this hackathon.");
        submitBtn.textContent = "Submit Application";
        submitBtn.disabled = false;
        return;
    }
    
    const teamName = document.getElementById('teamName').value.trim();
    const leaderReg = document.getElementById('leaderReg').value.trim();
    
    const pptLink = document.getElementById('pptLink').value.trim();
    const pptName = pptLink || "";

    const memberInputs = document.querySelectorAll('.member-reg-input');
    let membersList = [];
    memberInputs.forEach(input => {
        if(input.value.trim()) membersList.push(input.value.trim());
    });

    try {
        const inviteCode = generateHackCode();
        const docRef = await addDoc(collection(db, "hackathon_applications"), {
            hackathon_id: hackId,
            club_id: clubId,
            applicant_uid: auth.currentUser.uid,
            team_members: [auth.currentUser.uid],
            team_name: teamName,
            leader_reg: leaderReg,
            members: membersList,
            ppt_name: pptName,
            invite_code: inviteCode,
            status: "pending", 
            current_round: 0,
            submitted_at: serverTimestamp()
        });
        
        // Update local cache immediately
        myApplications[hackId] = { status: 'pending', appId: docRef.id, team_name: teamName };
        
        alert(`Application submitted successfully!\n\nYour Team Invite Code: ${inviteCode}\nShare this code with teammates so they can join your team.`);
        closeModal();
        renderHackathons(); // Re-render to update button states
        
    } catch(err) {
        console.error(err);
        alert("Failed to submit application. Reach out to support if issue persists.");
    } finally {
        submitBtn.textContent = "Submit Application";
        submitBtn.disabled = false;
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = "login.html";
    });
});

// ─── Join Hackathon Team by Invite Code UI ───
window.openJoinTeamModalUI = () => {
    document.getElementById('joinTeamCodeInput').value = '';
    document.getElementById('hackTeamDetailsCard').style.display = 'none';
    document.getElementById('joinHackTeamModal').style.display = 'flex';
};

document.getElementById('fetchHackTeamForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('joinTeamCodeInput').value.trim().toUpperCase();
    if(code.length !== 6) return alert("Code must be 6 characters");
    
    const btn = document.getElementById('fetchHackTeamBtn');
    btn.textContent = "Verifying...";
    btn.disabled = true;

    try {
        const q = query(collection(db, "hackathon_applications"), where("invite_code", "==", code));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            alert("No team found with this invite code. Please check and try again.");
            return;
        }
        
        const teamData = snap.docs[0].data();
        const uid = auth.currentUser.uid;
        
        if (teamData.team_members && teamData.team_members.includes(uid)) {
            alert("You are already a member of this team!");
            return;
        }
        
        if (myApplications[teamData.hackathon_id]) {
            alert("You have already applied to this hackathon with a different team.");
            return;
        }
        
        let hackName = "Unknown Hackathon";
        try {
            const hSnap = await getDoc(doc(db, "hackathons", teamData.hackathon_id));
            if(hSnap.exists()) hackName = hSnap.data().name;
        } catch(err){}

        document.getElementById('fetchedHackTeamTitle').textContent = `Team: ${teamData.team_name}`;
        document.getElementById('fetchedHackTeamHackName').textContent = `Event: ${hackName}`;
        document.getElementById('confirmedTeamCode').value = code;
        
        document.getElementById('hackTeamDetailsCard').style.display = 'block';
        
    } catch(err) {
        console.error(err);
        alert("Failed to verify team code.");
    } finally {
        btn.textContent = "Verify Team";
        btn.disabled = false;
    }
});

document.getElementById('confirmHackTeamJoinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('confirmedTeamCode').value;
    const btn = document.getElementById('confirmHackTeamJoinBtn');
    btn.textContent = "Joining...";
    btn.disabled = true;
    
    await joinTeamByCode(code);
    document.getElementById('joinHackTeamModal').style.display = 'none';
    btn.textContent = "Confirm Join";
    btn.disabled = false;
});

async function joinTeamByCode(code) {
    try {
        const q = query(collection(db, "hackathon_applications"), where("invite_code", "==", code));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            alert("No team found with this invite code. Please check and try again.");
            return;
        }
        
        const teamDoc = snap.docs[0];
        const teamData = teamDoc.data();
        const uid = auth.currentUser.uid;
        
        // Check if already in this team
        if (teamData.team_members && teamData.team_members.includes(uid)) {
            alert("You are already a member of this team!");
            return;
        }
        
        // Check if already applied to this hackathon with another team
        if (myApplications[teamData.hackathon_id]) {
            alert("You have already applied to this hackathon with a different team. You cannot join another team.");
            return;
        }
        
        // Add user to the team
        await updateDoc(doc(db, "hackathon_applications", teamDoc.id), {
            team_members: arrayUnion(uid)
        });
        
        // Update local cache
        myApplications[teamData.hackathon_id] = { status: teamData.status, appId: teamDoc.id, team_name: teamData.team_name };
        
        alert(`Successfully joined team "${teamData.team_name}"!`);
        renderHackathons();
        
    } catch (e) {
        console.error("Join team error:", e);
        alert("Failed to join team. Please try again.");
    }
}
