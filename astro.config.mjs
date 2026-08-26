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
});
