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
            }
            await _db.SaveChangesAsync();
            return Ok(new { success = true, message = "Đã dọn sạch toàn bộ mock data trên Azure SQL Database!" });
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
                    finalDeadline = team.FinalDeadline ?? ""
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

public class TeamDto
{
    public string? Name { get; set; }
    public string? Topic { get; set; }
    public string? Subject { get; set; }
    public string? ClassCode { get; set; }
    public string? FinalDeadline { get; set; }
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
