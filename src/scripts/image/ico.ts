// ICO 编码器。canvas 不能导出 ICO，原来的实现是"导出 PNG 再改名 .ico"，
// Windows 资源管理器不认。这里写真正的 ICO 容器：
// 内部装 PNG（Vista 起原生支持），并且按多个尺寸一次打包好。

export interface IcoImage {
    size: number;
    data: Uint8Array<ArrayBuffer>;
}

export function encodeIco(images: IcoImage[]): Blob {
    const count = images.length;
    const headerSize = 6 + count * 16;
    let offset = headerSize;

    const header = new Uint8Array(headerSize);
    const view = new DataView(header.buffer);
    view.setUint16(0, 0, true); // 保留
    view.setUint16(2, 1, true); // 类型 1 = 图标
    view.setUint16(4, count, true);

    images.forEach((image, i) => {
        const at = 6 + i * 16;
        // 256 在这里写 0：宽高字段只有 1 字节，0 约定表示 256
        header[at] = image.size >= 256 ? 0 : image.size;
        header[at + 1] = image.size >= 256 ? 0 : image.size;
        header[at + 2] = 0; // 调色板颜色数
        header[at + 3] = 0; // 保留
        view.setUint16(at + 4, 1, true); // 平面数
        view.setUint16(at + 6, 32, true); // 位深
        view.setUint32(at + 8, image.data.length, true);
        view.setUint32(at + 12, offset, true);
        offset += image.data.length;
    });

    return new Blob([header, ...images.map((image) => image.data)], {
        type: 'image/x-icon',
    });
}
