import {
    HackRejudgeFailedError, PretestRejudgeFailedError, ForbiddenError,
    PermissionError, ProblemConfigError, RecordNotFoundError, NotFoundError,
    db, ProblemDoc, TaskModel, param, Types, RecordDoc, ObjectId,
    Tdoc, PERM, PRIV, STATUS, postJudge, Context, Handler
} from 'hydrooj';

import * as contest from 'hydrooj/src/model/contest';

import { ContestDetailBaseHandler } from 'hydrooj/src/handler/contest';

import { omit, pick } from 'lodash';

export class NumberRecordDetailHandler extends ContestDetailBaseHandler { // added
    rdoc: RecordDoc;

    @param('numberid', Types.PositiveInt)
    async prepare(domainId: string, numberid: number) {
        this.rdoc = await Temp.gets(numberid);
        if (!this.rdoc) throw new RecordNotFoundError(numberid.toString());
        if (this.rdoc.uid !== this.user._id) this.checkPerm(PERM.PERM_VIEW_RECORD);
    }

    async download() {
        for (const file of ['code', 'hack']) {
            if (!this.rdoc.files?.[file]) continue;
            const [id, filename] = this.rdoc.files?.[file]?.split('#') || [];
            // eslint-disable-next-line no-await-in-loop
            this.response.redirect = await global.Hydro.model.storage.signDownloadLink(`submission/${id}`, filename || file, true, 'user');
            return;
        }
        const lang = global.Hydro.model.setting.langs[this.rdoc.lang]?.pretest || this.rdoc.lang;
        this.response.body = this.rdoc.code;
        this.response.type = 'text/plain';
        this.response.disposition = `attachment; filename="${global.Hydro.model.setting.langs[lang]?.code_file || `foo.${this.rdoc.lang}`}"`;
    }

    @param('numberid', Types.PositiveInt)
    @param('download', Types.Boolean)
    @param('rev', Types.ObjectId, true)
    // eslint-disable-next-line consistent-return
    async get(domainId: string, numberid: number, download = false, rev?: ObjectId) {
        let rdoc = this.rdoc;
        let rid = this.rdoc._id;
        const allRev = await db.collection('record.history').find({ rid }).project({ _id: 1, judgeAt: 1 }).sort({ _id: -1 }).toArray();
        const allRevs: Record<string, Date> = Object.fromEntries(allRev.map((i) => [i._id.toString(), i.judgeAt]));
        if (rev && allRevs[rev.toString()]) {
            rdoc = { ...rdoc, ...omit(await db.collection('record.history').findOne({ _id: rev }), ['_id']), progress: null };
        }
        let canViewDetail = true;
        if (rdoc.contest?.toString().startsWith('0'.repeat(23))) {
            if (rdoc.uid !== this.user._id) throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
        } else if (rdoc.contest) {
            this.tdoc = await global.Hydro.model.contest.get(domainId, rdoc.contest);
            let canView = this.user.own(this.tdoc);
            canView ||= global.Hydro.model.contest.canShowRecord.call(this, this.tdoc);
            canView ||= global.Hydro.model.contest.canShowSelfRecord.call(this, this.tdoc, true) && rdoc.uid === this.user._id;
            if (!canView && rdoc.uid !== this.user._id) throw new PermissionError(rid);
            canViewDetail = canView;
            this.args.tid = this.tdoc.docId;
            if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.rdoc = global.Hydro.model.contest.applyProjection(this.tdoc, this.rdoc, this.user);
            }
        }

        // eslint-disable-next-line prefer-const
        let [pdoc, self, udoc] = await Promise.all([
            global.Hydro.model.problem.get(rdoc.domainId, rdoc.pid, global.Hydro.model.problem.PROJECTION_LIST.concat('config')),
            global.Hydro.model.problem.getStatus(domainId, rdoc.pid, this.user._id),
            global.Hydro.model.user.getById(domainId, rdoc.uid),
        ]);

        let canViewCode = rdoc.uid === this.user._id;
        canViewCode ||= this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE_ACCEPT) && self?.status === STATUS.STATUS_ACCEPTED;
        if (this.tdoc) {
            this.tsdoc = await global.Hydro.model.contest.getStatus(domainId, this.tdoc.docId, this.user._id);
            canViewCode ||= this.user.own(this.tdoc);
            if (this.tdoc.allowViewCode && global.Hydro.model.contest.isDone(this.tdoc)) {
                canViewCode ||= !!this.tsdoc?.attend;
            }
            if (!this.tsdoc?.attend && pdoc && !global.Hydro.model.problem.canViewBy(pdoc, this.user)) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        } else if (pdoc && !global.Hydro.model.problem.canViewBy(pdoc, this.user)) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        if (!canViewCode) {
            rdoc.code = '';
            rdoc.files = {};
            rdoc.compilerTexts = [];
        } else if (download) return await this.download();
        this.response.template = 'record_detail.html';
        this.response.body = {
            udoc, rdoc: canViewDetail ? rdoc : pick(rdoc, ['_id', 'lang', 'code']), pdoc, tdoc: this.tdoc, rev, allRevs,
        };
    }

    @param('numberid', Types.PositiveInt)
    async post() {
        this.checkPerm(PERM.PERM_REJUDGE);
        if (this.rdoc.files?.hack) throw new HackRejudgeFailedError();
        if (this.rdoc.contest?.toString().startsWith('0'.repeat(23))) throw new PretestRejudgeFailedError();
    }

    @param('numberid', Types.PositiveInt)
    async postRejudge(domainId: string, numberid: number) {
        const pdoc = await global.Hydro.model.problem.get(domainId, this.rdoc.pid);
        let rid = this.rdoc._id;
        if (!pdoc?.config || typeof pdoc.config === 'string') throw new ProblemConfigError();
        const priority = await global.Hydro.model.record.submissionPriority(this.user._id, -20);
        const rdoc = await global.Hydro.model.record.reset(domainId, rid, true);
        this.ctx.broadcast('record/change', rdoc);
        await global.Hydro.model.record.judge(domainId, rid, priority, this.rdoc.contest ? { detail: false } : {});
        this.back();
    }

    @param('numberid', Types.PositiveInt)
    async postCancel(domainId: string, numberid: number) {
        let rid = this.rdoc._id;
        const $set = {
            status: STATUS.STATUS_CANCELED,
            score: 0,
            time: 0,
            memory: 0,
            testCases: [{
                id: 0, subtaskId: 0, status: 9, score: 0, time: 0, memory: 0, message: 'score canceled',
            }],
            subtasks: {},
        };
        const [latest] = await Promise.all([
            global.Hydro.model.record.update(domainId, rid, $set),
            TaskModel.deleteMany({ rid: this.rdoc._id }),
        ]);
        if (latest) {
            this.ctx.broadcast('record/change', latest);
            await postJudge(latest);
        }
        this.back();
    }
}
class Temp {
    static async gets(arg0: number) {
        const res = await global.Hydro.model.record.coll.findOne({ numberId: arg0 });
        if (!res) return null;
        return res;
    }
    static async add(
        domainId: string, pid: number, uid: number,
        lang: string, code: string, addTask: boolean,
        args: {
            contest?: ObjectId;
            input?: string;
            files?: Record<string, string>;
            hackTarget?: ObjectId;
            type: 'judge' | 'rejudge' | 'pretest' | 'hack' | 'generate';
        } = { type: 'judge' },
    ) {
        let numberId = 0;

        if (args.type === 'judge' && domainId === 'system' && !args.contest?.toString().startsWith('0'.repeat(24))) {
            let result = await db.collection('system').findOneAndUpdate(
                { _id: 'submissionCount' }, 
                { $inc: { value: 1 } },
                { 
                    upsert: true, 
                    returnDocument: 'after',
                    upsertDefaults: { value: 0 } 
                }
            );
            numberId = result.value;
        }

        const data: RecordDoc = {
            status: STATUS.STATUS_WAITING,
            _id: new ObjectId(),
            uid,
            code,
            lang,
            pid,
            domainId,
            score: 0,
            time: 0,
            memory: 0,
            judgeTexts: [],
            compilerTexts: [],
            testCases: [],
            judger: null,
            judgeAt: null,
            rejudged: false,
            numberId,
        };
        let isContest = !!args.contest;
        if (args.contest) data.contest = args.contest;
        if (args.files) data.files = args.files;
        if (args.hackTarget) data.hackTarget = args.hackTarget;
        if (args.type === 'rejudge') {
            args.type = 'judge';
            data.rejudged = true;
        } else if (args.type === 'pretest') {
            data.input = args.input || '';
            isContest = false;
            data.contest = global.Hydro.model.record.RECORD_PRETEST;
        } else if (args.type === 'generate') {
            data.contest = global.Hydro.model.record.RECORD_GENERATE;
        }
        const res = await global.Hydro.model.record.coll.insertOne(data);
        global.bus.broadcast('record/change', data);
        if (addTask) {
            const priority = await global.Hydro.model.record.submissionPriority(uid, args.type === 'pretest' ? -20 : (isContest ? 50 : 0));
            await global.Hydro.model.record.judge(domainId, data, priority, isContest ? { detail: false } : {}, {
                type: args.type,
                rejudge: data.rejudged,
            });
        }
        return res.insertedId;
    }
}

export class MoreNumberRecordDetailHandler extends ContestDetailBaseHandler {
    rdoc: RecordDoc;

    @param('numberid', Types.PositiveInt)
    @param('subtaskid', Types.Int)
    @param('caseid', Types.Int)
    async prepare(domainId: string, numberid: number, subtaskid: number, caseid: number) {
        this.rdoc = await Temp.gets(numberid);
        if (!this.rdoc) throw new RecordNotFoundError(numberid.toString());
        let idx = this.rdoc.testCases.findIndex(testCase => testCase.id === caseid && testCase.subtaskId === subtaskid);
        if (idx === -1) throw new NotFoundError(`Submission ${numberid} Subtask ${subtaskid} Test ${caseid}`);
        let testCase = this.rdoc.testCases[idx];
    }

    @param('numberid', Types.PositiveInt)
    @param('subtaskid', Types.Int)
    @param('caseid', Types.Int)
    @param('rev', Types.ObjectId, true)
    // eslint-disable-next-line consistent-return
    async get(domainId: string, numberid: number, subtaskid: number, caseid: number, rev?: ObjectId) {
        let rdoc = this.rdoc;
        let rid = this.rdoc._id;
        const allRev = await db.collection('record.history').find({ rid }).project({ _id: 1, judgeAt: 1 }).sort({ _id: -1 }).toArray();
        const allRevs: Record<string, Date> = Object.fromEntries(allRev.map((i) => [i._id.toString(), i.judgeAt]));
        if (rev && allRevs[rev.toString()]) {
            rdoc = { ...rdoc, ...omit(await db.collection('record.history').findOne({ _id: rev }), ['_id']), progress: null };
        }
        let canViewDetail = true;
        if (rdoc.contest?.toString().startsWith('0'.repeat(23))) {
            if (rdoc.uid !== this.user._id) throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
        } else if (rdoc.contest) {
            this.tdoc = await global.Hydro.model.contest.get(domainId, rdoc.contest);
            let canView = this.user.own(this.tdoc);
            canView ||= global.Hydro.model.contest.canShowRecord.call(this, this.tdoc);
            canView ||= global.Hydro.model.contest.canShowSelfRecord.call(this, this.tdoc, true) && rdoc.uid === this.user._id;
            if (!canView && rdoc.uid !== this.user._id) throw new PermissionError(rid);
            canViewDetail = canView;
            this.args.tid = this.tdoc.docId;
            if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.rdoc = global.Hydro.model.contest.applyProjection(this.tdoc, this.rdoc, this.user);
            }
        }
        if (!canViewDetail) throw new ForbiddenError(`Submission ${numberid}`);

        // eslint-disable-next-line prefer-const
        let [pdoc, self, udoc] = await Promise.all([
            global.Hydro.model.problem.get(rdoc.domainId, rdoc.pid, global.Hydro.model.problem.PROJECTION_LIST.concat('config')),
            global.Hydro.model.problem.getStatus(domainId, rdoc.pid, this.user._id),
            global.Hydro.model.user.getById(domainId, rdoc.uid),
        ]);

        let canViewCode = rdoc.uid === this.user._id;
        canViewCode ||= this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE_ACCEPT) && self?.status === STATUS.STATUS_ACCEPTED;
        if (this.tdoc) {
            const tsdoc = await global.Hydro.model.contest.getStatus(domainId, this.tdoc.docId, this.user._id);
            canViewCode ||= this.user.own(this.tdoc);
            if (this.tdoc.allowViewCode && global.Hydro.model.contest.isDone(this.tdoc)) {
                canViewCode ||= tsdoc?.attend;
            }
            if (!tsdoc?.attend && pdoc && !global.Hydro.model.problem.canViewBy(pdoc, this.user)) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        } else if (pdoc && !global.Hydro.model.problem.canViewBy(pdoc, this.user)) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        if (!canViewCode) throw new ForbiddenError(`Submission ${numberid}`);
        let canViewData = 0;
        if (this.tdoc) {
            const tsdoc = await global.Hydro.model.contest.getStatus(domainId, this.tdoc.docId, this.user._id);
            canViewData ||= this.user.own(this.tdoc);
            canViewData ||= global.Hydro.model.contest.isDone(this.tdoc);
            canViewData ||= global.Hydro.model.contest.canShowRecord.call(this, this.tdoc);
            if (tsdoc) {
                if (tsdoc.attend) canViewData ||= global.Hydro.model.contest.isDone(this.tdoc, tsdoc);
            }
        } else canViewData = 1;
        if (!canViewData) throw new ForbiddenError(`Submission ${numberid}`);
        this.response.template = 'more_number_record_detail.html';
        this.response.body = { rdoc, idx: this.rdoc.testCases.findIndex(testCase => testCase.id === caseid && testCase.subtaskId === subtaskid) };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('number_record_detail', '/submission/:numberid', NumberRecordDetailHandler);
    ctx.Route('more_number_record_detail', '/submission/detail/:numberid/:subtaskid/:caseid', MoreNumberRecordDetailHandler);
    global.Hydro.model.record.PROJECTION_LIST.push('numberId');
    global.Hydro.model.record.gets = Temp.gets;
    global.Hydro.model.record.add = Temp.add;
}
