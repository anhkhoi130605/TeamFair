using Microsoft.EntityFrameworkCore;
using MyMvcApp.Models;

namespace MyMvcApp.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<TeamMember> Members => Set<TeamMember>();
    public DbSet<TeamTask> Tasks => Set<TeamTask>();
    public DbSet<ScheduleSlot> ScheduleSlots => Set<ScheduleSlot>();
    public DbSet<TeamMeeting> Meetings => Set<TeamMeeting>();
    public DbSet<PeerReview> PeerReviews => Set<PeerReview>();
    public DbSet<EmailLog> EmailLogs => Set<EmailLog>();
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.ToTable("Users");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Email).IsUnique();
        });

        modelBuilder.Entity<Team>(entity =>
        {
            entity.ToTable("Teams");
            entity.HasKey(e => e.Id);
        });

        modelBuilder.Entity<TeamMember>(entity =>
        {
            entity.ToTable("TeamMembers");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Email);
        });

        modelBuilder.Entity<TeamTask>(entity =>
        {
            entity.ToTable("TeamTasks");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.AssigneeId);
        });

        modelBuilder.Entity<ScheduleSlot>(entity =>
        {
            entity.ToTable("ScheduleSlots");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.MemberId, e.SlotKey });
        });

        modelBuilder.Entity<TeamMeeting>(entity =>
        {
            entity.ToTable("TeamMeetings");
            entity.HasKey(e => e.Id);
        });

        modelBuilder.Entity<PeerReview>(entity =>
        {
            entity.ToTable("PeerReviews");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TaskId);
        });

        modelBuilder.Entity<EmailLog>(entity =>
        {
            entity.ToTable("EmailLogs");
            entity.HasKey(e => e.Id);
        });

        modelBuilder.Entity<ActivityLog>(entity =>
        {
            entity.ToTable("ActivityLogs");
            entity.HasKey(e => e.Id);
        });
    }
}
