# Monitor Glass

Monitor Glass 是由 **wxte** 独立维护、独立版本化和独立发布的 Monitor 公开页主题。

它采用 Once UI 风格的中性视觉体系，并针对服务器监控场景重新设计了首页、节点详情、历史图表和移动端交互。当前仓库不跟随任何其他主题仓库的版本、Release 或更新链路。

![预览](preview.png)

## 特点

- Once UI 风格的 Gray / Black 中性界面
- 首页总览与服务器卡片统一视觉层级
- ServerStatus 风格的紧凑节点信息组织与抽屉详情交互
- iOS / 移动端优先的布局与滚动优化
- 在线状态 Pulse、资源历史图表与三网延迟展示
- 独立 Release：安装包只从本仓库发布

## 安装

从 [Releases](https://github.com/wxte/Monitor-Glass/releases) 下载 `theme.tar.gz`，在 Monitor hub 后台「主题」页上传。

也可以解压到 hub 的 `--themes` 目录下，例如：

```text
themes/
└── glass/
    ├── dist/
    └── theme.json
```

## 版本

当前自主版本线从 **v1.0.0** 开始。

此前开发阶段的实验版本不再作为正式版本线的一部分。

## 许可与第三方

Monitor Glass 以 MIT License 发布。

第三方设计 token / 开源资源的许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。历史代码中需要保留的版权声明继续保留在 [LICENSE](LICENSE) 中；这些声明仅用于许可合规，不代表本主题存在上游发布或更新依赖。
