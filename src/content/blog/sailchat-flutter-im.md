---
title: SailChat — 基于 Flutter 的跨平台即时通讯应用开发实录
description: 从架构设计到核心实现，完整记录 SailChat 的开发过程——WebSocket 实时通信、Riverpod 状态管理、缓存优先策略、深色模式与国际化。
date: 2026-05-08
tags:
    - Flutter
    - Dart
    - 即时通讯
    - 移动开发
---

## 项目背景

即时通讯是移动端最经典的应用场景之一，它几乎涉及客户端开发的每一个核心问题：实时通信、状态管理、本地持久化、鉴权、多媒体处理。我选择从零构建 SailChat，不是为了造又一个微信，而是想通过一个完整项目，把这些技术点串联起来，真正理解它们在工程中如何协作。

SailChat 的后端采用 Spring Boot，独立仓库 [SailChat-Server](https://github.com/OneSailTech/SailChat-Server)，本文聚焦 Flutter 客户端的实现。

## 技术选型

| 分类 | 技术 | 选择理由 |
|------|------|----------|
| 框架 | Flutter 3.29+ | 一套代码覆盖 Android/iOS，Dart 空安全 |
| 状态管理 | flutter_riverpod | 编译时安全、family 参数化、比 Provider 更灵活 |
| 路由 | go_router | 声明式路由 + StatefulShellRoute 保持 tab 状态 |
| 网络请求 | Dio | 拦截器机制成熟，方便统一鉴权 |
| 实时通信 | web_socket_channel | Dart 官方维护，stream 模型与 Flutter 天然契合 |
| 本地存储 | SharedPreferences | 轻量键值缓存，消息/列表离线兜底 |
| 安全存储 | flutter_secure_storage | Token 持久化，OS 级加密 |
| 图片 | cached_network_image | 网络图缓存 + 占位符，聊天图片必备 |
| 媒体 | image_picker | 选图/选视频，系统原生选择器 |
| 国际化 | flutter_localizations | ARB 文件 + 代码生成，官方方案 |

## 项目架构

```
lib/
├── main.dart              # 入口，ProviderScope 包一层
├── router/
│   └── app_router.dart    # GoRouter 路由配置 + 登录态拦截
├── models/                # 数据模型，JSON 序列化
├── services/              # 网络层（Dio + 拦截器）
├── socket/
│   └── chat_websocket.dart  # WebSocket 封装
├── store/                 # 状态管理（Riverpod）
├── utils/                 # 主题、缓存、Token 等
├── pages/                 # 页面
└── l10n/                  # 国际化源文件
```

架构遵循**分层原则**：`Service` 只负责调接口返回原始 JSON，模型转换在 `Store` 层做，`Page` 只管 UI 和用户交互。这样 Service 轻量可测试，Store 层统一管理状态和缓存逻辑。

## 核心实现

### 1. 路由与鉴权守卫

路由是应用的骨架。SailChat 使用 `go_router` 管理所有页面跳转，核心设计是**登录态拦截**：

```dart
final router = Provider<GoRouter>((ref) {
  ref.watch(authProvider);
  return GoRouter(
    initialLocation: '/chats',
    redirect: (context, state) {
      if (ref.read(authProvider.notifier).loading) return null;
      final token = ref.read(authProvider);
      final loggingIn = state.matchedLocation == '/login';
      if (token == null && !loggingIn) return '/login';
      if (token != null && loggingIn) return '/chats';
      return null;
    },
    // ...
  );
});
```

关键点：

- **监听 `authProvider`**：Token 变化时路由自动重新计算，不需要手动跳转
- **loading 保护**：Token 还在从 SecureStorage 读取时，不执行重定向，避免闪烁
- **双向拦截**：没 Token 跳登录页，已登录不让再进登录页

底部导航三个 Tab 使用 `StatefulShellRoute.indexedStack`，切换 Tab 时各页面状态完整保留，不会重新 build。

### 2. WebSocket 实时通信

即时通讯的灵魂是实时性。SailChat 用 `ChatWebSocket` 类封装了 WebSocket 的完整生命周期：

```dart
class ChatWebSocket {
  final _msgCtrl = StreamController<Message>.broadcast();
  final _notifCtrl = StreamController<SystemNotification>.broadcast();
  final _statusCtrl = StreamController<WsStatus>.broadcast();

  Future<void> connect() async {
    final token = await TokenStorage.get();
    _channel = WebSocketChannel.connect(
      Uri.parse('ws://$_host/ws/chat?token=$token'),
    );
    _channel!.stream.listen((data) {
      final json = jsonDecode(data);
      if (json.containsKey('type')) {
        _notifCtrl.add(SystemNotification.fromJson(json));
      } else if (json.containsKey('msgType')) {
        _msgCtrl.add(Message.fromJson(json));
      }
    });
  }
}
```

设计要点：

- **双通道分发**：通过 `type` 和 `msgType` 区分系统通知与聊天消息，分别输出到不同的 Stream
- **状态广播**：`WsStatus` 枚举（disconnected / connecting / connected / failed）通过 Stream 广播，UI 层可以实时展示连接状态
- **Token 鉴权**：Token 通过 query 参数传递，连接时自动带上，无需额外握手

### 3. WebSocket → Riverpod 桥接

WebSocket 是命令式的，Riverpod 是响应式的。如何优雅地桥接两者？

```dart
final wsProvider = Provider<ChatWebSocket>((ref) {
  final ws = ChatWebSocket('10.0.2.2:8080');
  ref.onDispose(() => ws.dispose());
  return ws;
});

final realtimeMessageProvider = StreamProvider<Message>((ref) {
  return ref.watch(wsProvider).onMessage;
});

final realtimeNotificationProvider = StreamProvider<SystemNotification>((ref) {
  return ref.watch(wsProvider).onNotification;
});
```

三个 `StreamProvider` 把 WebSocket 的 Stream 转成 Riverpod 可监听的状态。UI 层只需要 `ref.watch(realtimeMessageProvider)` 就能响应实时消息，完全不需要手动管理监听器的注册和注销。

在 `MainLayout` 中统一消费：

```dart
final messageAsync = ref.watch(realtimeMessageProvider);
messageAsync.whenData((msg) {
  ref.read(messageNotifierProvider.notifier).onReceiveMessage(msg, currentUserId);
});

final notificationAsync = ref.watch(realtimeNotificationProvider);
notificationAsync.whenData((notification) {
  ref.read(messageNotifierProvider.notifier).handleNotification(notification);
});
```

这样无论在哪个页面，WebSocket 消息都能正确分发到对应的 Provider。

### 4. 聊天记录：为什么用 StateNotifier 而不是 FutureProvider

这是 SailChat 架构中最关键的决策之一。

聊天记录用 `StateNotifierProvider.family`，每个会话对应一个 Notifier：

```dart
final chatHistoryProvider =
    StateNotifierProvider.family<ChatHistoryNotifier, AsyncValue<List<Message>>, int>(
  (ref, targetId) => ChatHistoryNotifier(targetId, ref.watch(messageServiceProvider)),
);
```

如果用 `FutureProvider`，每次发消息后需要 `invalidate` 刷新，这会导致状态先进入 `AsyncLoading`，列表闪一下再重新加载——用户体验极差。

而 `StateNotifier` 的 `addMessage` 方法直接追加到当前状态：

```dart
void addMessage(Message msg) {
  final current = state.value ?? [];
  if (current.any((m) => m.id == msg.id)) return; // 去重
  state = AsyncValue.data([...current, msg]);
}
```

发消息、收消息时直接调用 `addMessage`，列表平滑追加，没有闪烁。

### 5. 缓存优先策略

所有列表 Provider 都遵循同一套加载逻辑：

```dart
final conversationListProvider = FutureProvider<List<Conversation>>((ref) async {
  final cached = await CacheStorage.getConversations();
  try {
    final data = await service.getConversations();
    final conversations = data.map((e) => Conversation.fromJson(e)).toList();
    await CacheStorage.saveConversations(conversations);
    return conversations;
  } catch (e) {
    if (cached != null) return cached;
    rethrow;
  }
});
```

流程：

1. 先读本地缓存 → 有就立刻展示
2. 再拉接口 → 成功后更新缓存和状态
3. 接口挂了 → 用缓存顶着，不报错

这套策略在弱网环境下特别有效——即使完全断网，页面也不会空白，用户至少能看到上次的数据。

聊天记录的加载更进一步：

```dart
Future<void> _load() async {
  final cached = await CacheStorage.getChatHistory(targetId);
  if (cached != null && cached.isNotEmpty) {
    state = AsyncValue.data(cached); // 立刻展示缓存
  }
  try {
    final data = await _service.getUnreadHistory(targetId: targetId);
    final unread = data.map((e) => Message.fromJson(e)).toList();
    await CacheStorage.appendChatHistory(targetId, unread);
    final all = await CacheStorage.getChatHistory(targetId);
    state = AsyncValue.data(all ?? unread);
  } catch (e, st) {
    if (cached == null || cached.isEmpty) {
      state = AsyncValue.error(e, st);
    }
    // 有缓存就不报错，静默失败
  }
}
```

先展示缓存，再拉未读消息增量合并，而不是每次全量刷新。

### 6. 跨数据源用户信息解析

用户昵称和头像从多个来源按优先级取：

```dart
final name = conv.targetUser?.nickname
    ?? friendUser?.nickname
    ?? conv.targetUser?.username
    ?? friendUser?.username
    ?? l10n.userPrefix(conv.targetId.toString());
```

为什么需要这样？因为会话接口返回的 `targetUser` 信息不一定完整——可能只有 `username` 没有 `nickname`。而好友列表的 `friendUser` 信息更全。所以需要结合两个数据源补全。

`targetUserProvider` 把这个逻辑封装成统一的 Provider：

```dart
final targetUserProvider = FutureProvider.family<UserBrief?, int>((ref, targetId) async {
  // 先查好友列表
  final friendsAsync = ref.watch(friendListProvider);
  // 再查会话列表
  final convsAsync = ref.watch(conversationListProvider);
  // 返回找到的第一个
});
```

任何页面需要显示用户信息，只需要 `ref.watch(targetUserProvider(targetId))`，不用关心数据从哪来。

### 7. Dio 拦截器与鉴权

网络层用全局 Dio 实例 + 拦截器统一处理鉴权：

```dart
final httpClientProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(
    baseUrl: 'http://10.0.2.2:8080',
    contentType: 'application/x-www-form-urlencoded',
  ));

  const noAuthPaths = ['/user/login', '/user/register', '/captcha'];

  dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) async {
      if (!noAuthPaths.contains(options.path)) {
        final token = await TokenStorage.get();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
      }
      handler.next(options);
    },
    onError: (error, handler) async {
      if (error.response?.statusCode == 401) {
        await TokenStorage.clear();
        ref.read(authProvider.notifier).onTokenExpired();
      }
      handler.next(error);
    },
  ));

  return dio;
});
```

两个关键设计：

- **白名单机制**：登录、注册、验证码接口不需要 Token，带了反而可能因为过期 Token 导致请求失败
- **401 自动处理**：Token 过期时自动清除存储并通知 `authProvider`，路由守卫检测到 Token 为 null 后自动跳转登录页，整个链路完全自动化

### 8. 深色模式与 ThemeExtension

SailChat 通过 `ThemeExtension` 定义完整的自定义色板：

```dart
@immutable
class AppColors extends ThemeExtension<AppColors> {
  final Color background;
  final Color chatBubbleMe;
  final Color chatBubbleOther;
  // ... 20+ 颜色定义

  static const light = AppColors(
    background: Color(0xFFF8FAFC),
    chatBubbleMe: Color(0xFF0052D4),
    chatBubbleOther: Colors.white,
  );

  static const dark = AppColors(
    background: Color(0xFF000000),
    chatBubbleMe: Color(0xFF0A84FF),
    chatBubbleOther: Color(0xFF2C2C2E),
  );
}
```

使用时通过 `Theme.of(context).extension<AppColors>()!` 获取，封装成快捷函数：

```dart
AppColors c(BuildContext context) => Theme.of(context).extension<AppColors>()!;
```

这样所有页面统一用 `final colors = c(context);` 取颜色，亮色暗色自动切换，不需要到处写三元表达式。

主题切换持久化到 SharedPreferences，支持跟随系统、手动亮色、手动暗色三种模式。

### 9. 国际化

支持中文简体、中文繁体、英文三种语言，使用 Flutter 官方的 ARB 方案：

- `app_zh.arb` — 中文简体
- `app_zh_TW.arb` — 中文繁体
- `app_en.arb` — 英文

通过 `flutter gen-l10n` 生成类型安全的 `AppLocalizations` 类，所有字符串都有编译时检查，不会拼错 key。

默认中文，用户可在设置页切换，语言偏好持久化到 SharedPreferences。

### 10. 多媒体消息

发送图片/视频的流程是两步走：

```dart
Future<void> _sendMediaFile(String filePath, String type) async {
  setState(() => _isSendingMedia = true);
  try {
    final url = await service.uploadFile(filePath: filePath, type: type);
    await ref.read(messageNotifierProvider.notifier)
        .send(toId: widget.targetId, msgType: type, content: url);
  } finally {
    setState(() => _isSendingMedia = false);
  }
}
```

1. 先通过 REST API 上传文件，拿到服务器返回的 URL
2. 再通过 WebSocket 发送包含 URL 的消息

为什么不直接走 WebSocket 传文件？因为 WebSocket 适合传小文本，大文件应该走 HTTP 分片上传，更可靠、可断点续传。

上传过程中显示 loading 状态，防止用户重复点击。图片用 `CachedNetworkImage` 渲染，自带缓存和占位符。

### 11. 消息收发中枢

`MessageNotifier` 是整个消息系统的调度中心：

```dart
class MessageNotifier extends StateNotifier<AsyncValue<void>> {
  // 发消息：调接口 → 存本地 → 追加状态 → 刷新会话
  Future<Message> send({required int toId, required String msgType, required String content}) async {
    final data = await _service.send(toId: toId, msgType: msgType, content: content);
    final msg = Message.fromJson(data);
    await CacheStorage.appendSingleMessage(toId, msg);
    _ref.read(chatHistoryProvider(toId).notifier).addMessage(msg);
    _ref.invalidate(conversationListProvider);
    return msg;
  }

  // 收消息：判断属于哪个会话 → 存本地 → 追加状态 → 刷新会话
  Future<void> onReceiveMessage(Message msg, int currentUserId) async {
    final targetId = msg.fromId == currentUserId ? msg.toId : msg.fromId;
    await CacheStorage.appendSingleMessage(targetId, msg);
    _ref.read(chatHistoryProvider(targetId).notifier).addMessage(msg);
    _ref.invalidate(conversationListProvider);
  }

  // 系统通知：按类型刷新对应列表
  void handleNotification(SystemNotification notification) {
    switch (notification.type) {
      case NotificationType.friendApply:
        _ref.invalidate(friendRequestListProvider);
      case NotificationType.friendAccept:
        _ref.invalidate(friendListProvider);
        _ref.invalidate(friendRequestListProvider);
      case NotificationType.friendReject:
        _ref.invalidate(friendRequestListProvider);
    }
  }
}
```

所有消息相关的操作都汇聚到这里，保证缓存、状态、UI 三者一致。

## 代码约定

### Service 层只做网络请求

Service 方法返回 `Map<String, dynamic>` 或 `List<Map<String, dynamic>>`，不做模型转换。模型转换在 Store 层做，保持 Service 轻量可测试。

### Provider 组织

```
store/
├── riverpod.dart          # 服务 provider 导出（barrel）
├── message_provider.dart  # 消息相关 provider 统一导出
├── *_provider.dart        # 各功能独立 provider
```

每个功能一个文件，`message_provider.dart` 作为便捷导出，消费方只需一个 import。

### 错误处理策略

- API 错误在 Provider 层捕获，有缓存就用缓存
- 401 自动清 Token，路由守卫跳登录页
- 接口挂了有缓存就不报错，没缓存才展示错误态

## 遇到的坑与思考

### Android 模拟器访问本机服务

Android 模拟器中 `localhost` 指向模拟器自身，要用 `10.0.2.2` 访问宿主机。iOS 模拟器没有这个问题，直接用 `localhost`。如果将来支持真机调试，需要换成局域网 IP。

### SharedPreferences 存储聊天记录

用 SharedPreferences 存消息其实是权衡之举。对于 SailChat 的规模够用了，但如果消息量很大，应该迁移到 SQLite（sqflite）或 Hive。当前方案的优势是实现简单，劣势是每次读取需要全量反序列化。

### StateNotifier.family 的生命周期

`chatHistoryProvider` 是 `family` 类型的，每个 `targetId` 对应一个 Notifier 实例。Riverpod 会在没有 watcher 时自动 dispose，这意味着如果用户从聊天页返回再进入，Notifier 会被重建，触发 `_load()` 重新加载。这其实是期望行为——每次进入聊天页都能拿到最新消息。

## 总结

SailChat 的核心设计可以归纳为三个原则：

1. **缓存优先**：先展示本地数据，再拉接口刷新，弱网也能用
2. **状态驱动**：WebSocket → Riverpod 桥接，UI 层只管 `ref.watch`，不需要手动管理监听
3. **分层解耦**：Service 只做网络请求，Store 管理状态和缓存，Page 只管 UI

这三个原则让代码职责清晰、易于测试、弱网体验好。即时通讯应用看似简单，实际上涉及的状态同步、缓存一致性、实时性保证，每一个都是值得深入思考的工程问题。

---

项目开源地址：[SailChat](https://github.com/OneSailTech/SailChat) | 后端：[SailChat-Server](https://github.com/OneSailTech/SailChat-Server)
