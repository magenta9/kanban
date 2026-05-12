# iCloud Signing Configuration

## 目标

CloudKit 同步只有在 app 和 `KanbanCloudKitHelper` 都使用 Apple 证书、CloudKit entitlement、匹配的 provisioning profile 签名后才会真实可用。ad-hoc 签名可以验证打包结构，但 macOS 会阻止带 iCloud entitlement 的 helper 实际运行 CloudKit。

## Apple Developer 配置

1. 在 Apple Developer 账号中确认 App ID `com.magenta9.kanban`。
2. 为 App ID 启用 iCloud，并勾选 CloudKit。
3. 创建或确认 iCloud container：`iCloud.com.magenta9.kanban`。
4. 生成包含该 App ID 与 container 的 macOS provisioning profile。
5. 准备用于 Electron 打包的 Developer ID Application 或 Mac App Store 证书。

## 本地环境变量

Electron Builder 常用签名输入：

```sh
export CSC_NAME="Developer ID Application: ..."
export CSC_LINK="/absolute/path/to/certificate.p12"
export CSC_KEY_PASSWORD="..."
```

如果走 Apple ID/notarization，再配置：

```sh
export APPLE_ID="..."
export APPLE_APP_SPECIFIC_PASSWORD="..."
export APPLE_TEAM_ID="..."
```

如果 CloudKit container 后续改名，同步更新：

```sh
export KANBAN_CLOUDKIT_CONTAINER="iCloud.com.magenta9.kanban"
```

## 验证命令

打包后运行：

```sh
pnpm verify:signing
```

该命令会检查：

- `release-electron/mac-arm64/Kanban.app` 存在且签名有效。
- `Contents/Resources/KanbanCloudKitHelper` 存在且签名有效。
- app 和 helper 都带 `com.apple.developer.icloud-services = CloudKit`。
- app 和 helper 都带 `iCloud.com.magenta9.kanban` container entitlement。
- app 和 helper 都不是 ad-hoc 签名。

本地只想确认 entitlements 结构时可以运行：

```sh
pnpm verify:signing -- --allow-adhoc
```

`--allow-adhoc` 不能作为 iCloud 发布验收，只用于本地结构检查。