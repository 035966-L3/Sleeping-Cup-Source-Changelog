import Queue from 'p-queue';
import {
    JudgeResultBody, NormalizedCase, NormalizedSubtask, STATUS,
} from '@hydrooj/common';
import { getConfig } from './config';
import { FormatError } from './error';
import { Context, ContextSubTask } from './judge/interface';

function mergeSumStatus(firstStatus: STATUS, secondStatus?: STATUS) {
    return (secondStatus === null ||
            secondStatus === undefined ||
            secondStatus === 0 ||
            secondStatus === STATUS.STATUS_CANCELED ||
            firstStatus === secondStatus) ?
                firstStatus :
                ((firstStatus > STATUS.STATUS_ACCEPTED &&
                    firstStatus < STATUS.STATUS_PARTIAL && 
                    secondStatus > STATUS.STATUS_ACCEPTED &&
                        secondStatus < STATUS.STATUS_PARTIAL ||
                        firstStatus === STATUS.STATUS_CANCELED ||
                        firstStatus === null ||
                        firstStatus === undefined) ?
                            secondStatus :
                            STATUS.STATUS_PARTIAL);
}

function mergeMinStatus(firstStatus: STATUS, secondStatus?: STATUS) {
    return (firstStatus === STATUS.STATUS_CANCELED) ?
            secondStatus :
            ((firstStatus > STATUS.STATUS_ACCEPTED &&
                firstStatus < STATUS.STATUS_PARTIAL) ?
                    firstStatus :
                    ((firstStatus === STATUS.STATUS_PARTIAL ||
                        secondStatus === STATUS.STATUS_PARTIAL) ?
                            STATUS.STATUS_PARTIAL :
                            firstStatus));
}

interface Task {
    compile: () => Promise<void>;
    judgeCase: (c: NormalizedCase) => (
        (ctx: Context, ctxSubtask: ContextSubTask) => Promise<JudgeResultBody['case']>
    );
}

const Score = {
    sum: (a: number, b: number) => (a + b),
    max: Math.max,
    min: Math.min,
};

function judgeSubtask(subtask: NormalizedSubtask, sid: string, judgeCase: Task['judgeCase']) {
    return async (ctx: Context) => {
        subtask.type ||= 'min';
        const ctxSubtask = {
            subtask,
            status: STATUS.STATUS_CANCELED,
            score: subtask.type === 'min'
                ? subtask.score
                : 0,
        };
        const cases = [];
        let thatId = ctx.thisId;
        for (const cid in subtask.cases) {
            thatId += 1;
            let currentId = thatId;
            const runner = judgeCase(subtask.cases[cid]);
            cases.push(ctx.queue.add(async () => {
                const res = (ctx.errored
                    || (subtask.type === 'min' &&
                        ctxSubtask.status > STATUS.STATUS_ACCEPTED &&
                        ctxSubtask.status > STATUS.STATUS_PARTIAL &&
                        ctxSubtask.status != STATUS.STATUS_CANCELED)
                    || (subtask.if || []).filter((i) => ctx.failed[i]).length)
                    ? {
                        id: currentId,
                        status: STATUS.STATUS_CANCELED,
                        subtaskId: subtask.id,
                        score: 0,
                        time: 0,
                        memory: 0,
                        message: '',
                    } : await (async () => {
                        using span = ctx.startChildSpan('judge.case', { id: subtask.cases[cid].id, subtaskId: subtask.id });
                        const r = await runner(ctx, ctxSubtask);
                        span.setAttributes({ status: r?.status, time: r?.time, memory: r?.memory });
                        return r;
                    })();
                if (res?.status !== STATUS.STATUS_CANCELED) {
                    ctxSubtask.score = Score[ctxSubtask.subtask.type](ctxSubtask.score, res.score);
                    ctxSubtask.status = (ctxSubtask.subtask.type === 'sum') ? mergeSumStatus(res.status, ctxSubtask.status) : mergeMinStatus(res.status, ctxSubtask.status);
                    ctx.total_time += res.time;
                    ctx.total_memory = Math.max(ctx.total_memory, res.memory);
                }
                if (ctxSubtask.status > STATUS.STATUS_ACCEPTED) ctx.failed[sid] = true;
                if (ctx.config.detail !== 'none') {
                    ctx.next({ ...res ? { case: res } : {}, addProgress: 100 / ctx.config.count });
                }
            }));
        }
        try {
            await Promise.all(cases);
        } catch (e) {
            ctx.errored = true;
            throw e;
        }
        ctx.total_status = mergeSumStatus(ctxSubtask.status, ctx.total_status);
        return {
            type: ctxSubtask.subtask.type,
            score: ctxSubtask.score,
            status: ctxSubtask.status,
        };
    };
}

export const runFlow = async (ctx: Context, task: Task) => {
    if (!ctx.config.subtasks.length) throw new FormatError('Problem data not found.');
    ctx.next({ status: STATUS.STATUS_COMPILING });
    await task.compile();
    ctx.next({ status: STATUS.STATUS_JUDGING, progress: 0 });
    ctx.total_status = 0;
    ctx.total_score = 0;
    ctx.total_memory = 0;
    ctx.total_time = 0;
    ctx.rerun = getConfig('rerun') || 0;
    ctx.queue = new Queue({ concurrency: getConfig('singleTaskParallelism') });
    ctx.failed = {};
    if (ctx.meta.hackRejudge) {
        const subtask = ctx.config.subtasks.find((i) => i.cases.find((j) => j.input.endsWith(ctx.meta.hackRejudge)));
        const ctxSubtask = {
            subtask,
            status: STATUS.STATUS_ACCEPTED,
            score: subtask.type === 'min' ? subtask.score : 0,
        };
        const runner = task.judgeCase(subtask.cases.find((i) => i.input.endsWith(ctx.meta.hackRejudge)));
        const res = await runner(ctx, ctxSubtask);
        if (res) ctx.next({ case: res });
        if (res?.status !== STATUS.STATUS_ACCEPTED) {
            const totalScore = Math.sum(ctx.config.subtasks.map((i) => i.score));
            ctx.end({
                status: STATUS.STATUS_HACKED,
                score: totalScore - subtask.score,
            });
        } else {
            ctx.next({ status: STATUS.STATUS_ACCEPTED });
            ctx.end({ nop: true });
        }
    } else {
        const infos = {};
        await Promise.all(Object.entries(ctx.config.subtasks).map(async ([key, value]) => {
            const sid = value.id?.toString() || key;
            infos[sid] = await judgeSubtask(value, sid, task.judgeCase)(ctx);
            ctx.thisId += value.cases.length || 0;
        }));
        for (const [key, value] of Object.entries(ctx.config.subtasks)) {
            let effective = true;
            const sid = value.id?.toString() || key;
            for (const required of value.if || []) {
                if (ctx.failed[required.toString()]) effective = false;
            }
            if (effective) ctx.total_score += infos[sid].score;
            else {
                ctx.failed[sid] = true;
                delete infos[sid];
            }
        }
        ctx.end({
            status: ctx.total_status,
            score: ctx.total_score,
            time: Math.floor(ctx.total_time * 1000000) / 1000000,
            memory: ctx.total_memory,
            subtasks: infos,
        });
    }
};
