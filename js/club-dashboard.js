import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const logoutBtn = document.getElementById('logout-btn');
const userNameDisplay = document.getElementById('nav-user-name');
const hackathonsList = document.getElementById('hackathons-list');

const createModal = document.getElementById('create-modal');
const openModalBtn = document.getElementById('create-hackathon-btn');
const closeModalBtn = document.getElementById('close-modal');
const createForm = document.getElementById('create-hackathon-form');
const submitHackBtn = document.getElementById('submit-hackathon');

let currentUserDoc = null;

// Dual Navbar / Tab Logic
const tabDashboard = document.getElementById('tab-dashboard');
const tabProfile = document.getElementById('tab-profile');
const tabSettings = document.getElementById('tab-settings');
const tabWinners = document.getElementById('tab-winners');
const viewDashboard = document.getElementById('view-dashboard');
const viewProfile = document.getElementById('view-profile');
const viewSettings = document.getElementById('view-settings');
const viewWinners = document.getElementById('view-winners');

const winnerClubFilter = document.getElementById('winner-club-filter');
const winnersList = document.getElementById('winners-list');

const editProfileForm = document.getElementById('edit-profile-form');
const updateProfileBtn = document.getElementById('update-profile-btn');

function hideAllViews() {
    viewDashboard.style.display = 'none';
    viewProfile.style.display = 'none';
    viewSettings.style.display = 'none';
    viewWinners.style.display = 'none';
    tabDashboard.classList.remove('active');
    tabProfile.classList.remove('active');
    tabSettings.classList.remove('active');
    tabWinners.classList.remove('active');
}

tabDashboard.addEventListener('click', () => {
    hideAllViews();
    tabDashboard.classList.add('active');
    viewDashboard.style.display = 'block';
});

tabProfile.addEventListener('click', () => {
    hideAllViews();
    tabProfile.classList.add('active');
    viewProfile.style.display = 'block';
    
    // Auto-fill form
    if(currentUserDoc) {
        document.getElementById('edit-club-name').value = currentUserDoc.club_name || "";
        document.getElementById('edit-exec-name').value = currentUserDoc.name || "";
        document.getElementById('edit-position').value = currentUserDoc.position || "";
        document.getElementById('edit-branch').value = currentUserDoc.branch || "";
    }
});

tabSettings.addEventListener('click', () => {
    hideAllViews();
    tabSettings.classList.add('active');
    viewSettings.style.display = 'block';
});

tabWinners.addEventListener('click', () => {
    hideAllViews();
    tabWinners.classList.add('active');
    viewWinners.style.display = 'block';
    loadWinners(winnerClubFilter.value);
});

winnerClubFilter.addEventListener('change', (e) => {
    loadWinners(e.target.value);
});

// Update Profile Logic
editProfileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    updateProfileBtn.textContent = "Updating...";
    updateProfileBtn.disabled = true;

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
            club_name: document.getElementById('edit-club-name').value.trim(),
            name: document.getElementById('edit-exec-name').value.trim(),
            position: document.getElementById('edit-position').value.trim(),
            branch: document.getElementById('edit-branch').value.trim()
        });
        
        currentUserDoc.club_name = document.getElementById('edit-club-name').value.trim();
        currentUserDoc.name = document.getElementById('edit-exec-name').value.trim();
        currentUserDoc.position = document.getElementById('edit-position').value.trim();
        currentUserDoc.branch = document.getElementById('edit-branch').value.trim();
        userNameDisplay.textContent = currentUserDoc.club_name;
        
        alert("Profile updated successfully!");
    } catch(err) {
        console.error(err);
        alert("Failed to update profile.");
    } finally {
        updateProfileBtn.textContent = "Update Changes";
        updateProfileBtn.disabled = false;
    }
});

// Auth Guard & Setup
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/html/login.html";
        return;
    }

    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists() || docSnap.data().role !== "club") {
        window.location.href = "/html/login.html"; // Not a club or profile incomplete
        return;
    }

    currentUserDoc = docSnap.data();
    userNameDisplay.textContent = currentUserDoc.club_name;

    // Load Hackathons live stream
    loadHackathons(user.uid);
});

// Load Hackathons from Firestore
function loadHackathons(clubUid) {
    const q = query(collection(db, "hackathons"), where("club_id", "==", clubUid));
    onSnapshot(q, (snapshot) => {
        hackathonsList.innerHTML = '';
        let total = 0;
        let active = 0;

        if (snapshot.empty) {
            hackathonsList.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">No hackathons created yet.</p>';
            document.getElementById('stat-total-events').innerText = "0";
            document.getElementById('stat-active-events').innerText = "0";
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            let currentStatus = data.status || "upcoming";

            // Evaluate dates for Live/Upcoming/Completed logic locally
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const stDate = data.start_date ? new Date(data.start_date) : null;
            const endDate = data.end_date ? new Date(data.end_date) : null;
            const dlDate = data.deadline ? new Date(data.deadline) : null;

            // Use end_date for completion (event is over), start_date for live status
            if (stDate || endDate || dlDate) {
                let evalStatus = "upcoming";
                const completionDate = endDate || dlDate; // prefer end_date, fallback to deadline

                if (stDate && completionDate) {
                    if (today < stDate) evalStatus = "upcoming";
                    else if (today >= stDate && today <= completionDate) evalStatus = "ongoing";
                    else if (today > completionDate) evalStatus = "completed";
                } else if (completionDate) {
                    if (today > completionDate) evalStatus = "completed";
                    else evalStatus = "ongoing";
                }

                if (evalStatus === "completed" && currentStatus !== "completed") {
                    currentStatus = "completed";
                    updateDoc(doc(db, "hackathons", docSnap.id), { status: "completed" }).catch(e=>console.error(e));
                } else if (evalStatus === "ongoing" && currentStatus === "upcoming") {
                    currentStatus = "ongoing";
                    updateDoc(doc(db, "hackathons", docSnap.id), { status: "ongoing" }).catch(e=>console.error(e));
                }
            }

            total++;
            if(currentStatus !== "completed") active++;

            const statusColor = currentStatus === 'upcoming' || currentStatus === 'ongoing' ? 'var(--success-msg)' : 'var(--muted-text)';
            const descPreview = data.description ? (data.description.length > 80 ? data.description.substring(0, 80) + '...' : data.description) : 'No description';

            // Format dates nicely
            const formatDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';

            const card = document.createElement('div');
            card.className = 'item-card';
            card.innerHTML = `
                <div class="item-details">
                    <h4>${data.name} <span style="font-size: 13px; color: var(--muted-text); font-weight: 400; margin-left: 8px;">by ${data.club_name || "Club"}</span></h4>
                    <p style="font-size: 13px; color: var(--muted-text); margin: 4px 0 6px; font-style: italic;">${descPreview}</p>
                    <p style="font-size: 13px;">Status: <span style="color: ${statusColor}; font-weight: 500;">${currentStatus.toUpperCase()}</span></p>
                    <p style="font-size: 12px; color: var(--muted-text); margin-top: 4px;">📅 ${formatDate(data.start_date)} → ${formatDate(data.end_date)} &nbsp;|&nbsp; Apply by: ${formatDate(data.deadline)}</p>
                </div>
                <button class="btn-secondary" onclick="window.location.href='hackathon-workspace.html?id=${docSnap.id}'">Manage</button>
            `;
            hackathonsList.appendChild(card);
        });

        document.getElementById('stat-total-events').innerText = total;
        document.getElementById('stat-active-events').innerText = active;
    });
}

// Modal Logic
openModalBtn.addEventListener('click', () => createModal.classList.add('active'));
closeModalBtn.addEventListener('click', () => createModal.classList.remove('active'));

// Open calendar picker when clicking anywhere on date inputs
document.querySelectorAll('input[type="date"]').forEach(input => {
    input.addEventListener('click', function () {
        try { this.showPicker(); } catch (e) { /* showPicker not supported */ }
    });
});

// Create Hackathon Functionality
createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitHackBtn.textContent = "Creating...";
    submitHackBtn.disabled = true;

    try {
        await addDoc(collection(db, "hackathons"), {
            club_id: auth.currentUser.uid,
            club_name: currentUserDoc.club_name || "Unknown Club",
            name: document.getElementById('hack-name').value.trim(),
            description: document.getElementById('hack-description').value.trim(),
            start_date: document.getElementById('hack-start-date').value,
            end_date: document.getElementById('hack-end-date').value,
            deadline: document.getElementById('hack-deadline').value,
            status: "upcoming",
            total_rounds: parseInt(document.getElementById('hack-rounds').value, 10),
            current_round: 1,
            rounds: [],
            created_at: serverTimestamp()
        });
        
        createModal.classList.remove('active');
        createForm.reset();
    } catch (error) {
        console.error("Error creating hackathon:", error);
        alert("Failed to create hackathon.");
    } finally {
        submitHackBtn.textContent = "Create Hackathon";
        submitHackBtn.disabled = false;
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => window.location.href = "/html/login.html");
});

// Load Winners List
function loadWinners(clubName) {
    let q;
    if (clubName === 'all') {
        q = query(collection(db, "hackathons"), where("status", "==", "completed"));
    } else {
        q = query(collection(db, "hackathons"), where("status", "==", "completed"), where("club_name", "==", clubName));
    }

    onSnapshot(q, (snapshot) => {
        winnersList.innerHTML = '';
        if (snapshot.empty) {
            winnersList.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">No completed hackathons found.</p>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const card = document.createElement('div');
            card.className = 'item-card';
            
            let winningTeamHtml = `<span style="color: var(--muted-text);">Winners pending announcement</span>`;
            if (data.winner_team) {
                if (typeof data.winner_team === 'string') {
                    if (data.winner_team.toLowerCase() === 'no participants') {
                        winningTeamHtml = `<span style="color: var(--danger-msg); font-weight: 500;">No one participated</span>`;
                    } else {
                        winningTeamHtml = `<strong style="color: var(--success-msg);">🥇 1st: ${data.winner_team}</strong>`;
                    }
                } else if (typeof data.winner_team === 'object') {
                    let wHtml = [];
                    if (data.winner_team.first) wHtml.push(`🥇 <span style="font-weight:600; color:var(--success-msg);">${data.winner_team.first}</span>`);
                    if (data.winner_team.second) wHtml.push(`🥈 <span style="font-weight:600; color:var(--dark-text);">${data.winner_team.second}</span>`);
                    if (data.winner_team.third) wHtml.push(`🥉 <span style="font-weight:600; color:var(--dark-text);">${data.winner_team.third}</span>`);
                    
                    if (wHtml.length > 0) {
                        winningTeamHtml = wHtml.join(' &nbsp;|&nbsp; ');
                    }
                }
            }

            card.innerHTML = `
                <div class="item-details" style="flex: 1;">
                    <h4 style="margin-bottom: 5px;">${data.name} <span style="font-size: 13px; color: var(--muted-text); font-weight: 400; margin-left: 8px;">by ${data.club_name || "Club"}</span></h4>
                    <p style="margin: 0; font-size: 14px;">${winningTeamHtml}</p>
                </div>
                <div style="font-size: 13px; color: var(--muted-text); text-align: right; display: flex; flex-direction: column; justify-content: center;">
                    <strong>Event Completed:</strong>
                    ${data.deadline}
                </div>
            `;
            // Add a style tweak to card layout to keep right side tidy
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';
            
            winnersList.appendChild(card);
        });
    }, (error) => {
        console.error("Error loading winners:", error);
        winnersList.innerHTML = '<p style="color: var(--danger-msg); font-size: 14px;">Failed to load data. Please check console.</p>';
    });
}
