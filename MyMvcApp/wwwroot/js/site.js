/**
 * TeamFair - Main Application Engine (Clean Version - No Mock Data)
 * Khởi tạo dữ liệu thực tế, sẵn sàng cho người dùng tự nhập toàn bộ.
 */

const DEFAULT_STATE = {
  team: {
    name: "Nhóm của tôi",
    topic: "Chưa đặt tên đề tài",
    subject: "Chưa nhập môn học",
    classCode: "Chưa nhập lớp",
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

const TeamFairApp = {
  state: null,
  activeTab: "dashboard",
  currentSchedulerMemberId: "",
  inMeeting: false,
  micOn: true,
  cameraOn: true,
  screenSharing: false,
  meetingTimer: null,
  meetingSeconds: 0,

  init() {
    this.loadState();
    this.bindEvents();
    this.renderAll();
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
          if (this.state.members.length > 0 && !this.currentSchedulerMemberId) {
            this.currentSchedulerMemberId = this.state.members[0].id;
          }
          this.renderAll();
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

    if (this.state.members.length > 0 && !this.currentSchedulerMemberId) {
      this.currentSchedulerMemberId = this.state.members[0].id;
    }
    this.renderAll();
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

  clearAllData() {
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (thành viên, công việc, lịch họp...) để nhập lại từ đầu?")) {
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      this.currentSchedulerMemberId = "";
      this.saveState();
      this.renderAll();
      this.showToast("Đã xóa toàn bộ dữ liệu, sẵn sàng nhập mới!", "info");
    }
  },

  editTeamInfo() {
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

  bindEvents() {
    // Navigation Tabs
    document.querySelectorAll(".tf-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        if (tab) this.switchTab(tab);
      });
    });

    // Form Task Assignment
    const formTask = document.getElementById("formAddTask");
    if (formTask) {
      formTask.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddTask();
      });
    }

    // Form Add Member
    const formMember = document.getElementById("formAddMember");
    if (formMember) {
      formMember.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddMember();
      });
    }

    // Form Schedule Meeting
    const formMeeting = document.getElementById("formAddMeeting");
    if (formMeeting) {
      formMeeting.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddMeeting();
      });
    }
  },

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll(".tf-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });

    document.querySelectorAll(".tf-tab-pane").forEach(pane => {
      pane.classList.toggle("d-none", pane.id !== `pane-${tabId}`);
    });

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
    this.renderHeaderAndBadges();
    if (this.activeTab === "dashboard") this.renderDashboard();
    if (this.activeTab === "tasks") this.renderTasks();
    if (this.activeTab === "schedule") this.renderSchedule();
    if (this.activeTab === "meeting") this.renderMeeting();
    if (this.activeTab === "reviews") this.renderReviews();
    if (this.activeTab === "emails") this.renderEmails();
    if (this.activeTab === "report") this.renderReport();
  },

  renderHeaderAndBadges() {
    const totalTasks = this.state.tasks.length;
    const doneTasks = this.state.tasks.filter(t => t.status === "done").length;
    const unreadEmails = this.state.emails.length;

    const elTaskBadge = document.getElementById("badge-task-count");
    if (elTaskBadge) elTaskBadge.textContent = `${doneTasks}/${totalTasks}`;

    const elEmailBadge = document.getElementById("badge-email-count");
    if (elEmailBadge) elEmailBadge.textContent = unreadEmails;

    const elTeamName = document.getElementById("topTeamName");
    if (elTeamName) elTeamName.textContent = this.state.team.name || "Nhóm của tôi";
  },

  /* ------------------- DASHBOARD VIEW ------------------- */
  renderDashboard() {
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
      elNextMeeting.textContent = nextMeeting ? `${nextMeeting.time} - ${nextMeeting.date.split('-').reverse().slice(0, 2).join('/')}` : "Chưa có";
    }

    this.renderContributionChart(memberStats);
    this.renderUrgentDeadlines();
    this.renderActivityFeed();
  },

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
              <span class="badge bg-secondary-subtle text-secondary" style="font-size: 0.7rem;">
                ${stat.completedTasks}/${stat.totalTasks} việc
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
              Không cần tự cãi vã chia điểm. Hệ số minh bạch qua từng đầu việc & đánh giá chéo.
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

  /* ------------------- TASKS & KANBAN VIEW ------------------- */
  renderTasks() {
    const selAssignee = document.getElementById("taskAssignee");
    if (selAssignee) {
      if (!this.state.members.length) {
        selAssignee.innerHTML = `<option value="">-- Chưa có thành viên nào --</option>`;
      } else {
        selAssignee.innerHTML = `<option value="">-- Chọn thành viên phụ trách --</option>` +
          this.state.members.map(m => `<option value="${m.id}">${m.name} (${m.role})</option>`).join("");
      }
    }

    const filterMember = document.getElementById("filterTaskMember");
    if (filterMember) {
      filterMember.innerHTML = `<option value="all">Tất cả thành viên</option>` +
        this.state.members.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
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

    container.innerHTML = this.state.members.map(m => {
      const taskCount = this.state.tasks.filter(t => t.assigneeId === m.id).length;
      return `
        <div class="d-flex align-items-center justify-content-between p-2 mb-2 bg-light rounded-3 border">
          <div class="d-flex align-items-center gap-2">
            <span class="tf-avatar" style="background-color: ${m.color}; width: 32px; height: 32px; font-size: 0.75rem;">${m.avatar}</span>
            <div>
              <div class="fw-bold text-slate-800" style="font-size: 0.875rem;">${m.name}</div>
              <div class="text-muted" style="font-size: 0.75rem;">${m.email || 'Chưa có email'} • <em>${m.role}</em></div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-white text-slate-700 border" style="font-size: 0.75rem;">${taskCount} công việc</span>
            <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="TeamFairApp.handleRemoveMember('${m.id}')" title="Xóa thành viên">×</button>
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

    container.innerHTML = tasks.map(t => {
      const assignee = this.state.members.find(m => m.id === t.assigneeId) || { name: "Chưa giao", color: "#64748b", avatar: "??" };
      const diff = this.getDifficultyLabel(t.difficulty);
      const st = this.getStatusInfo(t.status);

      return `
        <div class="card mb-3 border shadow-sm">
          <div class="card-body p-3">
            <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
              <div class="d-flex align-items-center gap-2">
                <span class="badge ${st.badge}">${st.label}</span>
                <span class="badge ${diff.badge}">${diff.label}</span>
                <span class="badge bg-light text-slate-600 border">${t.category || "Công việc"}</span>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="text-muted small">Hạn: <strong>${t.deadline ? t.deadline.split('-').reverse().join('/') : "Chưa đặt"}</strong></span>
                <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="TeamFairApp.handleDeleteTask('${t.id}')">×</button>
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
                  📊 Cập nhật %
                </button>
                <button class="btn btn-sm btn-light border py-1" onclick="TeamFairApp.sendTaskReminderEmail('${t.id}')">
                  ✉️ Nhắc nhở
                </button>
                <button class="btn btn-sm btn-tf-indigo py-1 text-white" onclick="TeamFairApp.openReviewModal('${t.id}')">
                  ⭐ Đánh giá chéo
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
      description: desc
    };

    this.state.tasks.unshift(newTask);

    const assignee = this.state.members.find(m => m.id === assigneeId);

    this.state.activities.unshift({
      time: "Vừa xong",
      text: `Đã giao nhiệm vụ mới: '${title}' cho ${assignee ? assignee.name : 'thành viên'}.`,
      type: "task"
    });

    if (assignee && assignee.email) {
      this.sendEmailNotification({
        to: assignee.email,
        toName: assignee.name,
        subject: `[TeamFair] Giao nhiệm vụ mới: ${title}`,
        type: "task_assigned",
        content: `Bạn vừa được giao nhiệm vụ: "${title}". Độ khó: ${this.getDifficultyLabel(difficulty).label}. Hạn chót: ${deadline ? deadline.split('-').reverse().join('/') : "Chưa đặt"}.`
      });
    }

    this.saveState();
    this.renderAll();
    this.showToast(`Đã giao việc "${title}" thành công!`, "success");

    document.getElementById("taskTitle").value = "";
    document.getElementById("taskDesc").value = "";
  },

  handleAddMember() {
    const name = document.getElementById("memberName")?.value.trim();
    const email = document.getElementById("memberEmail")?.value.trim();
    const role = document.getElementById("memberRole")?.value.trim() || "Thành viên";

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
      text: `Đã thêm thành viên mới: ${name} (${role}) vào nhóm.`,
      type: "member"
    });

    this.saveState();
    this.renderAll();
    this.showToast(`Đã thêm thành viên ${name} vào nhóm!`, "success");

    document.getElementById("memberName").value = "";
    if (document.getElementById("memberEmail")) document.getElementById("memberEmail").value = "";
    if (document.getElementById("memberRole")) document.getElementById("memberRole").value = "";
  },

  handleRemoveMember(id) {
    const m = this.state.members.find(x => x.id === id);
    if (confirm(`Bạn có chắc muốn xóa thành viên ${m?.name} khỏi nhóm không?`)) {
      this.state.members = this.state.members.filter(x => x.id !== id);
      delete this.state.schedules[id];
      if (this.currentSchedulerMemberId === id) {
        this.currentSchedulerMemberId = this.state.members[0] ? this.state.members[0].id : "";
      }
      this.saveState();
      this.renderAll();
      this.showToast("Đã xóa thành viên khỏi nhóm.", "info");
    }
  },

  handleDeleteTask(id) {
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
        task.progress = val;
        if (val === 100) task.status = "done";
        else if (val > 0) task.status = "doing";
        else task.status = "todo";

        this.state.activities.unshift({
          time: "Vừa xong",
          text: `Tiến độ việc '${task.title}' được cập nhật lên ${val}%`,
          type: "task"
        });

        this.saveState();
        this.renderAll();
        this.showToast(`Đã cập nhật tiến độ ${val}%!`, "success");
      }
    }
  },

  /* ------------------- SCHEDULE / LỊCH RẢNH VIEW ------------------- */
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
            <button class="btn btn-sm btn-primary mt-3" onclick="TeamFairApp.switchTab('tasks')">
              ➔ Thêm thành viên nhóm
            </button>
          </div>
        `;
      }
      return;
    }

    if (!this.currentSchedulerMemberId || !this.state.members.find(m => m.id === this.currentSchedulerMemberId)) {
      this.currentSchedulerMemberId = this.state.members[0].id;
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

    html += `
          </tbody>
        </table>
      </div>
    `;

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
            <strong>⚠️ Chưa có khung giờ nào 100% thành viên cùng rảnh.</strong> Bạn hãy bấm vào các ô khung giờ trên để cập nhật giờ rảnh cá nhân!
          </div>
        `;
      }
    }
  },

  toggleScheduleSlot(slotKey) {
    if (!this.currentSchedulerMemberId) return;
    let slots = this.state.schedules[this.currentSchedulerMemberId] || [];
    if (slots.includes(slotKey)) {
      slots = slots.filter(s => s !== slotKey);
    } else {
      slots.push(slotKey);
    }
    this.state.schedules[this.currentSchedulerMemberId] = slots;
    this.saveState();
    this.renderSchedule();
    this.showToast("Đã cập nhật lịch rảnh!", "info");
  },

  scheduleMeetingAtGoldenSlot(day, shift) {
    this.switchTab("meeting");
    const titleInput = document.getElementById("meetingTitle");
    if (titleInput) titleInput.value = `Họp nhóm định kỳ (${day} - ${shift})`;
  },

  /* ------------------- MEETING ROOM / PHÒNG HỌP VIEW ------------------- */
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
      text: `Đã tạo cuộc họp mới: '${title}' và gửi thư mời email cho nhóm.`,
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
              <div class="fw-bold">Bạn đang ở trong phòng họp một mình</div>
              <div class="text-muted small mt-1">Hãy thêm thành viên để hiển thị luồng video của nhóm.</div>
            </div>
            <div class="tf-video-name">Bạn (Chủ phòng)</div>
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
      bubble.innerHTML = `<strong>Bạn:</strong> ${msg}`;
      chatBox.appendChild(bubble);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
    input.value = "";
  },

  /* ------------------- PEER REVIEWS / ĐÁNH GIÁ CHÉO VIEW ------------------- */
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
        selReviewer.innerHTML = candidates.map(m => `<option value="${m.id}">${m.name} (${m.role})</option>`).join("");
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

    listContainer.innerHTML = this.state.emails.map(em => `
      <div class="card mb-3 border shadow-sm">
        <div class="card-body p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <span class="badge bg-success text-white">Đã gửi thành công</span>
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
    `).join("");
  },

  sendEmailNotification(emData) {
    const newEmail = {
      id: "em" + Date.now(),
      to: emData.to,
      toName: emData.toName,
      subject: emData.subject,
      type: emData.type || "notification",
      sentAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      content: emData.content
    };
    this.state.emails.unshift(newEmail);
    this.saveState();
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

  /* ------------------- REPORT VIEW (XUẤT BÁO CÁO NỘP KÈM BÀI) ------------------- */
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
  }
};

document.addEventListener("DOMContentLoaded", () => {
  TeamFairApp.init();
});
