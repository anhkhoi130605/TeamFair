using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyMvcApp.Data;
using MyMvcApp.Models;

namespace MyMvcApp.Controllers;

public class AuthController : Controller
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthController> _logger;

    public AuthController(AppDbContext db, IConfiguration config, ILogger<AuthController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    [HttpGet("auth/google-login")]
    public IActionResult GoogleLogin(string? returnUrl = "/")
    {
        var redirectUrl = Url.Action(nameof(GoogleCallback), "Auth", new { returnUrl });
        var properties = new AuthenticationProperties { RedirectUri = redirectUrl };
        return Challenge(properties, GoogleDefaults.AuthenticationScheme);
    }

    [HttpGet("auth/google-callback")]
    public async Task<IActionResult> GoogleCallback(string? returnUrl = "/")
    {
        try
        {
            var authenticateResult = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            if (!authenticateResult.Succeeded || authenticateResult.Principal == null)
            {
                _logger.LogWarning("Google OAuth authentication failed or principal is null.");
                return Redirect("/?auth_error=google_failed");
            }

            var claims = authenticateResult.Principal.Identities.FirstOrDefault()?.Claims;
            var emailClaim = claims?.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value;
            var nameClaim = claims?.FirstOrDefault(c => c.Type == ClaimTypes.Name)?.Value 
                            ?? claims?.FirstOrDefault(c => c.Type == "name")?.Value 
                            ?? emailClaim?.Split('@')[0] 
                            ?? "Google User";

            if (string.IsNullOrWhiteSpace(emailClaim))
            {
                _logger.LogWarning("Google OAuth returned no email claim.");
                return Redirect("/?auth_error=no_email");
            }

            var cleanEmail = emailClaim.Trim().ToLowerInvariant();

            // Lưu/cập nhật tài khoản người dùng vào Azure SQL Database
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == cleanEmail);
            if (user == null)
            {
                var words = nameClaim.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var avatar = words.Length >= 2
                    ? (words[0][0].ToString() + words[^1][0].ToString()).ToUpper()
                    : (nameClaim.Length >= 2 ? nameClaim[..2].ToUpper() : "GG");

                string[] colors = { "#ea4335", "#4285f4", "#fbbc05", "#34a853", "#059669", "#7c3aed" };
                var color = colors[Math.Abs(cleanEmail.GetHashCode()) % colors.Length];

                user = new AppUser
                {
                    Name = nameClaim,
                    Email = cleanEmail,
                    Password = "google_oauth_" + Guid.NewGuid().ToString("N")[..8],
                    Avatar = avatar,
                    Color = color,
                    CreatedAt = DateTime.UtcNow
                };

                _db.Users.Add(user);
                await _db.SaveChangesAsync();
            }

            // Kiểm tra phân quyền trưởng nhóm / thành viên
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

            var userPayload = new
            {
                id = user.Id.ToString(),
                name = user.Name,
                email = user.Email,
                avatar = user.Avatar,
                color = user.Color,
                roleType = isLeader ? "Leader" : "Member",
                role = isLeader ? "Trưởng nhóm" : "Thành viên"
            };

            // Set cookie để frontend JavaScript đọc ngay lập tức khi redirect về trang chính
            Response.Cookies.Append("tf_google_user", System.Text.Json.JsonSerializer.Serialize(userPayload), new CookieOptions
            {
                Expires = DateTimeOffset.UtcNow.AddDays(30),
                HttpOnly = false,
                SameSite = SameSiteMode.Lax,
                Secure = Request.IsHttps
            });

            return Redirect(returnUrl ?? "/");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi xử lý callback Google OAuth");
            return Redirect("/?auth_error=server_error");
        }
    }

    [HttpGet("auth/logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        Response.Cookies.Delete("tf_google_user");
        Response.Cookies.Delete("TeamFair_Auth");
        return Redirect("/");
    }
}
