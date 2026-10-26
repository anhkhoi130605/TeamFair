using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyMvcApp.Data;
using MyMvcApp.Models;

namespace MyMvcApp.Controllers;

public class EventController : Controller
{
    private readonly AppDbContext _db;
    private readonly ILogger<EventController> _logger;

    public EventController(AppDbContext db, ILogger<EventController> logger)
    {
        _db = db;
        _logger = logger;
    }

    [HttpGet("/event")]
    [HttpGet("/events")]
    [HttpGet("/events/create")]
    public IActionResult Create()
    {
        return View();
    }

    [HttpGet("/event/{code}")]
    public async Task<IActionResult> Details(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
            return RedirectToAction(nameof(Create));

        var cleanCode = code.Trim().ToLowerInvariant();
        var evt = await _db.ScheduleEvents.FirstOrDefaultAsync(e => e.Id.ToLower() == cleanCode);
        if (evt == null)
        {
            ViewBag.ErrorMessage = $"Không tìm thấy sự kiện với mã: {code}";
            return View("NotFound");
        }

        ViewBag.Event = evt;
        return View(evt);
    }

    // ==========================================
    // API ENDPOINTS FOR WHEN2MEET SCHEDULER
    // ==========================================

    public class CreateEventDto
    {
        public string Name { get; set; } = string.Empty;
        public List<string> Dates { get; set; } = new();
        public int StartHour { get; set; } = 8;
        public int EndHour { get; set; } = 22;
        public int SlotMinutes { get; set; } = 30;
        public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";
    }

    [HttpPost("/api/events/create")]
    public async Task<IActionResult> CreateEventApi([FromBody] CreateEventDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(new { success = false, message = "Vui lòng nhập tên sự kiện." });

        if (dto.Dates == null || dto.Dates.Count == 0)
            return BadRequest(new { success = false, message = "Vui lòng chọn ít nhất một ngày." });

        if (dto.StartHour < 0 || dto.StartHour > 23 || dto.EndHour <= dto.StartHour || dto.EndHour > 24)
            return BadRequest(new { success = false, message = "Khung giờ bắt đầu và kết thúc không hợp lệ." });

        // Generate unique 8-character alphanumeric code
        string code;
        int attempts = 0;
        do
        {
            code = GenerateShortCode(8);
            attempts++;
            if (attempts > 10)
            {
                code = Guid.NewGuid().ToString("N")[..8];
                break;
            }
        } while (await _db.ScheduleEvents.AnyAsync(e => e.Id == code));

        var evt = new ScheduleEvent
        {
            Id = code,
            Name = dto.Name.Trim(),
            DatesJson = JsonSerializer.Serialize(dto.Dates),
            StartHour = dto.StartHour,
            EndHour = dto.EndHour,
            SlotMinutes = dto.SlotMinutes <= 15 ? 15 : 30,
            TimeZone = string.IsNullOrWhiteSpace(dto.TimeZone) ? "Asia/Ho_Chi_Minh" : dto.TimeZone.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.ScheduleEvents.Add(evt);
        await _db.SaveChangesAsync();

        var baseUrl = $"{Request.Scheme}://{Request.Host}";
        var eventUrl = $"/event/{code}";

        return Ok(new
        {
            success = true,
            eventCode = code,
            url = eventUrl,
            fullUrl = $"{baseUrl}{eventUrl}"
        });
    }

    [HttpGet("/api/events/{code}")]
    public async Task<IActionResult> GetEventApi(string code)
    {
        var cleanCode = code.Trim().ToLowerInvariant();
        var evt = await _db.ScheduleEvents
            .Include(e => e.Participants)
            .FirstOrDefaultAsync(e => e.Id.ToLower() == cleanCode);

        if (evt == null)
            return NotFound(new { success = false, message = "Không tìm thấy sự kiện." });

        var dates = JsonSerializer.Deserialize<List<string>>(evt.DatesJson) ?? new List<string>();

        var availabilities = await _db.EventAvailabilities
            .Where(a => a.EventId == evt.Id && a.IsAvailable)
            .Select(a => new
            {
                participantId = a.ParticipantId,
                slotKey = a.SlotKey
            })
            .ToListAsync();

        return Ok(new
        {
            success = true,
            id = evt.Id,
            name = evt.Name,
            dates = dates,
            startHour = evt.StartHour,
            endHour = evt.EndHour,
            slotMinutes = evt.SlotMinutes,
            timeZone = evt.TimeZone,
            participants = evt.Participants.Select(p => new
            {
                id = p.Id,
                name = p.Name,
                hasPassword = !string.IsNullOrEmpty(p.PasswordHash)
            }).ToList(),
            availabilities = availabilities
        });
    }

    public class SignInDto
    {
        public string Name { get; set; } = string.Empty;
        public string? Password { get; set; }
    }

    [HttpPost("/api/events/{code}/signin")]
    public async Task<IActionResult> SignInParticipant(string code, [FromBody] SignInDto dto)
    {
        var cleanCode = code.Trim().ToLowerInvariant();
        var evt = await _db.ScheduleEvents.FirstOrDefaultAsync(e => e.Id.ToLower() == cleanCode);
        if (evt == null)
            return NotFound(new { success = false, message = "Không tìm thấy sự kiện." });

        var cleanName = dto?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(cleanName))
            return BadRequest(new { success = false, message = "Vui lòng nhập tên của bạn." });

        var participant = await _db.EventParticipants
            .FirstOrDefaultAsync(p => p.EventId == evt.Id && p.Name.ToLower() == cleanName.ToLower());

        if (participant != null)
        {
            // Verify password if protected
            if (!string.IsNullOrEmpty(participant.PasswordHash))
            {
                if (string.IsNullOrEmpty(dto.Password))
                {
                    return Ok(new
                    {
                        success = false,
                        requirePassword = true,
                        message = "Tên này đã được đặt mật khẩu. Vui lòng nhập mật khẩu để tiếp tục."
                    });
                }

                var inputHash = HashPassword(dto.Password);
                if (!string.IsNullOrEmpty(participant.PasswordHash) && participant.PasswordHash != inputHash)
                {
                    return Ok(new
                    {
                        success = false,
                        requirePassword = true,
                        message = "Mật khẩu không chính xác."
                    });
                }
            }
            else if (!string.IsNullOrEmpty(dto.Password))
            {
                if (!string.IsNullOrEmpty(dto.Password)) participant.PasswordHash = HashPassword(dto.Password);
                await _db.SaveChangesAsync();
            }

            var slots = await _db.EventAvailabilities
                .Where(a => a.EventId == evt.Id && a.ParticipantId == participant.Id && a.IsAvailable)
                .Select(a => a.SlotKey)
                .ToListAsync();

            return Ok(new
            {
                success = true,
                participant = new
                {
                    id = participant.Id,
                    name = participant.Name,
                    hasPassword = !string.IsNullOrEmpty(participant.PasswordHash)
                },
                slots = slots
            });
        }
        else
        {
            var newParticipant = new EventParticipant
            {
                Id = Guid.NewGuid().ToString("N"),
                EventId = evt.Id,
                Name = cleanName,
                PasswordHash = !string.IsNullOrEmpty(dto?.Password) ? HashPassword(dto.Password) : null,
                CreatedAt = DateTime.UtcNow
            };

            _db.EventParticipants.Add(newParticipant);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                participant = new
                {
                    id = newParticipant.Id,
                    name = newParticipant.Name,
                    hasPassword = !string.IsNullOrEmpty(newParticipant.PasswordHash)
                },
                slots = new List<string>()
            });
        }
    }

    public class SaveAvailabilityDto
    {
        public string ParticipantId { get; set; } = string.Empty;
        public List<string> SlotKeys { get; set; } = new();
    }

    [HttpPost("/api/events/{code}/availability")]
    public async Task<IActionResult> SaveAvailability(string code, [FromBody] SaveAvailabilityDto dto)
    {
        var cleanCode = code.Trim().ToLowerInvariant();
        var evt = await _db.ScheduleEvents.FirstOrDefaultAsync(e => e.Id.ToLower() == cleanCode);
        if (evt == null)
            return NotFound(new { success = false, message = "Không tìm thấy sự kiện." });

        if (string.IsNullOrWhiteSpace(dto.ParticipantId))
            return BadRequest(new { success = false, message = "Thiếu thông tin người tham gia." });

        var participant = await _db.EventParticipants
            .FirstOrDefaultAsync(p => p.Id == dto.ParticipantId && p.EventId == evt.Id);

        if (participant == null)
            return NotFound(new { success = false, message = "Người tham gia không hợp lệ." });

        var oldSlots = await _db.EventAvailabilities
            .Where(a => a.EventId == evt.Id && a.ParticipantId == participant.Id)
            .ToListAsync();

        if (oldSlots.Count > 0)
        {
            _db.EventAvailabilities.RemoveRange(oldSlots);
        }

        var distinctKeys = dto.SlotKeys?.Where(k => !string.IsNullOrWhiteSpace(k)).Distinct().ToList() ?? new List<string>();
        foreach (var key in distinctKeys)
        {
            _db.EventAvailabilities.Add(new EventAvailability
            {
                EventId = evt.Id,
                ParticipantId = participant.Id,
                SlotKey = key.Trim(),
                IsAvailable = true
            });
        }

        await _db.SaveChangesAsync();

        return Ok(new { success = true, savedCount = distinctKeys.Count });
    }

    private static string GenerateShortCode(int length)
    {
        const string chars = "abcdefghjkmnpqrstuvwxyz23456789";
        var bytes = new byte[length];
        RandomNumberGenerator.Fill(bytes);
        var sb = new StringBuilder(length);
        foreach (var b in bytes)
        {
            sb.Append(chars[b % chars.Length]);
        }
        return sb.ToString();
    }

    private static string HashPassword(string password)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(password));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
