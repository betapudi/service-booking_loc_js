class ProfileManager {
    constructor() {
        this.user = null;
        this.locationData = {
            states: [],
            districts: [],
            taluks: [],
            villages: []
        };
        this.skillsData = [];
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        this.user = JSON.parse(localStorage.getItem('user'));
        if (!this.user) {
            console.log('No user found, skipping profile check');
            return;
        }

        console.log('ProfileManager initialized for user:', this.user.id);
        this.initialized = true;

        // Wait a bit for the dashboard to load, then check profile
        setTimeout(() => {
            this.checkProfileStatus();
        }, 1000);
    }
    async checkProfileStatus() {
        try {
            console.log('Checking profile status for user:', this.user.id);

            // First, check if user has profile_completed field in localStorage
            if (this.user.profile_completed === false) {
                console.log('Profile not completed (from localStorage), showing modal immediately');
                this.showProfileCompletionModal({
                    name: !this.user.name,
                    location: !this.user.location_id,
                    experience: this.user.role === 'provider' && !this.user.experience_years,
                    literacy: this.user.role === 'provider' && !this.user.literacy_level,
                    skills: this.user.role === 'provider' && (!this.user.skills || this.user.skills.length === 0)
                });
                return;
            }

            // If not in localStorage, check with API
            const response = await apiCall('/profile/me/status');
            console.log('Profile status API response:', response);

            if (response.needs_completion || response.profile_completed === false) {
                console.log('Profile needs completion (from API), showing modal');
                this.showProfileCompletionModal(response.missing_fields || {
                    name: !this.user.name,
                    location: !this.user.location_id,
                    experience: this.user.role === 'provider' && !this.user.experience_years,
                    literacy: this.user.role === 'provider' && !this.user.literacy_level,
                    skills: this.user.role === 'provider' && (!this.user.skills || this.user.skills.length === 0)
                });
            } else {
                console.log('Profile is complete');
                await this.loadCompleteProfile();
            }
        } catch (error) {
            console.error('Error checking profile status:', error);
            // If API fails, check basic required fields and show modal if missing
            const hasBasicInfo = this.user.name && this.user.location_id;
            const hasProviderInfo = this.user.role !== 'provider' ||
                (this.user.experience_years && this.user.literacy_level &&
                    this.user.skills && this.user.skills.length > 0);

            if (!hasBasicInfo || !hasProviderInfo) {
                console.log('Basic info missing, showing modal despite API error');
                this.showProfileCompletionModal({
                    name: !this.user.name,
                    location: !this.user.location_id,
                    experience: this.user.role === 'provider' && !this.user.experience_years,
                    literacy: this.user.role === 'provider' && !this.user.literacy_level,
                    skills: this.user.role === 'provider' && (!this.user.skills || this.user.skills.length === 0)
                });
            }
        }
    }

    // Add this function to initialize profile manager
    async initializeProfileManager() {
        try {
            // Check if profile manager already exists
            if (!window.profileManager) {
                console.log('Creating new ProfileManager instance');
                window.profileManager = new ProfileManager();
            }

            // Initialize the profile manager
            await window.profileManager.init();

            console.log('ProfileManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize ProfileManager:', error);
        }
    }

    async loadCompleteProfile() {
        try {
            const response = await apiCall('/profile/me');
            const updatedUser = response.user;

            // Update user data in localStorage
            localStorage.setItem('user', JSON.stringify(updatedUser));
            this.user = updatedUser;

            console.log('Complete profile loaded:', updatedUser);

            // Dispatch event for other components to know profile is loaded
            window.dispatchEvent(new CustomEvent('profileLoaded', { detail: updatedUser }));
        } catch (error) {
            console.error('Error loading complete profile:', error);
        }
    }

    showProfileCompletionModal(missingFields) {
        // Check if modal already exists
        if (document.querySelector('.profile-completion-modal')) {
            console.log('Profile modal already exists');
            return;
        }

        console.log('Creating profile completion modal with missing fields:', missingFields);

        // Create and show modal for profile completion
        const modal = document.createElement('div');
        modal.className = 'profile-completion-modal';
        modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Complete Your Profile</h3>
          <p>Please provide some additional information to enhance your experience</p>
        </div>
        <div class="modal-body">
          <form id="profileForm">
            ${this.generateCollapsibleFormFields(missingFields)}
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Save Profile</button>
              <button type="button" class="btn btn-secondary" id="completeLaterBtn">
                Complete Later
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

        document.body.appendChild(modal);
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';

        // Close modal when clicking on backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeProfileModal();
            }
        });
        // Initialize all modal components
        this.setupFormHandlers();
        this.setupCollapsibleHandlers();
        this.loadLocationDataForProfile();

        // Load skills data for providers
        if (this.user?.role === 'provider') {
            this.loadSkillsData();
        }
    }

    generateCollapsibleFormFields(missingFields = {}) {
        let fields = '';

        // Always show Basic Information section
        fields += `
      <div class="collapsible-card active">
        <div class="collapsible-header">
          <h4>👤 Basic Information</h4>
          <span class="collapsible-icon">▼</span>
        </div>
        <div class="collapsible-content">
          <div class="form-group">
            <label for="name">Full Name *</label>
            <input type="text" id="name" name="name" required 
                   placeholder="Enter your full name" value="${this.user?.name || ''}">
          </div>
          <div class="form-group">
            <label for="gender">Gender</label>
            <select id="gender" name="gender">
              <option value="">Prefer not to say</option>
              <option value="male" ${this.user?.gender === 'male' ? 'selected' : ''}>Male</option>
              <option value="female" ${this.user?.gender === 'female' ? 'selected' : ''}>Female</option>
              <option value="other" ${this.user?.gender === 'other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label for="date_of_birth">Date of Birth</label>
            <input type="date" id="date_of_birth" name="date_of_birth" value="${this.user?.date_of_birth || ''}">
          </div>
        </div>
      </div>
    `;

        // Always show Location section
        fields += `
    <div class="collapsible-card">
        <div class="collapsible-header">
        <h4>📍 Location Details</h4>
        <span class="collapsible-icon">▼</span>
        </div>
        <div class="collapsible-content">
        ${missingFields.location ? '<span class="missing-badge">Missing</span>' : ''}
        <div class="form-group">
            <label for="state">State *</label>
            <select id="state" name="state" required></select>
        </div>
        <div class="form-group">
            <label for="district">District *</label>
            <select id="district" name="district" required disabled></select>
        </div>
        <div class="form-group">
            <label for="taluk">Taluk *</label>
            <select id="taluk" name="taluk" required disabled></select>
        </div>
        <div class="form-group">
            <label for="village">Village *</label>
            <select id="village" name="village" required disabled></select>
        </div>
        </div>
    </div>
    `;

        // Always show Professional Info for providers
        if (this.user?.role === 'provider') {
            fields += `
      <div class="collapsible-card">
        <div class="collapsible-header">
          <h4>🔧 Professional Information</h4>
          <span class="collapsible-icon">▼</span>
        </div>
        <div class="collapsible-content">
          <div class="form-group">
            <label for="experience_years">Years of Experience *</label>
            <select id="experience_years" name="experience_years" required>
              <option value="">Select Experience</option>
              <option value="0" ${this.user?.experience_years == 0 ? 'selected' : ''}>Less than 1 year</option>
              <option value="1" ${this.user?.experience_years == 1 ? 'selected' : ''}>1 year</option>
              <option value="2" ${this.user?.experience_years == 2 ? 'selected' : ''}>2 years</option>
              <option value="3" ${this.user?.experience_years == 3 ? 'selected' : ''}>3 years</option>
              <option value="5" ${this.user?.experience_years == 5 ? 'selected' : ''}>5+ years</option>
              <option value="10" ${this.user?.experience_years == 10 ? 'selected' : ''}>10+ years</option>
            </select>
          </div>

          <div class="form-group">
            <label for="literacy_level">Literacy Level *</label>
            <select id="literacy_level" name="literacy_level" required>
              <option value="">Select Literacy Level</option>
              <option value="illiterate" ${this.user?.literacy_level === 'illiterate' ? 'selected' : ''}>Illiterate</option>
              <option value="basic" ${this.user?.literacy_level === 'basic' ? 'selected' : ''}>Basic (Can read/write)</option>
              <option value="intermediate" ${this.user?.literacy_level === 'intermediate' ? 'selected' : ''}>Intermediate</option>
              <option value="advanced" ${this.user?.literacy_level === 'advanced' ? 'selected' : ''}>Advanced</option>
            </select>
          </div>

          <div class="form-group">
            <label for="education_level">Education Level</label>
            <input type="text" id="education_level" name="education_level" 
                   placeholder="e.g., 10th Standard, Diploma, Degree"
                   value="${this.user?.education_level || ''}">
          </div>

          <div class="form-group">
            <label for="skills">Skills *</label>
            <select id="skills" name="skills" multiple required 
                    style="height: 120px;" class="skills-multiselect">
              <option value="">Loading skills...</option>
            </select>
            <small>Hold Ctrl/Cmd to select multiple skills</small>
          </div>
        </div>
      </div>
    `;
        }

        return fields;
    }


    // Setup collapsible functionality
    setupCollapsibleHandlers() {
        const collapsibleHeaders = document.querySelectorAll('.collapsible-header');

        collapsibleHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const card = header.parentElement;
                const content = header.nextElementSibling;
                const icon = header.querySelector('.collapsible-icon');

                // Toggle active class
                card.classList.toggle('active');

                // Toggle content visibility
                if (content.style.maxHeight) {
                    content.style.maxHeight = null;
                    icon.textContent = '▼';
                } else {
                    content.style.maxHeight = content.scrollHeight + "px";
                    icon.textContent = '▲';
                }
            });
        });

        // Auto-expand first card
        const firstCard = document.querySelector('.collapsible-card.active');
        if (firstCard) {
            const content = firstCard.querySelector('.collapsible-content');
            const icon = firstCard.querySelector('.collapsible-icon');
            content.style.maxHeight = content.scrollHeight + "px";
            icon.textContent = '▲';
        }
    }

    // ===== LOCATION DATA METHODS =====
    async loadLocationDataForProfile() {
        try {
            console.log('Loading location data for profile...');
            const states = await apiCall('/location/states');
            if (Array.isArray(states)) {
                this.locationData.states = states;
                this.populateProfileSelect('state', states);
                this.setupProfileLocationEventListeners();
                console.log(`Loaded ${states.length} states for profile`);

                // If user already has a location, try to pre-populate
                if (this.user?.location_id) {
                    setTimeout(() => {
                        this.prePopulateLocation();
                    }, 500);
                }
            }
        } catch (error) {
            console.error('Error loading location data for profile:', error);
        }
    }

    setupProfileLocationEventListeners() {
        const stateSelect = document.getElementById('state');
        const districtSelect = document.getElementById('district');
        const talukSelect = document.getElementById('taluk');

        if (stateSelect) {
            stateSelect.addEventListener('change', () => this.onProfileStateChange());
        }
        if (districtSelect) {
            districtSelect.addEventListener('change', () => this.onProfileDistrictChange());
        }
        if (talukSelect) {
            talukSelect.addEventListener('change', () => this.onProfileTalukChange());
        }

        console.log('Profile location event listeners setup');
    }

    async onProfileStateChange() {
        const stateId = document.getElementById('state').value;
        if (!stateId) {
            this.resetProfileSelect('district');
            this.resetProfileSelect('taluk');
            this.resetProfileSelect('village');
            return;
        }

        try {
            const districts = await apiCall(`/location/districts/${stateId}`);
            this.locationData.districts = districts;
            this.populateProfileSelect('district', districts);
            document.getElementById('district').disabled = false;

            // Reset downstream selects
            this.resetProfileSelect('taluk');
            this.resetProfileSelect('village');
        } catch (error) {
            console.error('Error loading districts for profile:', error);
        }
    }

    async onProfileDistrictChange() {
        const districtId = document.getElementById('district').value;
        if (!districtId) {
            this.resetProfileSelect('taluk');
            this.resetProfileSelect('village');
            return;
        }

        try {
            const taluks = await apiCall(`/location/taluks/${districtId}`);
            this.locationData.taluks = taluks;
            this.populateProfileSelect('taluk', taluks);
            document.getElementById('taluk').disabled = false;

            // Reset downstream select
            this.resetProfileSelect('village');
        } catch (error) {
            console.error('Error loading taluks for profile:', error);
        }
    }

    async onProfileTalukChange() {
        const talukId = document.getElementById('taluk').value;
        if (!talukId) {
            this.resetProfileSelect('village');
            return;
        }

        try {
            const villages = await apiCall(`/location/villages/${talukId}`);
            this.locationData.villages = villages;
            this.populateProfileSelect('village', villages);
            document.getElementById('village').disabled = false;
        } catch (error) {
            console.error('Error loading villages for profile:', error);
        }
    }

    populateProfileSelect(selectId, data) {
        const select = document.getElementById(selectId);
        if (!select) {
            console.warn(`Profile select element ${selectId} not found`);
            return;
        }

        // Save current value
        const currentValue = select.value;

        // Clear and repopulate
        select.innerHTML = `<option value="">Select ${selectId.charAt(0).toUpperCase() + selectId.slice(1)}</option>`;

        data.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            select.appendChild(option);
        });

        // Restore value if it exists in new data
        if (currentValue && data.some(item => item.id == currentValue)) {
            select.value = currentValue;
        }
    }

    resetProfileSelect(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = `<option value="">Select ${selectId.charAt(0).toUpperCase() + selectId.slice(1)}</option>`;
        select.disabled = true;
    }

    async prePopulateLocation() {
        try {
            if (!this.user?.location_id) return;

            console.log('Pre-populating location for user:', this.user.location_id);

            const hierarchyResponse = await apiCall(`/location/${this.user.location_id}/hierarchy`);
            console.log('Location hierarchy received:', hierarchyResponse);

            if (hierarchyResponse && hierarchyResponse.length > 0) {
                // Find each level in the hierarchy
                const state = hierarchyResponse.find(loc => loc.type === 'state');
                const district = hierarchyResponse.find(loc => loc.type === 'district');
                const taluk = hierarchyResponse.find(loc => loc.type === 'taluk');
                const village = hierarchyResponse.find(loc => loc.type === 'village');

                console.log('Resolved location hierarchy:', { state, district, taluk, village });

                // Populate state first
                if (state) {
                    const stateSelect = document.getElementById('state');
                    if (stateSelect) {
                        stateSelect.value = state.id;
                        // Trigger change event to load districts
                        stateSelect.dispatchEvent(new Event('change'));
                    }
                }

                // Wait a bit then populate district
                if (district) {
                    setTimeout(() => {
                        const districtSelect = document.getElementById('district');
                        if (districtSelect) {
                            districtSelect.value = district.id;
                            districtSelect.dispatchEvent(new Event('change'));
                        }
                    }, 800);
                }

                // Wait a bit then populate taluk
                if (taluk) {
                    setTimeout(() => {
                        const talukSelect = document.getElementById('taluk');
                        if (talukSelect) {
                            talukSelect.value = taluk.id;
                            talukSelect.dispatchEvent(new Event('change'));
                        }
                    }, 1600);
                }

                // Wait a bit then populate village
                if (village) {
                    setTimeout(() => {
                        const villageSelect = document.getElementById('village');
                        if (villageSelect) {
                            villageSelect.value = village.id;
                            console.log('Location fully pre-populated');
                        }
                    }, 2400);
                }
            }
        } catch (error) {
            console.error('Error pre-populating location:', error);
        }
    }

    // ===== SKILLS DATA METHODS =====
    async loadSkillsData() {
        try {
            console.log('Loading skills data...');
            const response = await apiCall('/profile/skills');
            this.skillsData = response.skills;
            console.log('Skills data loaded:', this.skillsData);
            this.populateSkillsDropdown();
        } catch (error) {
            console.error('Error loading skills:', error);
            // Fallback to hardcoded skills if API fails
            this.skillsData = [
                { id: 1, name: "Electrician" }, { id: 2, name: "Plumber" },
                { id: 3, name: "Carpenter" }, { id: 4, name: "House Cleaning" },
                { id: 5, name: "AC Repair" }, { id: 6, name: "Painter" },
                { id: 7, name: "Gardener" }, { id: 8, name: "Mechanic" },
                { id: 9, name: "Driver" }, { id: 10, name: "Cook" },
                { id: 11, name: "Laundry Service" }, { id: 12, name: "Mason" },
                { id: 13, name: "Welder" }, { id: 14, name: "Beautician" },
                { id: 15, name: "Pest Control" }, { id: 16, name: "Solar Technician" },
                { id: 17, name: "Security Guard" }, { id: 18, name: "Computer Repair" },
                { id: 19, name: "TV Repair" }, { id: 20, name: "Water Tank Cleaning" },
                { id: 21, name: "Roofer" }, { id: 22, name: "Interior Designer" },
                { id: 23, name: "CCTV Installation" }, { id: 24, name: "Event Decorator" },
                { id: 25, name: "Appliance Technician" }
            ];
            console.log('Using fallback skills data');
            this.populateSkillsDropdown();
        }
    }

    populateSkillsDropdown() {
        const skillsSelect = document.getElementById('skills');
        if (!skillsSelect) {
            console.log('Skills select element not found');
            return;
        }

        // Clear existing options
        skillsSelect.innerHTML = '<option value="">Select Skills</option>';

        // Populate with all available skills
        this.skillsData.forEach(skill => {
            const option = document.createElement('option');
            option.value = skill.id;
            option.textContent = skill.name;
            skillsSelect.appendChild(option);
        });

        console.log('Skills dropdown populated with', this.skillsData.length, 'skills');

        // Pre-select user's existing skills
        this.preSelectUserSkills();
    }

    preSelectUserSkills() {
        if (!this.user?.skills || !this.user.skills.length) {
            console.log('No existing skills to pre-select');
            return;
        }

        const skillsSelect = document.getElementById('skills');
        if (!skillsSelect) return;

        console.log('Pre-selecting user skills:', this.user.skills);

        // Wait a bit for the dropdown to be fully populated
        setTimeout(() => {
            this.user.skills.forEach(skillName => {
                // Find the skill by name in our skillsData
                const skill = this.skillsData.find(s => s.name === skillName);
                if (skill) {
                    const option = skillsSelect.querySelector(`option[value="${skill.id}"]`);
                    if (option) {
                        option.selected = true;
                        console.log('Pre-selected skill:', skillName);
                    }
                }
            });
        }, 100);
    }

    // ===== FORM HANDLING METHODS =====
    // Update the "Complete Later" button handler
    setupFormHandlers() {
        const form = document.getElementById('profileForm');
        if (!form) {
            console.log('Profile form not found');
            return;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.submitProfileForm(new FormData(form));
        });

        // Handle "Complete Later" button
        const completeLaterBtn = document.getElementById('completeLaterBtn');
        if (completeLaterBtn) {
            completeLaterBtn.addEventListener('click', () => {
                this.closeProfileModal();
                showNotification('You can complete your profile later from settings.', 'info');
            });
        }

        console.log('Profile form handlers setup complete');
    }
    async submitProfileForm(formData) {
        const submitBtn = document.querySelector('#profileForm button[type="submit"]');
        const originalText = submitBtn.textContent;

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';

            const profileData = {
                name: formData.get('name') || this.user?.name,
                location_id: formData.get('village'), // Use village as primary location
                experience_years: formData.get('experience_years') ? parseInt(formData.get('experience_years')) : null,
                literacy_level: formData.get('literacy_level') || null,
                education_level: formData.get('education_level') || null,
                date_of_birth: formData.get('date_of_birth') || null,
                gender: formData.get('gender') || null
            };

            // Process skills - convert skill IDs to skill names
            const skillsSelect = document.getElementById('skills');
            if (skillsSelect) {
                const selectedSkillIds = Array.from(skillsSelect.selectedOptions)
                    .map(option => option.value)
                    .filter(value => value);

                // Convert skill IDs to skill names
                const selectedSkillNames = selectedSkillIds.map(skillId => {
                    const skill = this.skillsData.find(s => s.id == skillId);
                    return skill ? skill.name : null;
                }).filter(name => name !== null);

                profileData.skills = selectedSkillNames;
            }

            console.log('Submitting profile data:', profileData);

            const response = await apiCall('/profile/me', {
                method: 'PUT',
                body: profileData
            });

            if (response.success) {
                showNotification('Profile updated successfully!', 'success');

                // Update local storage and close modal
                localStorage.setItem('user', JSON.stringify(response.user));
                this.user = response.user;

                // Remove modal
                document.querySelector('.profile-completion-modal')?.remove();

                // Dispatch profile loaded event
                window.dispatchEvent(new CustomEvent('profileLoaded', { detail: response.user }));

                // Reload the page to reflect changes in the dashboard
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            showNotification('Failed to update profile. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
    // Add this method to handle modal closing
    closeProfileModal() {
        const modal = document.querySelector('.profile-completion-modal');
        if (modal) {
            modal.remove();
            document.body.style.overflow = ''; // Restore body scroll
        }
    }
    // ===== LEGACY METHODS (for backward compatibility) =====
    async loadLocationData() {
        // Legacy method - redirect to new method
        return this.loadLocationDataForProfile();
    }

    async onStateChange() {
        // Legacy method - redirect to new method
        return this.onProfileStateChange();
    }

    async onDistrictChange() {
        // Legacy method - redirect to new method
        return this.onProfileDistrictChange();
    }

    async onTalukChange() {
        // Legacy method - redirect to new method
        return this.onProfileTalukChange();
    }

    populateSelect(selectId, data) {
        // Legacy method - redirect to new method
        return this.populateProfileSelect(selectId, data);
    }

    resetSelect(selectId) {
        // Legacy method - redirect to new method
        return this.resetProfileSelect(selectId);
    }
}

// Initialize profile manager on every page
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM loaded, initializing ProfileManager...');

    // Wait for user data to be available
    const checkUser = setInterval(() => {
        const user = JSON.parse(localStorage.getItem('user'));
        if (user && user.id) {
            clearInterval(checkUser);
            console.log('User found, initializing ProfileManager');
            window.profileManager = new ProfileManager();
            window.profileManager.init();
        }
    }, 500);

    // Fallback: initialize after 3 seconds
    setTimeout(() => {
        if (!window.profileManager) {
            console.log('Fallback initialization of ProfileManager');
            window.profileManager = new ProfileManager();
            window.profileManager.init();
        }
    }, 3000);
});

// Export for use in other files
if (typeof window !== 'undefined') {
    window.ProfileManager = ProfileManager;
}