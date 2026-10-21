using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyMvcApp.Data;
using MyMvcApp.Models;

namespace MyMvcApp.Controllers;

[ApiController]
[Route("api")]
public class ApiController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILogger<ApiController> _logger;

    public ApiController(AppDbContext db, ILogger<ApiController> logger)
    {
        _db = db;
        _logger = logger;
    }

    [HttpGet("test-connection")]
    public async Task<IActionResult> TestConnection()
    {
        try
        {
            var canConnect = await _db.Database.CanConnectAsync();
            if (canConnect)
            {
                return Ok(new { success = true, message = "Kết nối Azure SQL Database thành công!" });
            }
            return StatusCode(500, new { success = false, message = "Không thể kết nối đến cơ sở dữ liệu." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("apply-migration")]
    public async Task<IActionResult> ApplyMigration()
    {
        try
        {
            await _db.Database.MigrateAsync();
            return Ok(new { success = true, message = "Đã chạy migration và tạo tất cả các bảng thành công!" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("clear-all")]
    public async Task<IActionResult> ClearAllData()
    {
        try
        {
            _db.PeerReviews.RemoveRange(await _db.PeerReviews.ToListAsync());
            _db.EmailLogs.RemoveRange(await _db.EmailLogs.ToListAsync());
            _db.ActivityLogs.RemoveRange(await _db.ActivityLogs.ToListAsync());
            _db.Tasks.RemoveRange(await _db.Tasks.ToListAsync());
            _db.Meetings.RemoveRange(await _db.Meetings.ToListAsync());
            _db.Members.RemoveRange(await _db.Members.Include(m => m.ScheduleSlots).ToListAsync());

            var team = await _db.Teams.FirstOrDefaultAsync();
            if (team != null)
            {
                team.Name = "Nhóm của tôi";
                team.Topic = "";
                team.Subject = "";
                team.ClassCode = "";
                team.FinalDeadline = "";
                team.JoinCode = null;
                team.CreatedByEmail = null;
            }
            await _db.SaveChangesAsync();
            return Ok(new { success = true, message = "Đã dọn sạch toàn bộ mock data trên Azure SQL Database!" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("auth/register")]
    public async Task<IActionResult> Register([FromBody] RegisterDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password) || string.IsNullOrWhiteSpace(dto.Name))
            {
                return BadRequest(new { success = false, message = "Vui lòng nhập đầy đủ Họ tên, Email và Mật khẩu." });
            }

            var cleanEmail = dto.Email.Trim().ToLowerInvariant();
            var existing = await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == cleanEmail);
            if (existing != null)
            {
                return BadRequest(new { success = false, message = "Email này đã được đăng ký tài khoản." });
            }

            var words = dto.Name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var avatar = words.Length >= 2
                ? (words[0][0].ToString() + words[^1][0].ToString()).ToUpper()
                : (dto.Name.Trim().Length >= 2 ? dto.Name.Trim().Substring(0, 2).ToUpper() : "TV");

            string[] colors = { "#2563eb", "#059669", "#7c3aed", "#ea580c", "#0891b2", "#db2777" };
            var color = colors[Math.Abs(cleanEmail.GetHashCode()) % colors.Length];

            var newUser = new AppUser
            {
                Name = dto.Name.Trim(),
                Email = cleanEmail,
                Password = dto.Password,
                Avatar = avatar,
                Color = color,
                CreatedAt = DateTime.UtcNow
            };

            _db.Users.Add(newUser);
            await _db.SaveChangesAsync();

            // Mặc định đăng ký mới: Ai cũng là Thành viên
            return Ok(new
            {
                success = true,
                message = "Đăng ký tài khoản thành công!",
                user = new
                {
                    id = newUser.Id.ToString(),
                    name = newUser.Name,
                    email = newUser.Email,
                    avatar = newUser.Avatar,
                    color = newUser.Color,
                    roleType = "Member",
                    role = "Thành viên"
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("auth/login")]
    public async Task<IActionResult> Login([FromBody] LoginDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password))
            {
                return BadRequest(new { success = false, message = "Vui lòng nhập Email và Mật khẩu." });
            }

            var cleanEmail = dto.Email.Trim().ToLowerInvariant();
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == cleanEmail);
            if (user == null || user.Password != dto.Password)
            {
                return BadRequest(new { success = false, message = "Email hoặc mật khẩu không chính xác." });
            }

            // Kiểm tra xem user này có đang là trưởng nhóm của nhóm hiện tại không
            var team = await _db.Teams.FirstOrDefaultAsync();
            var member = await _db.Members.FirstOrDefaultAsync(m => m.Email.ToLower() == cleanEmail);

            bool isLeader = false;
            if (team != null && !string.IsNullOrEmpty(team.CreatedByEmail) && team.CreatedByEmail.ToLower() == cleanEmail)
            {
                isLeader = true;
            }
            else if (member != null && string.Equals(member.RoleType, "Leader", StringComparison.OrdinalIgnoreCase))
            {
                isLeader = true;
            }

            return Ok(new
            {
                success = true,
                message = "Đăng nhập thành công!",
                user = new
                {
                    id = user.Id.ToString(),
                    name = user.Name,
                    email = user.Email,
                    avatar = user.Avatar,
                    color = user.Color,
                    roleType = isLeader ? "Leader" : "Member",
                    role = isLeader ? "Trưởng nhóm" : "Thành viên"
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("auth/google")]
    public async Task<IActionResult> GoogleAuth([FromBody] GoogleAuthDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email))
            {
                return BadRequest(new { success = false, message = "Email Google không hợp lệ." });
            }

            var cleanEmail = dto.Email.Trim().ToLowerInvariant();
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == cleanEmail);

            if (user == null)
            {
                // Tự động tạo tài khoản Google vào Azure SQL Database
                var displayName = !string.IsNullOrWhiteSpace(dto.Name) ? dto.Name.Trim() : cleanEmail.Split('@')[0];
                var words = displayName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var avatar = words.Length >= 2
                    ? (words[0][0].ToString() + words[^1][0].ToString()).ToUpper()
                    : (displayName.Length >= 2 ? displayName[..2].ToUpper() : "GG");

                string[] colors = { "#ea4335", "#4285f4", "#fbbc05", "#34a853", "#059669", "#7c3aed" };
                var color = colors[Math.Abs(cleanEmail.GetHashCode()) % colors.Length];

                user = new AppUser
                {
                    Name = displayName,
                    Email = cleanEmail,
                    Password = "google_authenticated_" + Guid.NewGuid().ToString("N")[..8],
                    Avatar = avatar,
                    Color = color,
                    CreatedAt = DateTime.UtcNow
                };

                _db.Users.Add(user);
                await _db.SaveChangesAsync();
            }

            // Kiểm tra xem user này có đang là trưởng nhóm của nhóm hiện tại không
            var team = await _db.Teams.FirstOrDefaultAsync();
            var member = await _db.Members.FirstOrDefaultAsync(m => m.Email.ToLower() == cleanEmail);

            bool isLeader = false;
            if (team != null && !string.IsNullOrEmpty(team.CreatedByEmail) && team.CreatedByEmail.ToLower() == cleanEmail)
            {
                isLeader = true;
            }
            else if (member != null && string.Equals(member.RoleType, "Leader", StringComparison.OrdinalIgnoreCase))
            {
                isLeader = true;
            }

            return Ok(new
            {
                success = true,
                message = "Đăng nhập Google thành công!",
                user = new
                {
                    id = user.Id.ToString(),
                    name = user.Name,
                    email = user.Email,
                    avatar = user.Avatar,
                    color = user.Color,
                    roleType = isLeader ? "Leader" : "Member",
                    role = isLeader ? "Trưởng nhóm" : "Thành viên"
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("team/create")]
    public async Task<IActionResult> CreateTeam([FromBody] CreateTeamDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.TeamName))
            {
                return BadRequest(new { success = false, message = "Vui lòng nhập tên nhóm." });
            }

            var joinCode = "TF-" + Random.Shared.Next(1000, 9999).ToString();
            var team = await _db.Teams.FirstOrDefaultAsync();
            if (team == null)
            {
                team = new Team();
                _db.Teams.Add(team);
            }

            team.Name = dto.TeamName.Trim();
            team.Topic = dto.Topic?.Trim() ?? "";
            team.Subject = dto.Subject?.Trim() ?? "";
            team.ClassCode = dto.ClassCode?.Trim() ?? "";
            team.FinalDeadline = dto.FinalDeadline?.Trim() ?? "";
            team.CreatedByEmail = dto.UserEmail?.Trim().ToLowerInvariant() ?? "";
            team.JoinCode = joinCode;

            // Xóa các thành viên và dữ liệu cũ của nhóm trước để tạo mới sạch sẽ
            var existingMembers = await _db.Members.Include(m => m.ScheduleSlots).ToListAsync();
            _db.Members.RemoveRange(existingMembers);
            _db.Tasks.RemoveRange(await _db.Tasks.ToListAsync());
            _db.Meetings.RemoveRange(await _db.Meetings.ToListAsync());
            _db.PeerReviews.RemoveRange(await _db.PeerReviews.ToListAsync());

            // "khi thành viên muốn tạo nhóm thì phải tự tạo xong hệ thống sẽ set người đầu tiên tạo đó làm nhóm trưởng nhé"
            var leaderMember = new TeamMember
            {
                Id = "m_" + Guid.NewGuid().ToString("N")[..8],
                Name = string.IsNullOrWhiteSpace(dto.UserName) ? "Trưởng Nhóm" : dto.UserName.Trim(),
                Email = dto.UserEmail?.Trim().ToLowerInvariant() ?? "",
                Role = "Trưởng nhóm",
                RoleType = "Leader", // set người đầu tiên tạo làm nhóm trưởng
                Avatar = string.IsNullOrWhiteSpace(dto.UserName) ? "TN" : dto.UserName.Trim()[..Math.Min(2, dto.UserName.Trim().Length)].ToUpper(),
                Color = "#059669"
            };
            _db.Members.Add(leaderMember);

            _db.ActivityLogs.Add(new ActivityLog
            {
                Text = $"{leaderMember.Name} đã tạo nhóm '{team.Name}' (Mã nhóm: {joinCode}) và trở thành 👑 Nhóm Trưởng.",
                Time = "Vừa xong",
                Type = "team"
            });

            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Tạo nhóm '{team.Name}' thành công! Bạn đã là 👑 Nhóm Trưởng.",
                joinCode = team.JoinCode,
                team = new
                {
                    id = team.Id,
                    name = team.Name,
                    topic = team.Topic,
                    subject = team.Subject,
                    classCode = team.ClassCode,
                    finalDeadline = team.FinalDeadline,
                    joinCode = team.JoinCode,
                    createdByEmail = team.CreatedByEmail
                },
                leader = new
                {
                    id = leaderMember.Id,
                    name = leaderMember.Name,
                    email = leaderMember.Email,
                    role = leaderMember.Role,
                    roleType = "Leader",
                    avatar = leaderMember.Avatar,
                    color = leaderMember.Color
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("team/join")]
    public async Task<IActionResult> JoinTeam([FromBody] JoinTeamDto dto)
    {
        try
        {
            var code = dto.JoinCode?.Trim().ToUpperInvariant();
            var team = await _db.Teams.FirstOrDefaultAsync(t => t.JoinCode != null && t.JoinCode.ToUpper() == code);
            if (team == null)
            {
                return BadRequest(new { success = false, message = "Mã nhóm không hợp lệ hoặc nhóm không tồn tại." });
            }

            var cleanEmail = dto.UserEmail?.Trim().ToLowerInvariant() ?? "";
            var existingMember = await _db.Members.FirstOrDefaultAsync(m => m.Email.ToLower() == cleanEmail);
            if (existingMember != null)
            {
                return Ok(new
                {
                    success = true,
                    message = "Bạn đã có mặt trong nhóm này!",
                    member = existingMember,
                    roleType = existingMember.RoleType
                });
            }

            // Ai tham gia cũng là Thành viên
            var newMember = new TeamMember
            {
                Id = "m_" + Guid.NewGuid().ToString("N")[..8],
                Name = dto.UserName.Trim(),
                Email = cleanEmail,
                Role = "Thành viên",
                RoleType = "Member",
                Avatar = dto.UserName.Trim()[..Math.Min(2, dto.UserName.Trim().Length)].ToUpper(),
                Color = "#2563eb"
            };
            _db.Members.Add(newMember);

            _db.ActivityLogs.Add(new ActivityLog
            {
                Text = $"{newMember.Name} đã tham gia vào nhóm '{team.Name}' với tư cách Thành viên.",
                Time = "Vừa xong",
                Type = "member"
            });

            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Tham gia nhóm '{team.Name}' thành công!",
                member = newMember,
                roleType = "Member"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("state")]
    public async Task<IActionResult> GetState()
    {
        try
        {
            var team = await _db.Teams.FirstOrDefaultAsync();
            if (team == null)
            {
                team = new Team { Name = "Nhóm của tôi" };
                _db.Teams.Add(team);
                await _db.SaveChangesAsync();
            }

            var members = await _db.Members.Include(m => m.ScheduleSlots).ToListAsync();
            var tasks = await _db.Tasks.ToListAsync();
            var meetings = await _db.Meetings.ToListAsync();
            var reviews = await _db.PeerReviews.ToListAsync();
            var emails = await _db.EmailLogs.ToListAsync();
            var activities = await _db.ActivityLogs.OrderByDescending(a => a.Id).Take(15).ToListAsync();

            var schedules = new Dictionary<string, List<string>>();
            foreach (var m in members)
            {
                schedules[m.Id] = m.ScheduleSlots.Where(s => s.IsAvailable).Select(s => s.SlotKey).ToList();
            }

            return Ok(new
            {
                success = true,
                team = new
                {
                    name = team.Name,
                    topic = team.Topic ?? "",
                    subject = team.Subject ?? "",
                    classCode = team.ClassCode ?? "",
                    finalDeadline = team.FinalDeadline ?? "",
                    joinCode = team.JoinCode ?? "",
                    createdByEmail = team.CreatedByEmail ?? ""
                },
                members = members.Select(m => new
                {
                    id = m.Id,
                    name = m.Name,
                    email = m.Email,
                    role = m.Role,
                    roleType = string.Equals(m.RoleType, "Leader", StringComparison.OrdinalIgnoreCase) || (m.Role != null && m.Role.Contains("trưởng", StringComparison.OrdinalIgnoreCase)) ? "Leader" : "Member",
                    avatar = m.Avatar,
                    color = m.Color
                }),
                tasks = tasks.Select(t => new
                {
                    id = t.Id,
                    title = t.Title,
                    assigneeId = t.AssigneeId,
                    difficulty = t.Difficulty,
                    baseHours = t.BaseHours,
                    deadline = t.Deadline,
                    category = t.Category,
                    status = t.Status,
                    progress = t.Progress,
                    description = t.Description
                }),
                schedules,
                meetings = meetings.Select(m => new
                {
                    id = m.Id,
                    title = m.Title,
                    date = m.MeetingDate,
                    time = m.Time,
                    duration = m.DurationMinutes,
                    roomCode = m.RoomCode,
                    platform = m.Platform,
                    link = m.Link,
                    notes = m.Notes,
                    status = m.Status
                }),
                reviews = reviews.Select(r => new
                {
                    id = r.Id,
                    taskId = r.TaskId,
                    revieweeId = r.RevieweeId,
                    reviewerId = r.ReviewerId,
                    quality = r.Quality,
                    punctuality = r.Punctuality,
                    effort = r.Effort,
                    cooperation = r.Cooperation,
                    comment = r.Comment,
                    createdAt = r.CreatedAt
                }),
                emails = emails.Select(e => new
                {
                    id = e.Id,
                    to = e.ToEmail,
                    toName = e.ToName,
                    subject = e.Subject,
                    type = e.Type,
                    content = e.Content,
                    sentAt = e.SentAt
                }),
                activities = activities.Select(a => new
                {
                    time = a.Time,
                    text = a.Text,
                    type = a.Type
                })
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("save-state")]
    public async Task<IActionResult> SaveFullState([FromBody] SyncStateDto dto)
    {
        try
        {
            if (dto == null) return BadRequest("Dữ liệu rỗng");

            // Update Team
            var team = await _db.Teams.FirstOrDefaultAsync();
            if (team == null)
            {
                team = new Team();
                _db.Teams.Add(team);
            }
            if (dto.Team != null)
            {
                team.Name = dto.Team.Name ?? "Nhóm của tôi";
                team.Topic = dto.Team.Topic;
                team.Subject = dto.Team.Subject;
                team.ClassCode = dto.Team.ClassCode;
                team.FinalDeadline = dto.Team.FinalDeadline;
                if (!string.IsNullOrEmpty(dto.Team.JoinCode)) team.JoinCode = dto.Team.JoinCode;
                if (!string.IsNullOrEmpty(dto.Team.CreatedByEmail)) team.CreatedByEmail = dto.Team.CreatedByEmail;
            }

            // Sync Members
            var existingMembers = await _db.Members.Include(m => m.ScheduleSlots).ToListAsync();
            _db.Members.RemoveRange(existingMembers);

            if (dto.Members != null)
            {
                foreach (var m in dto.Members)
                {
                    var newMember = new TeamMember
                    {
                        Id = m.Id,
                        Name = m.Name,
                        Email = m.Email ?? "",
                        Role = m.Role ?? "Thành viên",
                        RoleType = !string.IsNullOrEmpty(m.RoleType) ? m.RoleType : ((m.Role != null && m.Role.Contains("trưởng", StringComparison.OrdinalIgnoreCase)) ? "Leader" : "Member"),
                        Password = !string.IsNullOrEmpty(m.Password) ? m.Password : "123456",
                        Avatar = m.Avatar ?? "TV",
                        Color = m.Color ?? "#2563eb"
                    };

                    if (dto.Schedules != null && dto.Schedules.TryGetValue(m.Id, out var slots))
                    {
                        foreach (var s in slots)
                        {
                            newMember.ScheduleSlots.Add(new ScheduleSlot
                            {
                                MemberId = m.Id,
                                SlotKey = s,
                                IsAvailable = true
                            });
                        }
                    }

                    _db.Members.Add(newMember);
                }
            }

            // Sync Tasks
            var existingTasks = await _db.Tasks.ToListAsync();
            _db.Tasks.RemoveRange(existingTasks);

            if (dto.Tasks != null)
            {
                foreach (var t in dto.Tasks)
                {
                    _db.Tasks.Add(new TeamTask
                    {
                        Id = t.Id,
                        Title = t.Title,
                        AssigneeId = t.AssigneeId,
                        Difficulty = t.Difficulty ?? "medium",
                        BaseHours = t.BaseHours > 0 ? t.BaseHours : 10,
                        Deadline = t.Deadline,
                        Category = t.Category ?? "Chung",
                        Status = t.Status ?? "todo",
                        Progress = t.Progress,
                        Description = t.Description
                    });
                }
            }

            // Sync Meetings
            var existingMeetings = await _db.Meetings.ToListAsync();
            _db.Meetings.RemoveRange(existingMeetings);

            if (dto.Meetings != null)
            {
                foreach (var mt in dto.Meetings)
                {
                    _db.Meetings.Add(new TeamMeeting
                    {
                        Id = mt.Id,
                        Title = mt.Title,
                        MeetingDate = mt.Date ?? "",
                        Time = mt.Time ?? "",
                        DurationMinutes = mt.Duration,
                        RoomCode = mt.RoomCode ?? "",
                        Platform = mt.Platform ?? "Phòng họp TeamFair ảo",
                        Link = mt.Link ?? "",
                        Notes = mt.Notes,
                        Status = mt.Status ?? "scheduled"
                    });
                }
            }

            // Sync Reviews
            var existingReviews = await _db.PeerReviews.ToListAsync();
            _db.PeerReviews.RemoveRange(existingReviews);

            if (dto.Reviews != null)
            {
                foreach (var r in dto.Reviews)
                {
                    _db.PeerReviews.Add(new PeerReview
                    {
                        Id = r.Id,
                        TaskId = r.TaskId,
                        RevieweeId = r.RevieweeId,
                        ReviewerId = r.ReviewerId,
                        Quality = r.Quality,
                        Punctuality = r.Punctuality,
                        Effort = r.Effort,
                        Cooperation = r.Cooperation,
                        Comment = r.Comment,
                        CreatedAt = r.CreatedAt ?? ""
                    });
                }
            }

            // Sync Emails
            var existingEmails = await _db.EmailLogs.ToListAsync();
            _db.EmailLogs.RemoveRange(existingEmails);

            if (dto.Emails != null)
            {
                foreach (var em in dto.Emails)
                {
                    _db.EmailLogs.Add(new EmailLog
                    {
                        Id = em.Id,
                        ToEmail = em.To ?? "",
                        ToName = em.ToName ?? "",
                        Subject = em.Subject ?? "",
                        Type = em.Type ?? "notification",
                        Content = em.Content ?? "",
                        SentAt = em.SentAt ?? ""
                    });
                }
            }

            // Sync Activities
            var existingActivities = await _db.ActivityLogs.ToListAsync();
            _db.ActivityLogs.RemoveRange(existingActivities);

            if (dto.Activities != null)
            {
                foreach (var act in dto.Activities.Take(20))
                {
                    _db.ActivityLogs.Add(new ActivityLog
                    {
                        Time = act.Time ?? "",
                        Text = act.Text ?? "",
                        Type = act.Type ?? "general"
                    });
                }
            }

            await _db.SaveChangesAsync();
            return Ok(new { success = true, message = "Đã đồng bộ cơ sở dữ liệu Azure SQL thành công!" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }
}

public class SyncStateDto
{
    public TeamDto? Team { get; set; }
    public List<MemberDto>? Members { get; set; }
    public List<TaskDto>? Tasks { get; set; }
    public Dictionary<string, List<string>>? Schedules { get; set; }
    public List<MeetingDto>? Meetings { get; set; }
    public List<ReviewDto>? Reviews { get; set; }
    public List<EmailDto>? Emails { get; set; }
    public List<ActivityDto>? Activities { get; set; }
}

public class RegisterDto
{
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class LoginDto
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class GoogleAuthDto
{
    public string Email { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? PhotoUrl { get; set; }
    public string? GoogleId { get; set; }
}

public class CreateTeamDto
{
    public string UserEmail { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;
    public string? Topic { get; set; }
    public string? Subject { get; set; }
    public string? ClassCode { get; set; }
    public string? FinalDeadline { get; set; }
}

public class JoinTeamDto
{
    public string UserEmail { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string JoinCode { get; set; } = string.Empty;
}

public class TeamDto
{
    public string? Name { get; set; }
    public string? Topic { get; set; }
    public string? Subject { get; set; }
    public string? ClassCode { get; set; }
    public string? FinalDeadline { get; set; }
    public string? JoinCode { get; set; }
    public string? CreatedByEmail { get; set; }
}

public class MemberDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Role { get; set; }
    public string? RoleType { get; set; }
    public string? Password { get; set; }
    public string? Avatar { get; set; }
    public string? Color { get; set; }
}

public class TaskDto
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? AssigneeId { get; set; }
    public string? Difficulty { get; set; }
    public int BaseHours { get; set; }
    public string? Deadline { get; set; }
    public string? Category { get; set; }
    public string? Status { get; set; }
    public int Progress { get; set; }
    public string? Description { get; set; }
}

public class MeetingDto
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Date { get; set; }
    public string? Time { get; set; }
    public int Duration { get; set; }
    public string? RoomCode { get; set; }
    public string? Platform { get; set; }
    public string? Link { get; set; }
    public string? Notes { get; set; }
    public string? Status { get; set; }
}

public class ReviewDto
{
    public string Id { get; set; } = string.Empty;
    public string TaskId { get; set; } = string.Empty;
    public string RevieweeId { get; set; } = string.Empty;
    public string ReviewerId { get; set; } = string.Empty;
    public int Quality { get; set; }
    public int Punctuality { get; set; }
    public int Effort { get; set; }
    public int Cooperation { get; set; }
    public string? Comment { get; set; }
    public string? CreatedAt { get; set; }
}

public class EmailDto
{
    public string Id { get; set; } = string.Empty;
    public string? To { get; set; }
    public string? ToName { get; set; }
    public string? Subject { get; set; }
    public string? Type { get; set; }
    public string? Content { get; set; }
    public string? SentAt { get; set; }
}

public class ActivityDto
{
    public string? Time { get; set; }
    public string? Text { get; set; }
    public string? Type { get; set; }
}
