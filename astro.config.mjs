import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
    site: 'https://www.onesailtech.cn',
    integrations: [
        sitemap({
            filter: (page) => page !== 'https://www.onesailtech.cn/diag/',
        }),
    ],
    devToolbar: {
        enabled: false,
    },
    vite: {
        // @ffmpeg/ffmpeg 通过 import.meta.url 定位自己的 Worker。Vite 的依赖
        // 预打包会把入口搬进 .vite/deps，却不会一起搬 worker.js，开发环境里
        // 因而会一直卡在“正在下载”。保持原包结构即可让 Worker 正常打包。
        optimizeDeps: {
            exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core'],
        },
    },
});
