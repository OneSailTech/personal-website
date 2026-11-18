export type Person = {
    name: string;
    studentId: string;
};

export const className = '2026级计算机科学与技术专升本1班';

const classNames = [
    '李静', '苏林桃', '叶伟龙', '陈思源', '曹志昂', '邱嘉洵', '李思雨', '习嘉轩',
    '李仁平', '黄嘉亭', '吴文杰', '罗静莹', '汪一凡', '何彦成', '陈佳文', '程坤平',
    '潘是稳', '于昊', '戴渤曦', '刘淑萍', '刘佐伟', '陈霜', '胡威', '杨冬香',
    '温谟嘉', '廖宝敏', '钟远', '余英伟', '吴艳莉', '徐杰', '余华芸', '谢怡帆',
    '姜津', '田烽', '吴冬芳', '胡伟', '王烨', '李玉琴', '胡琳宇', '刘佳',
    '万伟志', '刘俊杰', '胡羽萱', '吴培', '吴玥', '马贝卡', '杨渊棋', '阮智斐',
];

export const classRoster: Person[] = classNames.map((name, index) => ({
    name,
    studentId: String(20260409201 + index),
}));
