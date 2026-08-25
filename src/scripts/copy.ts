// 复制到剪贴板。navigator.clipboard 在非安全上下文（http、部分内嵌 WebView）下
// 直接是 undefined，所以这里带一条 execCommand 兜底，并且明确返回成败，
// 让调用方能区分"已复制"和"复制失败"两种反馈（§16：完成与错误是两类反馈）。
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch {
            return false;
        }
    }
}
