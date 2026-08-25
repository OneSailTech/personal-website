// 触发一次浏览器下载。用完立刻 revoke 会让部分浏览器拿不到数据，
// 所以延后一拍再释放；同时把 <a> 挂进文档，Firefox 才会响应 click()。
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 换掉文件名末尾的扩展名，没有扩展名就直接追加 */
export function replaceExt(name: string, ext: string): string {
    const base = name.replace(/\.[^.\\/]+$/, '');
    return `${base || name}.${ext}`;
}
