// 尺寸调整：算出目标宽高，再把原图画进目标尺寸的画布。
// 三种适配方式：
//   stretch —— 直接拉伸填满，比例不同会变形
//   contain —— 等比缩到完整放进目标框，不足处留白（底色可选，默认透明）
//   cover   —— 等比放大占满目标框，超出的部分居中裁掉

export type ResizeMode = 'original' | 'percent' | 'pixels';
export type FitMode = 'stretch' | 'contain' | 'cover';

export interface ResizeOptions {
    mode: ResizeMode;
    /** percent 模式：缩放百分比，10–400 */
    percent?: number;
    /** pixels 模式：目标宽（px），留空表示按高推算或保持原值 */
    width?: number;
    /** pixels 模式：目标高（px） */
    height?: number;
    /** pixels 模式：锁定宽高比，只填一边时另一边按原图比例推出 */
    lockAspect?: boolean;
    fit: FitMode;
    /** contain 模式的留白底色；不填 = 透明。不支持透明的格式仍会走白底合成 */
    padColor?: string;
}

/** 各家浏览器 canvas 单边上限不一，取共同的安全值 */
export const MAX_SIDE = 16384;

interface Size {
    width: number;
    height: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function sizeOf(source: CanvasImageSource): Size {
    const el = source as { width?: unknown; height?: unknown };
    return {
        width: Number(el.width) || 0,
        height: Number(el.height) || 0,
    };
}

/**
 * 由原图尺寸和调整选项算出导出尺寸。
 * 像素模式里某一边没填时：锁了比例就按另一边和原图比例推出，否则沿用原图那一边。
 */
export function computeTargetSize(srcW: number, srcH: number, o: ResizeOptions): Size {
    if (o.mode === 'percent') {
        const p = clamp(o.percent ?? 100, 1, 400) / 100;
        return {
            width: clamp(Math.round(srcW * p), 1, MAX_SIDE),
            height: clamp(Math.round(srcH * p), 1, MAX_SIDE),
        };
    }

    if (o.mode === 'pixels') {
        const w = o.width != null && Number.isFinite(o.width) ? Math.round(o.width) : null;
        const h = o.height != null && Number.isFinite(o.height) ? Math.round(o.height) : null;

        let width: number;
        let height: number;

        if (w != null && h != null) {
            width = w;
            height = h;
        } else if (w != null) {
            width = w;
            height = o.lockAspect ? Math.round((w * srcH) / srcW) : srcH;
        } else if (h != null) {
            height = h;
            width = o.lockAspect ? Math.round((h * srcW) / srcH) : srcW;
        } else {
            width = srcW;
            height = srcH;
        }

        return { width: clamp(width, 1, MAX_SIDE), height: clamp(height, 1, MAX_SIDE) };
    }

    return { width: srcW, height: srcH };
}

/**
 * 把原图画成 W×H 的画布。
 * 缩幅超过一半时先逐步减半再落最终尺寸，比一步缩小清晰得多。
 * 返回结构和 index.ts 的 toCanvas 一致，方便两边互换。
 */
export function drawResized(
    source: CanvasImageSource,
    width: number,
    height: number,
    o: ResizeOptions,
    flatten = false
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不可用 canvas 2D');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 不支持透明的格式先把底铺白，再让用户选的留白色盖上去
    if (flatten) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (o.mode === 'pixels' && o.fit === 'contain' && o.padColor) {
        ctx.fillStyle = o.padColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const fit: FitMode = o.mode === 'pixels' ? o.fit : 'stretch';

    // 多步降采样：只在等比路径下做（stretch 的横向纵向缩放不一致，逐步减半意义不大）
    let cur: CanvasImageSource = source;
    let cw = sizeOf(cur).width;
    let ch = sizeOf(cur).height;

    if (fit !== 'stretch' && cw > 0 && ch > 0) {
        while (cw * 0.5 >= canvas.width && ch * 0.5 >= canvas.height) {
            const half = document.createElement('canvas');
            half.width = Math.max(1, Math.floor(cw / 2));
            half.height = Math.max(1, Math.floor(ch / 2));
            const hctx = half.getContext('2d');
            if (!hctx) break;
            hctx.imageSmoothingEnabled = true;
            hctx.imageSmoothingQuality = 'high';
            hctx.drawImage(cur, 0, 0, half.width, half.height);
            cur = half;
            cw = half.width;
            ch = half.height;
        }
    }

    if (fit === 'contain') {
        const scale = Math.min(canvas.width / cw, canvas.height / ch);
        const dw = cw * scale;
        const dh = ch * scale;
        ctx.drawImage(cur, 0, 0, cw, ch, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    } else if (fit === 'cover') {
        const scale = Math.max(canvas.width / cw, canvas.height / ch);
        const visW = canvas.width / scale;
        const visH = canvas.height / scale;
        const sx = (cw - visW) / 2;
        const sy = (ch - visH) / 2;
        ctx.drawImage(cur, sx, sy, visW, visH, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, canvas.width, canvas.height);
    }

    return { canvas, ctx };
}
