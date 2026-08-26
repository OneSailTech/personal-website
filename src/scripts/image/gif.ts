// GIF 编码器（单帧）。canvas 同样不能导出 GIF，
// 原来选 GIF 得到的是一张改了后缀的 PNG——多数软件会直接报错。
//
// GIF 最多 256 色，所以必经一步降色。这里用固定的 6×7×6 = 252 色调色板
// （绿色多给一级，人眼对绿最敏感）配 Floyd–Steinberg 误差扩散，
// 不引入任何依赖也能得到肉眼可接受的渐变；第 255 号索引留给透明。

const R_LEVELS = 6;
const G_LEVELS = 7;
const B_LEVELS = 6;
const TRANSPARENT_INDEX = 255;

function buildPalette(): Uint8Array<ArrayBuffer> {
    const table = new Uint8Array(256 * 3);
    for (let r = 0; r < R_LEVELS; r += 1) {
        for (let g = 0; g < G_LEVELS; g += 1) {
            for (let b = 0; b < B_LEVELS; b += 1) {
                const index = (r * G_LEVELS + g) * B_LEVELS + b;
                table[index * 3] = Math.round((r * 255) / (R_LEVELS - 1));
                table[index * 3 + 1] = Math.round((g * 255) / (G_LEVELS - 1));
                table[index * 3 + 2] = Math.round((b * 255) / (B_LEVELS - 1));
            }
        }
    }
    return table;
}

const PALETTE = buildPalette();

function quantize(image: ImageData): Uint8Array<ArrayBuffer> {
    const { width, height, data } = image;
    const indices = new Uint8Array(width * height);
    // 误差缓冲用浮点，直接在整型上累加会把误差截断掉
    const buffer = new Float32Array(width * height * 3);

    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
        buffer[p] = data[i];
        buffer[p + 1] = data[i + 1];
        buffer[p + 2] = data[i + 2];
    }

    const diffuse = (p: number, er: number, eg: number, eb: number, weight: number) => {
        buffer[p] += er * weight;
        buffer[p + 1] += eg * weight;
        buffer[p + 2] += eb * weight;
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const pixel = y * width + x;
            const p = pixel * 3;

            // 半透明一律按全透明处理：GIF 的透明只有 1 位，没有中间态
            if (data[pixel * 4 + 3] < 128) {
                indices[pixel] = TRANSPARENT_INDEX;
                continue;
            }

            const r = Math.min(255, Math.max(0, buffer[p]));
            const g = Math.min(255, Math.max(0, buffer[p + 1]));
            const b = Math.min(255, Math.max(0, buffer[p + 2]));

            const ri = Math.round((r / 255) * (R_LEVELS - 1));
            const gi = Math.round((g / 255) * (G_LEVELS - 1));
            const bi = Math.round((b / 255) * (B_LEVELS - 1));
            const index = (ri * G_LEVELS + gi) * B_LEVELS + bi;
            indices[pixel] = index;

            const er = r - PALETTE[index * 3];
            const eg = g - PALETTE[index * 3 + 1];
            const eb = b - PALETTE[index * 3 + 2];

            // Floyd–Steinberg：右 7/16、左下 3/16、下 5/16、右下 1/16
            if (x + 1 < width) diffuse(p + 3, er, eg, eb, 7 / 16);
            if (y + 1 < height) {
                const below = p + width * 3;
                if (x > 0) diffuse(below - 3, er, eg, eb, 3 / 16);
                diffuse(below, er, eg, eb, 5 / 16);
                if (x + 1 < width) diffuse(below + 3, er, eg, eb, 1 / 16);
            }
        }
    }

    return indices;
}

// LZW（GIF 变体）：码长从 9 位起，字典满 4096 就发一个 clear 重来。
// 位序是低位在前，这一点和 TIFF/PNG 的习惯相反。
const MAX_CODES = 1 << 12;

function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array<ArrayBuffer> {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;

    const out: number[] = [];
    let bitBuffer = 0;
    let bitCount = 0;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dict = new Map<number, number>();

    const emit = (code: number) => {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
            out.push(bitBuffer & 0xff);
            bitBuffer >>= 8;
            bitCount -= 8;
        }
    };

    emit(clearCode);

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
        const next = indices[i];
        const key = prefix * 256 + next;
        const known = dict.get(key);

        if (known !== undefined) {
            prefix = known;
            continue;
        }

        emit(prefix);

        // 字典还没满就记下这个新串。注意加宽的判据是 nextCode > 2^codeSize 而不是 >=：
        // 解码端要晚一步才建出同一条目，用 >= 会提前一个码加宽，
        // 从那个码开始双方的位宽就错开了，解出来是一堆乱像素。
        if (nextCode < MAX_CODES) {
            dict.set(key, nextCode);
            nextCode += 1;
            if (nextCode > 1 << codeSize && codeSize < 12) codeSize += 1;
        } else {
            // 12 位也放不下了：发一个 clear，双方一起把字典清回初始状态
            emit(clearCode);
            dict = new Map();
            codeSize = minCodeSize + 1;
            nextCode = endCode + 1;
        }

        prefix = next;
    }

    emit(prefix);
    emit(endCode);
    if (bitCount > 0) out.push(bitBuffer & 0xff);

    return new Uint8Array(out);
}

// 图像数据按不超过 255 字节的子块串起来，最后跟一个长度 0 的块收尾
function toSubBlocks(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const blocks = Math.ceil(bytes.length / 255);
    const out = new Uint8Array(bytes.length + blocks + 1);
    let read = 0;
    let write = 0;

    while (read < bytes.length) {
        const size = Math.min(255, bytes.length - read);
        out[write] = size;
        out.set(bytes.subarray(read, read + size), write + 1);
        read += size;
        write += size + 1;
    }

    out[write] = 0;
    return out;
}

export function encodeGif(image: ImageData): Blob {
    const { width, height } = image;
    if (width === 0 || height === 0) {
        throw new Error('图片尺寸为 0，无法编码 GIF');
    }

    const indices = quantize(image);
    const data = toSubBlocks(lzwEncode(indices, 8));

    // 6 签名 + 7 逻辑屏幕描述符 + 768 调色板 + 8 图形控制扩展
    // + 10 图像描述符 + 1 LZW 最小码长
    const head = new Uint8Array(6 + 7 + 768 + 8 + 10 + 1);
    const view = new DataView(head.buffer);
    let at = 0;

    // 签名
    for (const ch of 'GIF89a') head[at++] = ch.charCodeAt(0);

    // 逻辑屏幕描述符：0xf7 = 有全局调色板 + 256 色
    view.setUint16(at, width, true);
    view.setUint16(at + 2, height, true);
    head[at + 4] = 0xf7;
    head[at + 5] = 0; // 背景色索引
    head[at + 6] = 0; // 像素宽高比
    at += 7;

    head.set(PALETTE, at);
    at += 768;

    // 图形控制扩展：只为了声明"第 255 号索引是透明色"
    head[at++] = 0x21;
    head[at++] = 0xf9;
    head[at++] = 0x04;
    head[at++] = 0x01; // 透明标志位
    head[at++] = 0; // 延时低字节
    head[at++] = 0; // 延时高字节
    head[at++] = TRANSPARENT_INDEX;
    head[at++] = 0;

    // 图像描述符
    head[at++] = 0x2c;
    view.setUint16(at, 0, true); // left
    view.setUint16(at + 2, 0, true); // top
    view.setUint16(at + 4, width, true);
    view.setUint16(at + 6, height, true);
    head[at + 8] = 0; // 无局部调色板、非交错
    head[at + 9] = 8; // LZW 最小码长
    at += 10;

    return new Blob([head, data, new Uint8Array([0x3b])], { type: 'image/gif' });
}

