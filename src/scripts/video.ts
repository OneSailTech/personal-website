// 视频转换的格式表与 FFmpeg 加载逻辑。
//
// 原来的实现每点一次"转换"就重新 import 一遍 CDN 模块并 ffmpeg.load()，
// 也就是每次都重新拉一遍约 30 MB 的 core + wasm。这里改成模块级单例：
// 第一次调用才加载，之后所有转换共用同一个实例。

import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

export interface VideoFormat {
    /** 同时用作扩展名 */
    id: string;
    label: string;
    mime: string;
    audioOnly?: boolean;
    note?: string;
}

export const VIDEO_FORMATS: VideoFormat[] = [
    {
        id: 'mp4',
        label: 'MP4 · H.264',
        mime: 'video/mp4',
        note: '兼容性最好的一档，微信、剪辑软件、老设备都认。',
    },
    {
        id: 'webm',
        label: 'WEBM · VP8',
        mime: 'video/webm',
        note: '网页内嵌播放用。VP8 比 VP9 画质略低，但在浏览器里编码快得多。',
    },
    {
        id: 'mov',
        label: 'MOV · H.264',
        mime: 'video/quicktime',
        note: '容器换成 QuickTime，编码与 MP4 相同。',
    },
    {
        id: 'mkv',
        label: 'MKV · H.264',
        mime: 'video/x-matroska',
        note: '容器最宽容，适合留档。',
    },
    {
        id: 'avi',
        label: 'AVI · MPEG-4',
        mime: 'video/x-msvideo',
        note: '给只认 AVI 的老设备用；体积会明显偏大。',
    },
    {
        id: 'gif',
        label: 'GIF · 动图',
        mime: 'image/gif',
        note: '10 fps、宽 480、逐段生成专属调色板。会丢掉声音，长视频请先剪短。',
    },
    {
        id: 'mp3',
        label: 'MP3 · 仅音频',
        mime: 'audio/mpeg',
        audioOnly: true,
        note: '只抽音轨。源文件没有音轨会直接报错。',
    },
    {
        id: 'wav',
        label: 'WAV · 仅音频',
        mime: 'audio/wav',
        audioOnly: true,
        note: '未压缩音轨，体积大但无二次损失。',
    },
];

/** 拼 ffmpeg 命令行。显式指定编码器，不然 avi/mkv 这些容器会挑到不可用的默认值。 */
export function buildArgs(input: string, output: string, format: VideoFormat): string[] {
    const args = ['-i', input];

    switch (format.id) {
        case 'mp3':
            args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
            break;
        case 'wav':
            args.push('-vn', '-c:a', 'pcm_s16le');
            break;
        case 'gif':
            // 一遍过的调色板方案：先分流，一路统计颜色生成调色板，另一路套用。
            // 只写 -vf fps,scale 会用默认的通用调色板，渐变处会脏很多。
            args.push(
                '-an',
                '-filter_complex',
                'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                '-loop',
                '0'
            );
            break;
        case 'webm':
            args.push('-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libvorbis');
            break;
        case 'avi':
            args.push('-c:v', 'mpeg4', '-vtag', 'xvid', '-qscale:v', '4', '-c:a', 'libmp3lame');
            break;
        default:
            // mp4 / mov / mkv 都是 H.264 + AAC，只是容器不同
            args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k');
            if (format.id === 'mp4') args.push('-movflags', '+faststart');
            break;
    }

    args.push('-y', output);
    return args;
}

/** ffmpeg 的文件系统只认简单名字，中文和空格都会出问题 */
export function safeName(name: string, index: number): string {
    const ext = name.match(/\.[^.]+$/)?.[0] ?? '';
    return `in_${index}${ext.replace(/[^.a-zA-Z0-9]/g, '')}`;
}

// ---------- FFmpeg 单例 ----------

type LogHandler = (line: string) => void;
type ProgressHandler = (ratio: number) => void;

// 回调放在模块作用域，事件只在创建实例时注册一次。
// 每次转换都 on() 会把监听器叠起来，日志越跑越多份。
let onLog: LogHandler | null = null;
let onProgress: ProgressHandler | null = null;

let instance: any = null;
let pending: Promise<any> | null = null;

export function setHandlers(log: LogHandler, progress: ProgressHandler): void {
    onLog = log;
    onProgress = progress;
}

/** 是否已经加载过——UI 用它决定要不要提示"首次需要下载" */
export function isFFmpegReady(): boolean {
    return instance !== null;
}

export async function getFFmpeg(): Promise<any> {
    if (instance) return instance;
    if (pending) return pending;

    pending = (async () => {
        const ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }: { message: string }) => onLog?.(message));
        ffmpeg.on('progress', ({ progress }: { progress: number }) => onProgress?.(progress));

        // Worker、core 与 wasm 全部交给 Vite 产出为本站资源。远程 Worker 会被
        // 浏览器同源策略拦截；运行时依赖 CDN 也会让工具在网络不稳时一直卡住。
        await ffmpeg.load({ coreURL, wasmURL });

        instance = ffmpeg;
        pending = null;
        return ffmpeg;
    })();

    try {
        return await pending;
    } catch (error) {
        pending = null;
        throw error;
    }
}

/**
 * 取消只能靠终止 worker：ffmpeg.wasm 没有中途停止单个任务的接口。
 * 终止后实例作废，下次要重新 load()；好在 wasm 已经在 HTTP 缓存里，不会再走一次网络。
 */
export function terminateFFmpeg(): void {
    if (!instance) return;
    try {
        instance.terminate();
    } catch {
        // 已经死了就算了，这里不需要区分
    }
    instance = null;
    pending = null;
}

/** 把 readFile 的结果复制成一份独立的字节。 */
export function toBytes(data: unknown): Uint8Array<ArrayBuffer> {
    // 原来写的是 new Blob([data.buffer])：buffer 是 ffmpeg 整块堆内存，
    // 比这个视图长得多，拿到的文件会带上一大截无关数据。
    // 另外必须复制：视图直接指向 worker 的内存，下一个任务会把它覆盖掉。
    if (data instanceof Uint8Array) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new Error('ffmpeg 返回了预料之外的数据类型');
}
