import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ALL_SKILLS, CATEGORY_COLORS } from "./skills-db.js";

let cachedMembers = [];
let currentUserId = null;

// ─── Search Autocomplete State ───
let acHighlightIndex = -1;
let acFilteredItems = [];
let currentFilterMode = 'all'; // 'all' | 'name' | 'skills' | 'branch'

document.addEventListener('DOMContentLoaded', () => {
    initSharedUI();
    initSearchAutocomplete();
    initFilterDropdown();
    
    // Segmented Role Toggle Logic
    const toggleStudentBtn = document.getElementById('toggleStudentBtn');
    const toggleAdminBtn = document.getElementById('toggleAdminBtn');
    const studentsGrid = document.getElementById('studentsGrid');
    const adminsGrid = document.getElementById('adminsGrid');

    if (toggleStudentBtn && toggleAdminBtn) {
        toggleStudentBtn.addEventListener('click', () => {
            toggleStudentBtn.classList.add('active');
            toggleStudentBtn.style.background = 'var(--primary-blue)';
            toggleStudentBtn.style.color = 'white';
            
            toggleAdminBtn.classList.remove('active');
            toggleAdminBtn.style.background = 'transparent';
            toggleAdminBtn.style.color = 'var(--primary-blue)';
            
            if(studentsGrid) studentsGrid.style.display = 'grid'; // .members-grid uses grid
            if(adminsGrid) adminsGrid.style.display = 'none';
        });

        toggleAdminBtn.addEventListener('click', () => {
            toggleAdminBtn.classList.add('active');
            toggleAdminBtn.style.background = 'var(--primary-blue)';
            toggleAdminBtn.style.color = 'white';
            
            toggleStudentBtn.classList.remove('active');
            toggleStudentBtn.style.background = 'transparent';
            toggleStudentBtn.style.color = 'var(--primary-blue)';
            
            if(adminsGrid) adminsGrid.style.display = 'grid';
            if(studentsGrid) studentsGrid.style.display = 'none';
        });
    }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    currentUserId = user.uid;
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            const fullName = data.name || (data.role === "admin" ? "Admin" : "Student");
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) navUserName.textContent = fullName;

            // Dynamically inject Admin Navigation if matched
            if (data.role === 'admin') {
                const navBrand = document.querySelector('.nav-brand');
                if (navBrand) navBrand.href = "admin-dashboard.html";
                
                const subNav = document.querySelector('.sub-navbar');
                if (subNav) {
                    subNav.innerHTML = `
                        <div class="sub-nav-link" onclick="window.location.href='admin-dashboard.html'">
                            <span class="icon-btn btn-blue nav-icon" style="pointer-events: none;">
                                <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
                            </span>
                            <span>Dashboard</span>
                        </div>
                        <div class="sub-nav-link" onclick="window.location.href='admin-dashboard.html#requests'">
                            <span class="icon-btn nav-icon" style="background-color: #0dcaf0; color: #005a6e; pointer-events: none;">
                                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                            </span>
                            <span>Requests</span>
                        </div>
                        <div class="sub-nav-link" onclick="window.location.href='admin-profile-setup.html'">
                            <span class="icon-btn btn-indigo nav-icon" style="pointer-events: none;">
                                <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                            </span>
                            <span>Profile</span>
                        </div>
                        <div class="sub-nav-link" onclick="window.location.href='admin-dashboard.html#history'">
                            <span class="icon-btn nav-icon" style="background-color: var(--success-msg); color: white; border: none; pointer-events: none;">
                                <i class="fa-solid fa-clock-rotate-left"></i>
                            </span>
                            <span>History</span>
                        </div>
                        <div class="sub-nav-link active">
                            <span class="icon-btn nav-icon" style="background-color: #0dcaf0; color: #005a6e; pointer-events: none;">
                                <i class="fa-solid fa-users"></i>
                            </span>
                            <span>Browse Members</span>
                        </div>
                    `;
                }
            }
        }
    } catch (e) { console.error("Error fetching user data", e); }

    fetchMembers();
});

document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut(auth).then(() => {
        window.location.href = 'login.html';
    });
});


function initSharedUI() {
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

    // Messages Page Link
    const fabMessages = document.getElementById('fabMessages');

    if (fabMessages) {
        fabMessages.addEventListener('click', () => { window.location.href = 'messages.html'; });
    }
}

async function fetchMembers() {
    const studentsGrid = document.getElementById('studentsGrid');
    const adminsGrid = document.getElementById('adminsGrid');

    try {
        const usersRef = collection(db, "users");
        // We want all students and admins
        const q = query(usersRef, where("role", "in", ["student", "admin"]));
        const snapshot = await getDocs(q);

        const loadedMembers = [];
        snapshot.forEach(docSnap => {
            if (docSnap.id !== currentUserId) {
                loadedMembers.push({ id: docSnap.id, ...docSnap.data() });
            }
        });

        cachedMembers = loadedMembers;
        renderMembersList(loadedMembers);

    } catch (err) {
        console.error("Error fetching members:", err);
        if (studentsGrid) studentsGrid.innerHTML = '<p class="text-danger" style="text-align: center; width: 100%;">Failed to load members.</p>';
        if (adminsGrid) adminsGrid.innerHTML = '<p class="text-danger" style="text-align: center; width: 100%;">Failed to load mentors.</p>';
    }
}

function renderMembersList(members) {
    const studentsGrid = document.getElementById('studentsGrid');
    const adminsGrid = document.getElementById('adminsGrid');
    
    if (studentsGrid) studentsGrid.innerHTML = '';
    if (adminsGrid) adminsGrid.innerHTML = '';

    const students = members.filter(m => m.role !== 'admin');
    const admins = members.filter(m => m.role === 'admin');

    if (students.length === 0 && studentsGrid) {
        studentsGrid.innerHTML = '<p class="text-muted" style="text-align: center; width: 100%;">No students found matching your criteria.</p>';
    }
    if (admins.length === 0 && adminsGrid) {
        adminsGrid.innerHTML = '<p class="text-muted" style="text-align: center; width: 100%;">No faculty/mentors found matching your criteria.</p>';
    }

    const renderCardToGrid = (member, targetGrid) => {
        if (!targetGrid) return;
        
        const name = member.name || (member.role === 'admin' ? "Faculty" : "Student");
        const branch = member.role === 'admin' ? (member.email || "Faculty Account") : (member.branch || "Branch TBD");
        const avatar = member.avatar_url || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";

        // Compute rating from Firestore fields
        let ratingHTML = "";
        if (member.total_reviews && member.total_reviews > 0) {
            const avg = (member.total_stars / member.total_reviews).toFixed(1);
            ratingHTML = `<div class="rating-badge-top"><i class="fa-solid fa-star"></i> ${avg}</div>`;
        } else {
            ratingHTML = `<div class="rating-badge-top">No Rating</div>`;
        }

        // Use user-selected top3_skills if available, else fallback
        let pillsHTML = "";
        if (member.role === 'admin') {
            pillsHTML = `<span class="skill-pill" style="background: rgba(245, 158, 11, 0.1); color: #b45309;">Mentor</span>`;
            if (member.employee_id) pillsHTML += `<span class="skill-pill" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">ID: ${member.employee_id}</span>`;
        } else {
            const top3Skills = Array.isArray(member.top3_skills) && member.top3_skills.length > 0
                ? member.top3_skills
                : (Array.isArray(member.skills) ? member.skills.slice(0, 3) : []);
            pillsHTML = top3Skills.map(s => `<span class="skill-pill">${s}</span>`).join('');
        }

        const iconClass = member.role === 'admin' ? "fa-envelope" : "fa-graduation-cap";

        const card = document.createElement('div');
        card.className = 'member-card';
        card.innerHTML = `
            ${ratingHTML}
            <img src="${avatar}" alt="${name}" class="member-avatar">
            <h3 class="member-name">${name}</h3>
            <div class="member-role"><i class="fa-solid ${iconClass}"></i> ${branch}</div>
            
            <div class="member-skills">
                ${pillsHTML}
            </div>

            <div class="member-actions">
                <button class="btn btn-outline btn-sm" style="flex: 1;" onclick="window.location.href='profile-view.html?uid=${member.id}'">View Profile</button>
                <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="window.location.href='messages.html?userId=${member.id}'"><i class="fa-solid fa-message" style="margin-right: 4px;"></i>Message</button>
            </div>
        `;
        targetGrid.appendChild(card);
    };

    students.forEach(s => renderCardToGrid(s, studentsGrid));
    admins.forEach(a => renderCardToGrid(a, adminsGrid));
}

// ─── Sort by Rating (highest first) ───
function sortByRating(members) {
    return [...members].sort((a, b) => {
        const ratingA = (a.total_reviews && a.total_reviews > 0) ? (a.total_stars / a.total_reviews) : -1;
        const ratingB = (b.total_reviews && b.total_reviews > 0) ? (b.total_stars / b.total_reviews) : -1;
        return ratingB - ratingA;
    });
}

// ─── Search Input Handler ───
document.getElementById('searchInput').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
        if (currentFilterMode === 'rating') {
            renderMembersList(sortByRating(cachedMembers));
        } else {
            renderMembersList(cachedMembers);
        }
        hideSearchDropdown();
        return;
    }

    // Show skill suggestions dropdown only when relevant
    if (currentFilterMode === 'skills' || currentFilterMode === 'all') {
        showSkillSuggestions(term);
    } else {
        hideSearchDropdown();
    }

    // Also filter members immediately
    let filtered = filterMembers(term);
    if (currentFilterMode === 'rating') {
        filtered = sortByRating(filtered);
    }
    renderMembersList(filtered);
});

function filterMembers(term) {
    return cachedMembers.filter(m => {
        // Normalize skills to an array to prevent crashes if stored as an object
        let skillsArr = [];
        if (Array.isArray(m.skills)) {
            skillsArr = m.skills;
        } else if (typeof m.skills === 'object' && m.skills !== null) {
            skillsArr = Object.keys(m.skills).filter(k => m.skills[k] === true);
        }

        switch (currentFilterMode) {
            case 'name':
                return (m.name || "").toLowerCase().includes(term);
            case 'skills':
                return skillsArr.some(s => s.toLowerCase().includes(term));
            case 'branch':
                return (m.branch || "").toLowerCase().includes(term);
            default: // 'all'
                const matchName = (m.name || "").toLowerCase().includes(term);
                const matchBranch = (m.branch || "").toLowerCase().includes(term);
                const matchRole = (m.position || "").toLowerCase().includes(term);
                const matchSkills = skillsArr.some(s => s.toLowerCase().includes(term));
                return matchName || matchBranch || matchRole || matchSkills;
        }
    });
}

// ─── Filter Dropdown ───
function initFilterDropdown() {
    const toggleBtn = document.getElementById('filterToggleBtn');
    const dropdown = document.getElementById('filterDropdown');
    const wrapper = document.getElementById('filterDropdownWrapper');
    if (!toggleBtn || !dropdown) return;

    // Toggle dropdown visibility
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('visible');
        dropdown.classList.toggle('visible', !isOpen);
        toggleBtn.classList.toggle('open', !isOpen);
    });

    // Handle option clicks
    dropdown.querySelectorAll('.filter-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const mode = opt.getAttribute('data-filter');
            currentFilterMode = mode;

            // Update active state
            dropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            // Update button label
            const labels = { all: 'All', name: 'Name', skills: 'Skills', rating: 'Rating' };
            document.getElementById('filterLabel').textContent = labels[mode] || 'All';

            // Update placeholder
            const placeholders = {
                all: 'Search by name, skills, or branch...',
                name: 'Search by name...',
                skills: 'Search by skill (e.g. React, Python)...',
                rating: 'Sorted by highest rating (type to filter)...'
            };
            document.getElementById('searchInput').placeholder = placeholders[mode] || placeholders.all;

            // Close dropdown
            dropdown.classList.remove('visible');
            toggleBtn.classList.remove('open');

            // Re-filter with current search term
            const term = document.getElementById('searchInput').value.toLowerCase().trim();
            if (mode === 'rating') {
                const list = term ? filterMembers(term) : cachedMembers;
                renderMembersList(sortByRating(list));
            } else if (term) {
                renderMembersList(filterMembers(term));
            }

            document.getElementById('searchInput').focus();
        });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            dropdown.classList.remove('visible');
            toggleBtn.classList.remove('open');
        }
    });

    // Wire up the Search button
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const term = document.getElementById('searchInput').value.toLowerCase().trim();
            if (!term) {
                renderMembersList(cachedMembers);
            } else {
                renderMembersList(filterMembers(term));
            }
            hideSearchDropdown();
        });
    }
}

// ─── Search Autocomplete ───
function initSearchAutocomplete() {
    const wrapper = document.querySelector('.search-bar-wrapper');
    const input = document.getElementById('searchInput');
    if (!wrapper || !input) return;

    // Create the dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'search-autocomplete';
    dropdown.id = 'searchAutocomplete';
    wrapper.appendChild(dropdown);

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        const dd = document.getElementById('searchAutocomplete');
        if (!dd || !dd.classList.contains('visible')) return;

        const selectableItems = dd.querySelectorAll('.search-ac-item');
        const total = selectableItems.length;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            acHighlightIndex = Math.min(acHighlightIndex + 1, total - 1);
            updateSearchHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            acHighlightIndex = Math.max(acHighlightIndex - 1, 0);
            updateSearchHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (acHighlightIndex >= 0 && selectableItems[acHighlightIndex]) {
                selectableItems[acHighlightIndex].click();
            }
        } else if (e.key === 'Escape') {
            hideSearchDropdown();
        }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-bar-wrapper')) {
            hideSearchDropdown();
        }
    });

    // Show suggestions on focus if there's text and filter mode allows it
    input.addEventListener('focus', () => {
        const val = input.value.trim().toLowerCase();
        if (val.length > 0 && (currentFilterMode === 'skills' || currentFilterMode === 'all')) {
            showSkillSuggestions(val);
        }
    });
}

function showSkillSuggestions(queryStr) {
    const dropdown = document.getElementById('searchAutocomplete');
    if (!dropdown) return;

    // Filter skills from the database
    acFilteredItems = ALL_SKILLS.filter(s =>
        s.name.toLowerCase().includes(queryStr)
    ).slice(0, 20);

    acHighlightIndex = -1;

    if (acFilteredItems.length === 0) {
        hideSearchDropdown();
        return;
    }

    // Group by category
    let html = '';
    let lastCategory = '';

    acFilteredItems.forEach((item, i) => {
        if (item.category !== lastCategory) {
            html += `<div class="search-ac-category">${item.category}</div>`;
            lastCategory = item.category;
        }

        const color = CATEGORY_COLORS[item.category] || '#64748b';

        // Highlight matching portion
        const lowerName = item.name.toLowerCase();
        const matchIdx = lowerName.indexOf(queryStr);
        let displayName;
        if (matchIdx >= 0) {
            const before = item.name.substring(0, matchIdx);
            const match = item.name.substring(matchIdx, matchIdx + queryStr.length);
            const after = item.name.substring(matchIdx + queryStr.length);
            displayName = `<span class="ac-rest">${before}</span><span class="ac-match">${match}</span><span class="ac-rest">${after}</span>`;
        } else {
            displayName = `<span class="ac-rest">${item.name}</span>`;
        }

        html += `<div class="search-ac-item" data-index="${i}" data-skill="${item.name}">
            <span class="ac-icon" style="background:${color}">${item.name.charAt(0).toUpperCase()}</span>
            <span>${displayName}</span>
        </div>`;
    });

    dropdown.innerHTML = html;
    dropdown.classList.add('visible');

    // Click handler on items
    dropdown.querySelectorAll('.search-ac-item').forEach(el => {
        el.addEventListener('click', () => {
            const skillName = el.getAttribute('data-skill');
            const input = document.getElementById('searchInput');
            input.value = skillName;
            hideSearchDropdown();

            // Filter members by the selected skill
            const filtered = filterMembers(skillName.toLowerCase());
            renderMembersList(filtered);
            input.focus();
        });
    });
}

function updateSearchHighlight() {
    const dropdown = document.getElementById('searchAutocomplete');
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.search-ac-item');
    items.forEach((el, i) => {
        el.classList.remove('highlighted');
        if (i === acHighlightIndex) {
            el.classList.add('highlighted');
            el.scrollIntoView({ block: 'nearest' });
        }
    });
}

function hideSearchDropdown() {
    const dropdown = document.getElementById('searchAutocomplete');
    if (dropdown) dropdown.classList.remove('visible');
    acHighlightIndex = -1;
    acFilteredItems = [];
}


// Modal Logic
const profileOverlay = document.getElementById('profileModalOverlay');
const closeBtn = document.getElementById('closeProfileModalBtn');

window.viewMemberProfile = (userId) => {
    const mem = cachedMembers.find(m => m.id === userId);
    if (!mem) return;

    document.getElementById('modalAvatar').src = mem.avatar_url || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
    document.getElementById('modalName').textContent = mem.name || "Student";
    document.getElementById('modalBranch').textContent = mem.branch || "Branch TBD";

    // Compute and show rating
    if (mem.total_reviews && mem.total_reviews > 0) {
        const rating = (mem.total_stars / mem.total_reviews).toFixed(1);
        document.getElementById('modalRatingContainer').innerHTML = `<i class="fa-solid fa-star" style="color: #f59e0b; margin-right: 6px;"></i><span id="modalRating">${rating}</span> / 5.0 Rating`;
    } else {
        document.getElementById('modalRatingContainer').innerHTML = `No Rating`;
    }
    document.getElementById('modalRatingContainer').style.display = 'inline-block';

    // Use user-selected top3_skills if available
    const top3Skills = Array.isArray(mem.top3_skills) && mem.top3_skills.length > 0
        ? mem.top3_skills
        : (Array.isArray(mem.skills) ? mem.skills.slice(0, 3) : []);

    const topPillsHTML = top3Skills.map(skill => `<span class="skill-pill">${skill}</span>`).join('');
    document.getElementById('modalTopSkills').innerHTML = topPillsHTML || '<span class="text-muted" style="font-size:0.8rem;">No top skills</span>';

    // Render GitHub / LinkedIn links
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

    // Set View Full Profile link
    const viewFullBtn = document.getElementById('viewFullProfileBtn');
    if (viewFullBtn) {
        viewFullBtn.onclick = () => {
            window.location.href = `profile-view.html?uid=${userId}`;
        };
    }

    // Set Message link
    const modalMsgBtn = document.getElementById('modalMessageBtn');
    if (modalMsgBtn) {
        modalMsgBtn.onclick = () => {
            window.location.href = `messages.html?userId=${userId}`;
        };
    }

    profileOverlay.style.display = 'flex';
};

closeBtn.addEventListener('click', () => {
    profileOverlay.style.display = 'none';
});

profileOverlay.addEventListener('click', (e) => {
    if (e.target === profileOverlay) profileOverlay.style.display = 'none';
});