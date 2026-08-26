---
title: GanJunMi-App — 基于 uni-app 的培训管理移动端应用
description: 面向学员的移动端应用，支持微信授权登录、在线报名、证书扫码查询、发票管理等功能，一套代码同时运行在 H5 和微信小程序。
date: 2025-02-17
tags:
    - uni-app
    - Vue 3
    - 微信小程序
    - 跨端开发
---

## 项目背景

GanJunMi-Admin 是培训机构的后台管理系统，面向管理员使用。而 GanJunMi-App 则是面向学员的移动端应用，两者共同构成完整的培训管理生态。

学员需要通过手机完成培训报名、上传证件照和回执单、查看报名状态、管理发票信息、扫码查询证书等操作。如果让学员使用电脑端的后台系统，体验会很差。因此，开发一个移动端应用是必然选择。

考虑到团队的技术栈和部署成本，最终选择了 uni-app 框架，一套代码同时编译到 H5 和微信小程序，最大化复用开发资源。

## 技术选型

| 分类 | 技术 | 说明 |
|------|------|------|
| 跨端框架 | uni-app | 基于 Vue 3，支持 H5 / 微信小程序多端编译 |
| 前端框架 | Vue 3 | Composition API 兼容，使用 Options API 开发 |
| UI 组件库 | uView UI 1.x | 60+ 组件，多端兼容 |
| 扩展组件 | uni_modules | uni-forms、uni-easyinput、uni-data-picker 等 |
| 微信能力 | 微信 JS-SDK | OAuth 授权登录、扫一扫 |
| 样式 | SCSS | 全局主题变量，渐变背景布局 |
| 状态管理 | uni.setStorageSync | 轻量级本地存储管理用户状态 |
| 网络请求 | uni.request 封装 | 统一拦截器、Token 鉴权、错误处理 |

## 项目架构

```
├── components/              # uView UI 组件库
│   ├── u-form/              # 表单组件
│   ├── u-input/             # 输入框组件
│   ├── u-upload/            # 上传组件
│   └── ...                  # 其他 UI 组件
├── libs/                    # 工具库与配置
│   ├── config/              # 全局配置
│   ├── css/                 # 全局样式
│   ├── function/            # 工具函数（防抖、节流、深拷贝等）
│   ├── mixin/               # 混入
│   ├── request/             # 网络请求封装
│   └── util/                # 工具类（事件派发、表单验证、地区数据）
├── pages/                   # 业务页面
│   ├── index/               # 首页模块
│   │   ├── index.vue        # 首页（功能入口 + 微信登录）
│   │   ├── me.vue           # 个人中心
│   │   ├── me/data.vue      # 个人资料编辑
│   │   ├── me/image.vue     # 证件照上传
│   │   ├── download.vue     # 回执空表下载
│   │   └── allRegInfo.vue   # 所有报名信息
│   ├── trains/              # 培训模块
│   │   ├── register.vue     # 报名培训
│   │   ├── previewRegistration.vue # 填写报名信息
│   │   ├── myRegistration.vue # 我的报名
│   │   └── editStu.vue      # 修改报名信息
│   ├── query.vue            # 证书查询（扫码）
│   └── invoice.vue          # 开票信息
├── uni_modules/             # uni-app 扩展组件
├── utils/                   # 业务工具
│   ├── api.js               # API 接口定义
│   └── request.js           # 请求封装
├── App.vue                  # 应用入口
├── main.js                  # 入口文件
├── pages.json               # 页面路由与 TabBar 配置
└── manifest.json            # 应用配置
```

## 核心功能

### 首页

六大功能入口清晰排列：报名培训、我的报名、开票信息、证书查询、查看报名、回执空表下载。

微信 OAuth 授权登录后，自动检测用户信息完整性。如果缺失证件照或个人资料，会引导用户补全，确保后续业务流程顺畅。

### 报名培训

- 按培训期数筛选班次列表
- 展示班次信息：开班/结班日期、剩余名额
- 点击报名进入填写页面

### 填写报名信息

采用分步表单设计：

1. **基本信息**：姓名、身份证号、手机号、工作单位
2. **地区选择**：市县区级联选择（江西省 11 个地级市 → 区/县二级级联）
3. **证件照上传**：1寸白底，支持图片预览
4. **回执单上传**：支持图片和 PDF 格式

身份证号和手机号有严格的格式校验，上传完成后才可提交报名。

### 我的报名

- 查看已报名的培训列表
- 显示证书状态（已获证书/未获得）和缴费状态
- 未获证书时可修改报名信息或撤销报名

### 证书查询

调用微信 JS-SDK 的 `scanQRCode` 接口扫描证书二维码，解析证书编号后查询并展示证书详情。同时支持通过 URL 参数直接查询，方便分享链接。

### 开票信息

支持两种发票类型：

- **普通发票**：填写抬头、税号
- **增值税专用发票**：额外填写银行开户名、银行账号、公司地址、公司电话

### 个人中心

- 展示用户头像、姓名
- 证件照管理：上传/更换
- 个人资料编辑：姓名、身份证号、手机号、性别

## 核心实现

### 微信 OAuth 登录

首页加载时解析 URL 中的 `code` 参数，调用后端接口完成微信授权登录：

```js
// pages/index/index.vue
onLoad(options) {
  if (options.code) {
    this.wxLogin(options.code)
  }
},

methods: {
  async wxLogin(code) {
    const res = await this.$api.wxLogin({ code })
    if (res.code === 0) {
      const { token, name, idCard } = res.data
      uni.setStorageSync('token', token)
      uni.setStorageSync('name', name)
      uni.setStorageSync('idCard', idCard)
      
      // 检测信息完整性
      this.checkUserInfo()
    }
  },
  
  checkUserInfo() {
    const hasPhoto = uni.getStorageSync('hasPhoto')
    const hasProfile = uni.getStorageSync('hasProfile')
    if (!hasPhoto || !hasProfile) {
      uni.showModal({
        title: '提示',
        content: '请完善个人资料',
        success: (res) => {
          if (res.confirm) {
            uni.navigateTo({ url: '/pages/index/me' })
          }
        }
      })
    }
  }
}
```

登录后将 Token、姓名、身份证号等关键信息存储到本地，后续请求自动携带 Token 鉴权。

### 请求封装与鉴权

```js
// utils/request.js
const request = (options) => {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('token')
    
    uni.request({
      url: `${baseUrl}${options.url}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Authorization': token ? `Bearer ${token}` : '',
        ...options.header
      },
      success: (res) => {
        if (res.data.code !== 0) {
          uni.showToast({ title: res.data.msg, icon: 'none' })
          reject(res.data)
        } else {
          resolve(res.data)
        }
      },
      fail: (err) => {
        uni.showToast({ title: '服务器错误,请稍后再试', icon: 'none' })
        reject(err)
      }
    })
  })
}
```

### 证书扫码查询

通过微信 JS-SDK 的 `scanQRCode` 接口实现扫码功能：

```js
// pages/query.vue
async scanQRCode() {
  // 获取微信签名配置
  const config = await this.$api.getWxConfig({ url: location.href })
  
  wx.config({
    debug: false,
    appId: config.appId,
    timestamp: config.timestamp,
    nonceStr: config.nonceStr,
    signature: config.signature,
    jsApiList: ['scanQRCode']
  })
  
  wx.ready(() => {
    wx.scanQRCode({
      needResult: 1,
      scanType: ['qrCode'],
      success: async (res) => {
        const certNumber = this.parseCertNumber(res.resultStr)
        const cert = await this.$api.queryCertificate({ certNumber })
        this.showCertificate(cert)
      }
    })
  })
}
```

扫码前需要先调用后端接口获取微信签名配置，完成 `wx.config` 初始化后才能调用扫一扫。

### 文件上传

证件照和回执单上传使用 `uni.uploadFile` API：

```js
async uploadPhoto(filePath) {
  const token = uni.getStorageSync('token')
  
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${baseUrl}/api/upload`,
      filePath: filePath,
      name: 'file',
      header: {
        'Authorization': `Bearer ${token}`
      },
      success: (res) => {
        const data = JSON.parse(res.data)
        if (data.code === 0) {
          this.photoUrl = data.data.url
          this.photoUploaded = true
          resolve(data)
        } else {
          reject(data)
        }
      },
      fail: reject
    })
  })
}
```

上传成功后将文件 URL 存入表单数据，通过标志位控制提交按钮的可用状态，确保必传文件上传完成后才可提交。

### 表单校验

使用 `uni-forms` 组件的 `rules` 配置实现表单校验：

```js
rules: {
  name: {
    rules: [{ required: true, errorMessage: '请输入姓名' }]
  },
  idCard: {
    rules: [
      { required: true, errorMessage: '请输入身份证号' },
      { 
        pattern: /^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$/,
        errorMessage: '请输入正确的身份证号'
      }
    ]
  },
  phone: {
    rules: [
      { required: true, errorMessage: '请输入手机号' },
      {
        pattern: /^1[3-9]\d{9}$/,
        errorMessage: '请输入正确的手机号'
      }
    ]
  }
}
```

支持必填校验、正则校验，校验不通过时自动显示错误提示。

## 遇到的坑与思考

### 微信 JS-SDK 签名配置

调用微信扫一扫功能前，必须先完成 `wx.config` 初始化。签名配置需要后端根据当前页面 URL 动态生成，每次页面跳转后都需要重新获取。

解决方案是在进入扫码页面前调用后端接口获取配置，确保签名与当前 URL 匹配。

### uni-app 条件编译

项目使用 uni-app 条件编译处理平台差异：

```js
// #ifdef MP-WEIXIN
// 微信小程序特有代码
// #endif

// #ifdef H5
// H5 特有代码
// #endif
```

在 `manifest.json` 中配置 `navigationStyle: custom` 实现自定义导航栏，配合渐变背景实现沉浸式效果。

### 级联数据选择

江西省 11 个地级市的区/县二级级联选择，使用 `uni-data-picker` 组件实现。数据结构化配置，易于维护和扩展：

```js
// 地区数据结构
{
  text: '南昌市',
  value: '360100',
  children: [
    { text: '东湖区', value: '360102' },
    { text: '西湖区', value: '360103' },
    // ...
  ]
}
```

### 文件上传与表单提交联动

证件照和回执单是必传字段，上传状态需要联动控制提交按钮：

```js
computed: {
  canSubmit() {
    return this.photoUploaded && this.receiptUploaded && this.formValid
  }
}
```

确保所有必传文件上传完成且表单校验通过后，提交按钮才可点击。

## 总结

GanJunMi-App 是培训管理系统的移动端应用，核心亮点在于：

1. **微信生态深度集成**：OAuth 登录、JS-SDK 扫一扫、签名配置动态获取
2. **跨端开发架构**：一套代码编译到 H5 和微信小程序，条件编译处理平台差异
3. **完善的表单校验体系**：身份证正则、手机号校验、文件上传状态联动
4. **级联数据选择**：江西省地级市区/县二级级联，结构化配置易于维护

这个项目让我深入理解了跨端开发的实践，特别是微信生态能力集成、条件编译处理和多端适配等场景。

---

项目地址：[GanJunMi-App](https://github.com/XieYifan1201/GanJunMi-App)

相关项目：

- [GanJunMi-Admin](https://github.com/OneSailTech/GanJunMi-Admin) — 后台管理系统
- [GanJunMi-Server](https://github.com/OneSailTech/GanJunMi-Server) — 后端服务
