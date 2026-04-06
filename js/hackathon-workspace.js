import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc, getDocs, addDoc, serverTimestamp, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Extract ID from ?id=xyz
const urlParams = new URLSearchParams(window.location.search);
const hackathonId = urlParams.get('id');

const titleDisplay = document.getElementById('hackathon-title');
const applicationsList = document.getElementById('applications-list');

const tabApps = document.getElementById('tab-applications');
const tabRounds = document.getElementById('tab-rounds');
const tabWinners = document.getElementById('tab-winners');
const tabAnnouncements = document.getElementById('tab-announcements');
const tabSettings = document.getElementById('tab-settings');

const viewApps = document.getElementById('view-applications');
const viewRounds = document.getElementById('view-rounds');
const viewWinners = document.getElementById('view-winners');
const viewAnnouncements = document.getElementById('view-announcements');
const viewSettings = document.getElementById('view-settings');

// Round DOMElements
const teamsRoundList = document.getElementById('teams-round-list');
const advanceRoundBtn = document.getElementById('advance-round-btn');
const roundTitle = document.getElementById('round-title');
const roundBadge = document.getElementById('round-status-badge');

let currentHackDoc = null;
let hackathonListenerUnsubscribe = null;

function hideWorkspaceViews() {
    viewApps.style.display = 'none';
    viewRounds.style.display = 'none';
    viewWinners.style.display = 'none';
    viewAnnouncements.style.display = 'none';
    viewSettings.style.display = 'none';
    tabApps.classList.remove('active');
    tabRounds.classList.remove('active');
    tabWinners.classList.remove('active');
    tabAnnouncements.classList.remove('active');
    tabSettings.classList.remove('active');
}

tabApps.addEventListener('click', () => { hideWorkspaceViews(); tabApps.classList.add('active'); viewApps.style.display = 'block'; });
tabRounds.addEventListener('click', () => { hideWorkspaceViews(); tabRounds.classList.add('active'); viewRounds.style.display = 'block'; });
tabWinners.addEventListener('click', () => { hideWorkspaceViews(); tabWinners.classList.add('active'); viewWinners.style.display = 'block'; });
tabAnnouncements.addEventListener('click', () => { hideWorkspaceViews(); tabAnnouncements.classList.add('active'); viewAnnouncements.style.display = 'block'; });
tabSettings.addEventListener('click', () => {
    hideWorkspaceViews();
    tabSettings.classList.add('active');
    viewSettings.style.display = 'block';
    // Pre-fill edit form with current hackathon data
    if (currentHackDoc) {
        const d = currentHackDoc.data();
        document.getElementById('edit-hack-name').value = d.name || '';
        document.getElementById('edit-hack-description').value = d.description || '';
        document.getElementById('edit-hack-start').value = d.start_date || '';
        document.getElementById('edit-hack-end').value = d.end_date || '';
        document.getElementById('edit-hack-deadline').value = d.deadline || '';
        document.getElementById('edit-hack-rounds').value = d.total_rounds || 1;
    }
});

// Primary Guard and Boot Flow
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    if (!hackathonId) {
        alert("Invalid Hackathon ID specified in URL.");
        window.location.href = "club-dashboard.html";
        return;
    }

    // Verify Club role/ownership over this specific Hackathon
    try {
        hackathonListenerUnsubscribe = onSnapshot(doc(db, "hackathons", hackathonId), (docSnap) => {
            if (!docSnap.exists() || docSnap.data().club_id !== user.uid) {
                alert("Unauthorized access. You do not own this hackathon or it has been deleted.");
                window.location.href = "club-dashboard.html";
                return;
            }

            currentHackDoc = docSnap;
            const hackData = docSnap.data();
            titleDisplay.textContent = `Managing: ${hackData.name}`;

            // Populate Info Bar
            const infoBar = document.getElementById('hackathon-info-bar');
            if (infoBar) {
                const formatDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';
                document.getElementById('hack-info-desc').textContent = hackData.description || 'No description provided.';
                document.getElementById('hack-info-dates').textContent = `📅 ${formatDate(hackData.start_date)} → ${formatDate(hackData.end_date)}`;
                document.getElementById('hack-info-deadline').textContent = `⏰ Apply by: ${formatDate(hackData.deadline)}`;
                infoBar.style.display = 'block';
            }

            if (hackData.winner_team) {
                if (typeof hackData.winner_team === 'string') {
                    if (hackData.winner_team !== 'No participants') {
                        document.getElementById('winner-1').value = hackData.winner_team;
                    }
                } else if (typeof hackData.winner_team === 'object') {
                    document.getElementById('winner-1').value = hackData.winner_team.first || "";
                    document.getElementById('winner-2').value = hackData.winner_team.second || "";
                    document.getElementById('winner-3').value = hackData.winner_team.third || "";
                }
            }
            
            // Reload rounds if settings change
            loadRounds();
        });

        // Setup Winner Buttons
        document.getElementById('save-winner-btn').addEventListener('click', async () => {
            const w1 = document.getElementById('winner-1').value.trim();
            const w2 = document.getElementById('winner-2').value.trim();
            const w3 = document.getElementById('winner-3').value.trim();

            if (!w1 && !w2 && !w3) return alert("Please enter at least one winning team.");
            
            await updateDoc(doc(db, "hackathons", hackathonId), { 
                winner_team: { first: w1, second: w2, third: w3 }, 
                status: "completed" 
            });
            alert("Winners published!");
        });

        document.getElementById('no-winner-btn').addEventListener('click', async () => {
            if(!confirm("Are you sure? This marks the hackathon as having no winners/participants.")) return;
            await updateDoc(doc(db, "hackathons", hackathonId), { winner_team: "No participants", status: "completed" });
            document.getElementById('winner-1').value = "";
            document.getElementById('winner-2').value = "";
            document.getElementById('winner-3').value = "";
            alert("Hackathon marked with no participants.");
        });

        // Initialize real-time list of students applying
        loadApplications();
    } catch(err) {
        console.error("Error fetching Workspace payload:", err);
        titleDisplay.textContent = "Error loading workspace.";
    }
});

function loadApplications() {
    const q = query(collection(db, "hackathon_applications"), where("hackathon_id", "==", hackathonId));
    onSnapshot(q, (snapshot) => {
        applicationsList.innerHTML = '';
        
        let pendingCount = 0; 
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // In a real-world scenario, you might want to see Accepted/Rejected ones under a different tab,
            // but we filter locally for only "pending" requests based on the user's plan.
            if (data.status !== "pending") return;
            
            pendingCount++;
            const card = document.createElement('div');
            card.className = 'application-card';
            
            card.innerHTML = `
                <div class="app-info">
                    <h4>${data.team_name || "Unnamed Team"}</h4>
                    <p><b>Leader Reg:</b> <a href="profile-view.html?uid=${data.applicant_uid}" target="_blank" style="color: var(--primary-blue); text-decoration: none; font-weight: 600;">${data.leader_reg || 'N/A'}</a> | <b>Members:</b> ${data.members && data.members.length > 0 ? data.members.join(', ') : 'None'}</p>
                </div>
                <div class="app-actions">
                    ${data.ppt_name ? `<a href="${data.ppt_name}" target="_blank" class="btn-download">View PPT</a>` : ''}
                    ${data.ppt_url ? `<a href="${data.ppt_url}" target="_blank" class="btn-download">View PPT</a>` : ''}
                    <button class="btn-approve" onclick="window.updateAppStatus('${docSnap.id}', 'approved')">Approve</button>
                    <button class="btn-reject" onclick="window.updateAppStatus('${docSnap.id}', 'rejected')">Reject</button>
                </div>
            `;
            applicationsList.appendChild(card);
        });
        
        if (snapshot.empty || pendingCount === 0) {
            applicationsList.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">No pending applications received yet. Check back later!</p>';
        }
    });
}

// Global scope attachment for inline HTML onclick calls
window.updateAppStatus = async (appId, newStatus) => {
    if (!confirm(`Are you sure you want to mark this team as ${newStatus.toUpperCase()}?`)) return;
    
    try {
        await updateDoc(doc(db, "hackathon_applications", appId), {
            status: newStatus,
            current_round: newStatus === "approved" ? 1 : 0 // Explicitly set starting round!
        });
    } catch(err) {
        console.error("Error updating application:", err);
        alert("Failed to update team status.");
    }
};

function loadRounds() {
    if (!currentHackDoc) return;
    const hackData = currentHackDoc.data();
    
    // Safely fallback variables for backwards compatibility with pre-existing events
    const currentRound = hackData.current_round || 1;
    const totalRounds = hackData.total_rounds || 1;
    
    // UI Update
    if (currentRound >= totalRounds) {
        roundTitle.textContent = "Final Round Evaluation";
        roundBadge.textContent = `Round ${totalRounds} / ${totalRounds}`;
        advanceRoundBtn.style.display = "none";
    } else {
        roundTitle.textContent = `Round ${currentRound} Evaluation`;
        roundBadge.textContent = `Round ${currentRound} / ${totalRounds}`;
        advanceRoundBtn.style.display = "block";
        advanceRoundBtn.textContent = `Advance Selected Teams to Round ${currentRound + 1}`;
    }

    const q = query(collection(db, "hackathon_applications"), where("hackathon_id", "==", hackathonId), where("status", "==", "approved"));

    onSnapshot(q, (snapshot) => {
        let activeTeamsCount = 0;
        let htmlBuffer = '';

        if (currentRound >= totalRounds) {
            htmlBuffer += '<p style="color: var(--success-msg); font-weight: 500; margin-bottom: 20px;">You are in the final round! Please evaluate from the finalists listed below (if any), then navigate to the "Declare Winners" tab to conclude.</p>';
        }

        snapshot.forEach((docSnap) => {
            const app = docSnap.data();
            const appRound = app.current_round || 1;
            
            if (appRound === currentRound) {
                activeTeamsCount++;
                htmlBuffer += `
                    <div class="application-card" style="align-items: center; justify-content: flex-start; gap: 15px;">
                        <input type="checkbox" class="team-advance-cb" value="${docSnap.id}" style="width: 18px; height: 18px; cursor: pointer; ${currentRound >= totalRounds ? 'display: none;' : ''}">
                        <div class="app-info" style="flex: 1;">
                            <h4 style="margin: 0; color: var(--dark-text);">${app.team_name || "Unnamed"}</h4>
                            <p style="margin: 0; margin-top: 4px;">Leader: <a href="profile-view.html?uid=${app.applicant_uid}" target="_blank" style="color: var(--primary-blue); text-decoration: none; font-weight: 600;">${app.leader_reg || 'N/A'}</a></p>
                        </div>
                        ${app.ppt_name ? `<a href="${app.ppt_name}" target="_blank" class="btn-download" style="padding: 5px 10px; font-size: 12px;">View PPT</a>` : ''}
                        ${app.ppt_url ? `<a href="${app.ppt_url}" target="_blank" class="btn-download" style="padding: 5px 10px; font-size: 12px;">View PPT</a>` : ''}
                    </div>
                `;
            }
        });
        
        if (activeTeamsCount === 0) {
            htmlBuffer += '<p style="color: var(--muted-text); font-size: 14px;">No teams are active in this round yet. Please approve pending applications or wait for participants.</p>';
        } 
        
        teamsRoundList.innerHTML = htmlBuffer;
    });
}

advanceRoundBtn.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.team-advance-cb:checked');
    if (checkboxes.length === 0) return alert("Please select at least one team to advance.");
    if(!confirm(`Are you sure? Unselected teams will be eliminated from the hackathon entirely.`)) return;

    advanceRoundBtn.textContent = "Processing...";
    advanceRoundBtn.disabled = true;

    try {
        const hackData = currentHackDoc.data();
        const nextRoundNum = hackData.current_round + 1;

        const updatePromises = [];
        checkboxes.forEach(cb => {
            updatePromises.push(updateDoc(doc(db, "hackathon_applications", cb.value), {
                current_round: nextRoundNum
            }));
        });
        
        const allCheckboxes = document.querySelectorAll('.team-advance-cb');
        allCheckboxes.forEach(cb => {
            if (!cb.checked) {
                updatePromises.push(updateDoc(doc(db, "hackathon_applications", cb.value), {
                    status: "eliminated"
                }));
            }
        });

        await Promise.all(updatePromises);
        await updateDoc(doc(db, "hackathons", hackathonId), { current_round: nextRoundNum });
        alert(`Round concluded! Welcome to Round ${nextRoundNum}.`);
        
    } catch(err) {
        console.error(err);
        alert("Failed to advance round.");
    } finally {
        advanceRoundBtn.disabled = false;
    }
});

// Announcements Logic
const announcementInput = document.getElementById('announcement-input');
const postAnnouncementBtn = document.getElementById('post-announcement-btn');
const announcementList = document.getElementById('announcement-list');

function initWinnerDropdowns() {
    const winner1 = document.getElementById('winner-1');
    const winner2 = document.getElementById('winner-2');
    const winner3 = document.getElementById('winner-3');
    const publishBtn = document.getElementById('save-winner-btn');

    const q = query(
        collection(db, "hackathon_applications"), 
        where("hackathon_id", "==", hackathonId),
        where("status", "==", "approved")
    );

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            const noTeamsHTML = '<option value="">No participating teams to publish</option>';
            winner1.innerHTML = noTeamsHTML;
            winner2.innerHTML = noTeamsHTML;
            winner3.innerHTML = noTeamsHTML;
            winner1.disabled = true;
            winner2.disabled = true;
            winner3.disabled = true;
            publishBtn.disabled = true;
            publishBtn.textContent = "No Teams Available";
            publishBtn.style.opacity = 0.6;
            return;
        }

        // Teams active, restore layout
        winner1.disabled = false;
        winner2.disabled = false;
        winner3.disabled = false;
        publishBtn.disabled = false;
        publishBtn.textContent = "Publish Winners";
        publishBtn.style.opacity = 1.0;

        let optionsBuffer = '<option value="">Select a team...</option>';
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // Natively format string literal merging Team Name + Master Reg arrays
            const membersExt = (data.members && data.members.length > 0) ? ', Members: ' + data.members.join(', ') : '';
            const compositionStr = `${data.team_name} (Leader: ${data.leader_reg}${membersExt})`;
            optionsBuffer += `<option value="${data.team_name}">${compositionStr}</option>`;
        });

        // Cache previous selections defensively to avoid resetting dropdowns dynamically on unrelated edits
        const v1 = winner1.value;
        const v2 = winner2.value;
        const v3 = winner3.value;

        winner1.innerHTML = optionsBuffer;
        winner2.innerHTML = optionsBuffer;
        winner3.innerHTML = optionsBuffer;

        if (v1) winner1.value = v1;
        if (v2) winner2.value = v2;
        if (v3) winner3.value = v3;
    });
}
initWinnerDropdowns();

postAnnouncementBtn.addEventListener('click', async () => {
    const msg = announcementInput.value.trim();
    if (!msg) return alert("Please type an announcement message.");
    
    postAnnouncementBtn.textContent = "Broadcasting...";
    postAnnouncementBtn.disabled = true;
    
    try {
        await addDoc(collection(db, "hackathon_announcements"), {
            hackathon_id: hackathonId,
            message: msg,
            club_id: auth.currentUser.uid,
            timestamp: serverTimestamp()
        });
        announcementInput.value = "";
        alert("Announcement posted successfully!");
    } catch(err) {
        console.error("Error posting announcement:", err);
        alert("Failed to post announcement.");
    } finally {
        postAnnouncementBtn.textContent = "Broadcast Announcement";
        postAnnouncementBtn.disabled = false;
    }
});

function loadAnnouncements() {
    const q = query(
        collection(db, "hackathon_announcements"), 
        where("hackathon_id", "==", hackathonId)
    );
    
    onSnapshot(q, (snapshot) => {
        let announcements = [];
        
        snapshot.forEach((docSnap) => {
            announcements.push(docSnap.data());
        });

        // Local descending sort to bypass complex Firebase index requirements
        announcements.sort((a, b) => {
            const timeA = a.timestamp ? a.timestamp.toMillis() : Date.now();
            const timeB = b.timestamp ? b.timestamp.toMillis() : Date.now();
            return timeB - timeA;
        });

        let htmlBuffer = "";
        
        announcements.forEach((data) => {
            const dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Just now";
            
            htmlBuffer += `
                <div class="application-card" style="flex-direction: column; align-items: flex-start;">
                    <p style="margin: 0; font-size: 15px; color: var(--dark-text); white-space: pre-wrap;">${data.message}</p>
                    <span style="font-size: 12px; color: var(--muted-text); margin-top: 8px;">Published: ${dateStr}</span>
                </div>
            `;
        });
        
        if (announcements.length === 0) {
            announcementList.innerHTML = '<p style="color: var(--muted-text); font-size: 14px;">No announcements broadcasted yet.</p>';
        } else {
            announcementList.innerHTML = htmlBuffer;
        }
    });
}
loadAnnouncements();

// Edit Hackathon Settings
document.getElementById('edit-hackathon-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-hackathon-settings');
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;

    try {
        await updateDoc(doc(db, "hackathons", hackathonId), {
            name: document.getElementById('edit-hack-name').value.trim(),
            description: document.getElementById('edit-hack-description').value.trim(),
            start_date: document.getElementById('edit-hack-start').value,
            end_date: document.getElementById('edit-hack-end').value,
            deadline: document.getElementById('edit-hack-deadline').value,
            total_rounds: parseInt(document.getElementById('edit-hack-rounds').value, 10)
        });
        alert("Hackathon details updated successfully!");
    } catch(err) {
        console.error("Error updating hackathon:", err);
        alert("Failed to update hackathon details.");
    } finally {
        saveBtn.textContent = "Save Changes";
        saveBtn.disabled = false;
    }
});

// Settings DOMElements
document.getElementById('delete-hackathon-btn').addEventListener('click', async () => {
    if(!confirm("Are you absolutely sure you want to delete this hackathon? This action EXPLICITLY deletes all incoming team applications and cannot be undone.")) return;

    const btn = document.getElementById('delete-hackathon-btn');
    btn.textContent = "Deleting... Please wait";
    btn.disabled = true;

    try {
        // Detach the real-time listener so the UI doesn't panic when the document vanishes
        if (hackathonListenerUnsubscribe) {
            hackathonListenerUnsubscribe();
        }

        // 1. Delete all applications related to this hackathon
        const q = query(collection(db, "hackathon_applications"), where("hackathon_id", "==", hackathonId));
        const snapshots = await getDocs(q);
        
        const deletePromises = [];
        snapshots.forEach(docSnap => {
            deletePromises.push(deleteDoc(doc(db, "hackathon_applications", docSnap.id)));
        });

        // 2. Delete all announcements related to this hackathon
        const qAnnounce = query(collection(db, "hackathon_announcements"), where("hackathon_id", "==", hackathonId));
        const snapAnnounce = await getDocs(qAnnounce);
        snapAnnounce.forEach(docSnap => {
            deletePromises.push(deleteDoc(doc(db, "hackathon_announcements", docSnap.id)));
        });

        await Promise.all(deletePromises);

        // 3. Delete the hackathon itself
        await deleteDoc(doc(db, "hackathons", hackathonId));
        
        alert("Hackathon deleted successfully!");
        window.location.href = "club-dashboard.html";
        
    } catch(err) {
        console.error("Error deleting hackathon:", err);
        alert("Failed to delete the hackathon.");
        btn.textContent = "Delete Hackathon";
        btn.disabled = false;
    }
});
