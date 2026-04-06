import { auth, db, storage } from "./firebase-config.js?v=2.2";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { SKILLS_DATABASE, ALL_SKILLS, CATEGORY_COLORS } from "./skills-db.js?v=2.2";

/**
 * student-profile.js
 * Handles populating the user's profile, calculating dynamic fields (average rating from stars),
 * and processing form submissions for profile updates.
 */

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = "login.html";
            return;
        }
        initProfile(user);
    });

    // Event Listeners for UI
    const pForm = document.getElementById('profileForm');
    if (pForm) pForm.addEventListener('submit', (e) => handleProfileSave(e, auth.currentUser));
    
    document.getElementById('skillInput')?.addEventListener('keydown', handleSkillTagEvent);
    initSkillAutocomplete();

    // Media Upload Listeners
    const coverUpload = document.getElementById('coverUploadInput');
    if (coverUpload) coverUpload.addEventListener('change', handleCoverUpload);
    
    const avatarUpload = document.getElementById('avatarUploadInput');
    if (avatarUpload) avatarUpload.addEventListener('change', handleAvatarUpload);

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

    // Logout Button
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        signOut(auth).then(() => {
            window.location.href = 'login.html';
        }).catch((err) => {
            console.error('Logout error:', err);
            alert('Failed to log out. Please try again.');
        });
    });
});

let pendingCoverFile = null;
let pendingAvatarFile = null;

// Compression Utility for images (to confidently avoid Firestore 1MB limits)
function compressImage(file, maxWidth, maxHeight, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // Return compressed webp or jpeg
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Handle local media uploads (Preview)
 */
function handleCoverUpload(e) {
    const file = e.target.files[0];
    if (file) {
        pendingCoverFile = file;
        const reader = new FileReader();
        reader.onload = function (event) {
            const imgUrl = event.target.result;
            document.getElementById('profileCover').style.backgroundImage = `linear-gradient(135deg, rgba(13,110,253,0.7) 0%, rgba(10,25,47,0.8) 100%), url('${imgUrl}')`;
        }
        reader.readAsDataURL(file);
    }
}

function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (file) {
        pendingAvatarFile = file;
        const reader = new FileReader();
        reader.onload = function (event) {
            document.getElementById('profile-avatar').src = event.target.result;
            if (document.getElementById('nav-avatar')) {
                document.getElementById('nav-avatar').src = event.target.result;
            }
        }
        reader.readAsDataURL(file);
    }
}

// A local state copy of skills as a "Map" mock ({ "react": true, "node": true })
let userSkillsMap = {};
let userTop3Skills = []; // User-selected top 3 skills

/**
 * Initialize Profile Data from Backend
 */
async function initProfile(user) {
    try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);

        let userData = {
            name: user.displayName || "New User",
            email: user.email || "",
            registration_number: "",
            branch: "",
            block: "",
            skills: {},
            completed_projects: 0,
            total_stars: 0,
            total_reviews: 0,
            avatar_url: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png",
            github: "",
            linkedin: "",
            top3_skills: []
        };

        if (docSnap.exists()) {
            userData = { ...userData, ...docSnap.data() };
            
            // ─── Self-Healing Patch for Negative Metrics ───
            let needsHeal = false;
            let healData = {};
            const metricFields = ['completed_projects', 'total_stars', 'project_stars', 'total_reviews'];
            
            metricFields.forEach(field => {
                if (userData[field] !== undefined && userData[field] < 0) {
                    userData[field] = 0;
                    healData[field] = 0;
                    needsHeal = true;
                }
            });
            
            if (needsHeal) {
                console.warn("Self-Heal Triggered: Resetting negative metrics to 0.");
                try {
                    await updateDoc(doc(db, "users", user.uid), healData);
                } catch(e) { console.error("Self-Heal Failed:", e); }
            }
        }

        // 1 & 2. Map profile strings safely
        const dName = document.getElementById('display-name');
        if (dName) dName.textContent = userData.name;

        const nName = document.getElementById('nav-user-name');
        if (nName) nName.textContent = userData.name || "Student";

        const pAvatar = document.getElementById('profile-avatar');
        if (pAvatar) pAvatar.src = userData.avatar_url;

        const nAvatar = document.getElementById('nav-avatar');
        if (nAvatar) nAvatar.src = userData.avatar_url;

        const dBranch = document.getElementById('display-branch');
        if (dBranch) dBranch.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${userData.branch || 'Add Branch'}`;
        
        const ratingBadge = document.getElementById('display-rating');
        if (ratingBadge) {
            if (userData.total_reviews && userData.total_reviews > 0) {
                let avgRating = (userData.total_stars / userData.total_reviews).toFixed(1);
                ratingBadge.style.display = 'inline-flex';
                ratingBadge.innerHTML = `<i class="fa-solid fa-star"></i> ${avgRating} / 5.0 Rating`;
            } else {
                ratingBadge.style.display = 'inline-flex';
                ratingBadge.innerHTML = `No Rating`;
            }
        }

        if (userData.cover_url) {
            const coverEl = document.getElementById('profileCover');
            if (coverEl) coverEl.style.backgroundImage = `linear-gradient(135deg, rgba(13,110,253,0.7) 0%, rgba(10,25,47,0.8) 100%), url('${userData.cover_url}')`;
        }

        // Stats (Safeguarded for pages that omit these elements)
        const statCompletedEl = document.getElementById('stat-completed');
        if (statCompletedEl) statCompletedEl.textContent = userData.completed_projects || 0;
        
        const statReviewsEl = document.getElementById('stat-reviews');
        if (statReviewsEl) statReviewsEl.textContent = userData.total_reviews || 0;

        // 3. Populate Form View safely
        if(document.getElementById('input-name')) document.getElementById('input-name').value = userData.name || '';
        if(document.getElementById('input-reg')) document.getElementById('input-reg').value = userData.registration_number || '';
        if(document.getElementById('input-branch')) document.getElementById('input-branch').value = userData.branch || '';
        if(userData.gender && document.getElementById('input-gender')) document.getElementById('input-gender').value = userData.gender;
        if(document.getElementById('input-block')) document.getElementById('input-block').value = userData.block || '';
        if(document.getElementById('input-email')) document.getElementById('input-email').value = userData.email || '';
        if (document.getElementById('input-github')) {
            document.getElementById('input-github').value = userData.github || '';
        }
        if (document.getElementById('input-linkedin')) {
            document.getElementById('input-linkedin').value = userData.linkedin || '';
        }

        // Populate Skills Map
        if (userData.skills) {
            userSkillsMap = userData.skills;
        }

        // Load user-selected Top 3 Skills
        if (Array.isArray(userData.top3_skills)) {
            userTop3Skills = userData.top3_skills;
        }

        renderSkillTags();

    } catch (e) {
        console.error("Failed to load profile", e);
    }
}

/**
 * Handle form submission
 */
async function handleProfileSave(e, user) {
    e.preventDefault();
    if (!user) return;

    // Grab button to show loading state
    const btn = document.getElementById('saveProfileBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
    btn.disabled = true;

    const updatedData = {
        name: document.getElementById('input-name').value.trim(),
        registration_number: document.getElementById('input-reg').value.trim(),
        gender: document.getElementById('input-gender').value,
        branch: document.getElementById('input-branch').value.trim(),
        block: document.getElementById('input-block').value.trim(),
        email: document.getElementById('input-email').value.trim(),
        github: document.getElementById('input-github') ? document.getElementById('input-github').value.trim() : '',
        linkedin: document.getElementById('input-linkedin') ? document.getElementById('input-linkedin').value.trim() : '',
        skills: userSkillsMap,
        top3_skills: userTop3Skills,
        role: "student" // Important! Dashboards rely on this role definition
    };

    try {
        // Compress and encode images dynamically locally to bypass Storage requirements
        if (pendingAvatarFile) {
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Compressing Avatar...';
            // Compress heavily: 300x300 px
            updatedData.avatar_url = await compressImage(pendingAvatarFile, 300, 300, 0.8);
            pendingAvatarFile = null;
        }

        if (pendingCoverFile) {
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Compressing Cover...';
            // Compress horizontally: 900x400 px max
            updatedData.cover_url = await compressImage(pendingCoverFile, 900, 400, 0.8);
            pendingCoverFile = null;
        }

        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving Profile...';
        const docRef = doc(db, 'users', user.uid);
        await setDoc(docRef, updatedData, { merge: true });

        // Display Header changes instantly
        document.getElementById('display-name').textContent = updatedData.name;
        document.getElementById('display-branch').innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${updatedData.branch}`;
        document.getElementById('nav-user-name').textContent = updatedData.name || "Student";
        if (updatedData.avatar_url && document.getElementById('nav-avatar')) {
            document.getElementById('nav-avatar').src = updatedData.avatar_url;
        }

        // Toast success
        alert("Profile saved successfully! You can now visit your Dashboard.");

    } catch (error) {
        console.error(error);
        alert("Error saving profile. Try again.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Skill Autocomplete & Tag Management
 */

let acHighlightIndex = -1;
let acFilteredItems = [];

/**
 * Handle keyboard input for skills (Enter, Comma, Arrow Keys)
 */
function handleSkillTagEvent(e) {
    const dropdown = document.getElementById('skillsAutocomplete');

    // Arrow key navigation in dropdown
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (acFilteredItems.length > 0) {
            acHighlightIndex = Math.min(acHighlightIndex + 1, acFilteredItems.length - 1);
            updateHighlight();
        }
        return;
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (acFilteredItems.length > 0) {
            acHighlightIndex = Math.max(acHighlightIndex - 1, 0);
            updateHighlight();
        }
        return;
    }

    // Enter or comma to add skill
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();

        // If a dropdown item is highlighted, use that
        if (acHighlightIndex >= 0 && acFilteredItems[acHighlightIndex]) {
            const selected = acFilteredItems[acHighlightIndex];
            addSkill(selected.name.toLowerCase());
        } else {
            // Else use whatever is typed
            const rawValue = e.target.value.trim().toLowerCase();
            if (rawValue !== "") {
                addSkill(rawValue);
            }
        }
        e.target.value = '';
        hideAutocomplete();
        return;
    }

    // Escape to close dropdown
    if (e.key === 'Escape') {
        hideAutocomplete();
        return;
    }
}

function addSkill(skillName) {
    if (!userSkillsMap[skillName]) {
        userSkillsMap[skillName] = true;
        renderSkillTags();
    }
}

/**
 * Initialize autocomplete on the skill input
 */
function initSkillAutocomplete() {
    const input = document.getElementById('skillInput');
    if (!input) return;

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'skills-autocomplete';
    dropdown.id = 'skillsAutocomplete';
    document.getElementById('skillTagsContainer').appendChild(dropdown);

    // Listen for typing
    input.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if (val.length === 0) {
            hideAutocomplete();
            return;
        }
        filterAndShowSuggestions(val);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.skills-input-wrapper')) {
            hideAutocomplete();
        }
    });

    // Show suggestions on focus if there's text
    input.addEventListener('focus', () => {
        const val = input.value.trim().toLowerCase();
        if (val.length > 0) {
            filterAndShowSuggestions(val);
        }
    });
}

function filterAndShowSuggestions(query) {
    const dropdown = document.getElementById('skillsAutocomplete');
    if (!dropdown) return;

    // Filter skills matching the query
    acFilteredItems = ALL_SKILLS.filter(s =>
        s.name.toLowerCase().includes(query)
    ).slice(0, 25); // Cap at 25 results

    acHighlightIndex = -1;

    if (acFilteredItems.length === 0) {
        dropdown.innerHTML = `<div class="skills-ac-item" style="color: #94a3b8; pointer-events:none; justify-content:center; font-style:italic;">
            Press Enter to add "${query}" as a custom skill
        </div>`;
        dropdown.classList.add('visible');
        return;
    }

    // Group by category
    let html = '';
    let lastCategory = '';

    acFilteredItems.forEach((item, i) => {
        if (item.category !== lastCategory) {
            html += `<div class="skills-ac-category">${item.category}</div>`;
            lastCategory = item.category;
        }

        const isAdded = userSkillsMap[item.name.toLowerCase()] === true;
        const color = CATEGORY_COLORS[item.category] || '#64748b';

        // Highlight matching portion
        const lowerName = item.name.toLowerCase();
        const matchIdx = lowerName.indexOf(query);
        let displayName;
        if (matchIdx >= 0) {
            const before = item.name.substring(0, matchIdx);
            const match = item.name.substring(matchIdx, matchIdx + query.length);
            const after = item.name.substring(matchIdx + query.length);
            displayName = `<span class="ac-rest">${before}</span><span class="ac-match">${match}</span><span class="ac-rest">${after}</span>`;
        } else {
            displayName = `<span class="ac-rest">${item.name}</span>`;
        }

        html += `<div class="skills-ac-item${isAdded ? ' ac-added' : ''}" data-index="${i}">
            <span class="ac-icon" style="background:${color}">${item.name.charAt(0).toUpperCase()}</span>
            <span>${displayName}</span>
        </div>`;
    });

    dropdown.innerHTML = html;
    dropdown.classList.add('visible');

    // Click handler on items
    dropdown.querySelectorAll('.skills-ac-item:not(.ac-added)').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.getAttribute('data-index'));
            if (acFilteredItems[idx]) {
                addSkill(acFilteredItems[idx].name.toLowerCase());
                document.getElementById('skillInput').value = '';
                hideAutocomplete();
                document.getElementById('skillInput').focus();
            }
        });
    });
}

function updateHighlight() {
    const dropdown = document.getElementById('skillsAutocomplete');
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.skills-ac-item:not(.ac-added)');
    let realIndex = 0;
    dropdown.querySelectorAll('.skills-ac-item').forEach(el => {
        el.classList.remove('highlighted');
        if (!el.classList.contains('ac-added')) {
            if (realIndex === acHighlightIndex) {
                el.classList.add('highlighted');
                el.scrollIntoView({ block: 'nearest' });
            }
            realIndex++;
        }
    });
}

function hideAutocomplete() {
    const dropdown = document.getElementById('skillsAutocomplete');
    if (dropdown) {
        dropdown.classList.remove('visible');
    }
    acHighlightIndex = -1;
    acFilteredItems = [];
}

/**
 * Refresh visual skill nodes from the HashMap
 */
function renderSkillTags() {
    const container = document.getElementById('skillTagsContainer');

    // Clear old tags (but keep the input box and autocomplete dropdown)
    document.querySelectorAll('.skill-tag').forEach(el => el.remove());

    const inputNode = document.getElementById('skillInput');
    if (!inputNode) return;

    // Create a new pill for every true key in the map
    Object.keys(userSkillsMap).forEach(skill => {
        if (userSkillsMap[skill] === true) {
            const tag = document.createElement('span');
            tag.className = 'skill-tag';
            const isTop = userTop3Skills.includes(skill);
            tag.innerHTML = `${isTop ? '<i class="fa-solid fa-star" style="font-size: 10px; color: #f59e0b; margin-right: 3px;"></i>' : ''}${skill} <i class="fa-solid fa-xmark" aria-hidden="true"></i>`;
            if (isTop) {
                tag.style.background = 'rgba(245,158,11,0.15)';
                tag.style.border = '1px solid rgba(245,158,11,0.4)';
            }
            tag.style.cursor = 'pointer';

            // Click tag to toggle top 3 selection
            tag.addEventListener('click', (e) => {
                // Don't toggle if clicking the X delete button
                if (e.target.classList.contains('fa-xmark')) return;
                toggleTop3Skill(skill);
            });

            // Allow deletion via X icon
            tag.querySelector('.fa-xmark').addEventListener('click', (e) => {
                e.stopPropagation();
                delete userSkillsMap[skill];
                // Also remove from top 3 if present
                userTop3Skills = userTop3Skills.filter(s => s !== skill);
                renderSkillTags();
            });

            container.insertBefore(tag, inputNode);
        }
    });

    // Update Top 3 Skills display
    updateTop3Display();
}

/**
 * Toggle a skill in/out of the top 3 selection
 */
function toggleTop3Skill(skill) {
    const idx = userTop3Skills.indexOf(skill);
    if (idx >= 0) {
        // Remove from top 3
        userTop3Skills.splice(idx, 1);
    } else {
        // Add to top 3 (max 3)
        if (userTop3Skills.length >= 3) {
            alert('You can select at most 3 top skills. Remove one first.');
            return;
        }
        userTop3Skills.push(skill);
    }
    renderSkillTags();
}

/**
 * Update the Top 3 Technical Skills display
 */
function updateTop3Display() {
    const display = document.getElementById('top3SkillsDisplay');
    if (!display) return;

    if (userTop3Skills.length === 0) {
        display.innerHTML = '<span class="text-muted" style="font-size: 0.85rem;">Click a skill above to mark it as a top skill.</span>';
        return;
    }

    display.innerHTML = userTop3Skills.map(skill =>
        `<span style="background: rgba(245,158,11,0.1); color: #b45309; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid rgba(245,158,11,0.2); cursor: pointer; transition: opacity 0.2s;"
              onclick="document.dispatchEvent(new CustomEvent('removeTop3', {detail: '${skill}'}))"
              onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
            <i class="fa-solid fa-star" style="font-size: 10px; margin-right: 4px;"></i>${skill}
            <i class="fa-solid fa-xmark" style="font-size: 10px; margin-left: 6px; opacity: 0.6;"></i>
        </span>`
    ).join('');
}

// Listen for remove top 3 events from the display pills
document.addEventListener('removeTop3', (e) => {
    const skill = e.detail;
    userTop3Skills = userTop3Skills.filter(s => s !== skill);
    renderSkillTags();
});