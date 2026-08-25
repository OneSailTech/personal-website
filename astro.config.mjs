import { defineConfig } from 'astro/config';

// TODO(域名待补)：拿到正式域名后取消下面两处注释并填入，即可生效：
//   1. canonical 链接与 og:image 绝对地址（src/layouts/Layout.astro 已就绪）
//   2. sitemap 生成 —— @astrojs/sitemap 已在依赖里，但它强制要求 site 配置，
//      在拿到域名前若提前启用会直接构建失败，所以先注释。
// import sitemap from '@astrojs/sitemap';

export default defineConfig({
    // site: 'https://your-domain.com',
    // integrations: [sitemap()],
    devToolbar: {
        enabled: false,
    },
});
