// 图片编码的统一入口。页面只跟这里打交道：
// 挑格式、问浏览器支不支持、把一张图编成目标格式的 Blob。

import { encodeBmp } from './bmp';
import { encodeGif } from './gif';
import { encodeIco } from './ico';
import { encodeTiff } from './tiff';
import { computeTargetSize, drawResized, type ResizeOptions } from './resize';

// 页面只跟这里打交道，尺寸相关的类型和纯函数也从这里转出去
export type { ResizeMode, FitMode, ResizeOptions } from './resize';
export { computeTargetSize, MAX_SIDE } from './resize';

export interface ImageFormat {
    mime: string;
    label: string;
    ext: string;
    /** 有损：只有这类格式才需要质量参数，其余显示质量滑块是骗人的 */
    lossy: boolean;
    /** 靠浏览器 canvas 编码，需要运行时探测；false 表示由本站自己编码，一定可用 */
    native: boolean;
    /** 目标格式不支持透明，透明区域要先合成到白底 */
    flatten?: boolean;
    note?: string;
}

export const FORMATS: ImageFormat[] = [
    { mime: 'image/png', label: 'PNG', ext: 'png', lossy: false, native: true },
    { mime: 'image/jpeg', label: 'JPG', ext: 'jpg', lossy: true, native: true, flatten: true },
    { mime: 'image/webp', label: 'WEBP', ext: 'webp', lossy: true, native: true },
    { mime: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true, native: true },
    { mime: 'image/bmp', label: 'BMP', ext: 'bmp', lossy: false, native: false, flatten: true },
    {
        mime: 'image/gif',
        label: 'GIF',
        ext: 'gif',
        lossy: false,
        native: false,
        note: 'GIF 最多 256 色，本站会自动降色并做误差扩散',
    },
    {
        mime: 'image/x-icon',
        label: 'ICO',
        ext: 'ico',
        lossy: false,
        native: false,
        note: '会一次打包 16 / 32 / 48 / 64 / 128 / 256 多个尺寸',
    },
    {
        mime: 'image/tiff',
        label: 'TIFF',
        ext: 'tiff',
        lossy: false,
        native: false,
        note: 'TIFF 不压缩，文件会明显大于原图',
    },
    {
        mime: 'image/svg+xml',
        label: 'SVG',
        ext: 'svg',
        lossy: false,
        native: false,
        note: 'SVG 是矢量容器，这里只是把位图原样嵌进去，不会变成矢量图形',
    },
];

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/** 探测 canvas 能否真的导出这个格式：不支持时浏览器会静默退回 PNG */
export function supportsFormat(format: ImageFormat): boolean {
    if (!format.native) return true;

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    try {
        return canvas.toDataURL(format.mime).startsWith(`data:${format.mime}`);
    } catch {
        return false;
    }
}

export type Source = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export function sourceSize(source: Source) {
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    return { width: width || 0, height: height || 0 };
}

/** 读一张本地图片。SVG 之类没有内在尺寸的源给个 512 的兜底，否则画出来是空白 */
export function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`无法解码 ${file.name}`));
        };
        img.src = url;
    });
}

function toCanvas(source: Source, width: number, height: number, flatten = false) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不可用 canvas 2D');

    if (flatten) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('编码失败'))),
            mime,
            quality
        );
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(blob);
    });
}

/**
 * 把一张图编成目标格式。
 * quality 传 0–1，只对有损格式有意义；无损格式会忽略它。
 * resize 传了就先把图调整到目标尺寸（含裁剪 / 留白），所有分支共用同一个结果尺寸；
 * 不传则行为与旧版完全一致。
 */
export async function encodeImage(
    source: Source,
    format: ImageFormat,
    quality: number,
    resize?: ResizeOptions
): Promise<Blob> {
    const src = sourceSize(source);
    if (!src.width || !src.height) throw new Error('图片尺寸异常');

    const target = resize
        ? computeTargetSize(src.width, src.height, resize)
        : { width: src.width, height: src.height };

    const render = (flatten = false) =>
        resize
            ? drawResized(source, target.width, target.height, resize, flatten)
            : toCanvas(source, target.width, target.height, flatten);

    if (format.native) {
        const { canvas } = render(format.flatten);
        return canvasToBlob(canvas, format.mime, format.lossy ? quality : undefined);
    }

    if (format.mime === 'image/x-icon') {
        // 调整过尺寸时按调整后的长边挑档位；每一档仍然把画面拉成正方形，和原逻辑一致
        const base: Source = resize ? render().canvas : source;
        const longest = Math.max(target.width, target.height);
        const sizes = ICO_SIZES.filter((size) => size <= longest);
        if (sizes.length === 0) sizes.push(longest);

        const images = await Promise.all(
            sizes.map(async (size) => {
                const { canvas } = toCanvas(base, size, size);
                const blob = await canvasToBlob(canvas, 'image/png');
                return { size, data: new Uint8Array(await blob.arrayBuffer()) };
            })
        );
        return encodeIco(images);
    }

    if (format.mime === 'image/svg+xml') {
        // 原来的实现把 blob: 地址写进 SVG，然后下一行就把它 revoke 了，
        // 导出的文件永远是空白。改成内嵌 data: URL，文件自带像素、可离线打开。
        const { canvas } = render();
        const png = await canvasToBlob(canvas, 'image/png');
        const dataUrl = await blobToDataUrl(png);
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" ` +
            `viewBox="0 0 ${canvas.width} ${canvas.height}">` +
            `<image width="${canvas.width}" height="${canvas.height}" href="${dataUrl}"/></svg>`;
        return new Blob([svg], { type: 'image/svg+xml' });
    }

    const { ctx } = render(format.flatten);
    const pixels = ctx.getImageData(0, 0, target.width, target.height);

    if (format.mime === 'image/bmp') return encodeBmp(pixels);
    if (format.mime === 'image/gif') return encodeGif(pixels);
    if (format.mime === 'image/tiff') return encodeTiff(pixels);

    throw new Error(`未支持的目标格式：${format.mime}`);
}

