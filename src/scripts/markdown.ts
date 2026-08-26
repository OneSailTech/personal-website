// 一个够用的 Markdown 渲染器。
//
// 为什么不直接用 marked / markdown-it：这个站是纯静态的，为一个工具页
// 引入 40KB+ 的依赖不值得；而且原实现的问题不是功能少，是**不转义**——
// 标题和正文都直接拼进 innerHTML，一个 <img src=x onerror=...> 就执行了。
//
// 这里的原则是反过来的：先把所有文本转义，标签只由渲染器自己生成。
// 链接和图片地址再过一遍协议白名单，javascript: 这类一律拦掉。

export interface Heading {
    level: number;
    text: string;
    id: string;
}

export interface Rendered {
    html: string;
    headings: Heading[];
    /** 汉字按字计、西文按词计的总量 */
    words: number;
    minutes: number;
}

export interface Doc {
    /** YAML frontmatter 原文，没有则为 null */
    frontmatter: string | null;
    body: string;
}

const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export function esc(text: string): string {
    return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * 地址白名单。只放行明确安全的协议，其余（javascript:、vbscript:、
 * 非图片的 data:）返回 null，调用方把它降级成纯文本。
 * data:image 里不含 svg+xml：SVG 能带脚本，没必要为它开口子。
 */
export function safeUrl(raw: string): string | null {
    const url = raw.trim().replace(/^<|>$/g, '');
    if (!url) return null;
    if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
    // 有协议的必须在白名单里；没协议的是相对路径或锚点，本来就无害
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        return /^(https?|mailto|tel):/i.test(url) ? url : null;
    }
    return url;
}

// ---------- 行内 ----------

// 占位符用 NUL 包着序号：正文里的 NUL 在入口就被清掉了，不会撞车。
const HOLD = '\u0000';

const EMPHASIS: [RegExp, string][] = [
    [/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>'],
    [/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>'],
    [/(?<![\w*])\*(?=\S)([\s\S]*?\S)\*(?![\w*])/g, '<em>$1</em>'],
    // _ 的两侧要求非单词字符，否则 snake_case_name 会被拆成斜体
    [/(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, '<strong>$1</strong>'],
    [/(?<![\w_])_(?=\S)([\s\S]*?\S)_(?![\w_])/g, '<em>$1</em>'],
    [/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>'],
];

/**
 * 行内渲染。顺序很重要：先把代码、图片、链接摘成占位符，再转义剩下的文本，
 * 最后才做强调。原实现是对同一段字符串连续 replace，生成出来的 <strong>
 * 会被后面的 `*` 规则再吃一遍。
 */
export function inline(text: string): string {
    const held: string[] = [];
    const hold = (html: string) => {
        held.push(html);
        return `${HOLD}${held.length - 1}${HOLD}`;
    };

    let work = text;

    // 行内代码：里面的 * _ [ ] 都是字面量
    work = work.replace(/(`+)([\s\S]*?)\1/g, (match, _ticks, code: string) =>
        code.trim() ? hold(`<code>${esc(code.trim())}</code>`) : match
    );

    // 图片。地址不合法就退回成纯文本，不留一个坏 <img>
    work = work.replace(
        /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g,
        (match, alt: string, src: string, title?: string) => {
            const url = safeUrl(src);
            if (!url) return match;
            const extra = title ? ` title="${esc(title)}"` : '';
            return hold(`<img src="${esc(url)}" alt="${esc(alt)}"${extra} loading="lazy" />`);
        }
    );

    // 链接。标签本身还可以带行内标记，递归一层（标签里不允许再出现 ]，深度有界）
    work = work.replace(
        /\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g,
        (match, label: string, href: string, title?: string) => {
            const url = safeUrl(href);
            if (!url) return match;
            const extra = title ? ` title="${esc(title)}"` : '';
            const rel = /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
            return hold(`<a href="${esc(url)}"${extra}${rel}>${inline(label)}</a>`);
        }
    );

    // <https://…> 这种裸链接
    work = work.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (match, href: string) => {
        const url = safeUrl(href);
        return url
            ? hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`)
            : match;
    });

    work = esc(work);

    for (const [pattern, replacement] of EMPHASIS) {
        work = work.replace(pattern, replacement);
    }

    // 行尾两个空格或反斜杠是硬换行
    work = work.replace(/(?: {2,}|\\)\n/g, '<br />\n');

    return work.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_m, index: string) => held[Number(index)]);
}

// ---------- 块级 ----------

const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([^\s`]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*$/;
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const DIVIDER_RE = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?\|?\s*$/;

/** 抽掉开头的 YAML frontmatter。阅读器把它单独显示，不当正文渲染。 */
export function splitFrontmatter(source: string): Doc {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    if (!match) return { frontmatter: null, body: source };
    return { frontmatter: match[1], body: source.slice(match[0].length) };
}

interface Ctx {
    headings: Heading[];
    taken: Set<string>;
}

/** 这一行是否开启一个新块——段落到这里就该断开 */
function startsBlock(line: string): boolean {
    return (
        FENCE_RE.test(line) ||
        HEADING_RE.test(line) ||
        HR_RE.test(line) ||
        QUOTE_RE.test(line) ||
        BULLET_RE.test(line) ||
        ORDERED_RE.test(line)
    );
}

function tableCells(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

/** 列表：按缩进递归。原实现只有一层，嵌套项会被拍平成同级。 */
function renderList(lines: string[], start: number, ctx: Ctx): [string, number] {
    const first = BULLET_RE.exec(lines[start]) ?? ORDERED_RE.exec(lines[start])!;
    const baseIndent = first[1].length;
    const ordered = !BULLET_RE.test(lines[start]);
    const tag = ordered ? 'ol' : 'ul';
    // 有序列表要从原文的起始序号开始，不然 "3. 4. 5." 会被重排成 1. 2. 3.
    const startAttr = ordered && first[2] !== '1' ? ` start="${Number(first[2])}"` : '';

    const items: string[][] = [];
    let i = start;

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) {
            // 空行后面还有缩进内容就说明列表没结束（松散列表）
            const next = lines[i + 1];
            if (next && (next.trim() === '' || next.search(/\S/) > baseIndent)) {
                items[items.length - 1]?.push('');
                i += 1;
                continue;
            }
            break;
        }

        const marker = BULLET_RE.exec(line) ?? ORDERED_RE.exec(line);
        const indent = line.search(/\S/);

        if (marker && marker[1].length <= baseIndent + 1) {
            items.push([marker[3]]);
            i += 1;
            continue;
        }

        if (indent > baseIndent) {
            // 属于当前项的续行，去掉一层缩进后交给下一轮解析
            items[items.length - 1]?.push(line.slice(Math.min(indent, baseIndent + 2)));
            i += 1;
            continue;
        }

        break;
    }

    const body = items.map((item) => `<li>${renderItem(item, ctx)}</li>`).join('');
    return [`<${tag}${startAttr}>${body}</${tag}>`, i];
}

const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

function renderItem(item: string[], ctx: Ctx): string {
    const trimmed = [...item];
    while (trimmed.length && !trimmed[trimmed.length - 1].trim()) trimmed.pop();

    const task = TASK_RE.exec(trimmed[0] ?? '');
    if (task) trimmed[0] = task[2];

    // 只读复选框：这是阅读器，勾选状态来自文档而不是用户
    const checkbox = task
        ? `<input type="checkbox" disabled${/x/i.test(task[1]) ? ' checked' : ''} /> `
        : '';

    // 松散项（内部有空行）整段按块走，段落间距该留就留
    if (trimmed.some((line) => !line.trim())) return checkbox + blocks(trimmed, ctx);

    // 紧凑项：第一段直接行内渲染，不套 <p>——套上之后行距会莫名拉开一档。
    // 紧跟其后的子列表、代码块之类再交给块级解析。
    let split = 1;
    while (split < trimmed.length && !startsBlock(trimmed[split])) split += 1;

    const lead = checkbox + inline(trimmed.slice(0, split).join('\n'));
    return split >= trimmed.length ? lead : lead + blocks(trimmed.slice(split), ctx);
}

function renderTable(lines: string[], start: number, ctx: Ctx): [string, number] {
    const header = tableCells(lines[start]);
    const aligns = tableCells(lines[start + 1]).map((cell) => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
    });

    const cell = (text: string, tag: 'th' | 'td', index: number) => {
        const align = aligns[index] ? ` style="text-align:${aligns[index]}"` : '';
        return `<${tag}${align}>${inline(text)}</${tag}>`;
    };

    let html = `<table><thead><tr>${header.map((text, index) => cell(text, 'th', index)).join('')}</tr></thead><tbody>`;
    let i = start + 2;

    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const row = tableCells(lines[i]);
        // 缺的格子补空，多的格子留着——表格写歪了也别把内容吞掉
        const width = Math.max(header.length, row.length);
        const cells = Array.from({ length: width }, (_, index) => cell(row[index] ?? '', 'td', index));
        html += `<tr>${cells.join('')}</tr>`;
        i += 1;
    }

    return [`${html}</tbody></table>`, i];
}

function blocks(lines: string[], ctx: Ctx): string {
    let html = '';
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) {
            i += 1;
            continue;
        }

        const fence = FENCE_RE.exec(line);
        if (fence) {
            const marker = fence[1].slice(0, 3);
            const body: string[] = [];
            i += 1;
            while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
                body.push(lines[i]);
                i += 1;
            }
            // 没有收尾栅栏就一直吃到文件末尾，这也是 CommonMark 的行为
            i += 1;
            const cls = fence[2] ? ` class="language-${esc(fence[2])}"` : '';
            html += `<pre><code${cls}>${esc(body.join('\n'))}</code></pre>`;
            continue;
        }

        const heading = HEADING_RE.exec(line);
        if (heading) {
            const level = heading[1].length;
            const id = slugify(heading[2], ctx.taken);
            ctx.headings.push({ level, text: heading[2], id });
            html += `<h${level} id="${esc(id)}">${inline(heading[2])}</h${level}>`;
            i += 1;
            continue;
        }

        if (HR_RE.test(line)) {
            html += '<hr />';
            i += 1;
            continue;
        }

        if (QUOTE_RE.test(line)) {
            const body: string[] = [];
            while (i < lines.length) {
                const quoted = QUOTE_RE.exec(lines[i]);
                if (quoted) {
                    body.push(quoted[1]);
                    i += 1;
                    continue;
                }
                // 引用块里的懒续行：没有 > 但也没空行，仍算同一段
                if (lines[i].trim() && !startsBlock(lines[i])) {
                    body.push(lines[i]);
                    i += 1;
                    continue;
                }
                break;
            }
            html += `<blockquote>${blocks(body, ctx)}</blockquote>`;
            continue;
        }

        if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
            const [listHtml, next] = renderList(lines, i, ctx);
            html += listHtml;
            i = next;
            continue;
        }

        // 表格要看下一行是不是分隔行，否则一句带竖线的普通话就成了表格
        if (line.includes('|') && i + 1 < lines.length && DIVIDER_RE.test(lines[i + 1])) {
            const [tableHtml, next] = renderTable(lines, i, ctx);
            html += tableHtml;
            i = next;
            continue;
        }

        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
            // 段落中间出现表格头也要断开
            if (lines[i].includes('|') && i + 1 < lines.length && DIVIDER_RE.test(lines[i + 1]) && para.length) break;
            para.push(lines[i]);
            i += 1;
        }
        html += `<p>${inline(para.join('\n'))}</p>`;
    }

    return html;
}

/** 标题锚点。中文不做转写，直接留着——浏览器和分享链接都认 UTF-8。 */
export function slugify(text: string, taken: Set<string>): string {
    const base =
        text
            .toLowerCase()
            .replace(/[\s]+/g, '-')
            .replace(/[^\p{L}\p{N}_-]+/gu, '')
            .replace(/^-+|-+$/g, '') || 'section';

    let id = base;
    let n = 2;
    // 同名标题要各有各的锚点，否则跳转永远落在第一个
    while (taken.has(id)) {
        id = `${base}-${n}`;
        n += 1;
    }
    taken.add(id);
    return id;
}

// ---------- 统计 ----------

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu;
const LATIN = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

/**
 * 字数。中文按字数、西文按词数——两种文字混排时按一种口径算总会偏得很远：
 * 全按空格分词的话一整段中文只算一个词，全按字符算的话英文又会虚高好几倍。
 */
export function countWords(text: string): number {
    // 代码块和行内代码不算进阅读量，标记符号也不算
    const plain = text
        .replace(/^\s{0,3}(```+|~~~+)[\s\S]*?^\s{0,3}\1\s*$/gm, ' ')
        .replace(/(`+)[\s\S]*?\1/g, ' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#>*_~|\-=+]/g, ' ');

    const cjk = plain.match(CJK)?.length ?? 0;
    const latin = plain.replace(CJK, ' ').match(LATIN)?.length ?? 0;
    return cjk + latin;
}

/** 中文默认按每分钟 400 字算，比英文的 200 词快一档，这是常见的实测区间。 */
export function readingMinutes(words: number): number {
    return Math.max(1, Math.round(words / 400));
}

// ---------- 入口 ----------

/**
 * 渲染整篇文档。返回的 html 可以直接进 innerHTML——里面所有标签都是这个
 * 渲染器自己生成的，原文里的每一个字符都过了 esc()。
 */
export function renderMarkdown(source: string): Rendered {
    const text = source
        // NUL 是行内渲染的占位符标记，原文里出现就会撞车，入口先清掉
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        // Tab 按 4 空格算：列表的缩进层级是按空格数判断的
        .replace(/\t/g, '    ');

    const ctx: Ctx = { headings: [], taken: new Set() };
    const html = blocks(text.split('\n'), ctx);
    const words = countWords(text);

    return { html, headings: ctx.headings, words, minutes: readingMinutes(words) };
}
