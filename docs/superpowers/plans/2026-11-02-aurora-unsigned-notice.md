# 未签名发布与说明补齐（2026-11-02）

## 起因

v0.1.1 发布后，安装包在 Windows 上会弹「未知发布者」。这个程序没有购买 Windows 代码签名证书，于是用户在安装这一步被拦一下，而仓库和 release notes 都没有解释这件事。

## 决定（用户拍板）

暂不买证书，走零成本路线：把「Windows 提示未知发布者」写进 **README（中英）**、**应用内离线指南的常见问题**、**release notes** 三处。

查证过但当前不采用的路径：

| 路径 | 结论 |
| --- | --- |
| Azure Trusted Signing（约 $9.99/月，无需硬件令牌） | 微软限定「美/加个人 + 美/加/欧盟/英国组织」，本项目不适用 |
| Sectigo/Comodo IV 个人证书（约 3200 元/年，身份证即可，无需营业执照） | 可行但需要付费；个人证书与 OV 在 Windows 上的信任级别相同，新证书同样要靠下载量积累 SmartScreen 信誉 |
| OV 企业证书（约 1200–4400 元/年） | 需要营业执照 |
| SignPath Foundation（免费开源签名） | 需申请审核、每次发布人工批准、发布者显示 "SignPath Foundation"，且要搭 GitHub Actions 可信构建 |
| 自签名 | 对第三方无意义 |

工具链已查清：electron-builder 25.1.8 在 macOS 上用自带 `osslsigncode` 签名，**不需要 wine**（缓存路径 `~/Library/Caches/electron-builder/winCodeSign/winCodeSign-2.6.0/darwin/osslsigncode`）；25.1.8 没有 pkcs11 后端，若 CA 发的是 USB Token 则本机签不了。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/aurora-guide-data.js` | 常见问题新增 `windows-warning`：为什么提示、怎么继续、怎么校验下载文件 |
| `README.md` | 下载章节新增「Windows 会提示「未知发布者」」小节；条数 51 → 52 |
| `README.en.md` | 同上（English）；条数 51 → 52 |
| `test/aurora/guide.test.js` | 新增用例：常见问题必须回答未签名提示，且中英文都能搜到 |
| `package.json` / `package-lock.json` | 版本 0.1.1 → 0.1.2 |

## 验证

- `npm test`：170 passed / 0 failed（新增 1 条）。
- `npm run test:legacy`：284 tests，271 pass，11 fail，2 skip——失败清单与基线一致。
- 指南结构复核：8 章节 52 条，常见问题 8 条。
