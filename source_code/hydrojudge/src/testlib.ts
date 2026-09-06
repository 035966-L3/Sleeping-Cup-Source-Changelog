import { DetailType, STATUS } from '@hydrooj/common';

const operation = /^\s*(status|score)\((\d+)\)\s*((\S|$).*)$/m;

export function parse(output: string, fullscore: number, detail: DetailType) {
    let status = STATUS.STATUS_WRONG_ANSWER;
    let score = 0;
    let message = `${output.substring(0, 1024)} `;
    if (output.startsWith('ok ')) {
        status = STATUS.STATUS_ACCEPTED;
        score = fullscore;
        message = output.split('ok ')[1] || '';
    } else if (output.startsWith('wrong answer ')) {
        message = output.split('wrong answer ')[1] || '';
    } else if (output.startsWith('wrong output format ')) {
        message = output.split('wrong output format ')[1] || '';
    } else if (output.startsWith('partially correct ')) {
        let p = +output.split('partially correct (')[1].split(')')[0] || 0;
        status = STATUS.STATUS_PARTIAL;
        score = fullscore * p;
        if (p >= 1) status = STATUS.STATUS_ACCEPTED;
        if (p <= 0) status = STATUS.STATUS_WRONG_ANSWER;
        const res = message.split(')');
        res.shift();
        message = res.join(')').trim();
    } else if (output.startsWith('points ')) {
        let p = +output.split('points ')[1].split(' ')[0] || 0;
        message = output.replace(/^points [\d.]+ /, '') || '';
        status = STATUS.STATUS_PARTIAL;
        score = fullscore * p;
        if (p >= 1) status = STATUS.STATUS_ACCEPTED;
        if (p <= 0) status = STATUS.STATUS_WRONG_ANSWER;
    }
    while (operation.test(message)) {
        const [, op, val, rest] = message.match(operation);
        message = rest;
        if (op === 'status') {
            const s = +val;
            if ([
                STATUS.STATUS_ACCEPTED,
                STATUS.STATUS_WRONG_ANSWER,
                STATUS.STATUS_COMPILE_ERROR,
                STATUS.STATUS_RUNTIME_ERROR,
                STATUS.STATUS_MEMORY_LIMIT_EXCEEDED,
                STATUS.STATUS_TIME_LIMIT_EXCEEDED,
                STATUS.STATUS_OUTPUT_LIMIT_EXCEEDED,
                STATUS.STATUS_FORMAT_ERROR,
                STATUS.STATUS_PARTIAL,
            ].includes(s)) status = +val;
        } else if (op === 'score') {
            score = +val;
        }
    }
    return { status, score, message: (detail === 'full' ? message : '') };
}
