using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace MyMvcApp.Hubs;

// Hub tín hiệu cho phòng họp WebRTC: chỉ trung chuyển offer/answer/ICE và chat,
// còn audio/video truyền trực tiếp giữa các trình duyệt (mesh).
public class MeetingHub : Hub
{
    public record Participant(string ConnectionId, string Name, string Avatar, string Color, bool Mic, bool Cam);

    // connectionId -> (roomId, participant)
    private static readonly ConcurrentDictionary<string, (string RoomId, Participant Info)> Connections = new();

    public async Task<List<Participant>> JoinRoom(string roomId, string name, string avatar, string color, bool mic, bool cam)
    {
        roomId = (roomId ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(roomId)) throw new HubException("Mã phòng họp không hợp lệ.");

        await LeaveCurrentRoom();

        var me = new Participant(Context.ConnectionId, string.IsNullOrWhiteSpace(name) ? "Thành viên" : name.Trim(), avatar ?? "TV", color ?? "#2563eb", mic, cam);
        var others = Connections.Values.Where(c => c.RoomId == roomId).Select(c => c.Info).ToList();

        Connections[Context.ConnectionId] = (roomId, me);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.OthersInGroup(roomId).SendAsync("PeerJoined", me);

        return others;
    }

    public Task LeaveRoom() => LeaveCurrentRoom();

    public async Task Signal(string targetConnectionId, string payload)
    {
        if (!Connections.TryGetValue(Context.ConnectionId, out var me)) return;
        if (!Connections.TryGetValue(targetConnectionId, out var target) || target.RoomId != me.RoomId) return;
        await Clients.Client(targetConnectionId).SendAsync("Signal", Context.ConnectionId, payload);
    }

    public async Task UpdateState(bool mic, bool cam)
    {
        if (!Connections.TryGetValue(Context.ConnectionId, out var me)) return;
        Connections[Context.ConnectionId] = (me.RoomId, me.Info with { Mic = mic, Cam = cam });
        await Clients.OthersInGroup(me.RoomId).SendAsync("PeerState", Context.ConnectionId, mic, cam);
    }

    public async Task SendChat(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        if (!Connections.TryGetValue(Context.ConnectionId, out var me)) return;
        var text = message.Trim();
        if (text.Length > 1000) text = text[..1000];
        await Clients.Group(me.RoomId).SendAsync("ChatMessage", me.Info.Name, text, DateTime.UtcNow);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveCurrentRoom();
        await base.OnDisconnectedAsync(exception);
    }

    private async Task LeaveCurrentRoom()
    {
        if (Connections.TryRemove(Context.ConnectionId, out var me))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, me.RoomId);
            await Clients.Group(me.RoomId).SendAsync("PeerLeft", Context.ConnectionId);
        }
    }
}
