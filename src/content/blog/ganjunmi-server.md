---
title: GanJunMi-Server — 基于 Spring Boot 的培训管理后端服务
description: 基于 Spring Boot 2.7 + MyBatis 的后端服务，提供微信授权登录、JWT 认证、培训报名、证书管理、发票管理等完整业务流程。
date: 2025-02-17
tags:
    - Spring Boot
    - MyBatis
    - Java
    - 后端开发
---

## 项目背景

GanJunMi-App 和 GanJunMi-Admin 分别面向学员和管理员，但它们都需要一个统一的后端服务来提供数据支撑。GanJunMi-Server 就是这样一个后端服务，为整个培训管理系统提供 RESTful API 接口。

考虑到项目的企业级属性和团队的技术栈，后端选择了 Spring Boot 2.7 + MyBatis 的组合，配合 MySQL 数据库和 Redis 缓存，构建稳定可靠的服务端架构。

## 技术选型

| 分类 | 技术 | 说明 |
|------|------|------|
| 核心框架 | Spring Boot 2.7.3 | 快速开发，开箱即用 |
| 持久层 | MyBatis | 灵活的 SQL 映射 |
| Web 框架 | Spring MVC | RESTful API 开发 |
| 数据库 | MySQL 8.0+ | 关系型数据库 |
| 连接池 | Druid | 高性能数据库连接池 |
| 缓存 | Redis | 微信 Token 缓存等 |
| 分页 | PageHelper | MyBatis 分页插件 |
| 认证 | JWT (jjwt 0.9.1) | Token 认证机制 |
| 微信集成 | 微信 JS-SDK | 公众号授权登录 |
| 文件存储 | 阿里云 OSS | 云端文件存储 |
| API 文档 | Knife4j | 接口文档自动生成 |
| 工具库 | Hutool | 二维码生成等工具 |

## 项目架构

采用 Maven 多模块架构，职责清晰：

```
train/
├── train-common/          # 公共模块
│   ├── cache/             # 缓存组件（微信 Token 缓存）
│   ├── constant/          # 常量定义
│   ├── context/           # 上下文工具（用户 ID 上下文）
│   ├── exception/         # 自定义异常
│   ├── json/              # Jackson 自定义序列化
│   ├── properties/        # 配置属性（JWT、微信配置）
│   ├── result/            # 统一返回结果
│   └── utils/             # 工具类（JWT、HTTP、OSS）
│
├── train-pojo/            # 实体类模块
│   ├── dto/               # 数据传输对象（30+）
│   ├── entity/            # 数据库实体（7 个核心实体）
│   └── vo/                # 视图对象（13 个 VO）
│
└── train-server/          # 服务模块
    ├── config/            # 配置类（WebMvc、跨域、拦截器）
    ├── controller/        # 控制器（8 个 Controller）
    ├── handler/           # 全局异常处理器
    ├── interceptor/       # JWT Token 拦截器
    ├── mapper/            # MyBatis Mapper（8 个 Mapper）
    ├── service/           # 业务逻辑层（8 个 Service）
    └── task/              # 定时任务（微信 Token 刷新）
```

## 核心功能

### 用户认证

支持两种登录方式：

- **微信授权登录**：学员通过微信 OAuth 授权，后端调用微信接口获取用户信息并生成 JWT Token
- **账号密码登录**：管理员通过账号密码登录，密码采用 MD5 加密存储

### 培训管理

- 培训班次管理：期次新增、编辑、删除，开启/关闭报名
- 班次管理：按期次管理多个班次，查看报名学员
- 学员统计：获取报名班级总人数、分页查询学员信息

### 证书管理

- 证书模板设置：自定义标题、颁证单位、有效期
- 证书颁发：批量给学员颁发证书，自动生成二维码
- 证书查询：通过证书编号公开查询，支持扫码验证

### 发票管理

- 学员端：填写普通发票或增值税专用发票信息
- 管理端：查看学员发票信息，公司发票抬头自动匹配历史数据

### 文章管理

集成微信公众号素材管理：

- 草稿管理：新建、编辑、删除、获取草稿列表
- 发布管理：提交发布、轮询发布状态、删除已发布文章
- 图片上传：上传图文消息内图片获取 URL

### 文件存储

- 本地存储：证件照、回执单、二维码本地保存
- 阿里云 OSS：云端文件上传，支持图片和 PDF 格式

### 定时任务

微信 Access Token 和 JS-SDK Ticket 自动刷新，避免过期导致授权失败。

## 核心实现

### JWT 认证机制

系统采用 JWT Token 进行鉴权，Token 有效期 30 天：

```java
// JWT 工具类
public class JwtUtil {
    private static final String SECRET_KEY = "anjunmi";
    private static final long TTL = 2592000000L; // 30 天
    
    public static String createToken(Long userId) {
        return Jwts.builder()
            .setSubject(userId.toString())
            .setExpiration(new Date(System.currentTimeMillis() + TTL))
            .signWith(SignatureAlgorithm.HS256, SECRET_KEY)
            .compact();
    }
    
    public static Long parseToken(String token) {
        Claims claims = Jwts.parser()
            .setSigningKey(SECRET_KEY)
            .parseClaimsJws(token)
            .getBody();
        return Long.valueOf(claims.getSubject());
    }
}
```

### Token 拦截器

```java
// JWT Token 拦截器
public class JwtInterceptor implements HandlerInterceptor {
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response, 
                            Object handler) {
        // 排除公开接口
        String uri = request.getRequestURI();
        if (uri.contains("/api/user/login") || 
            uri.contains("/api/certificate/getByNumber")) {
            return true;
        }
        
        // 验证 Token
        String token = request.getHeader("token");
        if (StringUtils.isEmpty(token)) {
            throw new CustomException("未登录");
        }
        
        try {
            Long userId = JwtUtil.parseToken(token);
            UserIdContext.setUserId(userId);
            return true;
        } catch (Exception e) {
            throw new CustomException("登录已过期");
        }
    }
}
```

### 微信授权登录

```java
// 微信登录接口
@PostMapping("/login")
public Result login(@RequestBody WxLoginDTO dto) {
    // 调用微信接口获取 openid
    String url = "https://api.weixin.qq.com/sns/oauth2/access_token"
        + "?appid=" + wechatConfig.getAppid()
        + "&secret=" + wechatConfig.getSecret()
        + "&code=" + dto.getCode()
        + "&grant_type=authorization_code";
    
    String response = HttpUtil.get(url);
    JSONObject json = JSON.parseObject(response);
    String openid = json.getString("openid");
    
    // 查询或创建用户
    User user = userService.getByOpenid(openid);
    if (user == null) {
        user = new User();
        user.setOpenid(openid);
        userService.save(user);
    }
    
    // 生成 Token
    String token = JwtUtil.createToken(user.getId());
    return Result.success(token, user);
}
```

### 微信 Token 自动刷新

```java
// 定时任务 - 刷新微信 Token
@Component
public class WechatTokenTask {
    
    @Scheduled(fixedRate = 7000000) // 约 2 小时
    public void refreshToken() {
        // 刷新 access_token
        String tokenUrl = "https://api.weixin.qq.com/cgi-bin/token"
            + "?grant_type=client_credential"
            + "&appid=" + wechatConfig.getAppid()
            + "&secret=" + wechatConfig.getSecret();
        
        String tokenResponse = HttpUtil.get(tokenUrl);
        JSONObject tokenJson = JSON.parseObject(tokenResponse);
        String accessToken = tokenJson.getString("access_token");
        
        // 刷新 jsapi_ticket
        String ticketUrl = "https://api.weixin.qq.com/cgi-bin/ticket/getticket"
            + "?access_token=" + accessToken
            + "&type=jsapi";
        
        String ticketResponse = HttpUtil.get(ticketUrl);
        JSONObject ticketJson = JSON.parseObject(ticketResponse);
        String jsapiTicket = ticketJson.getString("ticket");
        
        // 存入缓存
        WechatTokenCache.setAccessToken(accessToken);
        WechatTokenCache.setJsapiTicket(jsapiTicket);
    }
}
```

### 统一返回结果

```java
// 统一返回结果类
@Data
public class Result<T> {
    private Integer code;
    private String msg;
    private T data;
    
    public static <T> Result<T> success(T data) {
        Result<T> result = new Result<>();
        result.setCode(0);
        result.setMsg("success");
        result.setData(data);
        return result;
    }
    
    public static <T> Result<T> error(String msg) {
        Result<T> result = new Result<>();
        result.setCode(1);
        result.setMsg(msg);
        return result;
    }
}
```

### 全局异常处理

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(CustomException.class)
    public Result handleCustomException(CustomException e) {
        return Result.error(e.getMessage());
    }
    
    @ExceptionHandler(Exception.class)
    public Result handleException(Exception e) {
        return Result.error("服务器内部错误");
    }
}
```

## 数据库设计

核心表结构：

| 表名 | 说明 |
|------|------|
| user | 用户表（学员、管理员、系统管理员） |
| student | 学员信息表 |
| trains_class | 培训班次表 |
| trains_info | 培训期次信息表 |
| certificate | 证书模板表 |
| student_certificate | 学员报名记录表 |
| invoice_info | 发票信息表 |

## 安全设计

- **JWT 签名**：HS256 算法签名，有效期 30 天
- **密码加密**：管理员密码 MD5 加密存储
- **接口鉴权**：JWT 拦截器统一拦截 `/api/**`，排除公开接口
- **SQL 注入防护**：MyBatis 参数化查询
- **跨域配置**：CORS 全局配置
- **文件上传限制**：图片 5MB，回执单 10MB，仅允许图片和 PDF

## 遇到的坑与思考

### 微信 Token 过期问题

微信 access_token 和 jsapi_ticket 有效期只有 2 小时，如果每次请求都重新获取，会触发微信的调用频率限制。

解决方案是使用定时任务提前刷新，并将 Token 存入内存缓存。定时任务每 2 小时执行一次，确保 Token 始终有效。

### 多模块项目依赖管理

Maven 多模块架构需要处理好模块间的依赖关系：

- `train-common` 不依赖其他模块，提供通用工具
- `train-pojo` 依赖 `train-common`，定义数据模型
- `train-server` 依赖 `train-pojo`，实现业务逻辑

这样设计可以避免循环依赖，提高代码复用性。

### 文件上传路径配置

证件照、回执单、二维码需要分别存储在不同目录，通过配置文件统一管理路径：

```yaml
web:
  upload-path: D:/image/
  qrcode-path: D:/image/qrcode/
  receipt-path: D:/image/receipt/
```

部署时只需修改配置文件即可切换存储路径。

## 总结

GanJunMi-Server 是培训管理系统的后端服务，核心亮点在于：

1. **多模块架构**：Maven 多模块设计，职责清晰，易于维护
2. **微信生态集成**：OAuth 登录、JS-SDK 签名、Token 自动刷新
3. **JWT 认证**：统一拦截器处理鉴权，公开接口白名单机制
4. **完整业务流程**：培训、证书、发票、文章管理全覆盖
5. **安全设计**：JWT 签名、密码加密、SQL 注入防护、文件上传限制

这个项目让我深入理解了 Spring Boot 企业级开发的最佳实践，特别是多模块架构设计、微信生态集成和 JWT 认证等场景。

---

项目地址：[GanJunMi-Server](https://github.com/XieYifan1201/GanJunMi-Server)

相关项目：

- [GanJunMi-Admin](https://github.com/OneSailTech/GanJunMi-Admin) — 后台管理系统
- [GanJunMi-App](https://github.com/OneSailTech/GanJunMi-App) — 移动端应用
