import assert from 'assert';
import { STATUS } from '@hydrooj/common';
import { fs, yaml } from '@hydrooj/utils';
import { FormatError } from '../error';
import { Context } from './interface';

function mergeStatus(firstStatus: STATUS, secondStatus: STATUS) { return (firstStatus === secondStatus || firstStatus === STATUS.STATUS_JUDGING) ? secondStatus : STATUS.STATUS_PARTIAL; }

export async function judge({
    next, end, config, code,
}: Context) {
    next({ status: STATUS.STATUS_JUDGING, progress: 0 });
    const answer = ('src' in code)
        ? await fs.readFile(code.src, 'utf-8')
        : ('content' in code)
            ? code.content.toString().replace(/\r/g, '')
            : '';
    let answers: { [x: string]: string | string[] } = {};
    try {
        answers = yaml.load(answer) as any;
        assert(typeof answers === 'object');
    } catch (e) {
        end({
            status: STATUS.STATUS_WRONG_ANSWER,
            score: 0,
            message: 'Unable to parse answer.',
            time: 0,
            memory: 0,
        });
        return null;
    }
    let totalScore = 0;
    let totalStatus = STATUS.STATUS_JUDGING;
    const subtasks = {};
    if (!Object.keys(config.answers).length) throw new FormatError('Invalid standard answer.');
    for (const key in config.answers) {
        const ansInfo = config.answers[key] as [string | string[], number] | Record<string, number>;
        // eslint-disable-next-line ts/no-loop-func
        const report = (status: STATUS, score: number, message: string) => {
            const [subtaskId, caseId] = key.includes('-') ? key.split('-').map(Number) : [key * 1, 1];
            totalScore += score;
            totalStatus = mergeStatus(totalStatus, status);
            subtasks[subtaskId] ||= { score: 0, status: STATUS.STATUS_JUDGING };
            subtasks[subtaskId].score += score;
            subtasks[subtaskId].status = mergeStatus(subtasks[subtaskId].status, status);
            next({
                case: {
                    subtaskId,
                    id: caseId,
                    time: 0,
                    memory: 0,
                    status,
                    score,
                    message,
                },
            });
        };
        if (!answers[key]) {
            report(STATUS.STATUS_WRONG_ANSWER, 0, '');
            continue;
        }
        const usrAns = answers[key].toString().trim();
        if (ansInfo instanceof Array) {
            const fullScore = (+ansInfo[1]) || 0;
            const stdAns = ansInfo[0];
            if (stdAns instanceof Array) {
                const stdSet = new Set(stdAns);
                const ans = new Set(answers[key] instanceof Array ? answers[key] : [answers[key]]);
                if (stdAns.length === ans.size && stdSet.isSupersetOf(ans)) report(STATUS.STATUS_ACCEPTED, fullScore, '');
                else if (ans.size && stdSet.isSupersetOf(ans)) report(STATUS.STATUS_PARTIAL, fullScore * ans.size / stdSet.size, '');
                else report(STATUS.STATUS_WRONG_ANSWER, 0, '');
            } else if (stdAns.toString() === usrAns) report(STATUS.STATUS_ACCEPTED, fullScore, '');
            else report(STATUS.STATUS_WRONG_ANSWER, 0, '');
        } else if (!ansInfo[usrAns]) report(STATUS.STATUS_WRONG_ANSWER, 0, '');
        else report(STATUS.STATUS_ACCEPTED, +ansInfo[usrAns] || 0, '');
    }
    end({
        status: totalStatus, score: totalScore, time: 0, memory: 0, subtasks,
    });
    return null;
}
