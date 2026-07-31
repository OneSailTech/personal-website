---
title: Flutter 如何直接使用 Figma 标注值：一套更自然的尺寸适配方案
description: 一个面向 Flutter 项目的 Figma 尺寸适配方案与 AI Agent Skill。
date: 2026-06-15
tags:
    - Figma
    - Flutter
    - dart
    - Node.js
    - Android
---

## 前言

在 Flutter 项目里，设计师给出的 Figma 设计稿经常是 750px、720px 或 1080px 宽，而 Flutter 使用的是逻辑像素。

于是，开发过程中很容易出现一种情况：

设计稿上标注的是 32px，代码里却要写成 16；设计稿上是 88px，代码里却要先计算成 44。

时间一长，页面里会出现大量人工换算：

```dart
width: 320 / 2,
height: 88 / 2,
fontSize: 28 / 2,
```

这种写法看起来简单，但它有两个问题。

第一，开发者必须不断手动换算，容易出错。

第二，“除以 2”只适用于特定设计稿和特定基准设备。换成不同宽度的手机后，页面并不会继续按照屏幕宽度自动调整。

因此，更理想的使用方式应该是：

```dart
width: 320.ui,
height: 88.ui,
fontSize: 28.font,
```

代码里的数字和 Figma 标注保持一致，尺寸换算全部交给统一工具处理。

---

## 为什么 750px 设计稿经常要除以 2

很多移动端设计稿使用 750px 宽，是因为它通常对应一台逻辑宽度为 375dp 的设备。

它们之间的关系是：

```text
750px → 375dp
```

因此，设计稿中的 100px，在基准设备上就是：

```text
100 × 375 ÷ 750 = 50dp
```

这就是“除以 2”的来源。

但除以 2 并不是尺寸适配规则，它只是 750px 设计稿到 375dp 基准设备的一次换算。

如果设备宽度变成 390dp，同一个 100px 的设计尺寸应该变成：

```text
100 × 390 ÷ 750 = 52dp
```

如果还是固定写成 50dp，页面在不同手机上的相对比例就不会完全一致。

所以，更完整的换算关系应该是：

```text
实际尺寸 = 设计稿尺寸 × 当前设备宽度 ÷ 设计稿宽度
```

这才是根据不同手机宽度动态适配的核心。

---

## 750 不是固定规则

750 只是某一份设计稿的宽度，不应该写死成所有项目的标准。

不同项目可能使用：

- 750px 设计稿，对应 375dp 基准设备
- 720px 设计稿，对应 360dp 基准设备
- 1080px 设计稿，对应 360dp 基准设备

因此，尺寸工具至少需要两个基准值：

```dart
static const double designWidth = 750;
static const double designLogicalWidth = 375;
```

`designWidth` 表示 Figma 设计稿的像素宽度。

`designLogicalWidth` 表示这份设计稿所对应的 Flutter 基准逻辑宽度。

这样做比单独保存一个 750 更准确。

例如，720px 设计稿对应 360dp 时：

```dart
static const double designWidth = 720;
static const double designLogicalWidth = 360;
```

业务代码依然可以继续写：

```dart
width: 320.ui,
```

页面不需要知道设计稿到底是 720、750 还是 1080。

---

## 尺寸适配不只是简单乘比例

如果完全按照屏幕宽度无限放大，手机页面到了平板、横屏或折叠屏上，按钮、图标和字体都会变得非常夸张。

例如，一份 750px / 375dp 的设计稿，在 800dp 宽的窗口中，设备比例会达到：

```text
800 ÷ 375 ≈ 2.13
```

如果所有尺寸都直接放大 2.13 倍，显然不合理。

所以实际实现中需要设置一个缩放范围：

```dart
static const double minUiScale = 0.90;
static const double maxUiScale = 1.20;
```

字体还应该更加保守：

```dart
static const double minFontScale = 0.95;
static const double maxFontScale = 1.08;
```

这样可以做到：

- 小屏设备适当缩小
- 大屏手机适当放大
- 平板和横屏不会无限放大
- 字体不会随着屏幕宽度过度增长

这也是为什么布局尺寸和字体尺寸应该分开处理。

---

## 使用 GetX 后，可以省略 context

普通尺寸扩展通常需要这样调用：

```dart
width: 320.ui(context),
fontSize: 28.font(context),
```

如果项目本身已经使用 GetX，可以通过 `Get.context` 获取当前页面上下文，于是调用方式可以进一步简化为：

```dart
width: 320.ui,
fontSize: 28.font,
```

这种写法更接近设计稿，也减少了页面中的重复参数。

不过需要注意，`Get.context` 并不是任何时候都存在。

它适合在以下场景使用：

- Widget 的 `build` 方法中
- 页面已经挂载后
- 正常的 UI 构建和交互过程中

它不适合用在：

- `runApp` 之前
- 顶层变量初始化
- 静态常量初始化
- 页面销毁后的异步回调
- 后台 Isolate

因此，下面这种写法可能有问题：

```dart
final cardWidth = 320.ui;
```

如果它在应用启动阶段执行，`Get.context` 可能还没有建立。

更稳妥的方式是在 Widget 构建阶段读取：

```dart
@override
Widget build(BuildContext context) {
  final cardWidth = 320.ui;

  return SizedBox(width: cardWidth);
}
```

---

## 核心实现

下面是一份完整但尽量精简的实现。

```dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class AppSize {
  AppSize._();

  /// Figma 设计稿像素宽度。
  static const double designWidth = 750;

  /// 设计稿对应的 Flutter 基准逻辑宽度。
  static const double designLogicalWidth = 375;

  static const double minUiScale = 0.90;
  static const double maxUiScale = 1.20;

  static const double minFontScale = 0.95;
  static const double maxFontScale = 1.08;

  static BuildContext get context {
    final value = Get.context;

    if (value == null) {
      throw StateError(
        '无法获取 Get.context，请确保应用使用 GetMaterialApp，'
        '并在 Widget 构建阶段调用尺寸扩展。',
      );
    }

    return value;
  }

  static double get screenWidth {
    return MediaQuery.sizeOf(context).width;
  }

  static double get rawScale {
    return screenWidth / designLogicalWidth;
  }

  static double get uiScale {
    return rawScale.clamp(minUiScale, maxUiScale).toDouble();
  }

  static double get fontScale {
    return rawScale.clamp(minFontScale, maxFontScale).toDouble();
  }

  static double toLogicalSize(double designValue) {
    return designValue * designLogicalWidth / designWidth;
  }

  static double ui(double designValue) {
    return toLogicalSize(designValue) * uiScale;
  }

  static double font(double designValue) {
    return toLogicalSize(designValue) * fontScale;
  }
}

extension AppSizeExtension on num {
  double get ui => AppSize.ui(toDouble());

  double get font => AppSize.font(toDouble());
}
```

这段代码做了三件事：

第一步，把 Figma 像素值转换成基准设备上的 Flutter 逻辑尺寸。

第二步，根据当前设备宽度计算缩放比例。

第三步，通过最小值和最大值限制缩放范围，避免在极端屏幕上失控。

---

## 页面中怎么使用

使用方式非常直接。

设计稿中的宽高：

```dart
SizedBox(
  width: 320.ui,
  height: 88.ui,
)
```

设计稿中的间距：

```dart
Padding(
  padding: EdgeInsets.symmetric(
    horizontal: 32.ui,
    vertical: 24.ui,
  ),
  child: const Text('内容'),
)
```

设计稿中的圆角：

```dart
BorderRadius.circular(20.ui)
```

设计稿中的字号：

```dart
TextStyle(
  fontSize: 28.font,
)
```

重点是，代码中的数字直接等于 Figma 标注，不需要再手动除以 2。

---

## 这套方案解决了什么

它真正解决的不是“如何写一个扩展方法”，而是统一了设计稿到代码之间的规则。

团队可以约定：

```text
布局尺寸使用 .ui
字体尺寸使用 .font
Figma 标注值直接复制
设计基准统一配置
业务页面禁止手动换算
```

这样做有几个明显好处。

### 1. 减少人工换算

开发者不再需要看到 64 就先想到 32，也不需要在页面里到处写除法。

### 2. 设计稿和代码更容易核对

设计师说按钮宽度是 320px，代码里也能直接看到 `320.ui`。

### 3. 不同手机自动适配

同一个设计尺寸会根据当前手机宽度得到不同的显示值，而不是永远固定。

### 4. 更适合 AI 编程工具

当项目规范明确后，AI 可以直接从 Figma 标注生成：

```dart
width: 320.ui,
height: 88.ui,
fontSize: 28.font,
```

不需要猜测项目中到底要不要除以 2。

---

## 它不能替代响应式布局

尺寸缩放只适合解决同一套手机布局在不同屏幕宽度下的比例问题。

它不能替代：

- 平板布局
- 桌面端布局
- Web 多断点布局
- 横屏结构重排
- 折叠屏双栏布局

例如，当页面宽度超过 600dp 时，更合理的做法通常是切换布局，而不是继续放大手机页面：

```dart
LayoutBuilder(
  builder: (context, constraints) {
    if (constraints.maxWidth >= 600) {
      return const TabletLayout();
    }

    return const MobileLayout();
  },
)
```

尺寸适配负责“大小”，响应式布局负责“结构”。

这两个概念不能混为一谈。

---

## 安全区域也不应该交给尺寸适配

状态栏、刘海、灵动岛、底部手势区域和键盘高度，都不是普通设计尺寸。

这些区域应该使用 Flutter 原生能力处理：

```dart
SafeArea(
  child: YourPage(),
)
```

或者：

```dart
MediaQuery.paddingOf(context)
```

不要因为 Figma 顶部留了 88px，就直接把它当成所有设备的状态栏高度。

---

## 关于系统字体缩放

`.font` 负责的是设计稿字号到应用字号之间的换算。

它不会自动取消用户在系统中设置的字体放大。

这是正常的无障碍行为。

为了追求设计稿像素级一致而全局禁止系统字体缩放，通常并不推荐。更好的方式是只对确实需要固定尺寸的局部组件进行评估。

---

## 推荐的项目规范

在实际项目中，可以把以下规则写进 `AGENTS.md`、团队规范或 AI Skill 中：

```text
1. Figma 布局尺寸必须使用 .ui
2. Figma 字号必须使用 .font
3. 禁止手动除以 2
4. 禁止重复乘缩放比例
5. 禁止混用多套尺寸适配方案
6. 安全区域使用 Flutter 原生能力处理
7. 平板和桌面端使用响应式布局
8. 修改设计稿基准时，同时检查 designWidth 和 designLogicalWidth
```

例如，正确写法是：

```dart
width: 320.ui,
fontSize: 28.font,
```

错误写法包括：

```dart
width: (320 / 2).ui;
width: 320.ui * AppSize.uiScale;
fontSize: 28.ui;
```

---

## 总结

一套好的尺寸适配方案，不应该让开发者记住更多换算规则，而应该让代码更接近设计稿。

最终希望达到的效果是：

设计稿中写着：

```text
宽度 320px
高度 88px
圆角 16px
字号 28px
```

Flutter 中就写：

```dart
width: 320.ui,
height: 88.ui,
borderRadius: BorderRadius.circular(16.ui),
fontSize: 28.font,
```

至于当前设备是 360dp、375dp、390dp 还是 430dp，交给尺寸工具统一处理。

当设计稿从 750px 改为 720px 或 1080px 时，只需要修改项目中的设计基准配置，业务页面不需要重新换算。

这比在页面中不断手动除以 2 更稳定，也更容易维护，更适合团队协作。

---

Skills开源地址：[flutter-figma-size](https://github.com/OneSailTech/flutter-figma-size)
