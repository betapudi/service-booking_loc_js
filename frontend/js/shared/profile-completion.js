import { apiCall } from "./api.js";
import { showNotification } from "./ui.js";

export class ProfileManager {
  constructor() {
    this.user = null;
    this.locationData = { states: [], districts: [], taluks: [], villages: [] };
    this.skillsData = [];
    this.initialized = false;
  }

  async init() {
    try {
        if (this.initialized) return;
        
        this.user = JSON.parse(localStorage.getItem("user"));
        if (!this.user) {
            console.error("No user found in localStorage");
            return;
        }

        console.log("Initializing profile manager for user:", this.user);
        this.initialized = true;
        
        // Immediate check instead of setTimeout
        await this.checkProfileStatus();
    } catch (error) {
        console.error("Profile manager initialization failed:", error);
    }
}

  async checkProfileStatus() {
    try {
        console.log("Checking profile status...");
        const response = await apiCall("/profile/me/status");
        console.log("Profile status response:", response);

        if (response.needs_completion || response.profile_completed === false) {
            console.log("Profile needs completion, showing modal");
            const missingFields = response.missing_fields || this.deriveMissingFieldsFallback();
            console.log("Missing fields:", missingFields);
            this.showProfileCompletionModal(missingFields);
        } else {
            console.log("Profile is complete, loading full profile");
            await this.loadCompleteProfile();
        }
    } catch (error) {
        console.error("Profile status check failed:", error);
        const missingFields = this.deriveMissingFieldsFallback();
        console.log("Using fallback missing fields:", missingFields);
        this.showProfileCompletionModal(missingFields);
    }
}

  deriveMissingFieldsFallback() {
    return {
      name: !this.user.name,
      location: !this.user.location_id,
      experience: this.user.role === "provider" && !this.user.experience_years,
      literacy: this.user.role === "provider" && !this.user.literacy_level,
      skills: this.user.role === "provider" && (!this.user.skills || this.user.skills.length === 0)
    };
  }

  async loadCompleteProfile() {
    const response = await apiCall("/profile/me");    
    this.user = response.user;
    localStorage.setItem("user", JSON.stringify(this.user));
    window.dispatchEvent(new CustomEvent("profileLoaded", { detail: this.user }));
  }

  showProfileCompletionModal(missingFields) {
    if (document.querySelector(".profile-completion-modal")) return;

    const modal = document.createElement("div");
    modal.className = "profile-completion-modal";
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Complete Your Profile (${this.user.role})</h3>
          <p>Missing fields will be auto-filled where possible. You can update them below.</p>
        </div>
        <div class="modal-body">
          <form id="profileForm">
            ${this.generateFormFields(missingFields)}
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Save Profile</button>
              <button type="button" class="btn btn-secondary" id="completeLaterBtn">Complete Later</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    this.setupFormHandlers();
    this.loadLocationDataForProfile();
    if (this.user.role === "provider") this.loadSkillsData();
  }

  generateFormFields(missingFields = {}) {
    const u = this.user;
    const isProvider = u.role === "provider";

    return `
      <div class="form-group">
        <label for="name">Full Name *</label>
        <input type="text" id="name" name="name" value="${u.name || ""}" required />
      </div>
      <div class="form-group">
        <label for="gender">Gender</label>
        <select id="gender" name="gender">
          <option value="">Prefer not to say</option>
          <option value="male" ${u.gender === "male" ? "selected" : ""}>Male</option>
          <option value="female" ${u.gender === "female" ? "selected" : ""}>Female</option>
          <option value="other" ${u.gender === "other" ? "selected" : ""}>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label for="date_of_birth">Date of Birth</label>
        <input type="date" id="date_of_birth" name="date_of_birth" value="${u.date_of_birth || ""}" />
      </div>
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
      ${isProvider ? `
        <div class="form-group">
          <label for="experience_years">Experience *</label>
          <select id="experience_years" name="experience_years" required>
            <option value="">Select</option>
            ${[0,1,2,3,5,10].map(y => `<option value="${y}" ${u.experience_years == y ? "selected" : ""}>${y === 0 ? "Less than 1 year" : y + "+ years"}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="literacy_level">Literacy Level *</label>
          <select id="literacy_level" name="literacy_level" required>
            <option value="">Select</option>
            ${["illiterate","basic","intermediate","advanced"].map(l => `<option value="${l}" ${u.literacy_level === l ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="education_level">Education Level</label>
          <input type="text" id="education_level" name="education_level" value="${u.education_level || ""}" />
        </div>
        <div class="form-group">
          <label for="skills">Skills *</label>
          <select id="skills" name="skills" multiple required style="height:120px;"></select>
        </div>
      ` : ""}
    `;
  }

  setupFormHandlers() {
    const form = document.getElementById("profileForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.submitProfileForm(new FormData(form));
    });

    document.getElementById("completeLaterBtn")?.addEventListener("click", () => {
      document.querySelector(".profile-completion-modal")?.remove();
      showNotification("You can complete your profile later.", "info");
    });
  }

  async submitProfileForm(formData) {
    const profileData = {
      name: formData.get("name"),
      location_id: formData.get("village"),
      gender: formData.get("gender"),
      date_of_birth: formData.get("date_of_birth"),
      experience_years: parseInt(formData.get("experience_years")) || null,
      literacy_level: formData.get("literacy_level"),
      education_level: formData.get("education_level")
    };

    const skillsSelect = document.getElementById("skills");
    if (skillsSelect) {
      const selectedSkillIds = Array.from(skillsSelect.selectedOptions).map(o => o.value);
      profileData.skills = selectedSkillIds.map(id => {
        const skill = this.skillsData.find(s => s.id == id);
        return skill?.name;
      }).filter(Boolean);
    }

    try {
      const res = await apiCall("/profile/me", { method: "PUT", body: profileData });
      if (res.success) {
        localStorage.setItem("user", JSON.stringify(res.user));
        this.user = res.user;
        document.querySelector(".profile-completion-modal")?.remove();
        window.dispatchEvent(new CustomEvent("profileLoaded", { detail: res.user }));
        showNotification("Profile updated successfully!", "success");
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      console.error("Profile update failed:", err);
      showNotification("Failed to update profile.", "error");
    }
  }

  async loadLocationDataForProfile() {
    const states = await apiCall("/location/states");
    this.locationData.states = states;
    this.populateSelect("state", states);
    this.setupLocationListeners();
    if (this.user.location_id) setTimeout(() => this.prePopulateLocation(), 500);
  }

  setupLocationListeners() {
    document.getElementById("state")?.addEventListener("change", () => this.onStateChange());
    document.getElementById("district")?.addEventListener("change", () => this.onDistrictChange());
    document.getElementById("taluk")?.addEventListener("change", () => this.onTalukChange());
  }

  async onStateChange() {
    const stateId = document.getElementById("state").value;
    const districts = await apiCall(`/location/districts/${stateId}`);
    this.locationData.districts = districts
        this.populateSelect("district", districts);
    document.getElementById("district").disabled = false;
    this.resetSelect("taluk");
    this.resetSelect("village");
  }

  async onDistrictChange() {
    const districtId = document.getElementById("district").value;
    const taluks = await apiCall(`/location/taluks/${districtId}`);
    this.locationData.taluks = taluks;
    this.populateSelect("taluk", taluks);
    document.getElementById("taluk").disabled = false;
    this.resetSelect("village");
  }

  async onTalukChange() {
    const talukId = document.getElementById("taluk").value;
    const villages = await apiCall(`/location/villages/${talukId}`);
    this.locationData.villages = villages;
    this.populateSelect("village", villages);
    document.getElementById("village").disabled = false;
  }

  populateSelect(selectId, data) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = `<option value="">Select ${selectId.charAt(0).toUpperCase() + selectId.slice(1)}</option>`;
    data.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
  }

  resetSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = `<option value="">Select ${selectId.charAt(0).toUpperCase() + selectId.slice(1)}</option>`;
    select.disabled = true;
  }

  async prePopulateLocation() {
    const hierarchy = await apiCall(`/location/${this.user.location_id}/hierarchy`);
    const state = hierarchy.find(loc => loc.type === "state");
    const district = hierarchy.find(loc => loc.type === "district");
    const taluk = hierarchy.find(loc => loc.type === "taluk");
    const village = hierarchy.find(loc => loc.type === "village");

    if (state) {
      document.getElementById("state").value = state.id;
      document.getElementById("state").dispatchEvent(new Event("change"));
    }
    if (district) {
      setTimeout(() => {
        document.getElementById("district").value = district.id;
        document.getElementById("district").dispatchEvent(new Event("change"));
      }, 800);
    }
    if (taluk) {
      setTimeout(() => {
        document.getElementById("taluk").value = taluk.id;
        document.getElementById("taluk").dispatchEvent(new Event("change"));
      }, 1600);
    }
    if (village) {
      setTimeout(() => {
        document.getElementById("village").value = village.id;
      }, 2400);
    }
  }

  async loadSkillsData() {
    try {
      const response = await apiCall("/profile/skills");
      this.skillsData = response.skills;
    } catch (error) {
      console.error("Skills API failed, using fallback");
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
    }

    const skillsSelect = document.getElementById("skills");
    if (!skillsSelect) return;

    skillsSelect.innerHTML = "";
    this.skillsData.forEach(skill => {
      const option = document.createElement("option");
      option.value = skill.id;
      option.textContent = skill.name;
      skillsSelect.appendChild(option);
    });

    this.preSelectUserSkills();
  }

  preSelectUserSkills() {
    if (!this.user.skills || !this.user.skills.length) return;
    const skillsSelect = document.getElementById("skills");
    if (!skillsSelect) return;

    setTimeout(() => {
      this.user.skills.forEach(skillName => {
        const skill = this.skillsData.find(s => s.name === skillName);
        if (skill) {
          const option = skillsSelect.querySelector(`option[value="${skill.id}"]`);
          if (option) option.selected = true;
        }
      });
    }, 100);
  }
}

// Global initializer
export async function initializeProfileManager() {
  if (!window.profileManager) {
    window.profileManager = new ProfileManager();
  }
  await window.profileManager.init();
}
