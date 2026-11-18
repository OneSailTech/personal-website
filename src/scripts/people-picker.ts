import { className, classRoster, type Person } from '../data/people-picker';
import { copyText } from './copy';

type Source = 'class' | 'custom';

type Round = {
    time: number;
    winners: Person[];
};

type Settings = {
    count: number;
    excluded: string[];
    avoidRepeats: boolean;
    rounds: Round[];
};

type State = {
    source: Source;
    custom: Person[];
    settings: Record<Source, Settings>;
};

const storageKey = 'blog.people-picker.v1';
const state = readState();
const randomBuffer = new Uint32Array(1);
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`#picker-${id}`)!;
const stage = element('stage');
const status = element('status');
const radar = element('radar');
const radarValue = element('radar-value');
const radarCaption = element('radar-caption');
const results = element('results');
const winners = element<HTMLOListElement>('winners');
const stageNote = element('stage-note');
const announcement = element('announcement');
const drawButton = element<HTMLButtonElement>('draw');
const drawLabel = element('draw-label');
const copyButton = element<HTMLButtonElement>('copy');
const settingsFields = element<HTMLFieldSetElement>('settings-fields');
const sourceInput = element<HTMLSelectElement>('source');
const editButton = element<HTMLButtonElement>('edit');
const countInput = element<HTMLInputElement>('count');
const minusButton = element<HTMLButtonElement>('minus');
const plusButton = element<HTMLButtonElement>('plus');
const repeatInput = element<HTMLInputElement>('repeat');
const searchInput = element<HTMLInputElement>('search');
const poolSummary = element('pool');
const rosterSummary = element('roster-summary');
const includeButton = element<HTMLButtonElement>('include');
const excludeButton = element<HTMLButtonElement>('exclude');
const rosterList = element('roster-list');
const noMatch = element('no-match');
const historyCount = element('history-count');
const historyList = element('history-list');
const noHistory = element('no-history');
const resetButton = element<HTMLButtonElement>('reset');
const customDialog = element<HTMLDialogElement>('dialog');
const customForm = element<HTMLFormElement>('custom-form');
const customInput = element<HTMLTextAreaElement>('custom-input');
const customError = element('custom-error');

let drawing = false;
let visibleRows: { id: string; row: HTMLLIElement; checkbox: HTMLInputElement; drawnTag: HTMLSpanElement }[] = [];

function defaultSettings(): Settings {
    return { count: 1, excluded: [], avoidRepeats: true, rounds: [] };
}

function isPerson(value: unknown): value is Person {
    const person = value as Partial<Person> | null;
    return !!person && typeof person.name === 'string' && person.name.trim() !== '' && typeof person.studentId === 'string';
}

function readSettings(value?: Partial<Settings>): Settings {
    const settings = defaultSettings();
    if (!value) return settings;

    if (typeof value.count === 'number' && Number.isInteger(value.count) && value.count > 0) settings.count = value.count;
    if (typeof value.avoidRepeats === 'boolean') settings.avoidRepeats = value.avoidRepeats;
    if (Array.isArray(value.excluded)) settings.excluded = value.excluded.filter(id => typeof id === 'string');
    if (Array.isArray(value.rounds)) {
        settings.rounds = value.rounds.filter(round =>
            typeof round?.time === 'number' && Number.isFinite(new Date(round.time).getTime()) &&
            Array.isArray(round.winners) && round.winners.length > 0 && round.winners.every(isPerson),
        );
    }
    return settings;
}

function readState(): State {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<State> | null;
        const custom = Array.isArray(saved?.custom) ? saved.custom.filter(isPerson) : [];
        return {
            source: saved?.source === 'custom' && custom.length ? 'custom' : 'class',
            custom,
            settings: { class: readSettings(saved?.settings?.class), custom: readSettings(saved?.settings?.custom) },
        };
    } catch {
        return { source: 'class', custom: [], settings: { class: defaultSettings(), custom: defaultSettings() } };
    }
}

function saveState() {
    try {
        localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
        // The picker still works for this visit when browser storage is unavailable.
    }
}

function personKey(person: Person) {
    return person.studentId ? `id:${person.studentId}` : `name:${person.name}`;
}

function roster() {
    return state.source === 'class' ? classRoster : state.custom;
}

function settings() {
    return state.settings[state.source];
}

function latestRound() {
    return settings().rounds.at(-1);
}

function selection() {
    const { excluded, avoidRepeats, rounds } = settings();
    const excludedIds = new Set(excluded);
    const drawnIds = new Set(avoidRepeats ? rounds.flatMap(round => round.winners.map(personKey)) : []);
    const included = roster().filter(person => !excludedIds.has(personKey(person)));
    const pool = included.filter(person => !drawnIds.has(personKey(person)));
    return { excludedIds, drawnIds, included, pool };
}

function formatPerson(person: Person) {
    return person.studentId ? `${person.name}（${person.studentId}）` : person.name;
}

function renderRoster() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const people = roster().filter(person =>
        person.name.toLocaleLowerCase().includes(query) || person.studentId.toLocaleLowerCase().includes(query),
    );

    visibleRows = people.map(person => {
        const id = personKey(person);
        const row = document.createElement('li');
        row.className = 'picker-person';
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';

        const name = document.createElement('span');
        name.className = 'picker-person-name';
        name.textContent = person.name;
        label.append(checkbox, name);

        const drawnTag = document.createElement('span');
        drawnTag.className = 'picker-drawn-tag';
        drawnTag.textContent = '已抽中';
        drawnTag.hidden = true;
        label.append(drawnTag);

        if (person.studentId) {
            const studentId = document.createElement('span');
            studentId.className = 'picker-student-id';
            studentId.textContent = person.studentId;
            label.append(studentId);
        }

        checkbox.addEventListener('change', () => setIncluded([id], checkbox.checked));
        row.append(label);
        return { id, row, checkbox, drawnTag };
    });

    rosterList.replaceChildren(...visibleRows.map(({ row }) => row));
    noMatch.hidden = visibleRows.length > 0;
}

function renderStage() {
    const round = latestRound();
    const phase = drawing ? 'rolling' : round ? 'result' : 'ready';
    stage.dataset.phase = phase;
    status.textContent = drawing ? '抽取中' : round ? `已抽中 ${round.winners.length} 人` : '待抽取';
    radar.hidden = phase === 'result';
    results.hidden = phase !== 'result';
    copyButton.hidden = results.hidden;
    copyButton.textContent = '复制结果';
    drawLabel.textContent = drawing ? '抽取中…' : round ? '再抽一次' : '开始抽取';

    if (round && !drawing) {
        const cards = round.winners.map(person => {
            const card = document.createElement('li');
            card.className = 'picker-winner';
            const name = document.createElement('span');
            name.textContent = person.name;
            card.append(name);

            if (person.studentId) {
                const studentId = document.createElement('span');
                studentId.className = 'picker-student-id';
                studentId.textContent = person.studentId;
                card.append(studentId);
            }
            return card;
        });
        winners.replaceChildren(...cards);
        winners.scrollTop = 0;
        winners.tabIndex = cards.length > 4 ? 0 : -1;
    } else {
        winners.replaceChildren();
    }
}

function renderHistory() {
    const { rounds } = settings();
    historyCount.textContent = `${rounds.length} 轮`;
    noHistory.hidden = rounds.length > 0;
    resetButton.hidden = rounds.length === 0;
    const fragment = document.createDocumentFragment();

    for (const round of [...rounds].reverse()) {
        const item = document.createElement('li');
        const time = document.createElement('time');
        time.dateTime = new Date(round.time).toISOString();
        time.textContent = timeFormat.format(round.time);
        const names = document.createElement('p');
        names.textContent = round.winners.map(formatPerson).join('、');
        item.append(time, names);
        fragment.append(item);
    }
    historyList.replaceChildren(fragment);
}

function syncControls(normalizeCount = true) {
    const { pool, included, excludedIds, drawnIds } = selection();
    const maxCount = Math.max(1, pool.length);
    countInput.max = String(maxCount);
    if (normalizeCount) {
        settings().count = Math.min(settings().count, maxCount);
        countInput.value = String(settings().count);
    }

    const validCount = countInput.validity.valid;
    settingsFields.disabled = drawing;
    repeatInput.checked = settings().avoidRepeats;
    countInput.disabled = pool.length === 0;
    minusButton.disabled = !pool.length || (validCount && countInput.valueAsNumber <= 1);
    plusButton.disabled = !pool.length || (validCount && countInput.valueAsNumber >= maxCount);
    drawButton.disabled = !pool.length || !validCount;
    drawButton.setAttribute('aria-disabled', String(drawing || drawButton.disabled));
    resetButton.disabled = drawing;

    poolSummary.textContent = `可抽 ${pool.length} / ${roster().length} 人`;
    rosterSummary.textContent = `已选 ${included.length} 人`;
    if (!drawing) {
        radarValue.textContent = String(pool.length);
        radarCaption.textContent = '可抽取人数';
    }

    let note = '';
    if (pool.length === 0) {
        note = included.length ? '已选人员均已抽中。关闭跨轮免重复或清空记录即可继续。' : '请在人员名单中勾选至少一人。';
    } else if (!validCount) {
        note = `请输入 1 至 ${maxCount} 之间的整数。`;
    }
    stageNote.textContent = note;

    const filtering = searchInput.value.trim() !== '';
    includeButton.textContent = filtering ? '全选结果' : '全选';
    excludeButton.textContent = filtering ? '排除结果' : '全部排除';
    includeButton.disabled = drawing || !visibleRows.some(({ id }) => excludedIds.has(id));
    excludeButton.disabled = drawing || !visibleRows.some(({ id }) => !excludedIds.has(id));

    for (const { id, row, checkbox, drawnTag } of visibleRows) {
        checkbox.disabled = drawing;
        checkbox.checked = !excludedIds.has(id);
        drawnTag.hidden = !drawnIds.has(id);
        row.dataset.unavailable = String(!checkbox.checked || !drawnTag.hidden);
    }
}

function setIncluded(ids: string[], included: boolean) {
    const next = new Set(settings().excluded);
    for (const id of ids) {
        if (included) next.delete(id);
        else next.add(id);
    }
    settings().excluded = [...next];
    syncControls();
    saveState();
}

function changeSource(source: Source) {
    state.source = source;
    sourceInput.value = source;
    searchInput.value = '';
    editButton.hidden = source !== 'custom';
    announcement.textContent = '';
    renderRoster();
    renderStage();
    renderHistory();
    syncControls();
    saveState();
}

function setCount(count: number) {
    settings().count = Math.max(1, Math.min(Math.trunc(count), Number(countInput.max)));
    syncControls();
    saveState();
}

function randomIndex(length: number) {
    const range = 2 ** 32;
    const limit = range - range % length;
    do {
        crypto.getRandomValues(randomBuffer);
    } while (randomBuffer[0] >= limit);
    return randomBuffer[0] % length;
}

function pickPeople(pool: Person[], count: number) {
    const shuffled = [...pool];
    for (let index = 0; index < count; index++) {
        const selected = index + randomIndex(shuffled.length - index);
        [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
    }
    return shuffled.slice(0, count);
}

function draw() {
    const { pool } = selection();
    const count = countInput.valueAsNumber;
    if (drawing || !countInput.validity.valid || count < 1 || count > pool.length) return;
    settings().count = count;

    const picked = pickPeople(pool, count);
    const finish = () => {
        settings().rounds.push({ time: Date.now(), winners: picked });
        drawing = false;
        renderStage();
        renderHistory();
        syncControls();
        saveState();
        announcement.textContent = picked.length <= 5
            ? `本轮抽中 ${picked.length} 人。${picked.map(person => person.name).join('、')}。`
            : `本轮抽中 ${picked.length} 人。`;
    };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
    }

    drawing = true;
    announcement.textContent = '正在抽取';
    renderStage();
    syncControls();
    radarCaption.textContent = `本轮抽取 ${count} 人`;
    radarValue.textContent = pool[randomIndex(pool.length)].name;
    const rolling = window.setInterval(() => {
        radarValue.textContent = pool[randomIndex(pool.length)].name;
    }, 95);
    window.setTimeout(() => {
        window.clearInterval(rolling);
        finish();
    }, 1400);
}

function customColumns(line: string) {
    if (line.includes('\t')) return line.split('\t').map(value => value.trim());
    if (/[,，]/.test(line)) return line.split(/[,，]/).map(value => value.trim());
    const text = line.trim();
    const indexed = text.match(/^(\d+)\s+(.+?)\s+(\S+)$/);
    if (indexed) return indexed.slice(1);
    const named = text.match(/^(.+?)\s+(\S*\d\S*)$/);
    return named ? named.slice(1) : [text];
}

function parseCustom(text: string) {
    const people = new Map<string, Person>();
    for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        if (!people.size && /^(?:序号[\s,，]+)?姓名(?:[\s,，]+学号)?$/.test(line.trim())) continue;

        const columns = customColumns(line);
        if (columns.length === 3 && /^\d+$/.test(columns[0])) columns.shift();
        const [name, studentId = ''] = columns;
        if (columns.length > 2 || !name) throw new Error(`第 ${index + 1} 行格式有误，请填写姓名和可选的学号。`);

        const person = { name, studentId };
        const key = personKey(person);
        const previous = people.get(key);
        if (previous && previous.name !== name) throw new Error(`第 ${index + 1} 行的学号 ${studentId} 已对应其他姓名。`);
        people.set(key, person);
    }
    if (!people.size) throw new Error('请至少填写一位人员。');
    return [...people.values()];
}

function openCustomDialog() {
    customError.textContent = '';
    customInput.removeAttribute('aria-invalid');
    customInput.value = state.custom.map(person => `${person.name}\t${person.studentId}`).join('\n');
    customDialog.showModal();
}

sourceInput.addEventListener('change', () => {
    const source = sourceInput.value as Source;
    if (source === 'custom' && !state.custom.length) {
        sourceInput.value = state.source;
        openCustomDialog();
    } else {
        changeSource(source);
    }
});

editButton.addEventListener('click', openCustomDialog);
element('cancel-icon').addEventListener('click', () => customDialog.close());
element('cancel').addEventListener('click', () => customDialog.close());
customInput.addEventListener('input', () => {
    customError.textContent = '';
    customInput.removeAttribute('aria-invalid');
});
customForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let people: Person[];
    try {
        people = parseCustom(customInput.value);
    } catch (error) {
        customError.textContent = (error as Error).message;
        customInput.setAttribute('aria-invalid', 'true');
        customInput.focus();
        return;
    }

    const validIds = new Set(people.map(personKey));
    state.custom = people;
    state.settings.custom.excluded = state.settings.custom.excluded.filter(id => validIds.has(id));
    customDialog.close();
    changeSource('custom');
});

searchInput.addEventListener('input', () => {
    renderRoster();
    syncControls(false);
});
includeButton.addEventListener('click', () => setIncluded(visibleRows.map(({ id }) => id), true));
excludeButton.addEventListener('click', () => setIncluded(visibleRows.map(({ id }) => id), false));
countInput.addEventListener('input', () => syncControls(false));
countInput.addEventListener('change', () => setCount(countInput.valueAsNumber || settings().count));
minusButton.addEventListener('click', () => setCount((countInput.valueAsNumber || settings().count) - 1));
plusButton.addEventListener('click', () => setCount((countInput.valueAsNumber || settings().count) + 1));
repeatInput.addEventListener('change', () => {
    settings().avoidRepeats = repeatInput.checked;
    syncControls();
    saveState();
});

drawButton.addEventListener('click', draw);
resetButton.addEventListener('click', () => {
    if (!window.confirm('清空当前名单的抽取记录？已抽中的人员将重新进入候选池。')) return;
    settings().rounds = [];
    renderStage();
    renderHistory();
    syncControls();
    saveState();
    announcement.textContent = '已清空抽取记录。';
});

copyButton.addEventListener('click', async () => {
    const round = latestRound();
    if (!round) return;
    const sourceName = state.source === 'class' ? className : '自定义名单';
    const copied = await copyText(`${sourceName} · 抽中 ${round.winners.length} 人\n${round.winners.map(formatPerson).join('\n')}`);
    if (!drawing && round === latestRound()) {
        copyButton.textContent = copied ? '已复制' : '复制失败';
        announcement.textContent = copied ? '已复制本轮结果。' : '复制失败，请手动选中结果复制。';
    }
});

changeSource(state.source);
