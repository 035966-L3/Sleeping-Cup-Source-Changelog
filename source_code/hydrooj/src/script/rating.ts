/* eslint-disable no-cond-assign */
/* eslint-disable no-await-in-loop */
import { NumericDictionary, unionWith } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import Schema from 'schemastery';
import { Counter } from '@hydrooj/utils';
import { Tdoc, Udoc } from '../interface';
import difficultyAlgorithm from '../lib/difficulty';
import rating from '../lib/rating';
import { PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import domain from '../model/domain';
import problem from '../model/problem';
import UserModel from '../model/user';
import db from '../service/db';

export const description = 'Calculate rp of a domain, or all domains';

type ND = NumericDictionary<number>;
type Report = (data: any) => void;

interface RpDef {
    run(domainIds: string[], udict: ND, report: Report): Promise<void>;
    hidden: boolean;
    base: number;
}

const { log, max, min } = Math;

// 警告：以下部分经过修改。
const RpTypes: Record<string, RpDef> = {
    problem: {
        async run(domainIds, udict, report) {
            // 直接跳过计算，Problem RP 设为 0
            for (const key in udict) udict[key] = 0; // 确保所有用户的 Problem RP 为 0
        },
        hidden: false,
        base: 0,
    },
    contest: {
        async run(domainIds, udict, report) {
            // 不重新计算 Contest RP，直接保留现有数据
            const contests = await contest.getMulti('', { domainId: { $in: domainIds }, rated: true })
                .limit(10).toArray() as Tdoc[];
            if (contests.length) await report({ message: `Found ${contests.length} contests, but RP remains unchanged` });

            // 不更新 udict，保留原值
            for (const key in udict) udict[key] = max(1, udict[key] / 4 - 375); // 保持原逻辑，但不影响 RP
        },
        hidden: false,
        // 将默认值设为 0
        base: 0,
    },
    delta: {
        async run(domainIds, udict) {},
        hidden: true,
        base: 0,
    },
};
global.Hydro.model.rp = RpTypes;

export async function calcLevel(domainId: string, report: Report) {
    await db.collection('domain.user').deleteMany({
        $or: [
            { uid: null },
            { uid: { $exists: false } },
            { uid: { $lte: 0 } }
        ]
    });
    await domain.setMultiUserInDomain(domainId, { level: { $lt: 11 } }, { level: 0, rank: null });
    await domain.setMultiUserInDomain(domainId, { level: { $gte: 11 } }, { level: 11, rank: null });
    let last = { rp: null };
    let rank = 0;
    let count = 0;
    const coll = db.collection('domain.user');
    const filter = { rp: { $gt: 0 }, uid: { $nin: [0, 1, null], $gt: -1000 } };
    const ducur = domain.getMultiUserInDomain(domainId, filter)
        .project<{ _id: ObjectId, rp: number }>({ rp: 1 })
        .sort({ rp: -1 });
    let bulk = coll.initializeUnorderedBulkOp();
    for await (const dudoc of ducur) {
        count++;
        dudoc.rp ||= null;
        if (dudoc.rp !== last.rp) rank = count;
        bulk.find({ _id: dudoc._id }).updateOne({ $set: { rank } });
        last = dudoc;
        if (count % 100 === 0) report({ message: `#${count}: Rank ${rank}` });
    }
    if (!count) return;
    await bulk.execute();
    bulk = coll.initializeUnorderedBulkOp();
    const levelCount = 8;
    const levelGap = 100;
    for (let i = 1; i <= levelCount; i++) {
        const query: Filter<Udoc> = {
            domainId,
            $and: [{ rp: { $gt: 0 } }, { level: { $lt: 11 } }],
        };
        if (i !== 1) query.$and.push({ rp: { $gte: (i - 1) * levelGap } });
        if (i !== levelCount) query.$and.push({ rp: { $lt: i * levelGap } });
        bulk.find(query).update({ $set: { level: i } });
    }
    await bulk.execute();
}

async function runInDomain(domainId: string, report: Report) {
    // 0. 跳过对非 system 域的处理
    if (domainId !== "system") return;
    const results: Record<keyof typeof RpTypes, ND> = {};
    const udict = Counter();

    // 1. 先获取当前用户的 RP 数据（保留 Contest RP）
    const currentUsers = await domain.getMultiUserInDomain(domainId, { rp: { $exists: true } }).toArray();
    for (const user of currentUsers) {
        udict[user.uid] = user.rpInfo?.contest || RpTypes.contest.base; // 继承 Contest RP
    }

    // 2. 强制 Problem RP = 0
    await RpTypes.problem.run([domainId], results.problem = {}, report);

    // 3. 更新数据库（确保 Problem RP = 0，Contest RP 不变）
    const bulk = db.collection('domain.user').initializeUnorderedBulkOp();
    for (const uid in udict) {
        if (!uid || uid === 'null' || +uid <= 0) continue;
        bulk.find({ domainId, uid: +uid }).upsert().update({
            $set: {
                rp: udict[uid], // 只保留 Contest RP
                "rpInfo.contest": udict[uid],
            },
        });
    }
    if (bulk.batches.length) await bulk.execute();

    // 4. 计算 Level & Rank
    await calcLevel(domainId, report);
}
// 修改到此结束。

export async function run({ domainId }, report: Report) {
    if (!domainId) {
        const domains = await domain.getMulti().toArray();
        await report({ message: `Found ${domains.length} domains` });
        for (const i in domains) {
            const start = new Date().getTime();
            await runInDomain(domains[i]._id, report);
            await report({
                case: {
                    status: STATUS.STATUS_ACCEPTED,
                    message: `Domain ${domains[i]._id} finished`,
                    time: new Date().getTime() - start,
                    memory: 0,
                    score: 0,
                },
                progress: Math.floor(((+i + 1) / domains.length) * 100),
            });
        }
    } else await runInDomain(domainId, report);
    return true;
}

export const apply = (ctx) => ctx.addScript(
    'rp', 'Calculate rp of a domain, or all domains',
    Schema.object({ domainId: Schema.string() }), run,
);
