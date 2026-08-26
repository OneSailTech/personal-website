---
title: GanJunMi-Admin — 基于 Vue 2 的培训机构一站式后台管理系统
description: 从培训信息发布、学员报名录入、缴费管理到证书生成打印，完整记录培训机构后台管理系统的设计与实现。
date: 2025-02-17
tags:
    - Vue 2
    - Element UI
    - 后台管理
    - Canvas
---

## 项目背景

培训机构在日常运营中需要处理大量事务：发布培训信息、管理学员报名、跟踪缴费状态、批量颁发证书。这些工作如果依赖 Excel 和纸质文件，效率低且容易出错。

GanJunMi-Admin 就是为了解决这些问题而开发的。它是一个面向培训机构的一站式后台管理平台，涵盖从培训信息发布到证书生成打印的全流程管理。

## 技术选型

| 分类 | 技术 | 选择理由 |
|------|------|----------|
| 框架 | Vue 2.6 | 生态成熟，团队熟悉度高 |
| UI 组件库 | Element UI 2.13 | 组件丰富，适合后台管理系统 |
| 状态管理 | Vuex 3.1 | 集中式状态管理，适合多模块协作 |
| 路由 | Vue Router 3.0 | 声明式路由，配合权限守卫使用 |
| HTTP 请求 | Axios | 拦截器机制成熟，统一处理鉴权 |
| 图表 | ECharts 5 | 数据可视化，仪表盘统计展示 |
| Excel 导出 | SheetJS (xlsx) | 纯前端导出，无需后端支持 |
| 证书渲染 | Canvas 2D API | 客户端渲染，支持自定义模板 |
| 样式 | SCSS | 嵌套与变量，提高样式可维护性 |
| 构建工具 | Vue CLI 4 | 开箱即用，配置简单 |

## 项目架构

```
src/
├── api/                  # 接口请求模块
│   ├── admin.js          # 管理员相关接口
│   ├── student.js        # 学员相关接口
│   ├── trains.js         # 培训与证书相关接口
│   └── user.js           # 登录鉴权接口
├── components/           # 公共组件
│   ├── Breadcrumb/       # 面包屑导航
│   ├── Hamburger/        # 侧边栏折叠按钮
│   └── SvgIcon/          # SVG 图标组件
├── layout/               # 页面布局框架
│   ├── components/
│   │   ├── Sidebar/      # 侧边栏
│   │   ├── Navbar.vue    # 顶部导航栏
│   │   └── AppMain.vue   # 主内容区
│   └── index.vue         # 布局入口
├── router/               # 路由配置
├── store/                # Vuex 状态管理
│   └── modules/
│       ├── app.js        # 应用状态（侧边栏等）
│       ├── settings.js   # 全局设置
│       └── user.js       # 用户信息与鉴权
├── utils/                # 工具函数
│   ├── auth.js           # Token 存取
│   ├── request.js        # Axios 封装
│   ├── validate.js       # 表单验证规则
│   └── get-page-title.js # 页面标题生成
├── views/                # 页面组件
│   ├── admin/            # 用户管理
│   ├── certificate/      # 证书管理
│   ├── dashboard/        # 首页仪表盘
│   ├── login/            # 登录
│   ├── student/          # 学员管理
│   ├── trains/           # 培训管理
│   └── 404.vue           # 404 页面
├── permission.js         # 全局路由守卫
└── main.js               # 入口文件
```

## 核心功能

### 首页仪表盘

首页展示核心统计数据：培训数量、期数数量、学员总数，以及各培训班报名人数的柱状图。管理员打开系统就能快速了解整体运营情况。

### 培训管理

采用**多期数多班次**的管理架构：

- 培训项目的新增、编辑、删除，支持状态控制
- 按培训项目管理多个期数班次
- 查看各班次报名学员，支持 Excel 导出
- 回执空表上传功能

### 学员管理

学员信息录入采用**三步表单**设计：

1. **基本信息**：姓名、身份证号、联系方式等
2. **培训报名**：选择培训班次
3. **发票信息**：开票需求填写

支持多条件搜索、分页浏览、批量导出、缴费状态管理等功能。身份证号和手机号有格式校验，减少录入错误。

### 证书管理

这是系统最有特色的模块：

- **证书模板设置**：自定义标题、颁证单位、有效期、发证日期
- **批量颁发证书**：按班次批量操作，提高效率
- **Canvas 证书渲染**：客户端渲染证书，包含证件照、二维码、正文自动换行
- **浏览器打印**：渲染完成后调用浏览器打印功能直接输出

### 用户管理

区分系统管理员与普通管理员角色，支持密码重置、账号删除等管理操作。

## 核心实现

### 权限控制

系统采用基于 Token 的鉴权机制：

```js
// request.js - Axios 请求拦截器
service.interceptors.request.use(
  config => {
    const token = getToken()
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  }
)

// permission.js - 路由守卫
router.beforeEach(async (to, from, next) => {
  const hasToken = getToken()
  if (hasToken) {
    // 已登录，检查用户信息
    const hasRoles = store.getters.roles && store.getters.roles.length > 0
    if (hasRoles) {
      next()
    } else {
      // 获取用户信息和权限
      const { roles } = await store.dispatch('user/getInfo')
      const accessRoutes = await store.dispatch('permission/generateRoutes', roles)
      router.addRoutes(accessRoutes)
      next({ ...to, replace: true })
    }
  } else {
    // 未登录，跳转登录页
    next(`/login?redirect=${to.path}`)
  }
})
```

Token 存储在 Cookie 中，每次路由跳转前校验有效性，未登录用户自动重定向。

### Canvas 证书渲染

证书打印是系统的核心功能之一，使用 Canvas 2D API 在客户端渲染：

```js
function drawCertificate(canvas, data) {
  const ctx = canvas.getContext('2d')
  
  // 绘制背景
  ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height)
  
  // 绘制证件照
  ctx.drawImage(photoImage, photoX, photoY, photoWidth, photoHeight)
  
  // 绘制二维码
  ctx.drawImage(qrImage, qrX, qrY, qrWidth, qrHeight)
  
  // 绘制正文（自动换行）
  drawTextWithWrap(ctx, content, textX, textY, maxWidth, lineHeight)
  
  // 绘制颁证单位和日期
  ctx.fillText(issuer, issuerX, issuerY)
  ctx.fillText(issueDate, dateX, dateY)
}
```

正文自动换行基于 `measureText` 逐字计算宽度，确保不同长度的文本都能正确排版。渲染完成后将 Canvas 转为图片，通过新窗口调用浏览器打印。

### Excel 导出

学员信息导出基于 SheetJS 库，纯前端实现：

```js
import XLSX from 'xlsx'

function exportStudents(students) {
  const header = ['姓名', '身份证号', '手机号', '培训班', '缴费状态']
  const data = students.map(s => [
    s.name,
    s.idCard,
    s.phone,
    s.trainName,
    s.payStatus
  ])
  
  const ws = XLSX.utils.aoa_to_sheet([header, ...data])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '学员信息')
  XLSX.writeFile(wb, '学员信息.xlsx')
}
```

无需后端支持，直接在浏览器中生成并下载 Excel 文件。

### Axios 封装

统一的请求封装，集中处理错误和鉴权：

```js
const service = axios.create({
  baseURL: process.env.VUE_APP_BASE_API,
  timeout: 10000
})

service.interceptors.response.use(
  response => {
    const { code, msg } = response.data
    if (code === 200) {
      return response.data
    } else {
      Message.error(msg || '请求失败')
      return Promise.reject(new Error(msg))
    }
  },
  error => {
    if (error.response && error.response.status === 401) {
      removeToken()
      location.href = '/login'
    }
    Message.error(error.message)
    return Promise.reject(error)
  }
)
```

## 遇到的坑与思考

### Canvas 图片跨域

证书渲染时需要加载证件照和二维码图片，如果图片来自不同域名，Canvas 会被污染，无法调用 `toDataURL`。解决方案是在图片加载时设置 `crossOrigin = 'anonymous'`，同时服务器需要配置 CORS 响应头。

### Canvas 文字自动换行

Canvas 原生不支持文字自动换行，需要手动实现。核心思路是用 `measureText` 逐字测量宽度，超过最大宽度就换行：

```js
function drawTextWithWrap(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split('')
  let line = ''
  let currentY = y
  
  for (let i = 0; i < chars.length; i++) {
    const testLine = line + chars[i]
    const metrics = ctx.measureText(testLine)
    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY)
      line = chars[i]
      currentY += lineHeight
    } else {
      line = testLine
    }
  }
  ctx.fillText(line, x, currentY)
}
```

### 多期数管理架构

培训管理采用"培训项目 → 期数 → 学员"的三层结构，而不是简单的扁平列表。这样设计的好处是：同一个培训项目可以开设多个班次，每个班次独立管理学员，数据结构更清晰。

## 总结

GanJunMi-Admin 是一个功能完整的培训机构后台管理系统，核心亮点在于：

1. **全流程覆盖**：从培训发布到证书打印，一站式解决
2. **Canvas 证书渲染**：客户端渲染，支持自定义模板和自动换行
3. **多期数管理**：灵活的培训班次架构
4. **纯前端导出**：Excel 导出无需后端支持

这个项目让我深入理解了后台管理系统的设计模式，特别是权限控制、Canvas 渲染和复杂表单处理等场景。

---

项目地址：[GanJunMi-Admin](https://github.com/XieYifan1201/GanJunMi-Admin)

相关项目：

- [GanJunMi-App](https://github.com/OneSailTech/GanJunMi-App) — 移动端应用
- [GanJunMi-Server](https://github.com/OneSailTech/GanJunMi-Server) — 后端服务
