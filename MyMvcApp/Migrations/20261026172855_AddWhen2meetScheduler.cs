using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyMvcApp.Migrations
{
    /// <inheritdoc />
    public partial class AddWhen2meetScheduler : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScheduleEvents",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    DatesJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    StartHour = table.Column<int>(type: "int", nullable: false),
                    EndHour = table.Column<int>(type: "int", nullable: false),
                    SlotMinutes = table.Column<int>(type: "int", nullable: false),
                    TimeZone = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CreatedByEmail = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduleEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EventParticipants",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    EventId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    PasswordHash = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ScheduleEventId = table.Column<string>(type: "nvarchar(50)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventParticipants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventParticipants_ScheduleEvents_ScheduleEventId",
                        column: x => x.ScheduleEventId,
                        principalTable: "ScheduleEvents",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "EventAvailabilities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    EventId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ParticipantId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    SlotKey = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    IsAvailable = table.Column<bool>(type: "bit", nullable: false),
                    EventParticipantId = table.Column<string>(type: "nvarchar(50)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventAvailabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventAvailabilities_EventParticipants_EventParticipantId",
                        column: x => x.EventParticipantId,
                        principalTable: "EventParticipants",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_EventAvailabilities_EventId_ParticipantId_SlotKey",
                table: "EventAvailabilities",
                columns: new[] { "EventId", "ParticipantId", "SlotKey" });

            migrationBuilder.CreateIndex(
                name: "IX_EventAvailabilities_EventParticipantId",
                table: "EventAvailabilities",
                column: "EventParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_EventParticipants_EventId_Name",
                table: "EventParticipants",
                columns: new[] { "EventId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_EventParticipants_ScheduleEventId",
                table: "EventParticipants",
                column: "ScheduleEventId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EventAvailabilities");

            migrationBuilder.DropTable(
                name: "EventParticipants");

            migrationBuilder.DropTable(
                name: "ScheduleEvents");
        }
    }
}
