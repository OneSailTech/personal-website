---
title: SailChat-Server — 基于 Spring Boot 的即时通讯后端设计与实现
description: 从分层架构到 WebSocket 实时推送，从 JWT 鉴权到消息生命周期管理，完整拆解 SailChat 后端的工程实践。
date: 2026-05-08
tags:
    - Spring Boot
    - Java
    - WebSocket
    - 后端
    - 即时通讯
---

## 为什么需要这篇文章

在上一篇 [SailChat Flutter 客户端](/posts/sailchat-flutter-im) 中，我详细拆解了移动端的实现。但即时通讯是前后端高度协作的系统——客户端的每一个交互，背后都有服务端的精密支撑。这篇文章聚焦后端，从架构设计到每一个核心模块的实现细节，完整呈现 SailChat-Server 的工程全貌。

## 技术选型

| 分类 | 技术 | 版本 | 选择理由 |
|------|------|------|----------|
| 框架 | Spring Boot | 4.0.6 | 生态成熟，开箱即用，WebSocket 支持完善 |
| ORM | MyBatis | 4.0.1 | SQL 灵活可控，注解方式简洁，适合中小项目 |
| 数据库 | MySQL | 8.0+ | utf8mb4 支持表情，索引优化成熟 |
| 实时通信 | Spring WebSocket | — | 原生集成，TextWebSocketHandler 扩展方便 |
| 认证 | jjwt | 0.12.6 | 无状态 JWT，水平扩展友好 |
| 序列化 | Jackson + JSR-310 | 2.21.2 | Java 8 时间类型支持，ObjectMapper 统一配置 |
| 验证码 | Kaptcha | 2.3.2 | 轻量图形验证码，防暴力注册 |
| 参数校验 | Spring Validation | — | `@Validated` + `@Pattern`，声明式校验 |
| 构建 | Maven | 3.8+ | 项目结构标准化 |

## 分层架构

```
src/main/java/com/sail/chat/
├── config/                  # 配置层
│   ├── KaptchaConfig        # 验证码生成器
│   ├── WebConfig            # MVC 配置、拦截器注册、ObjectMapper
│   └── WebSocketConfig      # WebSocket 端点注册
├── controller/              # 接口层
│   ├── CaptchaController    # 验证码图片
│   ├── UserController       # 用户注册/登录/信息/头像
│   ├── FriendController     # 好友申请/接受/拒绝/列表
│   └── MessageController    # 消息发送/历史/已读/文件上传
├── dto/                     # 请求传输对象
├── exception/               # 全局异常处理
├── interceptors/            # 请求拦截器
│   └── LoginInterceptor     # JWT 认证拦截
├── mapper/                  # 数据访问层（MyBatis 注解）
├── pojo/                    # 实体类 + 统一响应封装
├── service/                 # 业务逻辑层
│   └── impl/                # 实现类
├── task/                    # 定时任务
│   └── MessageCleanupTask   # 过期消息自动清理
├── utils/                   # 工具类
│   ├── JwtUtil              # JWT 生成与解析
│   ├── Md5Util              # MD5 密码加密
│   └── ThreadLocalUtil      # 线程上下文
└── websocket/               # WebSocket 组件
    ├── handler/
    │   └── ChatWebSocketHandler  # 连接管理、消息路由、离线推送
    └── manager/
        └── SessionManager        # 在线会话注册表
```

调用链路清晰：**Controller → Service → Mapper → MySQL**，每层职责单一，不跨层调用。

## 核心实现

### 1. JWT 认证与拦截器

认证是所有接口的第一道门。SailChat 采用 JWT 无状态方案，不依赖 Session 存储登录态。

**JwtUtil** 封装了令牌的生成和解析：

```java
public class JwtUtil {
    private static final SecretKey key = Keys.hmacShaKeyFor(
        "fdf98wu3jvcvc454brm0oi9fg2woshixieyifan".getBytes()
    );
    private static final long EXPIRATION = 1000L * 60 * 60 * 24 * 14; // 14天

    public static String generateToken(Map<String, Object> claims) {
        return Jwts.builder()
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + EXPIRATION))
                .signWith(key)
                .compact();
    }

    public static Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
```

Token 中只存 `id` 和 `username`，14 天过期，HMAC-SHA256 签名。

**LoginInterceptor** 在每个请求前校验 Token，通过后将用户信息存入 ThreadLocal：

```java
public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    String authHeader = request.getHeader("Authorization");
    if (authHeader == null || !authHeader.startsWith("Bearer ")) {
        response.setStatus(401);
        return false;
    }
    String token = authHeader.substring(7);
    try {
        Map<String, Object> claims = JwtUtil.parseToken(token);
        ThreadLocalUtil.set(claims);
        return true;
    } catch (Exception e) {
        response.setStatus(401);
        return false;
    }
}
```

关键设计：

- **ThreadLocal 传递用户上下文**：拦截器存入，Controller 直接 `ThreadLocalUtil.get()` 取用，不需要每个方法都传 `userId` 参数
- **afterCompletion 清理**：请求结束后必须 `ThreadLocalUtil.remove()`，否则线程池复用会导致用户信息串号
- **白名单排除**：登录、注册、验证码、静态资源不需要 Token

WebConfig 中注册拦截器并排除白名单路径：

```java
public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(loginInterceptor).excludePathPatterns(
        "/user/login", "/user/register", "/captcha", "/uploads/**"
    );
}
```

### 2. WebSocket 连接管理与消息路由

WebSocket 是即时通讯的核心通道。SailChat 的实现分为三层：配置 → 会话管理 → 消息处理。

**WebSocketConfig** 注册端点：

```java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    @Autowired
    private ChatWebSocketHandler chatHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatHandler, "/ws/chat")
                .setAllowedOrigins("*");
    }
}
```

**SessionManager** 用 ConcurrentHashMap 维护在线用户映射：

```java
@Component
public class SessionManager {
    private static final ConcurrentHashMap<Long, WebSocketSession> SESSION_MAP = new ConcurrentHashMap<>();

    public void addSession(Long userId, WebSocketSession session) {
        SESSION_MAP.put(userId, session);
    }

    public void removeSession(Long userId) {
        SESSION_MAP.remove(userId);
    }

    public WebSocketSession getSession(Long userId) {
        return SESSION_MAP.get(userId);
    }
}
```

为什么用 ConcurrentHashMap？因为 WebSocket 的连接和断开是多线程并发的——一个用户上线的同时另一个可能下线，HashMap 会导致并发修改异常。

**ChatWebSocketHandler** 是消息处理的核心，处理三个生命周期事件：

**连接建立时** — 推送离线消息和好友申请通知：

```java
public void afterConnectionEstablished(WebSocketSession session) throws Exception {
    Long userId = extractUserId(session);
    if (userId != null) {
        sessionManager.addSession(userId, session);

        // 推送离线期间的未读消息
        List<Message> unreadMessages = messageService.getUnreadMessages(userId);
        for (Message msg : unreadMessages) {
            if (session.isOpen()) {
                String json = objectMapper.writeValueAsString(msg);
                session.sendMessage(new TextMessage(json));
            }
        }

        // 推送离线期间收到的好友申请
        List<FriendRequest> pendingRequests = friendService.getPendingRequests(userId);
        for (FriendRequest req : pendingRequests) {
            if (session.isOpen()) {
                User fromUser = userService.findById(req.getFromId());
                String displayName = (fromUser != null && fromUser.getNickname() != null)
                        ? fromUser.getNickname() : fromUser.getUsername();
                Notification notification = new Notification(
                    "friend_apply", displayName + " 请求添加你为好友", data
                );
                session.sendMessage(new TextMessage(objectMapper.writeValueAsString(notification)));
            }
        }
    }
}
```

**收到消息时** — 保存数据库 + 实时转发：

```java
protected void handleTextMessage(WebSocketSession session, TextMessage textMessage) throws Exception {
    Long userId = extractUserId(session);
    Map<String, Object> msgMap = objectMapper.readValue(textMessage.getPayload(), Map.class);
    Long toId = Long.valueOf(msgMap.get("toId").toString());
    String msgType = (String) msgMap.get("msgType");
    String content = (String) msgMap.get("content");

    // 保存到数据库
    Message message = messageService.sendMessage(userId, toId, msgType, content);

    // 对方在线则实时推送
    WebSocketSession targetSession = sessionManager.getSession(toId);
    if (targetSession != null && targetSession.isOpen()) {
        String json = objectMapper.writeValueAsString(message);
        targetSession.sendMessage(new TextMessage(json));
    }
}
```

**连接关闭时** — 移除会话注册：

```java
public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    Long userId = extractUserId(session);
    if (userId != null) {
        sessionManager.removeSession(userId);
    }
}
```

用户 ID 从连接 URL 的 `token` 参数中提取，复用 JWT 校验：

```java
private Long extractUserId(WebSocketSession session) {
    String query = session.getUri().getQuery();
    if (query != null && query.contains("token=")) {
        String token = query.substring(query.indexOf("token=") + 6);
        Map<String, Object> claims = JwtUtil.parseToken(token);
        return ((Number) claims.get("id")).longValue();
    }
    return null;
}
```

### 3. 消息发送与会话同步

消息发送不只是 INSERT 一条记录，还要同步更新双方的会话。`MessageServiceImpl.sendMessage` 用 `@Transactional` 保证原子性：

```java
@Transactional
public Message sendMessage(Long fromId, Long toId, String msgType, String content) {
    // 1. 保存消息
    Message message = new Message();
    message.setFromId(fromId);
    message.setToId(toId);
    message.setMsgType(msgType);
    message.setContent(content);
    message.setStatus(0); // 未读
    messageMapper.insert(message);

    String preview = content.length() > 50 ? content.substring(0, 50) : content;

    // 2. 更新发送方会话（未读数不变）
    Conversation senderConv = conversationMapper.findByUserAndTarget(fromId, toId);
    if (senderConv == null) {
        senderConv = new Conversation();
        senderConv.setUserId(fromId);
        senderConv.setTargetId(toId);
        senderConv.setLastMessage(preview);
        senderConv.setUnreadCount(0);
        conversationMapper.insert(senderConv);
    } else {
        conversationMapper.updateLastMessage(fromId, toId, preview);
    }

    // 3. 更新接收方会话（未读数 +1）
    Conversation receiverConv = conversationMapper.findByUserAndTarget(toId, fromId);
    if (receiverConv == null) {
        receiverConv = new Conversation();
        receiverConv.setUserId(toId);
        receiverConv.setTargetId(fromId);
        receiverConv.setLastMessage(preview);
        receiverConv.setUnreadCount(1);
        conversationMapper.insert(receiverConv);
    } else {
        conversationMapper.updateLastMessage(toId, fromId, preview);
        conversationMapper.incrementUnread(toId, fromId);
    }

    return message;
}
```

会话表的设计是**每对关系两条记录**——A 和 B 聊天，A 有一条 `user_id=A, target_id=B`，B 有一条 `user_id=B, target_id=A`。这样双方的未读数和最后消息可以独立维护，查询时只需 `WHERE user_id = ?`。

### 4. 消息已读与生命周期

消息从发送到清理，经历完整的状态流转：

```
发送 → status=0（未读）→ WebSocket 推送
  ↓
接收方调用 POST /message/read/{fromId}
  ↓
status=1（已读），记录 read_time
  ↓
已读超过 7 天 → 定时任务自动删除 + 关联媒体文件
```

标记已读时同步重置会话未读数：

```java
public void markAsRead(Long fromId, Long toId) {
    messageMapper.markAsRead(fromId, toId);
    conversationMapper.resetUnread(toId, fromId);
}
```

**MessageCleanupTask** 每天凌晨 3 点执行清理：

```java
@Scheduled(cron = "0 0 3 * * ?")
public void cleanExpiredMessages() {
    int deleted = messageService.cleanExpiredMessages();
}
```

清理逻辑先删文件再删记录，保证数据一致性：

```java
public int cleanExpiredMessages() {
    List<Message> expiredMessages = messageMapper.findExpiredReadMessages();
    for (Message msg : expiredMessages) {
        deleteResourceFile(msg); // 只删 image/video/file 类型
    }
    return messageMapper.deleteExpiredReadMessages();
}
```

头像文件存储在 `/uploads/avatar/`，不受消息清理机制影响——因为清理只处理 `msg_type` 为 image/video/file 的消息内容。

### 5. 好友系统与通知推送

好友系统的核心是**双向关系**和**实时通知**。

**发起申请** — 三重校验：

```java
public void apply(Long fromId, String toUsername, String message) {
    User targetUser = userMapper.findByUsername(toUsername);
    if (targetUser == null) throw new RuntimeException("该用户不存在");
    if (fromId.equals(targetUser.getId())) throw new RuntimeException("不能添加自己为好友");

    // 防止重复申请
    FriendRequest existingRequest = friendRequestMapper.findPendingByFromAndTo(fromId, toId);
    if (existingRequest != null) throw new RuntimeException("已经发送过好友申请");

    // 已经是好友
    Friend existingFriend = friendMapper.findByUserAndFriend(fromId, toId);
    if (existingFriend != null && existingFriend.getStatus() == 1)
        throw new RuntimeException("对方已经是你的好友");

    friendRequestMapper.insert(request);

    // 实时推送通知给对方
    notificationService.pushNotification(toId, notification);
}
```

**同意申请** — 事务内双向建联：

```java
@Transactional
public void accept(Long requestId, Long currentUserId) {
    // 校验权限：只有被申请人才能同意
    FriendRequest request = friendRequestMapper.findById(requestId);
    if (!request.getToId().equals(currentUserId))
        throw new RuntimeException("无权处理此申请");

    friendRequestMapper.updateStatus(requestId, 1);

    // 双向插入好友关系
    Friend friend1 = new Friend();
    friend1.setUserId(request.getFromId());
    friend1.setFriendId(request.getToId());
    friendMapper.insert(friend1);

    Friend friend2 = new Friend();
    friend2.setUserId(request.getToId());
    friend2.setFriendId(request.getFromId());
    friendMapper.insert(friend2);

    // 通知申请人
    notificationService.pushNotification(request.getFromId(), notification);
}
```

**通知推送** — NotificationService 通过 SessionManager 查找在线用户：

```java
public void pushNotification(Long userId, Notification notification) {
    WebSocketSession session = sessionManager.getSession(userId);
    if (session != null && session.isOpen()) {
        String json = objectMapper.writeValueAsString(notification);
        session.sendMessage(new TextMessage(json));
    }
}
```

用户在线则实时推送，离线则等下次 WebSocket 连接时在 `afterConnectionEstablished` 中补推。

### 6. 文件上传与类型校验

文件上传分两类：头像和聊天文件，各自有独立的校验逻辑。

**头像上传** — 更换时自动删除旧文件：

```java
@PostMapping("/avatar")
public Result<String> uploadAvatar(@RequestParam("file") MultipartFile file) {
    // 类型校验：仅 jpg/png/gif/webp
    if (!ALLOWED_TYPES.contains(contentType))
        return Result.error("仅支持jpg/png/gif/webp格式的图片");

    // 删除旧头像（只删 /uploads/avatar/ 下的，防误删）
    String oldAvatar = currentUser.getAvatar();
    if (oldAvatar != null && oldAvatar.startsWith("/uploads/avatar/")) {
        File oldFile = new File(uploadDir, oldAvatar.substring("/uploads/".length()));
        if (oldFile.exists()) oldFile.delete();
    }

    // 新文件命名：用户ID_时间戳.扩展名
    String filename = userId + "_" + System.currentTimeMillis() + "." + ext;
    file.transferTo(new File(avatarDir, filename));

    // 更新数据库
    String avatarUrl = "/uploads/avatar/" + filename;
    userService.update(updateUser);
    return Result.success(avatarUrl);
}
```

**聊天文件上传** — 按 type 参数分目录：

```java
@PostMapping("/upload")
public Result<String> uploadChatFile(@RequestParam("file") MultipartFile file,
                                     @RequestParam("type") String type) {
    if ("image".equals(type)) {
        if (!IMAGE_TYPES.contains(contentType))
            return Result.error("仅支持jpg/png/gif/webp格式的图片");
    } else if ("video".equals(type)) {
        if (!VIDEO_TYPES.contains(contentType))
            return Result.error("仅支持mp4/webm/mov格式的视频");
    } else {
        return Result.error("type参数仅支持image或video");
    }

    // 图片 → uploads/chat/image，视频 → uploads/chat/video
    String subDir = "image".equals(type) ? "chat/image" : "chat/video";
    String filename = userId + "_" + System.currentTimeMillis() + "." + ext;
    file.transferTo(new File(dir, filename));

    return Result.success("/uploads/" + subDir + "/" + filename);
}
```

前端拿到 URL 后通过 WebSocket 发送消息，不直接在 HTTP 接口中发消息。

### 7. 统一响应封装

所有接口返回统一的 `Result<T>` 格式：

```java
public class Result<T> {
    private Integer code;    // 0-成功, 1-失败
    private String message;  // 提示信息
    private T data;          // 响应数据

    public static <E> Result<E> success(E data) {
        return new Result<>(0, "操作成功", data);
    }

    public static Result error(String message) {
        return new Result<>(1, message, null);
    }
}
```

配合 **GlobalExceptionHandler** 捕获所有未处理异常：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(Exception.class)
    public Result handleException(Exception e) {
        e.printStackTrace();
        return Result.error(
            StringUtils.hasLength(e.getMessage()) ? e.getMessage() : "操作失败"
        );
    }
}
```

Service 层抛 `RuntimeException`，Controller 层 try-catch 转 `Result.error()`，未捕获的异常由全局处理器兜底。前端永远收到 JSON，不会看到堆栈信息。

### 8. 验证码保护

注册接口用 Kaptcha 生成图形验证码，防止暴力注册：

```java
@Configuration
public class KaptchaConfig {
    @Bean
    public Producer kaptchaProducer() {
        Properties properties = new Properties();
        properties.setProperty("kaptcha.image.width", "100");
        properties.setProperty("kaptcha.image.height", "40");
        // 只用数字和大写字母，避免容易混淆的字符
        properties.setProperty("kaptcha.textproducer.char.string",
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        properties.setProperty("kaptcha.textproducer.char.length", "4");
        properties.setProperty("kaptcha.noise.impl",
            "com.google.code.kaptcha.impl.NoNoise");
        // ...
    }
}
```

验证码文本存入 Session，图片以 PNG 流返回。前端直接将接口 URL 作为 `<img src>` 使用。

### 9. 发送者身份不可伪造

这是一个容易被忽略但极其重要的安全设计。消息发送者的 ID 不是从前端传的，而是从 JWT Token 中提取的：

```java
@PostMapping("/send")
public Result<Message> sendMessage(@RequestBody MessageSendDTO dto) {
    Map<String, Object> claims = ThreadLocalUtil.get();
    Long fromId = ((Number) claims.get("id")).longValue(); // 从 Token 取
    Message message = messageService.sendMessage(fromId, dto.getToId(), dto.getMsgType(), dto.getContent());
    return Result.success(message);
}
```

前端只能指定 `toId`（发给谁）、`msgType`（消息类型）、`content`（消息内容），无法伪造 `fromId`。好友申请同理——申请人 ID 从 Token 中提取，不能冒充别人发申请。

### 10. 数据库设计要点

五张表，各有侧重：

**users** — 用户表，`username` 唯一索引，`online_status` 和 `last_active` 为后续扩展预留

**friend_request** — 好友申请表，`idx_to_id(to_id, status)` 复合索引加速"查询我的待处理申请"

**friend** — 好友关系表，双向存储，`uk_user_friend(user_id, friend_id)` 唯一约束防重复

**conversation** — 会话表，双向存储，`uk_user_target(user_id, target_id)` 唯一约束，`unread_count` 独立维护

**message** — 消息表，`idx_to_status(to_id, status)` 加速"查询我的未读消息"，`idx_read_time(status, read_time)` 加速定时清理

关键设计决策：

- **会话和好友关系都是双向存储**：A 和 B 是好友，friend 表有两条记录；A 和 B 聊天，conversation 表也有两条记录。这样每个用户查自己的列表只需要 `WHERE user_id = ?`，不需要 OR 查询
- **消息表不存发送者用户名**：JOIN 查询比冗余存储更安全，用户改名后历史消息自动同步
- **read_time 字段**：不只是标记已读，还用于计算"已读超过 7 天"的清理条件

## 前后端协作流程

以"发送一条文字消息"为例，完整链路：

```
1. 客户端通过 WebSocket 发送: {"toId": 2, "msgType": "text", "content": "你好"}
2. ChatWebSocketHandler.handleTextMessage() 解析消息
3. 从 Token 提取 fromId，调用 messageService.sendMessage()
4. Service 层: INSERT message + UPDATE/INSERT 双方 conversation
5. Handler 查 SessionManager，对方在线则推送
6. 客户端收到 WebSocket 消息，Riverpod 更新状态，UI 刷新
```

以"发送图片消息"为例：

```
1. 客户端 POST /message/upload 上传图片，拿到 URL
2. 客户端通过 WebSocket 发送: {"toId": 2, "msgType": "image", "content": "/uploads/chat/image/1_xxx.jpg"}
3. 后续流程同文字消息
```

## 遇到的坑与思考

### WebSocket 鉴权不能用 Header

HTTP 请求的 Token 放在 `Authorization` Header 里，但 WebSocket 握手时浏览器不支持自定义 Header。SailChat 的方案是把 Token 放在 URL 参数 `?token=xxx` 中。这有安全隐患——Token 会出现在服务器日志里。生产环境应该用短期 Ticket 方案：先通过 HTTP 接口换取一次性 Ticket，再用 Ticket 建立 WebSocket 连接。

### ConcurrentHashMap 的局限性

SessionManager 用 `ConcurrentHashMap<userId, session>` 管理在线用户，单机没问题。但如果将来要水平扩展（多实例部署），就需要用 Redis Pub/Sub 或消息队列来同步会话状态——A 连在实例 1，B 连在实例 2，实例 1 需要通过中间件把消息转发给实例 2。

### 文件存储的本地化限制

当前文件直接存在服务器本地目录，通过 `ResourceHandler` 映射为 HTTP 可访问。单机够用，但多实例部署时文件不共享。生产环境应该用 OSS（如阿里云 OSS、AWS S3），上传后返回公网 URL。

### 会话表的竞态问题

两个用户同时给对方发消息，可能同时触发 `INSERT conversation`，导致唯一约束冲突。当前依赖数据库唯一索引 + `INSERT` 失败后不重试。更健壮的做法是用 `INSERT ... ON DUPLICATE KEY UPDATE`。

## 总结

SailChat-Server 的核心设计可以归纳为三个原则：

1. **无状态认证**：JWT + ThreadLocal，不依赖 Session，水平扩展友好
2. **离线消息补推**：WebSocket 连接时自动推送未读消息和好友申请，用户不会错过任何信息
3. **事务一致性**：消息发送 + 会话更新在同一事务内，好友关系双向建联在事务内，数据不会出现半成品

即时通讯后端看似只是 CRUD + WebSocket，实际上消息状态同步、会话维护、离线补推、文件清理，每一个环节都需要仔细设计。SailChat 的实现选择了简单可靠的方案——单机部署、本地存储、注解式 ORM，在可维护性和扩展性之间取得了平衡。

---

项目开源地址：[SailChat-Server](https://github.com/OneSailTech/SailChat-Server) | Flutter 客户端：[SailChat](https://github.com/OneSailTech/SailChat)
