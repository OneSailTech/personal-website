// TIFF 编码器（不压缩，RGBA）。
// 浏览器的 canvas 完全不能导出 TIFF，原来的选项等于把 PNG 改名。
// 不压缩的 TIFF 体积偏大，但结构简单、绝对无损，任何看图软件都认。

const ENTRIES = 11;
const IFD_OFFSET = 8;
const HEADER_SIZE = IFD_OFFSET + 2 + ENTRIES * 12 + 4;
// BitsPerSample 是 4 个 SHORT（8 字节），塞不进 IFD 的 4 字节值域，得另放
const BITS_OFFSET = HEADER_SIZE;
const PIXEL_OFFSET = BITS_OFFSET + 8;

type FieldType = 3 | 4; // 3 = SHORT, 4 = LONG

export function encodeTiff(image: ImageData): Blob {
    const { width, height, data } = image;
    const out = new Uint8Array(PIXEL_OFFSET + data.length);
    const view = new DataView(out.buffer);

    // 头：II = 小端，42 = 魔数，随后是第一个 IFD 的偏移
    out[0] = 0x49;
    out[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, IFD_OFFSET, true);

    view.setUint16(IFD_OFFSET, ENTRIES, true);

    let cursor = IFD_OFFSET + 2;
    const entry = (tag: number, type: FieldType, count: number, value: number) => {
        view.setUint16(cursor, tag, true);
        view.setUint16(cursor + 2, type, true);
        view.setUint32(cursor + 4, count, true);
        // 单个 SHORT 写在值域的低 2 字节，其余按 LONG 写满 4 字节
        if (type === 3 && count === 1) view.setUint16(cursor + 8, value, true);
        else view.setUint32(cursor + 8, value, true);
        cursor += 12;
    };

    // IFD 条目必须按 tag 升序排列，否则部分解码器会拒读
    entry(256, 4, 1, width); // ImageWidth
    entry(257, 4, 1, height); // ImageLength
    entry(258, 3, 4, BITS_OFFSET); // BitsPerSample → 8,8,8,8
    entry(259, 3, 1, 1); // Compression = 无压缩
    entry(262, 3, 1, 2); // PhotometricInterpretation = RGB
    entry(273, 4, 1, PIXEL_OFFSET); // StripOffsets
    entry(277, 3, 1, 4); // SamplesPerPixel
    entry(278, 4, 1, height); // RowsPerStrip：整图一条
    entry(279, 4, 1, data.length); // StripByteCounts
    // 分辨率相关的 282/283 是 RATIONAL 类型，写不进 4 字节值域，
    // 而它们本来就是可选的，索性不写，交给看图软件用默认值。
    entry(284, 3, 1, 1); // PlanarConfiguration = 交错
    entry(338, 3, 1, 2); // ExtraSamples = 非预乘 alpha

    view.setUint32(cursor, 0, true); // 没有下一个 IFD

    view.setUint16(BITS_OFFSET, 8, true);
    view.setUint16(BITS_OFFSET + 2, 8, true);
    view.setUint16(BITS_OFFSET + 4, 8, true);
    view.setUint16(BITS_OFFSET + 6, 8, true);

    out.set(data, PIXEL_OFFSET);

    return new Blob([out], { type: 'image/tiff' });
}
