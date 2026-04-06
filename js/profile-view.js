import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    doc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * profile-view.js
 * Fetches and renders a full user profile based on URL param ?uid=<userId>
 * Handles loading, error, and data states gracefully.
 */

const loadingEl = document.getElementById('profileLoading');
const errorEl = document.getElementById('profileError');
const contentEl = document.getElementById('profileContent');

const DEFAULT_AVATAR = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";

// ─── Get UID from URL ───
const urlParams = new URLSearchParams(window.location.search);
const targetUid = urlParams.get('uid') || urlParams.get('id');

if (!targetUid) {
    showError();
} else {
    // Auth check — only allow logged-in users to view profiles
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "login.html";
            return;
        }
        await loadProfile(targetUid);
    });
}

async function loadProfile(uid) {
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            showError();
            return;
        }

        const data = docSnap.data();

        // Only show student profiles
        if (data.role && data.role !== "student") {
            showError();
            return;
        }

        // ─── Populate Header ───
        document.getElementById('heroAvatar').src = data.avatar_url || DEFAULT_AVATAR;
        document.getElementById('heroName').textContent = data.name || "Student";

        // Cover photo
        if (data.cover_url) {
            document.getElementById('heroCover').style.backgroundImage =
                `linear-gradient(135deg, rgba(13,110,253,0.6) 0%, rgba(10,25,47,0.7) 100%), url('${data.cover_url}')`;
            document.getElementById('heroCover').style.backgroundSize = 'cover';
            document.getElementById('heroCover').style.backgroundPosition = 'center';
        }

        // Branch
        const branch = data.branch || "Not specified";
        document.getElementById('heroBranch').innerHTML =
            `<i class="fa-solid fa-graduation-cap"></i> ${branch}`;

        // Registration Number
        const regNo = data.registration_number || "";
        if (regNo) {
            document.getElementById('heroRegNo').innerHTML =
                `<i class="fa-solid fa-id-card"></i> ${regNo}`;
        } else {
            document.getElementById('heroRegNo').style.display = 'none';
        }

        // Rating
        const totalReviews = data.total_reviews || 0;
        const totalStars = data.total_stars || 0;
        const avgRating = totalReviews > 0
            ? (totalStars / totalReviews).toFixed(1)
            : "No Rating";

        document.getElementById('statRating').textContent = avgRating;
        if (avgRating === "No Rating") {
            document.getElementById('heroRating').innerHTML = `No Rating`;
        } else {
            document.getElementById('heroRating').innerHTML = `<i class="fa-solid fa-star" style="color: #f59e0b;"></i> ${avgRating} / 5.0`;
        }

        // ─── Stats ───
        document.getElementById('statRating').textContent = avgRating;
        document.getElementById('statCompleted').textContent = data.completed_projects || 0;

        // ─── Fetch Total Projects ───
        let totalProjects = 0;
        try {
            const projQuery = query(
                collection(db, "projects"),
                where("team_members", "array-contains", uid)
            );
            const projSnap = await getDocs(projQuery);
            totalProjects = projSnap.size;
        } catch (e) {
            console.warn("Could not fetch projects count:", e);
            totalProjects = data.completed_projects || 0;
        }
        document.getElementById('statTotalProjects').textContent = totalProjects;

        // ─── Fetch ALL Hackathon Applications (leader OR member) ───
        let allUserHackApps = []; // all hackathon apps this user is part of
        try {
            // 1. Apps where user is the leader
            const leaderQuery = query(
                collection(db, "hackathon_applications"),
                where("applicant_uid", "==", uid)
            );
            const leaderSnap = await getDocs(leaderQuery);
            leaderSnap.forEach(d => {
                allUserHackApps.push({ id: d.id, ...d.data() });
            });

            // 2. Apps where user is a member (by reg number)
            if (regNo) {
                const memberQuery = query(
                    collection(db, "hackathon_applications"),
                    where("members", "array-contains", regNo)
                );
                const memberSnap = await getDocs(memberQuery);
                memberSnap.forEach(d => {
                    // Avoid duplicates (if leader's reg was also in members)
                    if (!allUserHackApps.find(a => a.id === d.id)) {
                        allUserHackApps.push({ id: d.id, ...d.data() });
                    }
                });
            }
        } catch (e) {
            console.warn("Could not fetch hackathon apps:", e);
        }

        // ─── Determine Hackathons WON & Validate Participated Count ───
        // For each app, check if the hackathon has winner_team matching the user's team_name
        let hackathonsWon = [];
        let validHackAppsCount = 0;
        const hackathonIds = [...new Set(allUserHackApps.map(a => a.hackathon_id))];

        for (const hackId of hackathonIds) {
            try {
                const hackDoc = await getDoc(doc(db, "hackathons", hackId));
                if (!hackDoc.exists()) continue; // Skip orphaned applications
                
                const hackData = hackDoc.data();
                const userAppsInHack = allUserHackApps.filter(a => a.hackathon_id === hackId);
                
                // Add to the valid participation count
                validHackAppsCount += userAppsInHack.length;

                if (!hackData.winner_team || hackData.status !== "completed") continue;

                for (const app of userAppsInHack) {
                    const teamName = app.team_name;
                    let position = null;

                    if (typeof hackData.winner_team === 'string') {
                        if (hackData.winner_team === teamName) position = '1st';
                    } else if (typeof hackData.winner_team === 'object') {
                        if (hackData.winner_team.first === teamName) position = '1st';
                        else if (hackData.winner_team.second === teamName) position = '2nd';
                        else if (hackData.winner_team.third === teamName) position = '3rd';
                    }

                    if (position) {
                        hackathonsWon.push({
                            hackathonName: hackData.name || hackData.title || "Unnamed Hackathon",
                            hackathonDesc: hackData.description || "No description available.",
                            position: position,
                            teamName: teamName,
                            leaderReg: app.leader_reg || "",
                            members: app.members || [],
                            clubId: hackData.club_id || app.club_id || ""
                        });
                    }
                }
            } catch (e) {
                console.warn(`Could not check hackathon ${hackId}:`, e);
            }
        }

        document.getElementById('statHackathons').textContent = validHackAppsCount;

        // ─── Render Hackathons Won Section ───
        const hackWonContainer = document.getElementById('hackathonsWonContainer');
        const hackWonCount = document.getElementById('hackWonCount');

        hackWonCount.textContent = hackathonsWon.length;

        if (hackathonsWon.length === 0) {
            hackWonContainer.innerHTML = '<span class="empty-state">No hackathons won yet. Keep participating!</span>';
        } else {
            let wonHTML = '';
            for (const win of hackathonsWon) {
                const medal = win.position === '1st' ? '🥇' : win.position === '2nd' ? '🥈' : '🥉';

                // Resolve member details (name, reg, profile link) from Firestore
                let membersHTML = '';
                // Leader reg
                const allRegs = [win.leaderReg, ...win.members].filter(Boolean);
                const uniqueRegs = [...new Set(allRegs)];

                for (const memberReg of uniqueRegs) {
                    let memberName = memberReg;
                    let profileLink = '';
                    try {
                        const userQuery = query(
                            collection(db, "users"),
                            where("registration_number", "==", memberReg)
                        );
                        const userSnap = await getDocs(userQuery);
                        if (!userSnap.empty) {
                            const userData = userSnap.docs[0].data();
                            const memberUid = userSnap.docs[0].id;
                            memberName = userData.name || memberReg;
                            profileLink = `profile-view.html?uid=${memberUid}`;
                        }
                    } catch (e) { /* fallback to reg no */ }

                    const isLeader = memberReg === win.leaderReg;

                    membersHTML += `
                    <div class="hack-member-row">
                        <div class="hack-member-info">
                            <span class="hack-member-name">${memberName}</span>
                            <span class="hack-member-reg">${memberReg}${isLeader ? ' <span class="leader-tag">Leader</span>' : ''}</span>
                        </div>
                        ${profileLink ? `<a href="${profileLink}" class="hack-member-link"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
                    </div>`;
                }

                wonHTML += `
                <div class="hack-won-card">
                    <div class="hack-won-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="hack-won-left">
                            <span class="hack-medal">${medal}</span>
                            <div>
                                <div class="hack-won-name">${win.hackathonName}</div>
                                <div class="hack-won-meta">${win.position} Place · Team ${win.teamName}</div>
                            </div>
                        </div>
                        <i class="fa-solid fa-chevron-down hack-expand-icon"></i>
                    </div>
                    <div class="hack-won-details">
                        <p class="hack-won-desc">${win.hackathonDesc}</p>
                        <h4 class="hack-team-title"><i class="fa-solid fa-users"></i> Team Members</h4>
                        <div class="hack-members-list">
                            ${membersHTML}
                        </div>
                    </div>
                </div>`;
            }
            hackWonContainer.innerHTML = wonHTML;
        }

        // ─── All Skills ───
        const allSkillsContainer = document.getElementById('allSkillsContainer');
        const skills = data.skills || {};
        const skillKeys = typeof skills === 'object' && !Array.isArray(skills)
            ? Object.keys(skills).filter(k => skills[k] === true)
            : (Array.isArray(skills) ? skills : []);

        // Top 3 skills
        const top3 = Array.isArray(data.top3_skills) && data.top3_skills.length > 0
            ? data.top3_skills
            : skillKeys.slice(0, 3);

        if (skillKeys.length > 0) {
            let html = '';
            // Show top 3 first with gold styling
            top3.forEach(s => {
                html += `<span class="skill-chip top"><i class="fa-solid fa-trophy" style="font-size: 0.7rem; margin-right: 4px;"></i>${s}</span>`;
            });
            // Then all other skills
            skillKeys.filter(s => !top3.includes(s)).forEach(s => {
                html += `<span class="skill-chip">${s}</span>`;
            });
            allSkillsContainer.innerHTML = html;
        } else {
            allSkillsContainer.innerHTML = '<span class="empty-state">No skills added yet.</span>';
        }

        // ─── Links ───
        const linksContainer = document.getElementById('linksContainer');
        let linksHTML = '';
        if (data.github) {
            linksHTML += `<a href="${data.github}" target="_blank" rel="noopener" class="link-btn link-github">
                <i class="fa-brands fa-github" style="font-size: 1.1rem;"></i> GitHub
            </a>`;
        }
        if (data.linkedin) {
            linksHTML += `<a href="${data.linkedin}" target="_blank" rel="noopener" class="link-btn link-linkedin">
                <i class="fa-brands fa-linkedin" style="font-size: 1.1rem;"></i> LinkedIn
            </a>`;
        }
        if (!linksHTML) {
            linksHTML = '<span class="empty-state">No profile links available.</span>';
        }
        linksContainer.innerHTML = linksHTML;

        // ─── Project History ───
        const projectsContainer = document.getElementById('projectsContainer');
        try {
            const projQuery = query(
                collection(db, "projects"),
                where("team_members", "array-contains", uid)
            );
            const projSnap = await getDocs(projQuery);

            if (projSnap.empty) {
                projectsContainer.innerHTML = '<span class="empty-state">No project history yet.</span>';
            } else {
                let projHTML = '';
                projSnap.forEach(docSnap => {
                    const proj = docSnap.data();
                    const status = proj.status || "pending";
                    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
                    const ratingText = proj.rating ? `⭐ ${proj.rating}/5` : '';

                    let dotClass = 'pending';
                    let badgeClass = 'badge-pending';
                    if (status === 'completed') { dotClass = 'completed'; badgeClass = 'badge-completed'; }
                    else if (status === 'ongoing') { dotClass = 'ongoing'; badgeClass = 'badge-ongoing'; }

                    projHTML += `
                    <div class="project-item">
                        <div class="project-info">
                            <div class="project-dot ${dotClass}"></div>
                            <div>
                                <div class="project-name">${proj.name || proj.title || 'Untitled Project'}</div>
                                <div class="project-meta">${ratingText}</div>
                            </div>
                        </div>
                        <span class="project-badge ${badgeClass}">${statusLabel}</span>
                    </div>`;
                });
                projectsContainer.innerHTML = projHTML;
            }
        } catch (e) {
            console.warn("Could not fetch project history:", e);
            projectsContainer.innerHTML = '<span class="empty-state">Unable to load project history.</span>';
        }

        // ─── Message Button ───
        document.getElementById('btnMessage').addEventListener('click', () => {
            alert('Messaging feature coming soon!');
        });

        // ─── Share Button ───
        document.getElementById('btnShare').addEventListener('click', () => {
            const profileUrl = window.location.href;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(profileUrl).then(() => {
                    const btn = document.getElementById('btnShare');
                    const origHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                    btn.style.background = '#dcfce7';
                    btn.style.color = '#16a34a';
                    setTimeout(() => {
                        btn.innerHTML = origHTML;
                        btn.style.background = '';
                        btn.style.color = '';
                    }, 2000);
                });
            } else {
                prompt('Copy this link to share:', profileUrl);
            }
        });

        // ─── Show Content ───
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';

        // Page title
        document.title = `${data.name || 'Student'} — VIT Collab Hub`;

    } catch (e) {
        console.error("Failed to load profile:", e);
        showError();
    }
}

function showError() {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'flex';
}
