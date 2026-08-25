// BMP 编码器。canvas.toBlob('image/bmp') 只有个别浏览器支持，
// 原来的实现在不支持时会静默拿到一张 PNG，然后套上 .bmp 后缀——文件是坏的。
// 这里自己写 24 位 BMP：无损、任何系统都打得开。

export function encodeBmp(image: ImageData): Blob {
    const { width, height, data } = image;

    // 每行字节数必须补齐到 4 的倍数
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixelSize = rowSize * height;
    const out = new Uint8Array(54 + pixelSize);
    const view = new DataView(out.buffer);

    // 文件头
    out[0] = 0x42; // 'B'
    out[1] = 0x4d; // 'M'
    view.setUint32(2, out.length, true);
    view.setUint32(10, 54, true);

    // BITMAPINFOHEADER
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true); // 平面数
    view.setUint16(28, 24, true); // 位深
    view.setUint32(34, pixelSize, true);
    view.setUint32(38, 2835, true); // 约 72 DPI
    view.setUint32(42, 2835, true);

    // 像素区：BMP 自下而上、通道顺序 BGR，且不带透明度，
    // 所以带 alpha 的源要先合成到白底，否则半透明区域会变成脏色。
    for (let y = 0; y < height; y += 1) {
        const src = y * width * 4;
        const dst = 54 + (height - 1 - y) * rowSize;
        for (let x = 0; x < width; x += 1) {
            const i = src + x * 4;
            const a = data[i + 3] / 255;
            const j = dst + x * 3;
            out[j] = Math.round(data[i + 2] * a + 255 * (1 - a));
            out[j + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
            out[j + 2] = Math.round(data[i] * a + 255 * (1 - a));
        }
    }

    return new Blob([out], { type: 'image/bmp' });
}
