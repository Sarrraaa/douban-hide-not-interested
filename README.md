# 豆瓣 · 不想看隐藏 + 本地标签

一个轻量级、独立的 Tampermonkey 用户脚本，仅用于在浏览器中管理个人观影偏好。**非豆瓣官方项目。**

## 功能

- 在豆瓣电影/电视剧列表和详情页标记 **不想看**，在支持的列表上自动隐藏相应卡片。
- 使用 **显示已隐藏 (N)** 临时展示被隐藏的条目，并可随时取消标记。
- 给作品添加多个本地标签：**想看**、**DBW**（女导演）、**WBW**（女编剧）、**WLW**（女同性恋题材），以及自定义标签。
- 在同一浏览器中的豆瓣标签页之间同步偏好；刷新页面后保留。
- 适配部分豆瓣电影列表、分类排行榜、详情页，以及含电影条目的豆列；网页改版后可能需要更新适配。

## 安装

1. 在 Chrome、Edge 等浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. [点击直接安装最新版脚本](https://raw.githubusercontent.com/Sarrraaa/douban-hide-not-interested/main/douban-hide-not-interested.user.js)，在 Tampermonkey 中确认安装。也可以打开仓库中的 [`douban-hide-not-interested.user.js`](./douban-hide-not-interested.user.js)，点击 **Raw** 安装。
3. 打开 `movie.douban.com` 的电影/电视剧页面，或 `www.douban.com/doulist/` 下的豆列页面。

脚本配置了 `@updateURL` / `@downloadURL`，后续可通过 Tampermonkey 检查更新。

如果还安装了完整的「豆瓣友邻榜」用户脚本，建议只启用其中一个，避免出现重复按钮。

## 数据与隐私

- **完全本地保存**：「不想看」及标签仅存储在 Tampermonkey 的本地 GM 数据中。
- **不采集好友评分、不批量抓取豆列、不访问 IMDb、不主动发起任何网络请求**，也不上传用户偏好。
- 不收集 Cookie、密码，不依赖服务器或第三方 API。
- 与完整「豆瓣友邻榜」使用独立的脚本身份与存储空间，互不覆盖。
- 清除 Tampermonkey 脚本存储或卸载脚本可能删除本地偏好。

## 限制

只用于个人页面增强。所有标签都由用户手动选择，不代表对电影主创或题材进行自动判断。隐藏和标签不会修改豆瓣账号上的原生「想看」状态或官方数据。

本项目与豆瓣无关联、未经豆瓣认可。使用者应自行遵守适用法律与网站规则。

## License

MIT