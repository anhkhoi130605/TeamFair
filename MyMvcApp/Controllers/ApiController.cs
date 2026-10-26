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
    private readonly IConfiguration _config;

    public ApiController(AppDbContext db, ILogger<ApiController> logger, IConfiguration config)
    {
        _db = db;
        _logger = logger;
        _config = config;
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
    public async Task<IActionResult> ClearAllData([FromQuery] string? joinCode = null)
    {
        try
        {
            if (!string.IsNullOrEmpty(joinCode))
            {
                var cleanCode = joinCode.Trim().ToUpperInvariant();
                var team = await _db.Teams.FirstOrDefaultAsync(t => t.JoinCode != null && t.JoinCode.ToUpper() == cleanCode);
                if (team != null)
                {
                    var teamMembers = await _db.Members.Where(m => m.TeamId == team.Id).Include(m => m.ScheduleSlots).ToListAsync();
                    _db.Members.RemoveRange(teamMembers);
                    _db.Tasks.RemoveRange(await _db.Tasks.Where(t => t.TeamId == team.Id).ToListAsync());
                    _db.Meetings.RemoveRange(await _db.Meetings.Where(m => m.TeamId == team.Id).ToListAsync());
                    _db.ActivityLogs.RemoveRange(await _db.ActivityLogs.Where(a => a.TeamId == team.Id).ToListAsync());
                    _db.Teams.Remove(team);
                    await _db.SaveChangesAsync();
                    return Ok(new { success = true, message = $"Đã dọn sạch dữ liệu của nhóm '{team.Name}'!" });
                }
            }

            _db.PeerReviews.RemoveRange(await _db.PeerReviews.ToListAsync());
            _db.EmailLogs.RemoveRange(await _db.EmailLogs.ToListAsync());
            _db.ActivityLogs.RemoveRange(await _db.ActivityLogs.ToListAsync());
            _db.Tasks.RemoveRange(await _db.Tasks.ToListAsync());
            _db.Meetings.RemoveRange(await _db.Meetings.ToListAsync());
            _db.Members.RemoveRange(await _db.Members.Include(m => m.ScheduleSlots).ToListAsync());
            _db.Teams.RemoveRange(await _db.Teams.ToListAsync());

            await _db.SaveChangesAsync();
            return Ok(new { success = true, message = "Đã dọn sạch toàn bộ dữ liệu mẫu trên cơ sở dữ liệu!" });
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
                : (dto.Name.Trim().Length >= 2 ? dto.Name.Trim()[..2].ToUpper() : "TV");

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

            // Đăng ký mới: CHỈ TẠO USER, KHÔNG TỰ TẠO NHÓM
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
                },
                team = (object?)null
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

            // Tìm thông tin nhóm mà user này đang tham gia
            var member = await _db.Members
                .Where(m => m.Email.ToLower() == cleanEmail && m.TeamId != null)
                .OrderByDescending(m => m.CreatedAt)
                .FirstOrDefaultAsync();

            Team? team = null;
            if (member?.TeamId != null)
            {
                team = await _db.Teams.FirstOrDefaultAsync(t => t.Id == member.TeamId);
            }
            if (team == null)
            {
                team = await _db.Teams
                    .Where(t => t.CreatedByEmail != null && t.CreatedByEmail.ToLower() == cleanEmail)
                    .OrderByDescending(t => t.Id)
                    .FirstOrDefaultAsync();
            }

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
                },
                team = team != null ? new
                {
                    id = team.Id,
                    name = team.Name,
                    joinCode = team.JoinCode,
                    topic = team.Topic,
                    subject = team.Subject
                } : null
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

            var member = await _db.Members
                .Where(m => m.Email.ToLower() == cleanEmail && m.TeamId != null)
                .OrderByDescending(m => m.CreatedAt)
                .FirstOrDefaultAsync();

            Team? team = null;
            if (member?.TeamId != null)
            {
                team = await _db.Teams.FirstOrDefaultAsync(t => t.Id == member.TeamId);
            }
            if (team == null)
            {
                team = await _db.Teams
                    .Where(t => t.CreatedByEmail != null && t.CreatedByEmail.ToLower() == cleanEmail)
                    .OrderByDescending(t => t.Id)
                    .FirstOrDefaultAsync();
            }

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
                },
                team = team != null ? new
                {
                    id = team.Id,
                    name = team.Name,
                    joinCode = team.JoinCode,
                    topic = team.Topic,
                    subject = team.Subject
                } : null
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

            var cleanEmail = dto.UserEmail?.Trim().ToLowerInvariant() ?? "";
            var joinCode = "TF-" + Random.Shared.Next(1000, 9999).ToString();

            // TẠO NHÓM MỚI, KHÔNG ĐÈ HOẶC XÓA NHÓM CỦA NGƯỜI KHÁC
            var team = new Team
            {
                Name = dto.TeamName.Trim(),
                Topic = dto.Topic?.Trim() ?? "",
                Subject = dto.Subject?.Trim() ?? "",
                ClassCode = dto.ClassCode?.Trim() ?? "",
                FinalDeadline = dto.FinalDeadline?.Trim() ?? "",
                CreatedByEmail = cleanEmail,
                JoinCode = joinCode,
                CreatedAt = DateTime.UtcNow
            };
            _db.Teams.Add(team);
            await _db.SaveChangesAsync();

            // Người tạo là Nhóm Trưởng (TeamId = team.Id)
            var leaderMember = new TeamMember
            {
                Id = "m_" + Guid.NewGuid().ToString("N")[..8],
                TeamId = team.Id,
                Name = string.IsNullOrWhiteSpace(dto.UserName) ? "Trưởng Nhóm" : dto.UserName.Trim(),
                Email = cleanEmail,
                Role = "Trưởng nhóm",
                RoleType = "Leader",
                Avatar = string.IsNullOrWhiteSpace(dto.UserName) ? "TN" : dto.UserName.Trim()[..Math.Min(2, dto.UserName.Trim().Length)].ToUpper(),
                Color = "#059669",
                CreatedAt = DateTime.UtcNow
            };
            _db.Members.Add(leaderMember);

            // Log hoạt động gắn với TeamId để không bị rò rỉ sang nhóm khác
            _db.ActivityLogs.Add(new ActivityLog
            {
                TeamId = team.Id,
                Text = $"{leaderMember.Name} đã tạo nhóm '{team.Name}' (Mã nhóm: {joinCode}) và trở thành 👑 Nhóm Trưởng.",
                Time = "Vừa xong",
                Type = "team",
                CreatedAt = DateTime.UtcNow
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
            if (string.IsNullOrEmpty(code))
            {
                return BadRequest(new { success = false, message = "Vui lòng nhập mã nhóm mời." });
            }

            var team = await _db.Teams.FirstOrDefaultAsync(t => t.JoinCode != null && t.JoinCode.ToUpper() == code);
            if (team == null)
            {
                return BadRequest(new { success = false, message = $"Mã nhóm '{code}' không tồn tại hoặc đã hết hạn." });
            }

            var cleanEmail = dto.UserEmail?.Trim().ToLowerInvariant() ?? "";
            var cleanName = !string.IsNullOrWhiteSpace(dto.UserName) ? dto.UserName.Trim() : (cleanEmail.Contains('@') ? cleanEmail.Split('@')[0] : "Thành viên");

            // Kiểm tra xem đã có mặt trong nhóm NÀY chưa
            var existingMember = await _db.Members.FirstOrDefaultAsync(m => m.TeamId == team.Id && m.Email.ToLower() == cleanEmail);
            if (existingMember != null)
            {
                return Ok(new
                {
                    success = true,
                    message = $"Bạn đã là thành viên trong nhóm '{team.Name}'!",
                    member = existingMember,
                    roleType = existingMember.RoleType,
                    team = new
                    {
                        id = team.Id,
                        name = team.Name,
                        joinCode = team.JoinCode,
                        topic = team.Topic,
                        subject = team.Subject
                    }
                });
            }

            var words = cleanName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var avatar = words.Length >= 2
                ? (words[0][0].ToString() + words[^1][0].ToString()).ToUpper()
                : (cleanName.Length >= 2 ? cleanName[..2].ToUpper() : "TV");

            string[] colors = { "#2563eb", "#059669", "#7c3aed", "#ea580c", "#0891b2", "#db2777" };
            var color = colors[Math.Abs(cleanEmail.GetHashCode()) % colors.Length];

            // Thêm mới thành viên và GẮN ĐÚNG TeamId = team.Id
            var newMember = new TeamMember
            {
                Id = "m_" + Guid.NewGuid().ToString("N")[..8],
                TeamId = team.Id,
                Name = cleanName,
                Email = cleanEmail,
                Role = "Thành viên",
                RoleType = "Member",
                Avatar = avatar,
                Color = color,
                CreatedAt = DateTime.UtcNow
            };
            _db.Members.Add(newMember);

            _db.ActivityLogs.Add(new ActivityLog
            {
                TeamId = team.Id,
                Text = $"{newMember.Name} đã tham gia vào nhóm '{team.Name}' với tư cách Thành viên.",
                Time = "Vừa xong",
                Type = "member",
                CreatedAt = DateTime.UtcNow
            });

            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Tham gia nhóm '{team.Name}' thành công!",
                member = newMember,
                roleType = "Member",
                team = new
                {
                    id = team.Id,
                    name = team.Name,
                    joinCode = team.JoinCode,
                    topic = team.Topic,
                    subject = team.Subject
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("state")]
    public async Task<IActionResult> GetState([FromQuery] string? userEmail = null, [FromQuery] string? joinCode = null)
    {
        try
        {
            Team? team = null;
            var cleanEmail = userEmail?.Trim().ToLowerInvariant();
            var cleanCode = joinCode?.Trim().ToUpperInvariant();

            if (!string.IsNullOrEmpty(cleanCode))
            {
                team = await _db.Teams.FirstOrDefaultAsync(t => t.JoinCode != null && t.JoinCode.ToUpper() == cleanCode);
            }

            if (team == null && !string.IsNullOrEmpty(cleanEmail))
            {
                var member = await _db.Members
                    .Where(m => m.Email.ToLower() == cleanEmail && m.TeamId != null)
                    .OrderByDescending(m => m.CreatedAt)
                    .FirstOrDefaultAsync();

                if (member?.TeamId != null)
                {
                    team = await _db.Teams.FirstOrDefaultAsync(t => t.Id == member.TeamId);
                }

                if (team == null)
                {
                    team = await _db.Teams
                        .Where(t => t.CreatedByEmail != null && t.CreatedByEmail.ToLower() == cleanEmail)
                        .OrderByDescending(t => t.Id)
                        .FirstOrDefaultAsync();
                }
            }

            // Nếu user chưa vào nhóm nào: KHÔNG TỰ TẠO NHÓM MẪU! Trả về team = null
            if (team == null)
            {
                return Ok(new
                {
                    success = true,
                    team = (object?)null,
                    members = Array.Empty<object>(),
                    tasks = Array.Empty<object>(),
                    schedules = new Dictionary<string, List<string>>(),
                    meetings = Array.Empty<object>(),
                    reviews = Array.Empty<object>(),
                    emails = Array.Empty<object>(),
                    activities = Array.Empty<object>()
                });
            }

            // Lấy dữ liệu CHỈ THUỘC VỀ TEAM NÀY (Độc lập, không lẫn lộn với nhóm khác)
            var members = await _db.Members
                .Where(m => m.TeamId == team.Id)
                .Include(m => m.ScheduleSlots)
                .ToListAsync();

            var tasks = await _db.Tasks
                .Where(t => t.TeamId == team.Id)
                .ToListAsync();

            var meetings = await _db.Meetings
                .Where(m => m.TeamId == team.Id)
                .ToListAsync();

            var activities = await _db.ActivityLogs
                .Where(a => a.TeamId == team.Id)
                .OrderByDescending(a => a.Id)
                .Take(20)
                .ToListAsync();

            var memberIds = members.Select(m => m.Id).ToHashSet();
            var taskIds = tasks.Select(t => t.Id).ToHashSet();

            var reviews = await _db.PeerReviews
                .Where(r => taskIds.Contains(r.TaskId) || memberIds.Contains(r.RevieweeId))
                .ToListAsync();

            var emails = await _db.EmailLogs
                .Where(e => memberIds.Contains(e.ToEmail) || (cleanEmail != null && e.ToEmail.ToLower() == cleanEmail))
                .OrderByDescending(e => e.Id)
                .Take(25)
                .ToListAsync();

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
                    id = team.Id,
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
                    description = t.Description,
                    reminderTiming = t.ReminderTiming ?? "1_day",
                    reminderCustomDateTime = t.ReminderCustomDateTime,
                    reminderSent = t.ReminderSent
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
    public async Task<IActionResult> SaveFullState([FromBody] SyncStateDto dto, [FromQuery] string? userEmail = null)
    {
        try
        {
            if (dto == null) return BadRequest("Dữ liệu rỗng");

            var cleanEmail = userEmail?.Trim().ToLowerInvariant() 
                ?? dto.Team?.CreatedByEmail?.Trim().ToLowerInvariant();

            Team? team = null;

            if (!string.IsNullOrEmpty(dto.Team?.JoinCode))
            {
                var cleanCode = dto.Team.JoinCode.Trim().ToUpperInvariant();
                team = await _db.Teams.FirstOrDefaultAsync(t => t.JoinCode != null && t.JoinCode.ToUpper() == cleanCode);
            }

            if (team == null && !string.IsNullOrEmpty(cleanEmail))
            {
                var member = await _db.Members
                    .Where(m => m.Email.ToLower() == cleanEmail && m.TeamId != null)
                    .OrderByDescending(m => m.CreatedAt)
                    .FirstOrDefaultAsync();

                if (member?.TeamId != null)
                {
                    team = await _db.Teams.FirstOrDefaultAsync(t => t.Id == member.TeamId);
                }

                if (team == null)
                {
                    team = await _db.Teams
                        .Where(t => t.CreatedByEmail != null && t.CreatedByEmail.ToLower() == cleanEmail)
                        .OrderByDescending(t => t.Id)
                        .FirstOrDefaultAsync();
                }
            }

            if (team == null)
            {
                team = new Team
                {
                    Name = dto.Team?.Name ?? "Nhóm của tôi",
                    Topic = dto.Team?.Topic,
                    Subject = dto.Team?.Subject,
                    ClassCode = dto.Team?.ClassCode,
                    FinalDeadline = dto.Team?.FinalDeadline,
                    JoinCode = !string.IsNullOrEmpty(dto.Team?.JoinCode) ? dto.Team.JoinCode : ("TF-" + Random.Shared.Next(1000, 9999)),
                    CreatedByEmail = cleanEmail
                };
                _db.Teams.Add(team);
                await _db.SaveChangesAsync();
            }
            else
            {
                if (dto.Team != null)
                {
                    if (!string.IsNullOrEmpty(dto.Team.Name)) team.Name = dto.Team.Name;
                    team.Topic = dto.Team.Topic;
                    team.Subject = dto.Team.Subject;
                    team.ClassCode = dto.Team.ClassCode;
                    team.FinalDeadline = dto.Team.FinalDeadline;
                }
            }

            // CHỈ ĐỒNG BỘ THÀNH VIÊN THUỘC VỀ TEAM NÀY
            var teamMembers = await _db.Members
                .Where(m => m.TeamId == team.Id)
                .Include(m => m.ScheduleSlots)
                .ToListAsync();
            _db.Members.RemoveRange(teamMembers);

            if (dto.Members != null)
            {
                foreach (var m in dto.Members)
                {
                    var newMember = new TeamMember
                    {
                        Id = !string.IsNullOrEmpty(m.Id) ? m.Id : ("m_" + Guid.NewGuid().ToString("N")[..8]),
                        TeamId = team.Id,
                        Name = m.Name,
                        Email = m.Email ?? "",
                        Role = m.Role ?? "Thành viên",
                        RoleType = !string.IsNullOrEmpty(m.RoleType) ? m.RoleType : ((m.Role != null && m.Role.Contains("trưởng", StringComparison.OrdinalIgnoreCase)) ? "Leader" : "Member"),
                        Password = !string.IsNullOrEmpty(m.Password) ? m.Password : "123456",
                        Avatar = m.Avatar ?? "TV",
                        Color = m.Color ?? "#2563eb",
                        CreatedAt = DateTime.UtcNow
                    };

                    if (dto.Schedules != null && dto.Schedules.TryGetValue(m.Id, out var slots))
                    {
                        foreach (var s in slots)
                        {
                            newMember.ScheduleSlots.Add(new ScheduleSlot
                            {
                                MemberId = newMember.Id,
                                SlotKey = s,
                                IsAvailable = true
                            });
                        }
                    }

                    _db.Members.Add(newMember);
                }
            }

            // CHỈ ĐỒNG BỘ TASKS THUỘC TEAM NÀY
            var teamTasks = await _db.Tasks.Where(t => t.TeamId == team.Id).ToListAsync();
            _db.Tasks.RemoveRange(teamTasks);

            if (dto.Tasks != null)
            {
                foreach (var t in dto.Tasks)
                {
                    _db.Tasks.Add(new TeamTask
                    {
                        Id = !string.IsNullOrEmpty(t.Id) ? t.Id : ("task_" + Guid.NewGuid().ToString("N")[..8]),
                        TeamId = team.Id,
                        Title = t.Title,
                        AssigneeId = t.AssigneeId,
                        Difficulty = t.Difficulty ?? "medium",
                        BaseHours = t.BaseHours > 0 ? t.BaseHours : 10,
                        Deadline = t.Deadline,
                        Category = t.Category ?? "Chung",
                        Status = t.Status ?? "todo",
                        Progress = t.Progress,
                        Description = t.Description,
                        ReminderTiming = t.ReminderTiming ?? "1_day",
                        ReminderCustomDateTime = t.ReminderCustomDateTime,
                        ReminderSent = t.ReminderSent,
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }

            // CHỈ ĐỒNG BỘ MEETINGS THUỘC TEAM NÀY
            var teamMeetings = await _db.Meetings.Where(m => m.TeamId == team.Id).ToListAsync();
            _db.Meetings.RemoveRange(teamMeetings);

            if (dto.Meetings != null)
            {
                foreach (var mt in dto.Meetings)
                {
                    _db.Meetings.Add(new TeamMeeting
                    {
                        Id = !string.IsNullOrEmpty(mt.Id) ? mt.Id : ("meet_" + Guid.NewGuid().ToString("N")[..8]),
                        TeamId = team.Id,
                        Title = mt.Title,
                        MeetingDate = mt.Date ?? "",
                        Time = mt.Time ?? "",
                        DurationMinutes = mt.Duration > 0 ? mt.Duration : 60,
                        RoomCode = mt.RoomCode ?? "",
                        Platform = mt.Platform ?? "Phòng họp TeamFair ảo",
                        Link = mt.Link ?? "",
                        Notes = mt.Notes,
                        Status = mt.Status ?? "scheduled",
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }

            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = "Đã đồng bộ dữ liệu nhóm lên máy chủ thành công!",
                teamId = team.Id,
                joinCode = team.JoinCode
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("email/send")]
    public async Task<IActionResult> SendEmail([FromBody] SendEmailRequestDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.To))
            {
                return BadRequest(new { success = false, message = "Email người nhận không hợp lệ." });
            }

            var cleanTo = dto.To.Trim();
            var newLog = new EmailLog
            {
                Id = "em" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                ToEmail = cleanTo,
                ToName = !string.IsNullOrWhiteSpace(dto.ToName) ? dto.ToName.Trim() : cleanTo.Split('@')[0],
                Subject = !string.IsNullOrWhiteSpace(dto.Subject) ? dto.Subject.Trim() : "[TeamFair] Thông báo từ hệ thống",
                Type = dto.Type ?? "notification",
                Content = dto.Content ?? "",
                SentAt = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm")
            };

            _db.EmailLogs.Add(newLog);
            await _db.SaveChangesAsync();

            var smtpHost = _config["EmailSettings:SmtpHost"];
            var smtpPortStr = _config["EmailSettings:SmtpPort"];
            var smtpUser = _config["EmailSettings:SmtpUser"];
            var smtpPass = _config["EmailSettings:SmtpPass"];

            bool smtpSent = false;
            string? smtpError = null;

            if (!string.IsNullOrEmpty(smtpHost) && !string.IsNullOrEmpty(smtpUser) && !string.IsNullOrEmpty(smtpPass))
            {
                try
                {
                    int.TryParse(smtpPortStr, out var port);
                    if (port == 0) port = 587;
                    using var client = new System.Net.Mail.SmtpClient(smtpHost.Trim(), port)
                    {
                        UseDefaultCredentials = false,
                        Credentials = new System.Net.NetworkCredential(smtpUser.Trim(), smtpPass.Trim().Replace(" ", "")),
                        EnableSsl = true,
                        DeliveryMethod = System.Net.Mail.SmtpDeliveryMethod.Network
                    };
                    using var mailMsg = new System.Net.Mail.MailMessage
                    {
                        From = new System.Net.Mail.MailAddress(smtpUser.Trim(), "TeamFair Platform"),
                        Subject = newLog.Subject,
                        Body = newLog.Content,
                        IsBodyHtml = false
                    };
                    mailMsg.To.Add(newLog.ToEmail);
                    await client.SendMailAsync(mailMsg);
                    smtpSent = true;
                }
                catch (Exception smtpEx)
                {
                    smtpError = smtpEx.Message;
                    _logger.LogError(smtpEx, "Lỗi gửi email SMTP đến {Email}", newLog.ToEmail);
                }
            }

            return Ok(new
            {
                success = true,
                smtpSent,
                smtpError,
                message = smtpSent ? "Đã gửi email SMTP thành công!" : "Đã lưu thông báo nội bộ.",
                email = new
                {
                    id = newLog.Id,
                    to = newLog.ToEmail,
                    toName = newLog.ToName,
                    subject = newLog.Subject,
                    type = newLog.Type,
                    content = newLog.Content,
                    sentAt = newLog.SentAt
                }
            });
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
    public int? Id { get; set; }
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
    public string? ReminderTiming { get; set; }
    public string? ReminderCustomDateTime { get; set; }
    public bool ReminderSent { get; set; }
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

public class SendEmailRequestDto
{
    public string To { get; set; } = string.Empty;
    public string? ToName { get; set; }
    public string? Subject { get; set; }
    public string? Type { get; set; } = "notification";
    public string? Content { get; set; }
}

public class ActivityDto
{
    public string? Time { get; set; }
    public string? Text { get; set; }
    public string? Type { get; set; }
}
