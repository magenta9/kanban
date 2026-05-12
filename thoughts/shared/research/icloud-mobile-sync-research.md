# iCloud 存储与 iPhone/iPad 方案调研

日期：2026-05-11

## 结论

不要把当前 SQLite 数据库文件直接放进 iCloud Drive 做同步。短期最稳的是 iCloud Drive 一致性快照/备份；中期如果只做 Apple 生态，走记录级 CloudKit 同步；长期如果要原生移动体验，iPhone/iPad 推荐 SwiftUI + Core Data + NSPersistentCloudKitContainer。

如果未来要兼顾 Android/Web，多端同步主路径不应绑定 iCloud，建议评估 PowerSync、Firestore 等跨端同步方案，iCloud 只作为 Apple 用户备份/export 选项。

## 方案对比

| 方案 | 适合 | 不适合 | 维护成本 |
| --- | --- | --- | --- |
| iCloud Drive 快照 | 备份、恢复、手动迁移 | 多端实时编辑、记录级合并 | 低 |
| CloudKit 记录同步 | Apple 设备私有同步、共享、离线本地库 + 云同步 | Electron 直接原生调用 | 中高 |
| Core Data + NSPersistentCloudKitContainer | iOS/iPadOS/macOS 原生 Apple 生态 | 复用当前 SQLite schema / Electron 直接使用 | 中 |
| SQLite 文件放 iCloud Drive | 不建议 | 活跃数据库同步 | 高风险 |
| PowerSync/Firestore | 跨平台、React Native/Web 友好 | 纯 iCloud 生态、无后端 | 中 |

## 为什么不能同步 SQLite 文件本体

Apple iCloud Design Guide 明确不建议把 SQLite store file 放进 iCloud；SQLite 官方也说明 WAL、journal、shm 文件和主库文件必须作为一致整体处理，文件同步服务容易制造缺页、旧新数据混合、WAL 丢失等损坏场景。

可行替代是：在本地用 SQLite 正常运行，导出时用 SQLite backup API 或 `VACUUM INTO` 生成一致快照，再把快照写到 iCloud Drive。

## 对当前 Electron 应用的影响

当前应用是 Electron + React + SQLite。Electron/Node 不能直接调用 Apple 的 CloudKit、NSFileCoordinator、ubiquity container 等 Cocoa API。

可行集成方式：

1. Swift/Objective-C helper 或 XPC/helper app：负责 iCloud Drive/File Coordination/CloudKit，Electron 通过 IPC 调用。最稳，但签名、entitlement、打包复杂。
2. Native Node addon：把 Cocoa API 包成 Node-API addon。可行，但 Electron native module 需要按 Electron ABI rebuild，维护成本高。
3. CloudKit JS：可用，但不能透明复用系统 iCloud 登录，也不适合作为主同步层。更适合管理页或轻量 Web 客户端。

Mac App Store/iCloud 相关要点：需要 App Sandbox、iCloud entitlement、container identifiers；CloudKit 还会涉及 Push Notifications capability。

## 推荐落地路线

### 第一阶段：iCloud Drive 快照/备份

目标：低风险支持“备份到 iCloud / 从 iCloud 恢复”。

做法：

- 保留本地 SQLite 作为唯一活跃数据库。
- 新增导出快照：生成 `.kbbackup` 或每个 board 一个 `.kanbanboard` JSON 包。
- 写入用户选择的 iCloud Drive 目录，或后续由 Swift helper 写入 ubiquity container。
- 明确 UI 文案：这是备份/恢复，不是实时多端同步。

### 第二阶段：记录级同步

目标：桌面和移动端离线优先，多端合并。

Apple-only 详细实现调研见：[apple-only-record-sync-research.md](apple-only-record-sync-research.md)。

做法：

- 每次写入先落本地 SQLite。
- 新增 outbox/change log。
- 同步器负责 push/pull、幂等 apply、冲突合并。
- Apple-only：CloudKit private database。
- 跨平台：PowerSync/Firestore 等后端同步。

### 第三阶段：iPhone/iPad 版

推荐 SwiftUI 原生。

原因：

- iCloud/CloudKit/Core Data 是一等公民。
- iPad 多窗口、拖拽、键盘快捷键、本地通知、后台任务体验最好。
- App Store 分发路径最稳。

React Native/Capacitor 可更快复用部分前端经验，但 iCloud/Core Data 仍需要原生 bridge；如果选择跨平台同步后端，它们才更有优势。

## 数据模型调整建议

所有实体使用稳定 UUID。核心实体：

- board
- column
- card
- label
- card_label
- subtask
- comment

建议新增字段：

- `created_at`
- `updated_at`
- `deleted_at` tombstone
- `created_by_device_id`
- `updated_by_device_id`
- `sync_version` 或 CloudKit `changeTag`

排序不要依赖连续整数，建议使用可插入排序键，例如小数 position 或 LexoRank 类字符串。

## 冲突策略

- title/description/priority/dueDate：字段级 last-write-wins 可接受。
- card 移动：独立处理 `column_id + position`，不要覆盖内容编辑。
- comment：append-only。
- subtask：按 ID 合并。
- label/card_label：集合合并，删除保留 tombstone。
- 删除：默认 delete-wins，但保留最近删除/恢复入口。

## 官方/权威来源

- Apple iCloud 文件管理：https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/iCloud/iCloud.html
- Apple iCloud Design Guide：https://developer.apple.com/library/archive/documentation/General/Conceptual/iCloudDesignGuide/Chapters/iCloudFundametals.html
- CloudKit：https://developer.apple.com/documentation/cloudkit
- CKSyncEngine：https://developer.apple.com/documentation/cloudkit/cksyncengine-5sie5
- NSPersistentCloudKitContainer：https://developer.apple.com/documentation/coredata/nspersistentcloudkitcontainer
- Core Data + CloudKit mirroring：https://developer.apple.com/documentation/coredata/mirroring-a-core-data-store-with-cloudkit
- iCloud entitlements：https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.icloud-services
- Electron Mac App Store guide：https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide
- Electron native modules：https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- SQLite corruption notes：https://www.sqlite.org/howtocorrupt.html
- SQLite WAL：https://www.sqlite.org/wal.html
- PowerSync：https://docs.powersync.com/
- Firestore offline：https://firebase.google.com/docs/firestore/manage-data/enable-offline
