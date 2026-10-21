/**
 * TeamFair - Main Application Engine
 * Hỗ trợ 2 Role: Nhóm Trưởng (Leader) & Thành Viên (Member) với 2 Dashboard riêng biệt.
 * Tích hợp lưu trữ Azure SQL Database + LocalStorage offline fallback.
 */

const DEFAULT_STATE = {
  team: {
    name: "Nhóm của tôi",
    topic: "",
    subject: "",
    classCode: "",
    finalDeadline: ""
  },
  members: [],
  tasks: [],
  schedules: {},
  meetings: [],
  reviews: [],
  emails: [],
  activities: []
};

const DEFAULT_LEADER = {
  id: "leader_root",
  name: "Trưởng Nhóm",
  email: "",
  role: "Trưởng nhóm",
  roleType: "Leader",
  avatar: "TN",
  color: "#059669"
};

const TeamFairApp = {
  state: null,
  currentUser: null,
  selectedQuickRole: "Leader",
  activeTab: "dashboard",
  currentSchedulerMemberId: "",
  inMeeting: false,
  micOn: true,
  cameraOn: true,
  screenSharing: false,
  meetingTimer: null,
  meetingSeconds: 0,

  async init() {
    this.loadUserSession();
    await this.loadState();
    this.bindEvents();
    this.renderAll();

    // Tự động kiểm tra nhắc hạn chót theo cấu hình khi vào trang
    setTimeout(() => {
      this.checkAndSendDeadlineReminders(false);
    }, 2000);

    // Định kỳ quét mỗi 5 phút một lần
    setInterval(() => {
      this.checkAndSendDeadlineReminders(false);
    }, 5 * 60 * 1000);
  },

  loadUserSession() {
    // 1. Kiểm tra cookie từ Google OAuth callback nếu có
    const gUserCookie = this.getCookie("tf_google_user");
    if (gUserCookie) {
      try {
        const parsed = JSON.parse(decodeURIComponent(gUserCookie));
        if (parsed && parsed.email) {
          this.currentUser = parsed;
          this.saveUserSession();
          document.cookie = "tf_google_user=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
          this.showToast(`Chào mừng ${parsed.name}! Đã đăng nhập bằng Google thành công.`, "success");
          return;
        }
      } catch (e) {
        console.warn("Lỗi đọc cookie Google OAuth:", e);
      }
    }

    // 2. LocalStorage fallback
    try {
      const savedUser = localStorage.getItem("TeamFair_CurrentUser_v1");
      if (savedUser) {
        this.currentUser = JSON.parse(savedUser);
      } else {
        this.currentUser = null;
      }
    } catch (e) {
      this.currentUser = null;
    }
  },

  getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  },

  saveUserSession() {
    try {
      if (this.currentUser) {
        localStorage.setItem("TeamFair_CurrentUser_v1", JSON.stringify(this.currentUser));
      } else {
        localStorage.removeItem("TeamFair_CurrentUser_v1");
      }
    } catch (e) {
      console.error("Lỗi lưu session user:", e);
    }
  },

  async loadState() {
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          this.state = {
            team: data.team || { ...DEFAULT_STATE.team },
            members: data.members || [],
            tasks: data.tasks || [],
            schedules: data.schedules || {},
            meetings: data.meetings || [],
            reviews: data.reviews || [],
            emails: data.emails || [],
            activities: data.activities || []
          };
          this.updateDbStatus(true);
          this.syncCurrentUserWithMembers();
          return;
        }
      }
    } catch (err) {
      console.warn("Chưa kết nối API backend, dùng localStorage:", err);
      this.updateDbStatus(false);
    }

    try {
      const saved = localStorage.getItem("TeamFair_State_v3");
      if (saved) {
        this.state = JSON.parse(saved);
        if (!Array.isArray(this.state.members)) this.state.members = [];
        if (!Array.isArray(this.state.tasks)) this.state.tasks = [];
        if (!Array.isArray(this.state.meetings)) this.state.meetings = [];
        if (!Array.isArray(this.state.reviews)) this.state.reviews = [];
        if (!Array.isArray(this.state.emails)) this.state.emails = [];
        if (!Array.isArray(this.state.activities)) this.state.activities = [];
        if (!this.state.schedules) this.state.schedules = {};
        if (!this.state.team) this.state.team = { ...DEFAULT_STATE.team };
      } else {
        this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      }
    } catch (e) {
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }

    this.syncCurrentUserWithMembers();
  },

  syncCurrentUserWithMembers() {
    if (this.currentUser && this.currentUser.roleType === "Member") {
      const matched = this.state.members.find(m =>
        m.id === this.currentUser.id ||
        (m.email && this.currentUser.email && m.email.toLowerCase() === this.currentUser.email.toLowerCase())
      );
      if (matched) {
        this.currentUser = {
          ...this.currentUser,
          ...matched,
          name: this.currentUser.name || matched.name,
          roleType: "Member"
        };
        this.saveUserSession();
      }
      // KHÔNG tự ý ghi đè this.currentUser bằng this.state.members[0] để bảo toàn tài khoản vừa đăng ký/đăng nhập
    }

    if (this.state.members.length > 0 && !this.currentSchedulerMemberId) {
      this.currentSchedulerMemberId = (this.currentUser && this.currentUser.id !== "leader_root") ? this.currentUser.id : this.state.members[0].id;
    }
  },

  saveState() {
    try {
      localStorage.setItem("TeamFair_State_v3", JSON.stringify(this.state));
    } catch (e) {
      console.error("Lỗi lưu state local:", e);
    }

    fetch("/api/save-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.state)
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.success) {
          this.updateDbStatus(true);
        }
      })
      .catch(err => {
        console.warn("Lỗi sync Azure SQL:", err);
        this.updateDbStatus(false);
      });
  },

  updateDbStatus(isConnected) {
    const el = document.getElementById("dbStatusBadge");
    if (el) {
      if (isConnected) {
        el.className = "badge bg-success-subtle text-success border border-success-subtle px-2 py-1";
        el.innerHTML = "🟢 Azure SQL: Đã kết nối";
      } else {
        el.className = "badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1";
        el.innerHTML = "🟡 Azure SQL: Ngoại tuyến";
      }
    }
  },

  async clearAllData() {
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (thành viên, công việc, lịch họp...) để nhập lại từ đầu?")) {
      try {
        await fetch("/api/clear-all", { method: "POST" });
      } catch (e) {
        console.warn("Lỗi gọi clear-all API:", e);
      }
      localStorage.removeItem("TeamFair_State_v3");
      localStorage.removeItem("TeamFair_CurrentUser_v1");
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      this.currentUser = { ...DEFAULT_LEADER };
      this.saveUserSession();
      this.currentSchedulerMemberId = "";
      this.renderAll();
      this.showToast("Đã xóa toàn bộ dữ liệu sạch sẽ, sẵn sàng nhập mới!", "info");
    }
  },

  editTeamInfo() {
    if (this.currentUser.roleType !== "Leader") {
      alert("Chỉ có Nhóm Trưởng mới có quyền chỉnh sửa thông tin đề tài và nhóm!");
      return;
    }

    const newName = prompt("Nhập tên nhóm của bạn:", this.state.team.name || "Nhóm 01");
    if (newName !== null && newName.trim()) {
      this.state.team.name = newName.trim();
      const newSubject = prompt("Nhập tên môn học:", this.state.team.subject || "");
      if (newSubject !== null) this.state.team.subject = newSubject.trim();
      const newTopic = prompt("Nhập tên đề tài bài tập lớn / đồ án:", this.state.team.topic || "");
      if (newTopic !== null) this.state.team.topic = newTopic.trim();
      const newClass = prompt("Nhập mã lớp / Giảng viên:", this.state.team.classCode || "");
      if (newClass !== null) this.state.team.classCode = newClass.trim();

      this.saveState();
      this.renderAll();
      this.showToast("Đã cập nhật thông tin nhóm thành công!", "success");
    }
  },

  /* ================= REAL AUTHENTICATION & TEAM MANAGEMENT ================= */
  switchAuthTab(tab) {
    const btnLogin = document.getElementById("btnAuthTabLogin");
    const btnRegister = document.getElementById("btnAuthTabRegister");
    const formLogin = document.getElementById("formUserLogin");
    const formRegister = document.getElementById("formUserRegister");

    if (tab === "login") {
      btnLogin?.classList.add("active");
      btnRegister?.classList.remove("active");
      formLogin?.classList.remove("d-none");
      formRegister?.classList.add("d-none");
    } else {
      btnLogin?.classList.remove("active");
      btnRegister?.classList.add("active");
      formLogin?.classList.add("d-none");
      formRegister?.classList.remove("d-none");
    }
  },

  showAuthPortal() {
    this.currentUser = null;
    this.saveUserSession();
    this.renderAll();
  },

  async handleUserRegister() {
    const name = document.getElementById("inputRegName")?.value.trim();
    const email = document.getElementById("inputRegEmail")?.value.trim();
    const password = document.getElementById("inputRegPassword")?.value.trim();

    if (!name || !email || !password) {
      alert("Vui lòng nhập đầy đủ thông tin Họ tên, Email và Mật khẩu!");
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || "Đăng ký không thành công!");
        return;
      }

      // Lưu đầy đủ user data với tên đăng ký thực tế
      this.currentUser = {
        ...data.user,
        name: name,
        roleType: "Member",
        role: "Thành viên"
      };
      this.saveUserSession();

      // Reset form
      const elName = document.getElementById("inputRegName");
      const elEmail = document.getElementById("inputRegEmail");
      const elPass = document.getElementById("inputRegPassword");
      if (elName) elName.value = "";
      if (elEmail) elEmail.value = "";
      if (elPass) elPass.value = "";

      await this.loadState();
      this.renderAll();
      this.showToast(`🎉 Đăng ký tài khoản thành công! Chào mừng ${name}. Bạn hiện là 🧑 Thành viên.`, "success");
    } catch (err) {
      console.error("Lỗi đăng ký:", err);
      alert("Lỗi kết nối đến máy chủ. Vui lòng thử lại!");
    }
  },

  async handleUserLogin() {
    const email = document.getElementById("inputLoginEmail")?.value.trim();
    const password = document.getElementById("inputLoginPassword")?.value.trim();

    if (!email || !password) {
      alert("Vui lòng nhập Email và Mật khẩu!");
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || "Đăng nhập không thành công!");
        return;
      }

      this.currentUser = data.user;
      this.saveUserSession();
      await this.loadState();
      this.renderAll();
      this.showToast(`Đăng nhập thành công! Vai trò: ${data.user.roleType === 'Leader' ? '👑 Nhóm Trưởng' : '🧑 Thành Viên'}`, "success");
    } catch (err) {
      console.error("Lỗi đăng nhập:", err);
      alert("Lỗi kết nối đến máy chủ. Vui lòng thử lại!");
    }
  },

  logout() {
    this.currentUser = null;
    this.saveUserSession();
    this.renderAll();
    this.showToast("Đã đăng xuất tài khoản.", "info");
  },

  handleGoogleAuthPrompt() {
    window.location.href = "/auth/google-login";
  },

  openGoogleModalManual() {
    try {
      const modalEl = document.getElementById("modalGoogleAuth");
      if (modalEl) {
        if (window.bootstrap && bootstrap.Modal) {
          const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
          modal.show();
          return;
        }
        if (window.$ && $.fn && $.fn.modal) {
          $('#modalGoogleAuth').modal('show');
          return;
        }
        modalEl.classList.add('show');
        modalEl.style.display = 'block';
        document.body.classList.add('modal-open');
      }
    } catch (e) {
      console.warn("Lỗi mở modal Google:", e);
    }
  },

  closeGoogleAuthModal() {
    const modalEl = document.getElementById("modalGoogleAuth");
    if (modalEl) {
      if (window.bootstrap && bootstrap.Modal) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }
      modalEl.classList.remove('show');
      modalEl.style.display = 'none';
      modalEl.setAttribute('aria-hidden', 'true');
    }
    // Xóa triệt để các backdrop còn sót lại để không bao giờ bị xám màn hình
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  },

  async handleGoogleLoginSubmit(presetEmail = null, presetName = null) {
    let email = presetEmail || document.getElementById("inputGoogleEmail")?.value.trim();
    let name = presetName || document.getElementById("inputGoogleName")?.value.trim();

    if (!email) {
      alert("Vui lòng nhập địa chỉ Email Google!");
      return;
    }

    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || "" })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || "Đăng nhập Google không thành công!");
        return;
      }

      this.closeGoogleAuthModal();

      this.currentUser = data.user;
      this.saveUserSession();
      await this.loadState();
      this.renderAll();
      this.showToast(`Chào mừng ${data.user.name}! Đã đăng nhập bằng Google (${data.user.roleType === 'Leader' ? '👑 Nhóm Trưởng' : '🧑 Thành Viên'}).`, "success");
    } catch (err) {
      console.error("Lỗi Google Auth:", err);
      alert("Lỗi kết nối máy chủ khi đăng nhập Google!");
    }
  },

  openCreateTeamModal() {
    const modalEl = document.getElementById("modalCreateTeam");
    if (modalEl) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  },

  openJoinTeamModal() {
    const modalEl = document.getElementById("modalJoinTeam");
    if (modalEl) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  },

  async handleCreateTeamHub() {
    const teamName = document.getElementById("hubTeamName")?.value.trim();
    const topic = document.getElementById("hubTeamTopic")?.value.trim();
    const subject = document.getElementById("hubTeamSubject")?.value.trim();
    const classCode = document.getElementById("hubTeamClass")?.value.trim();
    const finalDeadline = document.getElementById("hubTeamDeadline")?.value;

    await this.executeCreateTeam({ teamName, topic, subject, classCode, finalDeadline });
  },

  async handleModalCreateTeam() {
    const teamName = document.getElementById("modalTeamName")?.value.trim();
    const topic = document.getElementById("modalTeamTopic")?.value.trim();
    const subject = document.getElementById("modalTeamSubject")?.value.trim();
    const classCode = document.getElementById("modalTeamClass")?.value.trim();
    const finalDeadline = document.getElementById("modalTeamDeadline")?.value;

    const modalEl = document.getElementById("modalCreateTeam");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    await this.executeCreateTeam({ teamName, topic, subject, classCode, finalDeadline });
  },

  async executeCreateTeam(teamData) {
    if (!this.currentUser) {
      alert("Vui lòng đăng nhập trước khi tạo nhóm!");
      return;
    }

    try {
      const res = await fetch("/api/team/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail: this.currentUser.email,
          userName: this.currentUser.name,
          ...teamData
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || "Tạo nhóm thất bại!");
        return;
      }

      // Người tạo nhóm tự động được gán làm Nhóm Trưởng!
      this.currentUser.roleType = "Leader";
      this.currentUser.role = "Trưởng nhóm";
      this.saveUserSession();

      await this.loadState();
      this.renderAll();
      this.showToast(`🎉 Tạo nhóm thành công! Bạn đã là 👑 Nhóm Trưởng (Mã nhóm: ${data.joinCode})`, "success");
    } catch (err) {
      console.error("Lỗi tạo nhóm:", err);
      alert("Lỗi kết nối khi tạo nhóm!");
    }
  },

  async handleJoinTeamHub() {
    const joinCode = document.getElementById("hubJoinCode")?.value.trim();
    await this.executeJoinTeam(joinCode);
  },

  async handleModalJoinTeam() {
    const joinCode = document.getElementById("modalJoinCodeInput")?.value.trim();
    const modalEl = document.getElementById("modalJoinTeam");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    await this.executeJoinTeam(joinCode);
  },

  async executeJoinTeam(joinCode) {
    if (!this.currentUser) {
      alert("Vui lòng đăng nhập trước khi tham gia nhóm!");
      return;
    }
    if (!joinCode) {
      alert("Vui lòng nhập mã nhóm!");
      return;
    }

    try {
      const res = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail: this.currentUser.email,
          userName: this.currentUser.name,
          joinCode
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || "Không thể tham gia nhóm!");
        return;
      }

      // Khi tham gia thì là Thành viên
      this.currentUser.roleType = "Member";
      this.currentUser.role = "Thành viên";
      this.saveUserSession();

      await this.loadState();
      this.renderAll();
      this.showToast("Tham gia nhóm thành công với vai trò 🧑 Thành Viên!", "success");
    } catch (err) {
      console.error("Lỗi tham gia nhóm:", err);
      alert("Lỗi kết nối khi tham gia nhóm!");
    }
  },

  copyJoinCode() {
    const code = this.state.team?.joinCode || document.getElementById("topJoinCodeText")?.textContent;
    if (code && code !== "--") {
      navigator.clipboard.writeText(code).then(() => {
        this.showToast(`Đã sao chép mã mời nhóm: ${code}! Hãy gửi cho bạn bè để vào nhóm.`, "success");
      }).catch(() => {
        prompt("Mã mời nhóm của bạn (hãy sao chép):", code);
      });
    } else {
      alert("Chưa có mã nhóm!");
    }
  },

  toggleCurrentRole() {
    if (this.currentUser.roleType === "Leader") {
      this.currentUser.roleType = "Member";
      this.showToast("Đang xem dưới góc nhìn 🧑 Thành Viên.", "info");
    } else {
      this.currentUser.roleType = "Leader";
      this.showToast("Đang xem dưới góc nhìn 👑 Nhóm Trưởng.", "info");
    }
    this.saveUserSession();
    this.renderAll();
  },

  bindEvents() {
    document.querySelectorAll(".tf-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        if (tab) this.switchTab(tab);
      });
    });

    const formTask = document.getElementById("formAddTask");
    if (formTask) {
      formTask.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddTask();
      });
    }

    const formMember = document.getElementById("formAddMember");
    if (formMember) {
      formMember.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddMember();
      });
    }

    const formMeeting = document.getElementById("formAddMeeting");
    if (formMeeting) {
      formMeeting.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddMeeting();
      });
    }

    // Bảo vệ toàn cục: Tự động dọn sạch backdrop khi modal đóng
    document.addEventListener('hidden.bs.modal', () => {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
    });

    document.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('modal-backdrop')) {
        this.closeGoogleAuthModal();
      }
    });
  },

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll(".tf-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });

    document.querySelectorAll(".tf-tab-pane").forEach(pane => {
      pane.classList.toggle("d-none", pane.id !== `pane-${tabId}`);
    });

    const btnHeaderReport = document.getElementById("btnHeaderReport");
    if (btnHeaderReport) {
      btnHeaderReport.classList.toggle("active", tabId === "report");
    }

    this.renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  getDifficultyWeight(diff) {
    switch (diff) {
      case "vhard": return 3.0;
      case "hard": return 2.0;
      case "medium": return 1.5;
      case "easy":
      default: return 1.0;
    }
  },

  getDifficultyLabel(diff) {
    switch (diff) {
      case "vhard": return { label: "Rất khó (3.0x)", badge: "badge-diff-vhard" };
      case "hard": return { label: "Khó (2.0x)", badge: "badge-diff-hard" };
      case "medium": return { label: "Trung bình (1.5x)", badge: "badge-diff-medium" };
      case "easy":
      default: return { label: "Dễ (1.0x)", badge: "badge-diff-easy" };
    }
  },

  getStatusInfo(status) {
    switch (status) {
      case "done": return { label: "Đã hoàn thành", badge: "badge-status-done", color: "#10b981" };
      case "review": return { label: "Chờ đánh giá", badge: "badge-status-review", color: "#f59e0b" };
      case "doing": return { label: "Đang làm", badge: "badge-status-doing", color: "#6366f1" };
      case "todo":
      default: return { label: "Chưa bắt đầu", badge: "badge-status-todo", color: "#64748b" };
    }
  },

  getMemberQualityMultiplier(memberId) {
    const memberReviews = this.state.reviews.filter(r => r.revieweeId === memberId);
    if (!memberReviews.length) return 1.0;

    const totalStars = memberReviews.reduce((sum, r) => {
      return sum + ((r.quality + r.punctuality + r.effort + r.cooperation) / 4);
    }, 0);
    const avgScore = totalStars / memberReviews.length;

    let factor = 1.0 + (avgScore - 3) * 0.125;
    return Math.max(0.6, Math.min(1.3, factor));
  },

  getMemberAverageReviewScore(memberId) {
    const memberReviews = this.state.reviews.filter(r => r.revieweeId === memberId);
    if (!memberReviews.length) return null;
    const totalStars = memberReviews.reduce((sum, r) => {
      return sum + ((r.quality + r.punctuality + r.effort + r.cooperation) / 4);
    }, 0);
    return (totalStars / memberReviews.length).toFixed(1);
  },

  computeContributions() {
    const memberStats = {};
    if (!this.state.members.length) {
      return { memberStats, totalPoints: "0.0", fairnessIndex: 100, idealShare: "0.0" };
    }

    this.state.members.forEach(m => {
      memberStats[m.id] = {
        member: m,
        totalTasks: 0,
        completedTasks: 0,
        baseHours: 0,
        rawPoints: 0,
        finalPoints: 0,
        percentage: 0,
        avgScore: this.getMemberAverageReviewScore(m.id) || "Chưa có",
        qualityMultiplier: this.getMemberQualityMultiplier(m.id)
      };
    });

    this.state.tasks.forEach(t => {
      const stat = memberStats[t.assigneeId];
      if (stat) {
        stat.totalTasks++;
        stat.baseHours += (t.baseHours || 0);
        if (t.status === "done") stat.completedTasks++;

        const diffWeight = this.getDifficultyWeight(t.difficulty);
        const progressFactor = (t.progress || 0) / 100;
        const taskRawPoints = (t.baseHours || 0) * diffWeight * progressFactor;
        stat.rawPoints += taskRawPoints;
      }
    });

    let sumFinalPoints = 0;
    this.state.members.forEach(m => {
      const s = memberStats[m.id];
      s.finalPoints = s.rawPoints * s.qualityMultiplier;
      sumFinalPoints += s.finalPoints;
    });

    this.state.members.forEach(m => {
      const s = memberStats[m.id];
      s.percentage = sumFinalPoints > 0 ? ((s.finalPoints / sumFinalPoints) * 100).toFixed(1) : (100 / this.state.members.length).toFixed(1);
    });

    const idealShare = 100 / (this.state.members.length || 1);
    let totalDeviation = 0;
    this.state.members.forEach(m => {
      const p = parseFloat(memberStats[m.id].percentage);
      totalDeviation += Math.abs(p - idealShare);
    });

    const maxDev = 2 * (100 - idealShare);
    const fairnessIndex = maxDev > 0 ? Math.max(50, Math.round(100 - (totalDeviation / maxDev) * 50)) : 100;

    return {
      memberStats,
      totalPoints: sumFinalPoints.toFixed(1),
      fairnessIndex,
      idealShare: idealShare.toFixed(1)
    };
  },

  renderAll() {
    if (!this.currentUser) {
      document.getElementById("authPortalView")?.classList.remove("d-none");
      document.getElementById("mainAppWorkspaceView")?.classList.add("d-none");
      document.getElementById("btnHeaderLogin")?.classList.remove("d-none");
      document.getElementById("btnHeaderDirectLogout")?.classList.add("d-none");
      document.getElementById("btnHeaderReport")?.classList.add("d-none");
      document.getElementById("userAccountDropdown")?.classList.add("d-none");
      const topName = document.getElementById("topTeamName");
      if (topName) topName.textContent = "Chưa đăng nhập";
      document.getElementById("topJoinCodeBadge")?.classList.add("d-none");
      return;
    }

    document.getElementById("authPortalView")?.classList.add("d-none");
    document.getElementById("mainAppWorkspaceView")?.classList.remove("d-none");
    document.getElementById("btnHeaderLogin")?.classList.add("d-none");
    document.getElementById("btnHeaderDirectLogout")?.classList.remove("d-none");
    document.getElementById("btnHeaderReport")?.classList.remove("d-none");
    document.getElementById("userAccountDropdown")?.classList.remove("d-none");

    this.renderHeaderAndUser();

    // Check if user has an active team
    const teamHubView = document.getElementById("teamHubView");
    const roleBanner = document.getElementById("roleBanner");
    const leaderView = document.getElementById("dash-leader-view");
    const memberView = document.getElementById("dash-member-view");

    const hasJoinedTeam = this.state.members && this.state.members.length > 0 && (
      this.currentUser.roleType === "Leader" ||
      this.state.members.some(m => m.id === this.currentUser.id || (m.email && this.currentUser.email && m.email.toLowerCase() === this.currentUser.email.toLowerCase()))
    );

    if (!hasJoinedTeam) {
      // User chưa tham gia nhóm nào hoặc chưa tạo nhóm: hiển thị Hub hướng dẫn & chọn hành động
      if (teamHubView) teamHubView.classList.remove("d-none");
      if (roleBanner) roleBanner.classList.add("d-none");
      if (leaderView) leaderView.classList.add("d-none");
      if (memberView) memberView.classList.add("d-none");
      const elGreeting = document.getElementById("hubGreetingName");
      if (elGreeting) elGreeting.textContent = this.currentUser.name || "Bạn";
    } else {
      if (teamHubView) teamHubView.classList.add("d-none");
      if (roleBanner) roleBanner.classList.remove("d-none");
    }

    if (this.activeTab === "dashboard") this.renderDashboard();
    if (this.activeTab === "tasks") this.renderTasks();
    if (this.activeTab === "schedule") this.renderSchedule();
    if (this.activeTab === "meeting") this.renderMeeting();
    if (this.activeTab === "reviews") this.renderReviews();
    if (this.activeTab === "emails") this.renderEmails();
    if (this.activeTab === "report") this.renderReport();
  },

  renderHeaderAndUser() {
    if (!this.currentUser) return;
    const totalTasks = this.state.tasks.length;
    const doneTasks = this.state.tasks.filter(t => t.status === "done").length;
    const unreadEmails = this.state.emails.length;

    const elTaskBadge = document.getElementById("badge-task-count");
    if (elTaskBadge) elTaskBadge.textContent = `${doneTasks}/${totalTasks}`;

    const elEmailBadge = document.getElementById("badge-email-count");
    if (elEmailBadge) elEmailBadge.textContent = unreadEmails;

    const elTeamName = document.getElementById("topTeamName");
    if (elTeamName) {
      elTeamName.textContent = this.state.members.length > 0 ? (this.state.team.name || "Nhóm của tôi") : "Chưa có nhóm";
    }

    // Join Code in Header
    const topJoinBadge = document.getElementById("topJoinCodeBadge");
    const topJoinText = document.getElementById("topJoinCodeText");
    const bannerJoinDisplay = document.getElementById("bannerJoinCodeDisplay");
    const bannerJoinText = document.getElementById("bannerJoinCodeText");
    if (this.state.team && this.state.team.joinCode && this.state.members.length > 0) {
      if (topJoinBadge) topJoinBadge.classList.remove("d-none");
      if (topJoinText) topJoinText.textContent = this.state.team.joinCode;
      if (bannerJoinDisplay) bannerJoinDisplay.classList.remove("d-none");
      if (bannerJoinText) bannerJoinText.textContent = this.state.team.joinCode;
    } else {
      if (topJoinBadge) topJoinBadge.classList.add("d-none");
      if (bannerJoinDisplay) bannerJoinDisplay.classList.add("d-none");
    }

    // User profile in Header - Luôn hiển thị tên người dùng đã đăng ký/đăng nhập
    const isLeader = this.currentUser.roleType === "Leader";
    const elUserName = document.getElementById("userNameDisplay");
    if (elUserName) elUserName.textContent = this.currentUser.name || (isLeader ? "Trưởng Nhóm" : "Thành Viên");

    const elRoleTag = document.getElementById("userRoleTag");
    if (elRoleTag) {
      elRoleTag.className = isLeader ? "badge bg-success" : "badge bg-primary";
      elRoleTag.innerHTML = isLeader ? "👑 Nhóm Trưởng" : "🧑 Thành Viên";
    }

    const elAvatar = document.getElementById("userAvatarBadge");
    if (elAvatar) {
      elAvatar.style.backgroundColor = this.currentUser.color || (isLeader ? "#059669" : "#2563eb");
      elAvatar.textContent = this.currentUser.avatar || (this.currentUser.name ? this.currentUser.name.trim().substring(0, 2).toUpperCase() : (isLeader ? "TN" : "TV"));
    }

    const elDDName = document.getElementById("ddUserName");
    if (elDDName) elDDName.textContent = this.currentUser.name || "Thành Viên";

    const elDDEmail = document.getElementById("ddUserEmail");
    if (elDDEmail) elDDEmail.textContent = this.currentUser.email || "Chưa có email";

    const elDDRole = document.getElementById("ddRoleBadge");
    if (elDDRole) {
      elDDRole.className = isLeader ? "badge bg-success" : "badge bg-primary";
      elDDRole.textContent = isLeader ? "👑 Nhóm Trưởng (Leader)" : "🧑 Thành Viên (Member)";
    }

    const elTabTitle = document.getElementById("tabDashboardTitle");
    if (elTabTitle) elTabTitle.textContent = isLeader ? "Dashboard Nhóm Trưởng" : "Dashboard Thành Viên";
  },

  /* ================= DASHBOARD RENDERING (LEADER VS MEMBER) ================= */
  renderDashboard() {
    const isLeader = this.currentUser.roleType === "Leader";

    // Switch Role Banner Info
    const elBanner = document.getElementById("roleBanner");
    const elIcon = document.getElementById("roleBannerIcon");
    const elTitle = document.getElementById("roleBannerTitle");
    const elDesc = document.getElementById("roleBannerDesc");
    const elBtnSwitch = document.getElementById("btnSwitchOtherRole");

    if (elBanner && elTitle && elDesc && elBtnSwitch) {
      if (isLeader) {
        elBanner.style.background = "linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%)";
        elBanner.style.borderColor = "#bbf7d0";
        elIcon.innerHTML = "👑";
        elTitle.textContent = "Bảng Điều Khiển Quản Trị - Nhóm Trưởng";
        elDesc.textContent = "Bạn đang có toàn quyền quản trị: theo dõi chỉ số công bằng nhóm, giao việc, duyệt tiến độ và nhắc nhở thành viên.";
        elBtnSwitch.textContent = "🧑 Chuyển sang xem Dashboard Thành Viên";
      } else {
        elBanner.style.background = "linear-gradient(135deg, #eef2ff 0%, #fdf4ff 100%)";
        elBanner.style.borderColor = "#c7d2fe";
        elIcon.innerHTML = "🧑";
        elTitle.textContent = `Không Gian Làm Việc Cá Nhân - ${this.currentUser.name}`;
        elDesc.textContent = "Không gian dành riêng cho bạn: cập nhật tiến độ công việc được giao, chấm điểm chéo đồng đội và xếp lịch rảnh.";
        elBtnSwitch.textContent = "👑 Chuyển sang Dashboard Nhóm Trưởng";
      }
    }

    // Toggle View Containers
    const leaderView = document.getElementById("dash-leader-view");
    const memberView = document.getElementById("dash-member-view");

    if (isLeader) {
      if (leaderView) leaderView.classList.remove("d-none");
      if (memberView) memberView.classList.add("d-none");
      this.renderLeaderDashboard();
    } else {
      if (leaderView) leaderView.classList.add("d-none");
      if (memberView) memberView.classList.remove("d-none");
      this.renderMemberDashboard();
    }
  },

  /* ------------------- DASHBOARD 1: LEADER ------------------- */
  renderLeaderDashboard() {
    const { memberStats, fairnessIndex } = this.computeContributions();
    const totalTasks = this.state.tasks.length;
    const doneTasks = this.state.tasks.filter(t => t.status === "done").length;
    const overallProgress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const elProgress = document.getElementById("dash-kpi-progress");
    if (elProgress) elProgress.textContent = `${overallProgress}%`;

    const elTasks = document.getElementById("dash-kpi-tasks");
    if (elTasks) elTasks.textContent = `${doneTasks} / ${totalTasks} việc hoàn thành`;

    const elFairness = document.getElementById("dash-kpi-fairness");
    if (elFairness) {
      if (this.state.members.length === 0 || totalTasks === 0) {
        elFairness.textContent = "--";
        const elFairLabel = document.getElementById("dash-kpi-fairness-label");
        if (elFairLabel) elFairLabel.textContent = "Chờ thêm thành viên và giao việc";
      } else {
        elFairness.textContent = `${fairnessIndex}%`;
        const elFairLabel = document.getElementById("dash-kpi-fairness-label");
        if (elFairLabel) {
          if (fairnessIndex >= 90) elFairLabel.textContent = "Cực kỳ cân đối (A+)";
          else if (fairnessIndex >= 75) elFairLabel.textContent = "Khá đồng đều (B+)";
          else elFairLabel.textContent = "Chênh lệch, cần phân bổ lại (C)";
        }
      }
    }

    const nextMeeting = this.state.meetings[0];
    const elNextMeeting = document.getElementById("dash-kpi-meeting");
    if (elNextMeeting) {
      elNextMeeting.textContent = nextMeeting ? `${nextMeeting.time} - ${nextMeeting.date ? nextMeeting.date.split('-').reverse().slice(0, 2).join('/') : ''}` : "Chưa có";
    }

    const unfinishedTasks = this.state.tasks.filter(t => t.status !== "done");
    const elUrgentCount = document.getElementById("leader-urgent-count");
    if (elUrgentCount) elUrgentCount.textContent = `${unfinishedTasks.length} việc`;

    this.renderContributionChart(memberStats);
    this.renderLeaderApprovalQueue();
    this.renderUrgentDeadlines();
    this.renderActivityFeed();
  },

  renderLeaderApprovalQueue() {
    const container = document.getElementById("leader-approval-queue");
    const badge = document.getElementById("leader-review-badge");
    if (!container) return;

    const reviewTasks = this.state.tasks.filter(t => t.status === "review" || (t.progress >= 90 && t.status !== "done"));
    if (badge) badge.textContent = `${reviewTasks.length} việc`;

    if (!reviewTasks.length) {
      container.innerHTML = `<div class="p-4 text-center text-muted small">Hiện không có công việc nào đang chờ duyệt nghiệm thu.</div>`;
      return;
    }

    container.innerHTML = reviewTasks.map(t => {
      const assignee = this.state.members.find(m => m.id === t.assigneeId) || { name: "Thành viên", avatar: "??" };
      return `
        <div class="d-flex align-items-center justify-content-between p-3 border-bottom">
          <div>
            <div class="fw-semibold text-slate-900">${t.title}</div>
            <div class="small text-muted">Người làm: <strong>${assignee.name}</strong> • Tiến độ: <span class="badge bg-warning text-dark">${t.progress}%</span></div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-success text-white" onclick="TeamFairApp.approveTaskByLeader('${t.id}')">
              ✓ Duyệt xong
            </button>
            <button class="btn btn-sm btn-outline-secondary" onclick="TeamFairApp.openReviewModal('${t.id}')">
              ⭐ Chấm điểm chéo
            </button>
          </div>
        </div>
      `;
    }).join("");
  },

  approveTaskByLeader(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = "done";
    task.progress = 100;
    const assignee = this.state.members.find(m => m.id === task.assigneeId);
    const actorName = assignee ? assignee.name : "Thành viên";
    this.state.activities.unshift({
      time: "Vừa xong",
      text: `Trưởng nhóm đã phê duyệt hoàn thành nhiệm vụ: '${task.title}' của ${actorName}`,
      type: "task"
    });
    this.notifyTeamTaskCompleted(task, actorName);
    this.saveState();
    this.renderAll();
    this.showToast(`Đã duyệt hoàn thành công việc "${task.title}" & gửi mail thông báo cho toàn đội!`, "success");
  },

  /* ------------------- DASHBOARD 2: MEMBER ------------------- */
  renderMemberDashboard() {
    const memberId = this.currentUser.id;
    const myTasks = this.state.tasks.filter(t => t.assigneeId === memberId);
    const myDoneTasks = myTasks.filter(t => t.status === "done");

    // Compute personal contribution
    const { memberStats } = this.computeContributions();
    const myStat = memberStats[memberId] || { percentage: "0.0", finalPoints: 0, qualityMultiplier: 1.0, avgScore: "Chưa có" };

    // KPI 1: My Tasks
    const elMyTasks = document.getElementById("member-kpi-tasks");
    if (elMyTasks) elMyTasks.textContent = `${myTasks.length} việc`;

    const elMyStatus = document.getElementById("member-kpi-task-status");
    if (elMyStatus) elMyStatus.textContent = `${myDoneTasks.length} việc đã xong`;

    // KPI 2: Contribution
    const elContrib = document.getElementById("member-kpi-contribution");
    if (elContrib) elContrib.textContent = `${myStat.percentage}%`;

    const elPoints = document.getElementById("member-kpi-points");
    if (elPoints) elPoints.textContent = `${myStat.finalPoints.toFixed(1)} điểm tích lũy`;

    // KPI 3: Peer Rating
    const elRating = document.getElementById("member-kpi-rating");
    if (elRating) elRating.textContent = `${myStat.avgScore} ⭐`;

    const elMult = document.getElementById("member-kpi-quality-mult");
    if (elMult) elMult.textContent = `Hệ số chất lượng: x${myStat.qualityMultiplier.toFixed(2)}`;

    // KPI 4: Meeting
    const nextMeeting = this.state.meetings[0];
    const elMeeting = document.getElementById("member-kpi-meeting");
    if (elMeeting) {
      elMeeting.textContent = nextMeeting ? `${nextMeeting.time} - ${nextMeeting.date ? nextMeeting.date.split('-').reverse().slice(0, 2).join('/') : ''}` : "Chưa có";
    }

    // List 1: My Tasks
    this.renderMemberMyTasks(myTasks);

    // List 2: Pending Reviews for Member
    this.renderMemberPendingReviews(memberId);

    // List 3: Quick Schedule for Member
    this.renderMemberQuickSchedule(memberId);

    // List 4: Personal Emails
    this.renderMemberPersonalEmails(this.currentUser.email);
  },

  renderMemberMyTasks(myTasks) {
    const container = document.getElementById("member-my-tasks-list");
    if (!container) return;

    if (!myTasks.length) {
      container.innerHTML = `
        <div class="p-5 text-center text-muted">
          <div class="fs-1 mb-2">🎉</div>
          <div class="fw-semibold">Bạn chưa có công việc nào được phân công.</div>
          <div class="small mt-1">Trưởng nhóm sẽ phân chia đầu việc cho bạn sớm nhất.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = myTasks.map(t => {
      const diff = this.getDifficultyLabel(t.difficulty);
      const st = this.getStatusInfo(t.status);

      return `
        <div class="card mb-3 border shadow-sm">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div class="d-flex align-items-center gap-2">
                <span class="badge ${st.badge}">${st.label}</span>
                <span class="badge ${diff.badge}">${diff.label}</span>
                <span class="badge bg-light text-slate-700 border">${t.category || "Công việc"}</span>
              </div>
              <span class="small text-muted">Hạn: <strong>${t.deadline ? t.deadline.split('-').reverse().join('/') : "Chưa đặt"}</strong></span>
            </div>

            <h6 class="fw-bold text-slate-900 mb-1">${t.title}</h6>
            <p class="text-muted small mb-3">${t.description || "Không có mô tả chi tiết."}</p>

            <div class="bg-light p-2 rounded-3 mb-3">
              <div class="d-flex justify-content-between small text-muted mb-1">
                <span>Tiến độ thực hiện của bạn:</span>
                <strong class="text-primary">${t.progress}%</strong>
              </div>
              <div class="progress" style="height: 8px;">
                <div class="progress-bar ${t.progress === 100 ? 'bg-success' : 'bg-primary'}" style="width: ${t.progress}%;"></div>
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div class="btn-group btn-group-sm" role="group">
                <button type="button" class="btn btn-outline-secondary ${t.progress === 0 ? 'active' : ''}" onclick="TeamFairApp.setMemberTaskProgress('${t.id}', 0)">0%</button>
                <button type="button" class="btn btn-outline-secondary ${t.progress === 50 ? 'active' : ''}" onclick="TeamFairApp.setMemberTaskProgress('${t.id}', 50)">50%</button>
                <button type="button" class="btn btn-outline-secondary ${t.progress === 80 ? 'active' : ''}" onclick="TeamFairApp.setMemberTaskProgress('${t.id}', 80)">80%</button>
                <button type="button" class="btn btn-outline-success ${t.progress === 100 ? 'active' : ''}" onclick="TeamFairApp.setMemberTaskProgress('${t.id}', 100)">100% (Xong)</button>
              </div>

              <div>
                ${t.status !== 'done' ? `
                  <button class="btn btn-sm btn-warning text-dark fw-semibold" onclick="TeamFairApp.submitTaskForReview('${t.id}')">
                    📤 Báo cáo nộp / Gửi duyệt
                  </button>
                ` : `
                  <span class="text-success small fw-semibold">✓ Đã hoàn thành</span>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  },

  setMemberTaskProgress(taskId, progressVal) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const oldStatus = task.status;
    task.progress = progressVal;
    if (progressVal === 100) task.status = "done";
    else if (progressVal > 0) task.status = "doing";
    else task.status = "todo";

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `${this.currentUser.name} đã cập nhật tiến độ việc '${task.title}' lên ${progressVal}%`,
      type: "task"
    });

    if (progressVal === 100 && oldStatus !== "done") {
      this.notifyTeamTaskCompleted(task, this.currentUser.name);
    }

    this.saveState();
    this.renderAll();
    this.showToast(`Đã cập nhật tiến độ ${progressVal}%!`, "success");
  },

  submitTaskForReview(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const subLink = prompt(`Nhập link minh chứng kết quả (GitHub Repo, Drive, Figma, Docs...):`, task.submissionLink || "");
    if (subLink !== null) {
      task.submissionLink = subLink.trim();
      const subNote = prompt("Ghi chú thêm về kết quả bàn giao (nếu có):", task.submissionNote || "Đã hoàn thành công việc theo đúng yêu cầu.");
      if (subNote !== null) task.submissionNote = subNote.trim();
      task.status = "done";
      task.progress = 100;

      this.state.activities.unshift({
        time: "Vừa xong",
        text: `${this.currentUser.name} đã hoàn thành và nộp kết quả công việc '${task.title}'.`,
        type: "task"
      });

      this.notifyTeamTaskCompleted(task, this.currentUser.name);
      this.saveState();
      this.renderAll();
      this.showToast(`Đã hoàn tất nộp bài và gửi email thông báo đến toàn bộ nhóm!`, "success");
    }
  },

  renderMemberPendingReviews(memberId) {
    const container = document.getElementById("member-pending-reviews-list");
    const countBadge = document.getElementById("member-pending-review-count");
    if (!container) return;

    // Tasks of OTHER members that are in review or done
    const otherTasks = this.state.tasks.filter(t => t.assigneeId !== memberId && (t.status === "review" || t.status === "done"));
    // Filter out tasks already reviewed by this member
    const unreviewedTasks = otherTasks.filter(t => !this.state.reviews.some(r => r.taskId === t.id && r.reviewerId === memberId));

    if (countBadge) countBadge.textContent = unreviewedTasks.length;

    if (!unreviewedTasks.length) {
      container.innerHTML = `<div class="p-4 text-center text-muted small">Tuyệt vời! Bạn không có đánh giá chéo nào còn tồn đọng.</div>`;
      return;
    }

    container.innerHTML = unreviewedTasks.map(t => {
      const assignee = this.state.members.find(m => m.id === t.assigneeId) || { name: "Đồng đội", avatar: "??" };
      return `
        <div class="p-3 border-bottom">
          <div class="fw-semibold text-slate-900 small mb-1">${t.title}</div>
          <div class="d-flex justify-content-between align-items-center">
            <span class="small text-muted">Làm bởi: <strong class="text-primary">${assignee.name}</strong></span>
            <button class="btn btn-sm btn-tf-indigo text-white py-1" onclick="TeamFairApp.openReviewModal('${t.id}')">
              ⭐ Chấm điểm
            </button>
          </div>
        </div>
      `;
    }).join("");
  },

  renderMemberQuickSchedule(memberId) {
    const container = document.getElementById("member-quick-schedule-container");
    if (!container) return;

    const days = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
    const shifts = [
      { name: "Sáng", id: 0 },
      { name: "Chiều", id: 1 },
      { name: "Tối", id: 2 }
    ];

    const mySlots = this.state.schedules[memberId] || [];

    let html = `
      <div class="table-responsive">
        <table class="table table-bordered text-center align-middle mb-0" style="font-size: 0.8rem;">
          <thead class="table-light">
            <tr>
              <th style="width: 70px;">Ca</th>
              ${days.map(d => `<th>${d}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    shifts.forEach(shift => {
      html += `<tr><td class="fw-semibold bg-light">${shift.name}</td>`;
      days.forEach((day, dayIndex) => {
        const slotKey = `${dayIndex}_${shift.id}`;
        const isFree = mySlots.includes(slotKey);
        html += `
          <td class="cursor-pointer ${isFree ? 'bg-success-subtle text-success fw-bold' : 'text-muted'}" 
              onclick="TeamFairApp.toggleScheduleSlot('${slotKey}')" 
              style="cursor: pointer; height: 38px;">
            ${isFree ? '✓ Rảnh' : '—'}
          </td>
        `;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  },

  renderMemberPersonalEmails(myEmail) {
    const container = document.getElementById("member-personal-emails-list");
    if (!container) return;

    const personalEmails = this.state.emails.filter(e =>
      e.to.toLowerCase() === (myEmail || "").toLowerCase() ||
      e.to.toLowerCase().includes("all")
    );

    if (!personalEmails.length) {
      container.innerHTML = `<div class="p-4 text-center text-muted small">Chưa có thông báo nào gửi riêng cho bạn.</div>`;
      return;
    }

    container.innerHTML = personalEmails.map(em => `
      <div class="p-2 mb-2 bg-light rounded-3 border">
        <div class="d-flex justify-content-between small text-muted mb-1">
          <span class="badge bg-primary text-white" style="font-size: 0.65rem;">${em.type}</span>
          <span style="font-size: 0.75rem;">${em.sentAt}</span>
        </div>
        <div class="fw-semibold text-slate-900 small mb-1">${em.subject}</div>
        <div class="small text-muted text-truncate">${em.content}</div>
        <div class="text-end mt-1">
          <button class="btn btn-link p-0 small text-decoration-none" onclick="TeamFairApp.previewEmailModal('${em.id}')">Xem chi tiết ➔</button>
        </div>
      </div>
    `).join("");
  },

  /* ------------------- COMMON WIDGETS ------------------- */
  renderContributionChart(memberStats) {
    const container = document.getElementById("dash-chart-container");
    if (!container) return;

    if (this.state.members.length === 0 || this.state.tasks.length === 0) {
      container.innerHTML = `
        <div class="py-5 text-center text-muted">
          <div class="fs-1 mb-2">📊</div>
          <div class="fw-semibold">Thêm thành viên và giao việc để xem tiến độ.</div>
          <div class="small text-muted mt-1">Mức đóng góp sẽ tự động cập nhật ngay khi bạn phân công công việc đầu tiên.</div>
          <button class="btn btn-sm btn-primary mt-3" onclick="TeamFairApp.switchTab('tasks')">
            ➔ Đến Phân chia công việc
          </button>
        </div>
      `;
      return;
    }

    let barsHtml = "";
    Object.values(memberStats).forEach(stat => {
      const m = stat.member;
      const pct = parseFloat(stat.percentage);

      barsHtml += `
        <div class="mb-3">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="d-flex align-items-center gap-2">
              <span class="tf-avatar" style="background-color: ${m.color}; width: 28px; height: 28px; font-size: 0.75rem;">${m.avatar}</span>
              <strong class="text-slate-800" style="font-size: 0.9rem;">${m.name}</strong>
              <span class="badge ${m.roleType === 'Leader' ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}" style="font-size: 0.7rem;">
                ${m.roleType === 'Leader' ? '👑 Trưởng nhóm' : 'Thành viên'}
              </span>
            </div>
            <div class="text-end">
              <span class="fw-bold text-slate-900" style="font-size: 1rem;">${pct}%</span>
              <span class="text-muted small">(${stat.finalPoints.toFixed(1)} đ)</span>
            </div>
          </div>
          <div class="progress" style="height: 10px; border-radius: 99px; background-color: #f1f5f9;">
            <div class="progress-bar" role="progressbar" style="width: ${pct}%; background-color: ${m.color}; border-radius: 99px;"></div>
          </div>
          <div class="d-flex justify-content-between mt-1 text-muted" style="font-size: 0.75rem;">
            <span>Chất lượng chéo: <strong>${stat.avgScore} ⭐</strong> (x${stat.qualityMultiplier.toFixed(2)})</span>
            <span>Kỳ vọng: ${(100 / this.state.members.length).toFixed(1)}%</span>
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="row align-items-center">
        <div class="col-lg-7">
          ${barsHtml}
        </div>
        <div class="col-lg-5 text-center p-3 border-start">
          <div class="p-3 rounded-4 bg-light">
            <div class="text-muted small text-uppercase fw-bold mb-1">Công Thức Tự Động TeamFair</div>
            <div class="p-2 bg-white rounded-3 shadow-sm border small text-start mb-2" style="font-family: monospace; font-size: 0.8rem;">
              Điểm = Khối lượng × Độ khó × Tiến độ × Hệ số chất lượng chéo
            </div>
            <div class="text-success fw-bold" style="font-size: 1.1rem;">
              100% Khách quan
            </div>
            <div class="small text-slate-500">
              Không ai phải tự cãi vã chia điểm. Hệ số minh bạch qua từng đầu việc & đánh giá chéo.
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderUrgentDeadlines() {
    const container = document.getElementById("dash-urgent-deadlines");
    if (!container) return;

    const unfinishedTasks = [...this.state.tasks]
      .filter(t => t.status !== "done")
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 5);

    if (!unfinishedTasks.length) {
      container.innerHTML = `<div class="p-4 text-center text-muted">Chưa có công việc nào cần nhắc nhở.</div>`;
      return;
    }

    container.innerHTML = unfinishedTasks.map(t => {
      const assignee = this.state.members.find(m => m.id === t.assigneeId) || { name: "Chưa giao", color: "#64748b", avatar: "??" };
      const diff = this.getDifficultyLabel(t.difficulty);

      return `
        <div class="d-flex align-items-center justify-content-between p-3 border-bottom hover-bg-light transition">
          <div class="d-flex align-items-center gap-3">
            <span class="tf-avatar" style="background-color: ${assignee.color}; width: 34px; height: 34px; font-size: 0.8rem;">
              ${assignee.avatar}
            </span>
            <div>
              <div class="fw-semibold text-slate-900">${t.title}</div>
              <div class="d-flex gap-2 align-items-center mt-1">
                <span class="badge ${diff.badge}">${diff.label}</span>
                <span class="text-muted small">Người làm: <strong>${assignee.name}</strong></span>
                <span class="badge bg-warning text-dark">
                  Hạn: ${t.deadline ? t.deadline.split('-').reverse().join('/') : "Chưa đặt"}
                </span>
              </div>
            </div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-primary" onclick="TeamFairApp.sendTaskReminderEmail('${t.id}')">
              ✉️ Nhắc nhở email
            </button>
            <button class="btn btn-sm btn-light border" onclick="TeamFairApp.quickUpdateProgress('${t.id}')">
              Tiến độ: ${t.progress}%
            </button>
          </div>
        </div>
      `;
    }).join("");
  },

  renderActivityFeed() {
    const container = document.getElementById("dash-activity-feed");
    if (!container) return;

    if (!this.state.activities.length) {
      container.innerHTML = `<div class="p-4 text-center text-muted small">Chưa có hoạt động nào được ghi nhận.</div>`;
      return;
    }

    container.innerHTML = this.state.activities.map(act => `
      <div class="d-flex gap-3 mb-3">
        <div class="mt-1">
          <span class="badge bg-slate-200 text-slate-700 rounded-pill px-2 py-1" style="font-size: 0.7rem;">●</span>
        </div>
        <div>
          <div class="text-slate-800" style="font-size: 0.875rem;">${act.text}</div>
          <div class="text-muted" style="font-size: 0.75rem;">${act.time}</div>
        </div>
      </div>
    `).join("");
  },

  /* ------------------- TASKS VIEW ------------------- */
  renderTasks() {
    const selAssignee = document.getElementById("taskAssignee");
    if (selAssignee) {
      if (!this.state.members.length) {
        selAssignee.innerHTML = `<option value="">-- Chưa có thành viên nào --</option>`;
      } else {
        selAssignee.innerHTML = `<option value="">-- Chọn thành viên phụ trách --</option>` +
          this.state.members.map(m => `<option value="${m.id}" ${this.currentUser.roleType === 'Member' && this.currentUser.id === m.id ? 'selected' : ''}>${m.name} (${m.role})</option>`).join("");
      }
    }

    const filterMember = document.getElementById("filterTaskMember");
    if (filterMember) {
      filterMember.innerHTML = `<option value="all">Tất cả thành viên</option>` +
        this.state.members.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
    }

    const roleNote = document.getElementById("memberRoleAccessNote");
    if (roleNote) {
      roleNote.textContent = this.currentUser.roleType === "Leader" ? "Quyền quản trị (Nhóm Trưởng)" : "Chế độ Thành viên";
    }

    this.renderTaskList();
    this.renderMembersSection();
  },

  renderMembersSection() {
    const container = document.getElementById("membersListContainer");
    if (!container) return;

    if (!this.state.members.length) {
      container.innerHTML = `<div class="text-muted py-2">Chưa có thành viên nào.</div>`;
      return;
    }

    const isLeader = this.currentUser.roleType === "Leader";

    container.innerHTML = this.state.members.map(m => {
      const taskCount = this.state.tasks.filter(t => t.assigneeId === m.id).length;
      const isLeaderMember = m.roleType === 'Leader';
      const hasCustomSkill = m.role && !["trưởng nhóm", "thành viên", "leader", "member"].includes(m.role.trim().toLowerCase());
      const skillText = hasCustomSkill ? ` • <span class="badge bg-light text-slate-700 border" style="font-size: 0.7rem;">${m.role}</span>` : '';

      return `
        <div class="d-flex align-items-center justify-content-between p-2 mb-2 bg-light rounded-3 border">
          <div class="d-flex align-items-center gap-2">
            <span class="tf-avatar" style="background-color: ${m.color}; width: 32px; height: 32px; font-size: 0.75rem;">${m.avatar}</span>
            <div>
              <div class="fw-bold text-slate-800" style="font-size: 0.875rem;">
                ${m.name}
                ${isLeaderMember ? '<span class="badge bg-success" style="font-size: 0.65rem;">👑 Trưởng nhóm</span>' : ''}
              </div>
              <div class="text-muted" style="font-size: 0.75rem;">${m.email || 'Chưa có email'}${skillText}</div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-white text-slate-700 border" style="font-size: 0.75rem;">${taskCount} việc</span>
            ${isLeader ? `
              <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="TeamFairApp.handleRemoveMember('${m.id}')" title="Xóa thành viên">×</button>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");
  },

  renderTaskList() {
    const container = document.getElementById("taskListContainer");
    if (!container) return;

    const filterVal = document.getElementById("filterTaskMember")?.value || "all";
    const statusVal = document.getElementById("filterTaskStatus")?.value || "all";

    let tasks = [...this.state.tasks];
    if (filterVal !== "all") tasks = tasks.filter(t => t.assigneeId === filterVal);
    if (statusVal !== "all") tasks = tasks.filter(t => t.status === statusVal);

    if (!tasks.length) {
      container.innerHTML = `<div class="p-5 text-center text-muted">Chưa có công việc nào.</div>`;
      return;
    }

    const isLeader = this.currentUser.roleType === "Leader";

    container.innerHTML = tasks.map(t => {
      const assignee = this.state.members.find(m => m.id === t.assigneeId) || { name: "Chưa giao", color: "#64748b", avatar: "??" };
      const diff = this.getDifficultyLabel(t.difficulty);
      const st = this.getStatusInfo(t.status);
      const isMyTask = t.assigneeId === this.currentUser.id;

      let reminderBadge = '';
      if (t.reminderTiming && t.reminderTiming !== 'none') {
        let timingText = 'Trước 1 ngày';
        if (t.reminderTiming === '2_days') timingText = 'Trước 2 ngày';
        else if (t.reminderTiming === '3_days') timingText = 'Trước 3 ngày';
        else if (t.reminderTiming === '6_hours') timingText = 'Trước 6 giờ';
        else if (t.reminderTiming === 'on_deadline') timingText = 'Đúng ngày hạn';
        else if (t.reminderTiming === 'custom' && t.reminderCustomDateTime) timingText = t.reminderCustomDateTime.replace('T', ' ');
        reminderBadge = `<span class="badge bg-warning-subtle text-warning border border-warning-subtle small ms-1" title="Cấu hình gửi email nhắc deadline: ${timingText}">⏰ Nhắc mail: ${timingText}${t.reminderSent ? ' (Đã gửi ✓)' : ''}</span>`;
      }

      return `
        <div class="card mb-3 border shadow-sm ${isMyTask ? 'border-primary' : ''}">
          <div class="card-body p-3">
            <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="badge ${st.badge}">${st.label}</span>
                <span class="badge ${diff.badge}">${diff.label}</span>
                <span class="badge bg-light text-slate-600 border">${t.category || "Công việc"}</span>
                ${reminderBadge}
                ${isMyTask ? '<span class="badge bg-primary-subtle text-primary fw-bold">📌 Việc của bạn</span>' : ''}
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="text-muted small">Hạn: <strong>${t.deadline ? t.deadline.split('-').reverse().join('/') : "Chưa đặt"}</strong></span>
                ${isLeader ? `<button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="TeamFairApp.handleDeleteTask('${t.id}')">×</button>` : ''}
              </div>
            </div>

            <h6 class="fw-bold text-slate-900 mb-1">${t.title}</h6>
            <p class="text-muted small mb-2">${t.description || "Không có mô tả chi tiết."}</p>

            <div class="row align-items-center g-2 pt-2 border-top">
              <div class="col-md-4 d-flex align-items-center gap-2">
                <span class="tf-avatar" style="background-color: ${assignee.color}; width: 28px; height: 28px; font-size: 0.75rem;">${assignee.avatar}</span>
                <span class="small fw-semibold text-slate-800">${assignee.name}</span>
              </div>
              <div class="col-md-4">
                <div class="d-flex justify-content-between small text-muted mb-1">
                  <span>Tiến độ</span>
                  <strong>${t.progress}%</strong>
                </div>
                <div class="progress" style="height: 6px;">
                  <div class="progress-bar ${t.progress === 100 ? 'bg-success' : 'bg-primary'}" style="width: ${t.progress}%;"></div>
                </div>
              </div>
              <div class="col-md-4 text-md-end d-flex justify-content-md-end gap-1 flex-wrap">
                <button class="btn btn-sm btn-light border py-1" onclick="TeamFairApp.quickUpdateProgress('${t.id}')">
                  📊 Tiến độ
                </button>
                <button class="btn btn-sm btn-light border py-1" onclick="TeamFairApp.sendTaskReminderEmail('${t.id}')" title="Gửi email nhắc nhở trực tiếp ngay bây giờ">
                  ✉️ Nhắc mail
                </button>
                <button class="btn btn-sm btn-tf-indigo py-1 text-white" onclick="TeamFairApp.openReviewModal('${t.id}')">
                  ⭐ Đánh giá
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  },

  handleAddTask() {
    const title = document.getElementById("taskTitle")?.value.trim();
    const assigneeId = document.getElementById("taskAssignee")?.value;
    const difficulty = document.getElementById("taskDifficulty")?.value || "medium";
    const deadline = document.getElementById("taskDeadline")?.value || "";
    const hours = parseInt(document.getElementById("taskHours")?.value || "10");
    const category = document.getElementById("taskCategory")?.value || "Chung";
    const desc = document.getElementById("taskDesc")?.value.trim() || "";

    const enableReminder = document.getElementById("taskEnableEmailReminder") ? document.getElementById("taskEnableEmailReminder").checked : true;
    const reminderTiming = enableReminder ? (document.getElementById("taskReminderTiming")?.value || "1_day") : "none";
    const reminderCustomDateTime = (enableReminder && reminderTiming === "custom") ? document.getElementById("taskReminderCustomTime")?.value || "" : "";

    if (!title) {
      alert("Vui lòng nhập tên công việc!");
      return;
    }
    if (!assigneeId) {
      alert("Vui lòng thêm thành viên và chọn người phụ trách!");
      return;
    }

    const newTask = {
      id: "t" + Date.now(),
      title,
      assigneeId,
      difficulty,
      baseHours: hours,
      deadline,
      category,
      status: "todo",
      progress: 0,
      description: desc,
      reminderTiming,
      reminderCustomDateTime,
      reminderSent: false
    };

    this.state.tasks.unshift(newTask);

    const assignee = this.state.members.find(m => m.id === assigneeId);

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `${this.currentUser.name} đã giao nhiệm vụ mới: '${title}' cho ${assignee ? assignee.name : 'thành viên'}.`,
      type: "task"
    });

    if (assignee && assignee.email) {
      let reminderInfo = "Hệ thống sẽ gửi email nhắc nhở hạn chót theo cấu hình.";
      if (reminderTiming === "1_day") reminderInfo = "Email nhắc nhở sẽ gửi trước hạn 1 ngày.";
      else if (reminderTiming === "2_days") reminderInfo = "Email nhắc nhở sẽ gửi trước hạn 2 ngày.";
      else if (reminderTiming === "6_hours") reminderInfo = "Email nhắc nhở sẽ gửi trước hạn 6 giờ.";

      this.sendEmailNotification({
        to: assignee.email,
        toName: assignee.name,
        subject: `[TeamFair] Giao nhiệm vụ mới: ${title}`,
        type: "task_assigned",
        content: `Chào ${assignee.name},\n\nBạn vừa được giao nhiệm vụ: "${title}".\nĐộ khó: ${this.getDifficultyLabel(difficulty).label}.\nHạn chót: ${deadline ? deadline.split('-').reverse().join('/') : "Chưa đặt"}.\n${reminderInfo}\n\nChúc bạn hoàn thành tốt nhiệm vụ!`
      });
    }

    this.saveState();
    this.renderAll();
    this.showToast(`Đã giao việc "${title}" & kích hoạt cấu hình nhắc mail thành công!`, "success");

    document.getElementById("taskTitle").value = "";
    document.getElementById("taskDesc").value = "";
  },

  handleAddMember() {
    if (this.currentUser.roleType !== "Leader") {
      alert("Chỉ có Nhóm Trưởng mới có quyền thêm thành viên vào nhóm!");
      return;
    }

    const name = document.getElementById("memberName")?.value.trim();
    const email = document.getElementById("memberEmail")?.value.trim();
    const roleType = document.getElementById("memberRoleTypeSelect")?.value || "Member";
    const roleInput = document.getElementById("memberRole")?.value.trim();
    const role = roleInput || (roleType === "Leader" ? "Trưởng nhóm" : "Thành viên");
    const password = document.getElementById("memberPasswordInput")?.value.trim() || "123456";

    if (!name) {
      alert("Vui lòng nhập họ và tên thành viên!");
      return;
    }

    const initials = name.split(" ").map(w => w[0]).filter(Boolean).slice(-2).join("").toUpperCase() || "TV";
    const colors = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#e11d48", "#0891b2"];
    const randomColor = colors[this.state.members.length % colors.length];

    const newMember = {
      id: "m" + Date.now(),
      name,
      email: email || `${name.toLowerCase().replace(/\s+/g, '')}@student.edu.vn`,
      role,
      roleType,
      password,
      avatar: initials,
      color: randomColor
    };

    this.state.members.push(newMember);
    this.state.schedules[newMember.id] = [];

    if (!this.currentSchedulerMemberId) {
      this.currentSchedulerMemberId = newMember.id;
    }

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `Đã thêm thành viên mới: ${name} (${roleType === 'Leader' ? '👑 Trưởng nhóm' : 'Thành viên'}).`,
      type: "member"
    });

    this.saveState();
    this.renderAll();
    this.showToast(`Đã thêm thành viên ${name} (${roleType}) vào nhóm!`, "success");

    document.getElementById("memberName").value = "";
    if (document.getElementById("memberEmail")) document.getElementById("memberEmail").value = "";
    if (document.getElementById("memberRole")) document.getElementById("memberRole").value = "";
  },

  handleRemoveMember(id) {
    if (this.currentUser.roleType !== "Leader") {
      alert("Chỉ có Nhóm Trưởng mới có quyền xóa thành viên!");
      return;
    }
    const m = this.state.members.find(x => x.id === id);
    if (confirm(`Bạn có chắc muốn xóa thành viên ${m?.name} khỏi nhóm không?`)) {
      this.state.members = this.state.members.filter(x => x.id !== id);
      delete this.state.schedules[id];
      this.saveState();
      this.renderAll();
      this.showToast("Đã xóa thành viên khỏi nhóm.", "info");
    }
  },

  handleDeleteTask(id) {
    if (this.currentUser.roleType !== "Leader") {
      alert("Chỉ có Nhóm Trưởng mới có quyền xóa đầu việc!");
      return;
    }
    if (confirm("Bạn có chắc muốn xóa đầu việc này không?")) {
      this.state.tasks = this.state.tasks.filter(t => t.id !== id);
      this.saveState();
      this.renderAll();
      this.showToast("Đã xóa đầu việc.", "info");
    }
  },

  quickUpdateProgress(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const newProgress = prompt(`Cập nhật tiến độ hoàn thành cho '${task.title}' (từ 0 đến 100%):`, task.progress);
    if (newProgress !== null) {
      const val = parseInt(newProgress);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        const oldStatus = task.status;
        task.progress = val;
        if (val === 100) task.status = "done";
        else if (val > 0) task.status = "doing";
        else task.status = "todo";

        this.state.activities.unshift({
          time: "Vừa xong",
          text: `Tiến độ việc '${task.title}' được cập nhật lên ${val}%`,
          type: "task"
        });

        if (val === 100 && oldStatus !== "done") {
          const assignee = this.state.members.find(m => m.id === task.assigneeId);
          const actor = (this.currentUser.id === task.assigneeId) ? this.currentUser.name : (assignee ? assignee.name : this.currentUser.name);
          this.notifyTeamTaskCompleted(task, actor);
        }

        this.saveState();
        this.renderAll();
        this.showToast(`Đã cập nhật tiến độ ${val}%!`, "success");
      }
    }
  },

  /* ------------------- SCHEDULE VIEW ------------------- */
  renderSchedule() {
    const selMember = document.getElementById("schedulerMemberSelect");
    const container = document.getElementById("scheduleTableContainer");
    const goldenBox = document.getElementById("scheduleGoldenRecommendation");

    if (!this.state.members.length) {
      if (selMember) selMember.innerHTML = `<option value="">-- Chưa có thành viên --</option>`;
      if (goldenBox) goldenBox.innerHTML = "";
      if (container) {
        container.innerHTML = `
          <div class="p-5 text-center text-muted">
            <div class="fs-1 mb-2">🗓️</div>
            <div class="fw-semibold">Chưa có thành viên nào trong nhóm.</div>
            <div class="small mt-1">Vui lòng thêm các thành viên trước để bắt đầu xếp lịch rảnh và tìm giờ họp chung.</div>
          </div>
        `;
      }
      return;
    }

    if (!this.currentSchedulerMemberId || !this.state.members.find(m => m.id === this.currentSchedulerMemberId)) {
      this.currentSchedulerMemberId = (this.currentUser && this.currentUser.id !== "leader_root" && this.state.members.find(m => m.id === this.currentUser.id)) ? this.currentUser.id : this.state.members[0].id;
    }

    if (selMember) {
      selMember.innerHTML = this.state.members.map(m => `
        <option value="${m.id}" ${m.id === this.currentSchedulerMemberId ? 'selected' : ''}>
          ${m.name} (${m.role})
        </option>
      `).join("");

      selMember.onchange = (e) => {
        this.currentSchedulerMemberId = e.target.value;
        this.renderSchedule();
      };
    }

    const days = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
    const shifts = [
      { name: "Sáng (08:00 - 11:30)", id: 0 },
      { name: "Chiều (13:30 - 17:00)", id: 1 },
      { name: "Tối (19:00 - 22:00)", id: 2 }
    ];

    const currentMemberSlots = this.state.schedules[this.currentSchedulerMemberId] || [];
    const totalMembers = this.state.members.length;

    let bestSlots = [];
    let html = `
      <div class="table-responsive">
        <table class="tf-schedule-table">
          <thead>
            <tr>
              <th style="width: 140px;">Khung Giờ</th>
              <th>Thứ 2</th>
              <th>Thứ 3</th>
              <th>Thứ 4</th>
              <th>Thứ 5</th>
              <th>Thứ 6</th>
              <th>Thứ 7</th>
              <th>Chủ Nhật</th>
            </tr>
          </thead>
          <tbody>
    `;

    shifts.forEach(shift => {
      html += `<tr>`;
      html += `<td class="fw-bold text-slate-700 p-2 text-nowrap" style="font-size: 0.85rem; background: #f8fafc;">${shift.name}</td>`;

      days.forEach((day, dayIndex) => {
        const slotKey = `${dayIndex}_${shift.id}`;
        let freeCount = 0;
        let freeMembers = [];
        this.state.members.forEach(m => {
          const slots = this.state.schedules[m.id] || [];
          if (slots.includes(slotKey)) {
            freeCount++;
            freeMembers.push(m.name);
          }
        });

        const isCurrentFree = currentMemberSlots.includes(slotKey);
        const freeRatio = totalMembers > 0 ? freeCount / totalMembers : 0;

        let slotClass = "tf-slot-free-low";
        if (freeRatio === 1) {
          slotClass = "tf-slot-free-all";
          bestSlots.push({ day, shift: shift.name, slotKey });
        } else if (freeRatio >= 0.75) {
          slotClass = "tf-slot-free-high";
        } else if (freeRatio >= 0.5) {
          slotClass = "tf-slot-free-med";
        }

        html += `
          <td class="tf-schedule-cell ${slotClass}" onclick="TeamFairApp.toggleScheduleSlot('${slotKey}')" title="${freeMembers.join(', ') || 'Chưa ai rảnh'}\nClick để đổi trạng thái">
            <div class="d-flex flex-column align-items-center justify-content-center h-100">
              <span style="font-size: 0.85rem;">${freeCount}/${totalMembers} bạn</span>
              <span style="font-size: 0.7rem; opacity: 0.85;">${isCurrentFree ? '✓ Bạn rảnh' : '✕ Bạn bận'}</span>
            </div>
          </td>
        `;
      });

      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    if (container) container.innerHTML = html;

    if (goldenBox) {
      if (bestSlots.length > 0) {
        goldenBox.innerHTML = `
          <div class="alert alert-success d-flex align-items-center justify-content-between p-3 mb-0">
            <div>
              <strong>🌟 Khung giờ vàng tìm thấy:</strong> Có <strong>${bestSlots.length}</strong> buổi trong tuần cả <strong>${totalMembers}/${totalMembers} thành viên</strong> đều rảnh!
              <div class="small mt-1 text-slate-700">Gợi ý tốt nhất: <strong>${bestSlots[0].day} - ${bestSlots[0].shift}</strong></div>
            </div>
            <button class="btn btn-sm btn-success text-white text-nowrap" onclick="TeamFairApp.scheduleMeetingAtGoldenSlot('${bestSlots[0].day}', '${bestSlots[0].shift}')">
              📅 Đặt phòng họp ngay
            </button>
          </div>
        `;
      } else {
        goldenBox.innerHTML = `
          <div class="alert alert-warning p-3 mb-0">
            <strong>⚠️ Chưa có khung giờ nào 100% thành viên cùng rảnh.</strong> Hãy bấm vào các ô trên để cập nhật giờ rảnh cá nhân!
          </div>
        `;
      }
    }
  },

  toggleScheduleSlot(slotKey) {
    const targetMemberId = (this.currentUser.roleType === "Member" && this.currentUser.id !== "leader_root") ? this.currentUser.id : this.currentSchedulerMemberId;
    if (!targetMemberId) return;

    let slots = this.state.schedules[targetMemberId] || [];
    if (slots.includes(slotKey)) {
      slots = slots.filter(s => s !== slotKey);
    } else {
      slots.push(slotKey);
    }
    this.state.schedules[targetMemberId] = slots;
    this.saveState();
    this.renderAll();
    this.showToast("Đã cập nhật lịch rảnh!", "info");
  },

  scheduleMeetingAtGoldenSlot(day, shift) {
    this.switchTab("meeting");
    const titleInput = document.getElementById("meetingTitle");
    if (titleInput) titleInput.value = `Họp nhóm định kỳ (${day} - ${shift})`;
  },

  /* ------------------- MEETING VIEW ------------------- */
  renderMeeting() {
    const listContainer = document.getElementById("meetingsListContainer");
    if (!listContainer) return;

    if (!this.state.meetings.length) {
      listContainer.innerHTML = `<div class="p-5 text-center text-muted">Chưa có cuộc họp nào được lên lịch. Hãy tạo cuộc họp đầu tiên ở bên trái!</div>`;
      return;
    }

    listContainer.innerHTML = this.state.meetings.map(mt => `
      <div class="card mb-3 border shadow-sm">
        <div class="card-body p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="badge bg-primary-subtle text-primary fw-semibold">${mt.platform}</span>
            <span class="badge bg-light text-slate-700 border">Mã: ${mt.roomCode}</span>
          </div>
          <h6 class="fw-bold text-slate-900 mb-1">${mt.title}</h6>
          <div class="text-muted small mb-2">
            📅 ${mt.date ? mt.date.split('-').reverse().join('/') : ""} lúc ⏰ <strong>${mt.time}</strong> (${mt.duration} phút)
          </div>
          <div class="p-2 bg-light rounded-3 small text-slate-700 mb-3" style="white-space: pre-line;">
            <strong>Nội dung / Biên bản:</strong>\n${mt.notes || "Chưa có ghi chú."}
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-tf-primary text-white" onclick="TeamFairApp.enterVirtualMeeting('${mt.id}')">
              📹 Vào phòng họp ảo ngay
            </button>
            <button class="btn btn-sm btn-outline-primary" onclick="TeamFairApp.sendMeetingInviteEmail('${mt.id}')">
              ✉️ Gửi email mời họp
            </button>
          </div>
        </div>
      </div>
    `).join("");
  },

  handleAddMeeting() {
    const title = document.getElementById("meetingTitle")?.value.trim();
    const date = document.getElementById("meetingDate")?.value;
    const time = document.getElementById("meetingTime")?.value;
    const duration = parseInt(document.getElementById("meetingDuration")?.value || "60");
    const notes = document.getElementById("meetingNotes")?.value.trim() || "";

    if (!title || !date || !time) {
      alert("Vui lòng điền đầy đủ tiêu đề, ngày và giờ họp!");
      return;
    }

    const roomCode = "TF-" + Math.floor(100 + Math.random() * 900);
    const newMeeting = {
      id: "mt" + Date.now(),
      title,
      date,
      time,
      duration,
      roomCode,
      platform: "Phòng họp TeamFair ảo",
      link: `https://teamfair.live/room/${roomCode}`,
      notes,
      status: "scheduled"
    };

    this.state.meetings.unshift(newMeeting);

    this.state.members.forEach(m => {
      if (m.email) {
        this.sendEmailNotification({
          to: m.email,
          toName: m.name,
          subject: `[TeamFair - Mời họp] ${title} (${time} ngày ${date.split('-').reverse().join('/')})`,
          type: "meeting",
          content: `Thư mời tham gia phòng họp nhóm: "${title}". Thời gian: ${time} ngày ${date.split('-').reverse().join('/')}. Link phòng họp ảo: ${newMeeting.link}.`
        });
      }
    });

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `${this.currentUser.name} đã tạo cuộc họp mới: '${title}' và gửi thư mời email cho nhóm.`,
      type: "meeting"
    });

    this.saveState();
    this.renderAll();
    this.showToast("Đã lên lịch họp thành công!", "success");

    document.getElementById("meetingTitle").value = "";
    document.getElementById("meetingNotes").value = "";
  },

  enterVirtualMeeting(meetingId) {
    const meeting = this.state.meetings.find(m => m.id === meetingId) || { title: "Phòng Họp Trực Tuyến TeamFair" };
    const roomModal = new bootstrap.Modal(document.getElementById("virtualMeetingModal"));
    roomModal.show();

    this.inMeeting = true;
    this.meetingSeconds = 0;
    const timerEl = document.getElementById("meetingTimerText");
    if (this.meetingTimer) clearInterval(this.meetingTimer);
    this.meetingTimer = setInterval(() => {
      this.meetingSeconds++;
      const mins = Math.floor(this.meetingSeconds / 60).toString().padStart(2, '0');
      const secs = (this.meetingSeconds % 60).toString().padStart(2, '0');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);

    const videoGrid = document.getElementById("meetingVideoGrid");
    if (videoGrid) {
      if (!this.state.members.length) {
        videoGrid.innerHTML = `
          <div class="tf-video-box active-speaker" style="grid-column: 1 / -1;">
            <div class="text-center text-white p-4">
              <div class="fs-1 mb-2">📹</div>
              <div class="fw-bold">${this.currentUser.name} (Đang trực tuyến)</div>
              <div class="text-muted small mt-1">Phòng họp ảo đang sẵn sàng.</div>
            </div>
            <div class="tf-video-name">${this.currentUser.name}</div>
          </div>
        `;
      } else {
        videoGrid.innerHTML = this.state.members.map((m, idx) => `
          <div class="tf-video-box ${idx === 0 ? 'active-speaker' : ''}" id="vbox-${m.id}">
            <div class="text-center text-white">
              <span class="tf-avatar mb-2" style="background-color: ${m.color}; width: 64px; height: 64px; font-size: 1.5rem;">
                ${m.avatar}
              </span>
              <div class="fw-bold" style="font-size: 0.9rem;">${m.name}</div>
              <div class="text-muted small">${m.role}</div>
            </div>
            <div class="tf-video-status">
              <span class="badge bg-dark bg-opacity-75">🎙️ ON</span>
            </div>
            <div class="tf-video-name">${m.name}</div>
          </div>
        `).join("");
      }
    }

    const meetingTitleEl = document.getElementById("meetingModalTitle");
    if (meetingTitleEl) meetingTitleEl.textContent = meeting.title;
  },

  toggleMic() {
    this.micOn = !this.micOn;
    const btn = document.getElementById("btnToggleMic");
    if (btn) {
      btn.innerHTML = this.micOn ? "🎙️" : "🔇";
      btn.classList.toggle("btn-danger-room", !this.micOn);
    }
    this.showToast(this.micOn ? "Đã bật micro" : "Đã tắt micro", "info");
  },

  toggleCamera() {
    this.cameraOn = !this.cameraOn;
    const btn = document.getElementById("btnToggleCamera");
    if (btn) {
      btn.innerHTML = this.cameraOn ? "📹" : "📷";
      btn.classList.toggle("btn-danger-room", !this.cameraOn);
    }
    this.showToast(this.cameraOn ? "Đã bật camera" : "Đã tắt camera", "info");
  },

  toggleScreenShare() {
    this.screenSharing = !this.screenSharing;
    const btn = document.getElementById("btnToggleScreen");
    if (btn) btn.classList.toggle("active-control", this.screenSharing);
    this.showToast(this.screenSharing ? "Đang chia sẻ màn hình..." : "Đã dừng chia sẻ", "info");
  },

  leaveMeeting() {
    if (this.meetingTimer) clearInterval(this.meetingTimer);
    this.inMeeting = false;
    const modalEl = document.getElementById("virtualMeetingModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    this.showToast("Đã rời phòng họp.", "info");
  },

  sendMeetingChat() {
    const input = document.getElementById("meetingChatInput");
    const msg = input?.value.trim();
    if (!msg) return;

    const chatBox = document.getElementById("meetingChatMessages");
    if (chatBox) {
      const bubble = document.createElement("div");
      bubble.className = "mb-2 p-2 rounded bg-primary-subtle text-primary-emphasis small";
      bubble.innerHTML = `<strong>${this.currentUser.name}:</strong> ${msg}`;
      chatBox.appendChild(bubble);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
    input.value = "";
  },

  /* ------------------- PEER REVIEWS VIEW ------------------- */
  renderReviews() {
    const listContainer = document.getElementById("reviewsListContainer");
    if (!listContainer) return;

    if (!this.state.reviews.length) {
      listContainer.innerHTML = `<div class="p-5 text-center text-muted">Chưa có đánh giá chéo nào được gửi. Khi hoàn thành công việc, hãy bấm nút "⭐ Đánh giá chéo" để đánh giá đồng đội!</div>`;
      return;
    }

    listContainer.innerHTML = this.state.reviews.map(rev => {
      const reviewer = this.state.members.find(m => m.id === rev.reviewerId) || { name: "Thành viên", avatar: "??" };
      const reviewee = this.state.members.find(m => m.id === rev.revieweeId) || { name: "Thành viên", avatar: "??" };
      const task = this.state.tasks.find(t => t.id === rev.taskId) || { title: "Công việc nhóm" };
      const avg = ((rev.quality + rev.punctuality + rev.effort + rev.cooperation) / 4).toFixed(1);

      return `
        <div class="card mb-3 border shadow-sm">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <span class="badge bg-success-subtle text-success fw-bold">⭐ ${avg} / 5.0</span>
                <span class="text-muted small ms-2">${rev.createdAt}</span>
              </div>
              <span class="badge bg-light text-slate-700 border">Mã đầu việc: ${task.id}</span>
            </div>
            <h6 class="fw-bold text-slate-900 mb-1">${task.title}</h6>
            <div class="small text-slate-600 mb-2">
              Người đánh giá: <strong>${reviewer.name}</strong> ➔ Người được đánh giá: <strong class="text-primary">${reviewee.name}</strong>
            </div>

            <div class="row g-2 mb-2 p-2 bg-light rounded-3 small">
              <div class="col-6 col-md-3">Chất lượng: <strong>${rev.quality} ⭐</strong></div>
              <div class="col-6 col-md-3">Đúng hạn: <strong>${rev.punctuality} ⭐</strong></div>
              <div class="col-6 col-md-3">Độ khó nỗ lực: <strong>${rev.effort} ⭐</strong></div>
              <div class="col-6 col-md-3">Hợp tác: <strong>${rev.cooperation} ⭐</strong></div>
            </div>

            <div class="p-2 border-start border-4 border-success bg-white small fst-italic">
              "${rev.comment || "Không có nhận xét thêm."}"
            </div>
          </div>
        </div>
      `;
    }).join("");
  },

  openReviewModal(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const reviewee = this.state.members.find(m => m.id === task.assigneeId);
    document.getElementById("reviewTaskId").value = task.id;
    document.getElementById("reviewTaskTitleDisplay").textContent = task.title;
    document.getElementById("revieweeNameDisplay").textContent = reviewee ? reviewee.name : "Thành viên";

    const selReviewer = document.getElementById("reviewerSelect");
    if (selReviewer) {
      const candidates = this.state.members.filter(m => m.id !== task.assigneeId);
      if (candidates.length === 0) {
        selReviewer.innerHTML = `<option value="">-- Cần ít nhất 2 thành viên trong nhóm để đánh giá chéo --</option>`;
      } else {
        selReviewer.innerHTML = candidates.map(m => `
          <option value="${m.id}" ${this.currentUser && this.currentUser.id === m.id ? 'selected' : ''}>
            ${m.name} (${m.role})
          </option>
        `).join("");
      }
    }

    const modal = new bootstrap.Modal(document.getElementById("peerReviewModal"));
    modal.show();
  },

  submitPeerReview() {
    const taskId = document.getElementById("reviewTaskId").value;
    const task = this.state.tasks.find(t => t.id === taskId);
    const reviewerId = document.getElementById("reviewerSelect").value;
    const quality = parseInt(document.querySelector('input[name="rateQuality"]:checked')?.value || "5");
    const punctuality = parseInt(document.querySelector('input[name="ratePunctuality"]:checked')?.value || "5");
    const effort = parseInt(document.querySelector('input[name="rateEffort"]:checked')?.value || "5");
    const cooperation = parseInt(document.querySelector('input[name="rateCooperation"]:checked')?.value || "5");
    const comment = document.getElementById("reviewComment").value.trim();

    if (!task) return;
    if (!reviewerId) {
      alert("Vui lòng chọn người đánh giá (phải có ít nhất 2 thành viên trong nhóm)!");
      return;
    }

    const newRev = {
      id: "rev" + Date.now(),
      taskId,
      revieweeId: task.assigneeId,
      reviewerId,
      quality,
      punctuality,
      effort,
      cooperation,
      comment,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    this.state.reviews.unshift(newRev);

    const reviewer = this.state.members.find(m => m.id === reviewerId);
    const reviewee = this.state.members.find(m => m.id === task.assigneeId);
    this.state.activities.unshift({
      time: "Vừa xong",
      text: `${reviewer ? reviewer.name : 'Đồng đội'} đã đánh giá chéo công việc '${task.title}' của ${reviewee ? reviewee.name : 'bạn'}.`,
      type: "review"
    });

    this.saveState();
    this.renderAll();

    const modalEl = document.getElementById("peerReviewModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    this.showToast("Đã lưu đánh giá chéo & cập nhật hệ số chất lượng!", "success");
  },

  /* ------------------- EMAIL NOTIFICATIONS VIEW ------------------- */
  renderEmails() {
    const listContainer = document.getElementById("emailsListContainer");
    if (!listContainer) return;

    if (!this.state.emails.length) {
      listContainer.innerHTML = `<div class="p-5 text-center text-muted">Chưa có thông báo email nào được gửi. Khi bạn giao việc, lên lịch họp hoặc gửi nhắc nhở, email sẽ xuất hiện tại đây!</div>`;
      return;
    }

    listContainer.innerHTML = this.state.emails.map(em => {
      let typeBadge = '<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1">✉️ Thông báo</span>';
      if (em.type === 'task_completed') {
        typeBadge = '<span class="badge bg-success-subtle text-success border border-success-subtle me-1">🎯 Hoàn thành nhiệm vụ (Gửi toàn team)</span>';
      } else if (em.type === 'deadline_reminder' || em.type === 'reminder') {
        typeBadge = '<span class="badge bg-warning-subtle text-warning border border-warning-subtle me-1">⏰ Nhắc nhở hạn chót</span>';
      } else if (em.type === 'task_assigned') {
        typeBadge = '<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1">📋 Giao việc mới</span>';
      } else if (em.type === 'meeting') {
        typeBadge = '<span class="badge bg-info-subtle text-info border border-info-subtle me-1">📹 Nhắc lịch họp</span>';
      }

      return `
        <div class="card mb-3 border shadow-sm">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
              <div class="d-flex align-items-center flex-wrap gap-1">
                ${typeBadge}
                <span class="badge bg-success text-white">✓ Đã gửi</span>
                <span class="text-muted small ms-2">${em.sentAt}</span>
              </div>
              <span class="badge bg-light text-slate-700 border">Gửi đến: ${em.to}</span>
            </div>
            <h6 class="fw-bold text-slate-900 mb-1">${em.subject}</h6>
            <div class="small text-slate-600 mb-2">Người nhận: <strong>${em.toName}</strong> &lt;${em.to}&gt;</div>
            <div class="p-3 bg-light rounded-3 small text-slate-800" style="white-space: pre-line;">
              ${em.content}
            </div>
            <div class="text-end mt-2">
              <button class="btn btn-sm btn-outline-primary" onclick="TeamFairApp.previewEmailModal('${em.id}')">
                🔍 Xem định dạng HTML chuẩn
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  },

  sendEmailNotification(emData) {
    const newEmail = {
      id: "em" + Date.now() + Math.floor(Math.random() * 1000),
      to: emData.to,
      toName: emData.toName || (emData.to ? emData.to.split('@')[0] : "Thành viên"),
      subject: emData.subject,
      type: emData.type || "notification",
      sentAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      content: emData.content
    };
    this.state.emails.unshift(newEmail);
    this.saveState();

    // Đồng bộ gửi vào CSDL Azure SQL & SMTP Service qua backend
    try {
      fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emData.to,
          toName: newEmail.toName,
          subject: emData.subject,
          type: newEmail.type,
          content: emData.content
        })
      }).catch(err => {
        console.warn("Lưu email backend notice:", err);
      });
    } catch (e) {
      console.warn("Gửi email API error:", e);
    }
  },

  /* Gửi email thông báo đến TOÀN BỘ thành viên khi có người hoàn thành Task (Requirement) */
  notifyTeamTaskCompleted(task, completedByName) {
    if (!this.state.members || !this.state.members.length) return;
    const teamName = this.state.team?.name || "Đồ án nhóm";
    const timeStr = new Date().toLocaleString('vi-VN');

    let sentCount = 0;
    this.state.members.forEach(member => {
      if (member.email) {
        const subject = `[TeamFair 🎉 Báo Cáo Hoàn Thành] ${completedByName} đã xong: "${task.title}"`;
        const content = `Chào ${member.name},\n\n` +
          `Thành viên ${completedByName} vừa cập nhật hoàn thành 100% nhiệm vụ thuộc đồ án "${teamName}".\n\n` +
          `📌 Nhiệm vụ: "${task.title}"\n` +
          `⭐ Độ khó: ${this.getDifficultyLabel(task.difficulty).label}\n` +
          `📅 Hoàn thành lúc: ${timeStr}\n` +
          `🔗 Minh chứng nộp bài: ${task.submissionLink || "Đã lưu trên hệ thống TeamFair"}\n` +
          `📝 Ghi chú: ${task.submissionNote || "Nhiệm vụ đã hoàn thành đạt yêu cầu"}\n\n` +
          `Các thành viên trong nhóm hãy kiểm tra và có thể tiến hành Chấm điểm chéo đánh giá cho đồng đội trên hệ thống TeamFair.`;

        this.sendEmailNotification({
          to: member.email,
          toName: member.name,
          subject: subject,
          type: "task_completed",
          content: content
        });
        sentCount++;
      }
    });

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `🎉 ${completedByName} hoàn thành nhiệm vụ '${task.title}' và hệ thống đã gửi email thông báo tới ${sentCount} thành viên trong nhóm.`,
      type: "email"
    });

    this.saveState();
    this.renderAll();
    this.showToast(`🎉 Đã cập nhật xong nhiệm vụ! Tự động gửi email thông báo đến toàn bộ ${sentCount} thành viên trong nhóm.`, "success");
  },

  /* Quét và gửi email nhắc deadline cho các thành viên theo cấu hình (Requirement) */
  checkAndSendDeadlineReminders(manualTrigger = false) {
    const tasks = this.state.tasks.filter(t => t.status !== "done" && t.deadline);
    const now = new Date();
    let remindersSent = 0;

    tasks.forEach(task => {
      if (task.reminderTiming === "none") return;
      if (task.reminderSent) return; // Đã gửi nhắc lần này

      const assignee = this.state.members.find(m => m.id === task.assigneeId);
      if (!assignee || !assignee.email) return;

      const deadlineDate = new Date(task.deadline + "T23:59:59");
      if (isNaN(deadlineDate.getTime())) return;

      let triggerTime = new Date(deadlineDate);
      const timing = task.reminderTiming || "1_day";

      if (timing === "1_day") {
        triggerTime.setDate(triggerTime.getDate() - 1);
        triggerTime.setHours(8, 0, 0, 0); // 8h sáng hôm trước
      } else if (timing === "2_days") {
        triggerTime.setDate(triggerTime.getDate() - 2);
        triggerTime.setHours(8, 0, 0, 0);
      } else if (timing === "3_days") {
        triggerTime.setDate(triggerTime.getDate() - 3);
        triggerTime.setHours(8, 0, 0, 0);
      } else if (timing === "6_hours") {
        triggerTime.setHours(triggerTime.getHours() - 6);
      } else if (timing === "on_deadline") {
        triggerTime = new Date(task.deadline + "T08:00:00");
      } else if (timing === "custom" && task.reminderCustomDateTime) {
        triggerTime = new Date(task.reminderCustomDateTime);
      }

      // Kiểm tra xem thời điểm hiện tại đã đến hoặc vượt qua triggerTime chưa
      if (now >= triggerTime) {
        const teamName = this.state.team?.name || "Đồ án nhóm";
        const deadlineFormatted = task.deadline.split('-').reverse().join('/');

        const subject = `[TeamFair ⏰ Nhắc Hạn Chót] Nhiệm vụ "${task.title}" sắp tới hạn!`;
        const content = `Chào ${assignee.name},\n\n` +
          `Hệ thống TeamFair xin gửi thông báo nhắc nhở về hạn chót nhiệm vụ của bạn:\n\n` +
          `📌 Nhiệm vụ: "${task.title}"\n` +
          `⭐ Độ khó: ${this.getDifficultyLabel(task.difficulty).label}\n` +
          `⏰ Hạn chót hoàn thành: ${deadlineFormatted}\n` +
          `📊 Tiến độ hiện tại: ${task.progress}%\n` +
          `📁 Nhóm: ${teamName}\n\n` +
          `Vui lòng khẩn trương hoàn thiện, cập nhật tiến độ hoặc nộp minh chứng bài làm lên hệ thống để đảm bảo tiến độ chung của toàn đội!`;

        this.sendEmailNotification({
          to: assignee.email,
          toName: assignee.name,
          subject: subject,
          type: "deadline_reminder",
          content: content
        });

        task.reminderSent = true;
        remindersSent++;

        this.state.activities.unshift({
          time: "Vừa xong",
          text: `⏰ Đã tự động gửi email nhắc hạn chót nhiệm vụ '${task.title}' đến ${assignee.name} (${assignee.email}).`,
          type: "email"
        });
      }
    });

    if (remindersSent > 0) {
      this.saveState();
      this.renderAll();
      if (manualTrigger) {
        this.showToast(`🔔 Đã quét và gửi email nhắc deadline thành công cho ${remindersSent} nhiệm vụ sắp đến hạn!`, "success");
      }
    } else if (manualTrigger) {
      this.showToast("✓ Tất cả các nhiệm vụ đều chưa tới hạn nhắc nhở hoặc đã được gửi email trước đó.", "info");
    }
  },

  sendTaskReminderEmail(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const assignee = this.state.members.find(m => m.id === task.assigneeId);
    if (!assignee) {
      alert("Đầu việc này chưa có thành viên phụ trách!");
      return;
    }

    this.sendEmailNotification({
      to: assignee.email,
      toName: assignee.name,
      subject: `[TeamFair - Nhắc nhở hạn chót] Đầu việc: ${task.title}`,
      type: "reminder",
      content: `Chào ${assignee.name},\n\nHệ thống TeamFair xin nhắc bạn về hạn chót công việc "${task.title}".\nHạn hoàn thành: ${task.deadline ? task.deadline.split('-').reverse().join('/') : "Chưa xác định"}.\nTiến độ hiện tại: ${task.progress}%.\n\nVui lòng sớm hoàn thành và cập nhật kết quả lên hệ thống để đảm bảo tiến độ chung của nhóm!`
    });

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `Đã gửi email nhắc nhở hạn chót cho ${assignee.name} về việc '${task.title}'.`,
      type: "email"
    });

    this.saveState();
    this.renderAll();
    this.showToast(`Đã gửi email nhắc nhở thành công đến ${assignee.email}!`, "success");
  },

  sendMeetingInviteEmail(meetingId) {
    const meeting = this.state.meetings.find(m => m.id === meetingId);
    if (!meeting) return;

    if (!this.state.members.length) {
      alert("Nhóm chưa có thành viên nào để gửi email mời họp!");
      return;
    }

    this.state.members.forEach(m => {
      if (m.email) {
        this.sendEmailNotification({
          to: m.email,
          toName: m.name,
          subject: `[TeamFair - Nhắc lịch họp] ${meeting.title} (${meeting.time} ngày ${meeting.date.split('-').reverse().join('/')})`,
          type: "meeting",
          content: `Chào ${m.name},\n\nCuộc họp nhóm "${meeting.title}" sẽ diễn ra lúc ${meeting.time} ngày ${meeting.date.split('-').reverse().join('/')}.\nLink phòng họp ảo: ${meeting.link}\n\nVui lòng kiểm tra micro, camera và tham gia đúng giờ!`
        });
      }
    });

    this.saveState();
    this.renderAll();
    this.showToast("Đã gửi email nhắc lịch họp đến các thành viên!", "success");
  },

  sendAllPendingReminders() {
    const unfinished = this.state.tasks.filter(t => t.status !== "done");
    if (!unfinished.length) {
      alert("Tất cả công việc đã hoàn thành hoặc chưa có công việc nào cần nhắc nhở!");
      return;
    }

    let count = 0;
    unfinished.forEach(t => {
      const assignee = this.state.members.find(m => m.id === t.assigneeId);
      if (assignee && assignee.email) {
        this.sendEmailNotification({
          to: assignee.email,
          toName: assignee.name,
          subject: `[TeamFair - Nhắc nhở hạn chót] Nhiệm vụ '${t.title}'`,
          type: "reminder",
          content: `Chào ${assignee.name},\n\nBạn có nhiệm vụ '${t.title}' đang có tiến độ ${t.progress}%, hạn chót: ${t.deadline ? t.deadline.split('-').reverse().join('/') : "Chưa xác định"}. Vui lòng sớm hoàn thiện!`
        });
        count++;
      }
    });

    this.saveState();
    this.renderAll();
    this.showToast(`Đã gửi ${count} email nhắc nhở tự động!`, "success");
  },

  previewEmailModal(emailId) {
    const em = this.state.emails.find(e => e.id === emailId);
    if (!em) return;

    const modalBody = document.getElementById("emailPreviewModalBody");
    if (modalBody) {
      modalBody.innerHTML = `
        <div class="tf-email-preview">
          <div class="tf-email-header">
            <div class="d-flex justify-content-between mb-2">
              <span class="badge bg-primary text-white">TeamFair Notification Mailer</span>
              <span class="text-muted small">${em.sentAt}</span>
            </div>
            <div class="fw-bold text-slate-900" style="font-size: 1.1rem;">${em.subject}</div>
            <div class="text-muted small mt-1">
              Từ: <strong>TeamFair Bot &lt;notifications@teamfair.edu.vn&gt;</strong><br>
              Đến: <strong>${em.toName} &lt;${em.to}&gt;</strong>
            </div>
          </div>
          <div class="tf-email-body">
            <div style="background-color: #f8fafc; border-left: 4px solid #059669; padding: 12px 16px; margin-bottom: 16px; border-radius: 4px;">
              <span style="font-weight: 600; color: #047857;">Thông báo tự động từ hệ thống quản trị nhóm TeamFair</span>
            </div>
            <div style="white-space: pre-line; margin-bottom: 24px; font-size: 0.95rem;">
              ${em.content}
            </div>
            <div style="text-align: center; margin-bottom: 24px;">
              <button class="btn btn-tf-primary" onclick="alert('Đang chuyển hướng đến cổng làm việc nhóm!')">
                Truy cập Không Gian Nhóm TeamFair
              </button>
            </div>
            <hr style="border-top: 1px dashed #cbd5e1;">
            <div style="font-size: 0.75rem; color: #94a3b8; text-align: center;">
              Email này được tạo và gửi tự động bởi hệ thống TeamFair. Vui lòng không trả lời trực tiếp email này.
            </div>
          </div>
        </div>
      `;
    }

    const modal = new bootstrap.Modal(document.getElementById("emailPreviewModal"));
    modal.show();
  },

  /* ------------------- REPORT VIEW ------------------- */
  renderReport() {
    const { memberStats } = this.computeContributions();

    const elRepTeam = document.getElementById("repTeamName");
    if (elRepTeam) elRepTeam.textContent = this.state.team.name || "Nhóm của tôi";

    const elRepTopic = document.getElementById("repTopic");
    if (elRepTopic) elRepTopic.textContent = this.state.team.topic || "(Chưa nhập đề tài)";

    const elRepSubject = document.getElementById("repSubject");
    if (elRepSubject) elRepSubject.textContent = this.state.team.subject || "(Chưa nhập môn học)";

    const elRepClass = document.getElementById("repClass");
    if (elRepClass) elRepClass.textContent = this.state.team.classCode || "(Chưa nhập lớp)";

    const elLeaderSig = document.getElementById("repLeaderSignature");
    if (elLeaderSig) {
      const leaderMember = this.state.members.find(m => m.roleType === "Leader" || (m.role && m.role.toLowerCase().includes("trưởng")));
      elLeaderSig.innerHTML = `<strong>${leaderMember ? leaderMember.name : (this.currentUser.roleType === 'Leader' ? this.currentUser.name : 'Trưởng nhóm')}</strong><br><span class="text-success small">✓ Đã xác nhận điện tử</span>`;
    }

    const tableContainer = document.getElementById("repMembersTableBody");
    if (tableContainer) {
      if (!this.state.members.length) {
        tableContainer.innerHTML = `
          <tr>
            <td colspan="8" class="text-center text-muted py-4">Chưa có thành viên nào trong nhóm để xuất báo cáo.</td>
          </tr>
        `;
        return;
      }

      tableContainer.innerHTML = Object.values(memberStats).map((stat, idx) => {
        const m = stat.member;
        const pct = parseFloat(stat.percentage);
        const tasksOfMember = this.state.tasks.filter(t => t.assigneeId === m.id);
        const taskTitles = tasksOfMember.map(t => `${t.title} (${t.progress}%)`).join(", ") || "Chưa có";

        let proposedGrade = "10.0 / 10";
        if (pct < 15) proposedGrade = "7.0 / 10";
        else if (pct < 20) proposedGrade = "8.5 / 10";
        else if (pct < 24) proposedGrade = "9.5 / 10";

        return `
          <tr>
            <td class="text-center fw-bold">${idx + 1}</td>
            <td>
              <div class="fw-bold text-slate-900">${m.name}</div>
              <div class="text-muted small">${m.email || 'Chưa có'} • <em>${m.role}</em></div>
            </td>
            <td class="small" style="max-width: 320px;">
              ${taskTitles}
            </td>
            <td class="text-center fw-bold text-primary">${stat.avgScore} ⭐</td>
            <td class="text-center fw-bold text-success">${stat.finalPoints.toFixed(1)} đ</td>
            <td class="text-center fw-bold" style="font-size: 1.05rem;">
              ${pct}%
              <div class="progress mt-1" style="height: 6px;">
                <div class="progress-bar bg-success" style="width: ${pct}%;"></div>
              </div>
            </td>
            <td class="text-center fw-bold text-slate-800">${proposedGrade}</td>
            <td class="text-center fst-italic text-muted small">Đã xác nhận điện tử ✓</td>
          </tr>
        `;
      }).join("");
    }
  },

  printReport() {
    window.print();
  },

  showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toastEl = document.createElement("div");
    toastEl.className = `toast align-items-center text-white border-0 shadow-lg ${type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : 'bg-primary'}`;
    toastEl.setAttribute("role", "alert");
    toastEl.setAttribute("aria-live", "assertive");
    toastEl.setAttribute("aria-atomic", "true");

    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body fw-semibold">
          ${type === 'success' ? '✅' : type === 'danger' ? '⚠️' : 'ℹ️'} ${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;

    container.appendChild(toastEl);
    const bsToast = new bootstrap.Toast(toastEl, { delay: 3500 });
    bsToast.show();

    toastEl.addEventListener('hidden.bs.toast', () => {
      toastEl.remove();
    });
  },

  /* ================= REQ 6: DEMO WORKSPACE & INTERACTIVE ONBOARDING ================= */
  loadDemoWorkspace() {
    const demoTeam = {
      name: "Nhóm 05 - Ứng Dụng Web Di Động",
      topic: "Hệ thống quản lý chuỗi cung ứng thực phẩm sạch",
      subject: "Phát triển Ứng dụng Web - CNTT K21",
      classCode: "21CNTT01 - GVHD: ThS. Minh",
      finalDeadline: "2026-11-20",
      joinCode: "TF-DEMO"
    };

    const currentName = (this.currentUser && this.currentUser.name) ? this.currentUser.name : "Nguyễn Văn An";
    const currentEmail = (this.currentUser && this.currentUser.email) ? this.currentUser.email : "an.nguyen@student.edu.vn";

    const demoMembers = [
      {
        id: "mem_demo_1",
        name: `${currentName} (Bạn)`,
        email: currentEmail,
        role: "Trưởng nhóm & Fullstack Developer",
        roleType: "Leader",
        color: "#059669",
        avatar: "NT"
      },
      {
        id: "mem_demo_2",
        name: "Trần Thị Mai",
        email: "mai.tran@student.edu.vn",
        role: "UI/UX & Frontend Designer",
        roleType: "Member",
        color: "#2563eb",
        avatar: "TM"
      },
      {
        id: "mem_demo_3",
        name: "Lê Hoàng Nam",
        email: "nam.le@student.edu.vn",
        role: "Backend & Database Architect",
        roleType: "Member",
        color: "#7c3aed",
        avatar: "HN"
      },
      {
        id: "mem_demo_4",
        name: "Phạm Đức Anh",
        email: "anh.pham@student.edu.vn",
        role: "Tester & QA Specialist",
        roleType: "Member",
        color: "#ea580c",
        avatar: "ĐA"
      }
    ];

    const demoTasks = [
      {
        id: "task_demo_1",
        title: "Thiết kế wireframe & prototype giao diện",
        assignedTo: "mem_demo_2",
        deadline: "2026-10-25",
        difficulty: 4,
        status: "done",
        desc: "Thiết kế UI/UX trên Figma theo chuẩn Tailwind và Material Design",
        submissionLink: "https://figma.com/file/demo-prototype-nhom05",
        submissionNote: "Đã hoàn thành 100% các màn hình chính và responsive mobile.",
        reminderTiming: "1_day",
        reminderSent: true
      },
      {
        id: "task_demo_2",
        title: "Thiết kế kiến trúc CSDL & EF Core Migrations",
        assignedTo: "mem_demo_3",
        deadline: "2026-10-28",
        difficulty: 4,
        status: "done",
        desc: "Thiết kế ERD, quan hệ 1-n, bảng Users, Teams, Tasks, Reviews",
        submissionLink: "https://github.com/teamfair-demo/backend-api",
        submissionNote: "Database đã migrate lên Azure SQL chạy ổn định.",
        reminderTiming: "1_day",
        reminderSent: true
      },
      {
        id: "task_demo_3",
        title: "Xây dựng luồng phân quyền và bảo mật JWT / Google OAuth",
        assignedTo: "mem_demo_1",
        deadline: "2026-11-02",
        difficulty: 5,
        status: "review",
        desc: "Cấu hình Google OAuth, kiểm soát vai trò Nhóm Trưởng và Thành Viên",
        submissionLink: "https://github.com/teamfair-demo/auth-service",
        submissionNote: "Đang chờ nhóm test nghiệm thu luồng callback.",
        reminderTiming: "2_days",
        reminderSent: false
      },
      {
        id: "task_demo_4",
        title: "Viết Unit Tests và kịch bản kiểm thử luồng chấm điểm",
        assignedTo: "mem_demo_4",
        deadline: "2026-11-05",
        difficulty: 3,
        status: "doing",
        desc: "Viết kiểm thử tự động xUnit cho thuật toán tính KPI đóng góp",
        submissionLink: "",
        submissionNote: "",
        reminderTiming: "1_day",
        reminderSent: false
      },
      {
        id: "task_demo_5",
        title: "Tích hợp phòng họp ảo và lên lịch rảnh nhóm",
        assignedTo: "mem_demo_1",
        deadline: "2026-11-08",
        difficulty: 3,
        status: "doing",
        desc: "Mô phỏng grid webcam và chia sẻ màn hình trực tuyến",
        submissionLink: "",
        submissionNote: "",
        reminderTiming: "1_day",
        reminderSent: false
      },
      {
        id: "task_demo_6",
        title: "Hoàn thiện Slide thuyết trình và Báo cáo tổng kết đồ án",
        assignedTo: "mem_demo_2",
        deadline: "2026-11-15",
        difficulty: 2,
        status: "todo",
        desc: "Tổng hợp số liệu từ TeamFair xuất ra báo cáo PDF nộp giảng viên",
        submissionLink: "",
        submissionNote: "",
        reminderTiming: "3_days",
        reminderSent: false
      }
    ];

    const demoSchedules = {
      "mem_demo_1": ["tue_sang", "tue_chieu", "thu_toi", "sat_sang", "sat_chieu", "sun_toi"],
      "mem_demo_2": ["tue_sang", "wed_chieu", "thu_toi", "fri_sang", "sat_sang", "sun_toi"],
      "mem_demo_3": ["tue_sang", "thu_toi", "fri_chieu", "sat_sang", "sun_sang", "sun_toi"],
      "mem_demo_4": ["tue_sang", "wed_sang", "thu_toi", "sat_sang", "sat_toi", "sun_toi"]
    };

    const demoMeetings = [
      {
        id: "meet_demo_1",
        title: "Họp rà soát tiến độ Sprint 2 & Chốt phân công đồ án",
        date: "2026-10-24",
        time: "19:30",
        platform: "TeamFair Virtual Room",
        link: "#meeting",
        notes: "Tất cả thành viên có mặt đúng giờ để rà soát Task và đánh giá chéo."
      }
    ];

    const demoReviews = [
      {
        reviewerId: "mem_demo_1",
        revieweeId: "mem_demo_2",
        criteria: { quality: 5, deadline: 5, effort: 4, cooperation: 5 },
        comment: "Mai thiết kế UI rất thẩm mỹ, phối màu dịu mắt và giao nộp đúng hẹn."
      },
      {
        reviewerId: "mem_demo_1",
        revieweeId: "mem_demo_3",
        criteria: { quality: 5, deadline: 4, effort: 5, cooperation: 4 },
        comment: "Nam thiết kế CSDL rất chuẩn xác, query tối ưu tốt."
      },
      {
        reviewerId: "mem_demo_2",
        revieweeId: "mem_demo_1",
        criteria: { quality: 5, deadline: 5, effort: 5, cooperation: 5 },
        comment: "Nhóm trưởng phân công công việc rõ ràng, theo sát tiến độ và hỗ trợ nhiệt tình."
      }
    ];

    this.state = {
      team: demoTeam,
      members: demoMembers,
      tasks: demoTasks,
      schedules: demoSchedules,
      meetings: demoMeetings,
      reviews: demoReviews,
      emails: [
        {
          id: "email_demo_1",
          to: currentEmail,
          subject: "[TeamFair] Thông báo giao việc mới: Luồng phân quyền",
          body: "Chào bạn, Nhóm Trưởng đã giao cho bạn nhiệm vụ: 'Xây dựng luồng phân quyền và bảo mật JWT / Google OAuth'. Hạn chót: 02/11/2026.",
          date: "21/10/2026 09:00"
        }
      ],
      activities: [
        { action: "Trần Thị Mai đã nộp minh chứng cho nhiệm vụ 'Thiết kế wireframe'", time: "Hôm nay 14:20" },
        { action: "Lê Hoàng Nam đã hoàn thành nhiệm vụ 'Thiết kế kiến trúc CSDL'", time: "Hôm qua 18:30" }
      ]
    };

    this.currentUser = {
      ...demoMembers[0],
      name: currentName,
      email: currentEmail,
      roleType: "Leader",
      role: "Trưởng nhóm"
    };

    this.saveUserSession();
    this.saveState();
    this.renderAll();
    this.showToast("✨ Đã nạp thành công Dữ liệu mẫu (Demo Workspace)! Bạn đang trải nghiệm đầy đủ vai trò Nhóm Trưởng.", "success");
  },

  openOnboardingGuide() {
    const modalEl = document.getElementById("modalOnboardingGuide");
    if (modalEl) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  TeamFairApp.init();
});
