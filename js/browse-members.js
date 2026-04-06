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
            const fullName = data.name || "Student";
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) navUserName.textContent = fullName;
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

async function fetchMembers() {
    const grid = document.getElementById('membersGrid');

    try {
        const usersRef = collection(db, "users");
        // We want all students except the current user (if they are a student)
        const q = query(usersRef, where("role", "==", "student"));
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
        grid.innerHTML = '<p class="text-danger" style="text-align: center; width: 100%;">Failed to load members.</p>';
    }
}

function renderMembersList(members) {
    const grid = document.getElementById('membersGrid');
    grid.innerHTML = '';

    if (members.length === 0) {
        grid.innerHTML = '<p class="text-muted" style="text-align: center; width: 100%;">No members found matching your criteria.</p>';
        return;
    }

    members.forEach(member => {
        const name = member.name || "Student";
        const branch = member.branch || "Branch TBD";
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
        const top3Skills = Array.isArray(member.top3_skills) && member.top3_skills.length > 0
            ? member.top3_skills
            : (Array.isArray(member.skills) ? member.skills.slice(0, 3) : []);
        const pillsHTML = top3Skills.map(s => `<span class="skill-pill">${s}</span>`).join('');

        const card = document.createElement('div');
        card.className = 'member-card';
        card.innerHTML = `
            ${ratingHTML}
            <img src="${avatar}" alt="${name}" class="member-avatar">
            <h3 class="member-name">${name}</h3>
            <div class="member-role"><i class="fa-solid fa-graduation-cap"></i> ${branch}</div>
            
            <div class="member-skills">
                ${pillsHTML}
            </div>

            <div class="member-actions">
                <button class="btn btn-outline btn-sm" style="flex: 1;" onclick="window.viewMemberProfile('${member.id}')">View Profile</button>
                <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="alert('Messaging feature coming soon!')"><i class="fa-solid fa-message" style="margin-right: 4px;"></i>Message</button>
            </div>
        `;
        grid.appendChild(card);
    });
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

    profileOverlay.style.display = 'flex';
};

closeBtn.addEventListener('click', () => {
    profileOverlay.style.display = 'none';
});

profileOverlay.addEventListener('click', (e) => {
    if (e.target === profileOverlay) profileOverlay.style.display = 'none';
});