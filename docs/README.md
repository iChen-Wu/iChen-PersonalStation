# iChen 文档

文档分三个部分：

| 部分 | 文档 | 内容 |
|---|---|---|
| **一、开发流程与习惯** | [1-开发流程](1-开发流程.md) | 版本规则、日常命令、开发约定、三部署发布同步、数据备份与恢复 |
| **二、项目介绍与标准** | [2-项目说明](2-项目说明.md) | 项目定位、三个版本边界、目录结构、关键机制、数据布局与红线 |
|  | [3-App开发指南](3-App开发指南.md) | **做 App 看这份**：目录模型、manifest、ui/core 协议、自测清单（唯一权威规格） |
| **三、日志** | [开发记录](开发记录.md) | v3.0.0 起的变更台账（版本、关键决策、事故记录） |

v1/v2 时代的旧文档（17 份）已整体归档到 Obsidian（只读留存）：
`D:/iChen/data/iChen_Obsidian/项目/iChen/原归档/iChen旧文档_20261005/`。

## 常用命令

```bash
python -m system.main                       # 启动开发版中枢
python ../workbench/tools/run_tests.py      # 全量测试（全绿才收工）
python ../workbench/tools/update_production.py            # 比对正式版差异（不写入）
python ../workbench/tools/update_production.py --apply    # 更新正式版（只换中枢代码）
python ../workbench/tools/update_production.py H:\iChen --apply  # 更新 U 盘移动版
```

## 给 AI 的一句话

- 在本仓库（中枢开发）改的是 `system/`、`shared/`；工程脚本在仓库外 `../workbench/`，动完跑测试、
  改版本号（两处）、写开发记录。
- 做 App 时把工作区直接选到 `apps/`，先读 `apps/README.md` 与 [3-App开发指南](3-App开发指南.md)，
  不要改中枢代码。
- 永远不要覆盖正式版 `D:\iChen` 与 U 盘 `H:\iChen` 的 `apps/ shared/ data/ runtime/`。
