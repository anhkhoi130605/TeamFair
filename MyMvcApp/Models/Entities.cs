using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace MyMvcApp.Models;

public class Team
{
    [Key]
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = "Nhóm của tôi";

    [MaxLength(250)]
    public string? Topic { get; set; }

    [MaxLength(200)]
    public string? Subject { get; set; }

    [MaxLength(100)]
    public string? ClassCode { get; set; }

    [MaxLength(50)]
    public string? FinalDeadline { get; set; }

    [MaxLength(50)]
    public string? JoinCode { get; set; }

    [MaxLength(200)]
    public string? CreatedByEmail { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<TeamMember> Members { get; set; } = new();
    public List<TeamTask> Tasks { get; set; } = new();
    public List<TeamMeeting> Meetings { get; set; } = new();
}

public class AppUser
{
    [Key]
    public int Id { get; set; }

    [Required]
    [MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string Password { get; set; } = string.Empty;

    [MaxLength(10)]
    public string Avatar { get; set; } = "TV";

    [MaxLength(20)]
    public string Color { get; set; } = "#2563eb";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class TeamMember
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    public int? TeamId { get; set; }

    [Required]
    [MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(200)]
    public string Email { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Role { get; set; } = "Thành viên";

    [MaxLength(10)]
    public string Avatar { get; set; } = "TV";

    [MaxLength(20)]
    public string Color { get; set; } = "#2563eb";

    [MaxLength(50)]
    public string RoleType { get; set; } = "Member"; // "Leader" hoặc "Member"

    [MaxLength(100)]
    public string Password { get; set; } = "123456";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<ScheduleSlot> ScheduleSlots { get; set; } = new();
}

public class TeamTask
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    public int? TeamId { get; set; }

    [Required]
    [MaxLength(300)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? AssigneeId { get; set; }

    [MaxLength(20)]
    public string Difficulty { get; set; } = "medium";

    public int BaseHours { get; set; } = 10;

    [MaxLength(50)]
    public string? Deadline { get; set; }

    [MaxLength(100)]
    public string Category { get; set; } = "Chung";

    [MaxLength(20)]
    public string Status { get; set; } = "todo";

    public int Progress { get; set; } = 0;

    public string? Description { get; set; }

    [MaxLength(50)]
    public string? ReminderTiming { get; set; } = "1_day";

    [MaxLength(50)]
    public string? ReminderCustomDateTime { get; set; }

    public bool ReminderSent { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ScheduleSlot
{
    [Key]
    public int Id { get; set; }

    [Required]
    [MaxLength(50)]
    public string MemberId { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string SlotKey { get; set; } = string.Empty; // e.g. "0_0", "2_2"

    public bool IsAvailable { get; set; } = true;
}

public class TeamMeeting
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    public int? TeamId { get; set; }

    [Required]
    [MaxLength(250)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(50)]
    public string MeetingDate { get; set; } = string.Empty;

    [MaxLength(20)]
    public string Time { get; set; } = string.Empty;

    public int DurationMinutes { get; set; } = 60;

    [MaxLength(50)]
    public string RoomCode { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Platform { get; set; } = "Phòng họp TeamFair ảo";

    [MaxLength(500)]
    public string Link { get; set; } = string.Empty;

    public string? Notes { get; set; }

    [MaxLength(30)]
    public string Status { get; set; } = "scheduled";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class PeerReview
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [Required]
    [MaxLength(50)]
    public string TaskId { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string RevieweeId { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string ReviewerId { get; set; } = string.Empty;

    public int Quality { get; set; } = 5;

    public int Punctuality { get; set; } = 5;

    public int Effort { get; set; } = 5;

    public int Cooperation { get; set; } = 5;

    public string? Comment { get; set; }

    [MaxLength(50)]
    public string CreatedAt { get; set; } = string.Empty;
}

public class EmailLog
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [MaxLength(200)]
    public string ToEmail { get; set; } = string.Empty;

    [MaxLength(150)]
    public string ToName { get; set; } = string.Empty;

    [MaxLength(300)]
    public string Subject { get; set; } = string.Empty;

    [MaxLength(50)]
    public string Type { get; set; } = "notification";

    public string Content { get; set; } = string.Empty;

    [MaxLength(50)]
    public string SentAt { get; set; } = string.Empty;
}

public class ActivityLog
{
    [Key]
    public int Id { get; set; }

    public int? TeamId { get; set; }

    [MaxLength(50)]
    public string Time { get; set; } = string.Empty;

    [MaxLength(500)]
    public string Text { get; set; } = string.Empty;

    [MaxLength(50)]
    public string Type { get; set; } = "general";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}


public class ScheduleEvent
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];

    [Required]
    [MaxLength(250)]
    public string Name { get; set; } = string.Empty;

    public string DatesJson { get; set; } = "[]";

    public int StartHour { get; set; } = 8; // 8 AM

    public int EndHour { get; set; } = 22; // 10 PM

    public int SlotMinutes { get; set; } = 30;

    [MaxLength(100)]
    public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";

    [MaxLength(200)]
    public string? CreatedByEmail { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<EventParticipant> Participants { get; set; } = new();
}

public class EventParticipant
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [Required]
    [MaxLength(50)]
    public string EventId { get; set; } = string.Empty;

    [Required]
    [MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(250)]
    public string? PasswordHash { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<EventAvailability> Availabilities { get; set; } = new();
}

public class EventAvailability
{
    [Key]
    public int Id { get; set; }

    [Required]
    [MaxLength(50)]
    public string EventId { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string ParticipantId { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string SlotKey { get; set; } = string.Empty;

    public bool IsAvailable { get; set; } = true;
}
