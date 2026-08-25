// 最小 ZIP 写入器（store 模式，不压缩）。
// 批量转换时浏览器会拦截连续多次下载，所以多个文件打成一个包再下。
// 图片本身已经是压缩格式，再 deflate 基本没有收益，store 模式则不需要任何依赖。

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

// ZIP 里的时间是 MS-DOS 格式：日期与时间各占 16 位，年份从 1980 起算。
function dosDateTime(date: Date) {
    const time =
        (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
    const day =
        ((Math.max(date.getFullYear() - 1980, 0) & 0x7f) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate();
    return { time, day };
}

export interface ZipEntry {
    name: string;
    data: Uint8Array;
}

export function zipStore(entries: ZipEntry[], date = new Date()): Blob {
    const encoder = new TextEncoder();
    const parts: BlobPart[] = [];
    const central: Uint8Array[] = [];
    const { time, day } = dosDateTime(date);
    let offset = 0;

    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const crc = crc32(entry.data);
        const size = entry.data.length;

        const local = new Uint8Array(30);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true); // 解压所需版本
        lv.setUint16(6, 0x0800, true); // 标志位：文件名按 UTF-8 解释
        lv.setUint16(8, 0, true); // 压缩方式：store
        lv.setUint16(10, time, true);
        lv.setUint16(12, day, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);

        parts.push(local, name, entry.data);

        const dir = new Uint8Array(46 + name.length);
        const dv = new DataView(dir.buffer);
        dv.setUint32(0, 0x02014b50, true);
        dv.setUint16(4, 20, true); // 生成方
        dv.setUint16(6, 20, true); // 解压所需版本
        dv.setUint16(8, 0x0800, true);
        dv.setUint16(10, 0, true);
        dv.setUint16(12, time, true);
        dv.setUint16(14, day, true);
        dv.setUint32(16, crc, true);
        dv.setUint32(20, size, true);
        dv.setUint32(24, size, true);
        dv.setUint16(28, name.length, true);
        dv.setUint32(42, offset, true);
        dir.set(name, 46);
        central.push(dir);

        offset += local.length + name.length + size;
    }

    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
