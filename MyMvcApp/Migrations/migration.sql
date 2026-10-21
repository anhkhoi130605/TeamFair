IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
CREATE TABLE [ActivityLogs] (
    [Id] int NOT NULL IDENTITY,
    [TeamId] int NULL,
    [Time] nvarchar(50) NOT NULL,
    [Text] nvarchar(500) NOT NULL,
    [Type] nvarchar(50) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    CONSTRAINT [PK_ActivityLogs] PRIMARY KEY ([Id])
);

CREATE TABLE [EmailLogs] (
    [Id] nvarchar(50) NOT NULL,
    [ToEmail] nvarchar(200) NOT NULL,
    [ToName] nvarchar(150) NOT NULL,
    [Subject] nvarchar(300) NOT NULL,
    [Type] nvarchar(50) NOT NULL,
    [Content] nvarchar(max) NOT NULL,
    [SentAt] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_EmailLogs] PRIMARY KEY ([Id])
);

CREATE TABLE [PeerReviews] (
    [Id] nvarchar(50) NOT NULL,
    [TaskId] nvarchar(50) NOT NULL,
    [RevieweeId] nvarchar(50) NOT NULL,
    [ReviewerId] nvarchar(50) NOT NULL,
    [Quality] int NOT NULL,
    [Punctuality] int NOT NULL,
    [Effort] int NOT NULL,
    [Cooperation] int NOT NULL,
    [Comment] nvarchar(max) NULL,
    [CreatedAt] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_PeerReviews] PRIMARY KEY ([Id])
);

CREATE TABLE [Teams] (
    [Id] int NOT NULL IDENTITY,
    [Name] nvarchar(200) NOT NULL,
    [Topic] nvarchar(250) NULL,
    [Subject] nvarchar(200) NULL,
    [ClassCode] nvarchar(100) NULL,
    [FinalDeadline] nvarchar(50) NULL,
    [CreatedAt] datetime2 NOT NULL,
    CONSTRAINT [PK_Teams] PRIMARY KEY ([Id])
);

CREATE TABLE [TeamMeetings] (
    [Id] nvarchar(50) NOT NULL,
    [TeamId] int NULL,
    [Title] nvarchar(250) NOT NULL,
    [MeetingDate] nvarchar(50) NOT NULL,
    [Time] nvarchar(20) NOT NULL,
    [DurationMinutes] int NOT NULL,
    [RoomCode] nvarchar(50) NOT NULL,
    [Platform] nvarchar(100) NOT NULL,
    [Link] nvarchar(500) NOT NULL,
    [Notes] nvarchar(max) NULL,
    [Status] nvarchar(30) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    CONSTRAINT [PK_TeamMeetings] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_TeamMeetings_Teams_TeamId] FOREIGN KEY ([TeamId]) REFERENCES [Teams] ([Id])
);

CREATE TABLE [TeamMembers] (
    [Id] nvarchar(50) NOT NULL,
    [TeamId] int NULL,
    [Name] nvarchar(150) NOT NULL,
    [Email] nvarchar(200) NOT NULL,
    [Role] nvarchar(100) NOT NULL,
    [Avatar] nvarchar(10) NOT NULL,
    [Color] nvarchar(20) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    CONSTRAINT [PK_TeamMembers] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_TeamMembers_Teams_TeamId] FOREIGN KEY ([TeamId]) REFERENCES [Teams] ([Id])
);

CREATE TABLE [TeamTasks] (
    [Id] nvarchar(50) NOT NULL,
    [TeamId] int NULL,
    [Title] nvarchar(300) NOT NULL,
    [AssigneeId] nvarchar(50) NULL,
    [Difficulty] nvarchar(20) NOT NULL,
    [BaseHours] int NOT NULL,
    [Deadline] nvarchar(50) NULL,
    [Category] nvarchar(100) NOT NULL,
    [Status] nvarchar(20) NOT NULL,
    [Progress] int NOT NULL,
    [Description] nvarchar(max) NULL,
    [CreatedAt] datetime2 NOT NULL,
    CONSTRAINT [PK_TeamTasks] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_TeamTasks_Teams_TeamId] FOREIGN KEY ([TeamId]) REFERENCES [Teams] ([Id])
);

CREATE TABLE [ScheduleSlots] (
    [Id] int NOT NULL IDENTITY,
    [MemberId] nvarchar(50) NOT NULL,
    [SlotKey] nvarchar(20) NOT NULL,
    [IsAvailable] bit NOT NULL,
    [TeamMemberId] nvarchar(50) NULL,
    CONSTRAINT [PK_ScheduleSlots] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_ScheduleSlots_TeamMembers_TeamMemberId] FOREIGN KEY ([TeamMemberId]) REFERENCES [TeamMembers] ([Id])
);

CREATE INDEX [IX_PeerReviews_TaskId] ON [PeerReviews] ([TaskId]);

CREATE INDEX [IX_ScheduleSlots_MemberId_SlotKey] ON [ScheduleSlots] ([MemberId], [SlotKey]);

CREATE INDEX [IX_ScheduleSlots_TeamMemberId] ON [ScheduleSlots] ([TeamMemberId]);

CREATE INDEX [IX_TeamMeetings_TeamId] ON [TeamMeetings] ([TeamId]);

CREATE INDEX [IX_TeamMembers_Email] ON [TeamMembers] ([Email]);

CREATE INDEX [IX_TeamMembers_TeamId] ON [TeamMembers] ([TeamId]);

CREATE INDEX [IX_TeamTasks_AssigneeId] ON [TeamTasks] ([AssigneeId]);

CREATE INDEX [IX_TeamTasks_TeamId] ON [TeamTasks] ([TeamId]);

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20261021070815_InitialCreate', N'10.0.13');

COMMIT;
GO

BEGIN TRANSACTION;
ALTER TABLE [TeamMembers] ADD [Password] nvarchar(100) NOT NULL DEFAULT N'';

ALTER TABLE [TeamMembers] ADD [RoleType] nvarchar(50) NOT NULL DEFAULT N'';

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20261021073210_AddMemberRoleAndPassword', N'10.0.13');

COMMIT;
GO

