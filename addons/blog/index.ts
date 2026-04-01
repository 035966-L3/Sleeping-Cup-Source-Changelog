import {
    _, Context, ProblemNotFoundError, DocumentNotFoundError, DocumentModel, Filter,
    Handler, NumberKeys, ObjectId, OplogModel, ProblemModel,
    param, PRIV, Types, UserModel, MessageModel, ValidationError
} from 'hydrooj';
import {
    CreateError as Err,
} from '@hydrooj/framework';
export const BlogNotFoundError = Err('BlogNotFoundError', DocumentNotFoundError, 'Blog {1} not found.');
export const DomainNotSupportedError = Err('DomainNotSupportedError', DocumentNotFoundError, 'Domain {0} not supported.');
export const TYPE_BLOG = 70 as const;
export interface BlogDoc {
    docType: 70;
    docId: ObjectId;
    owner: number;
    title: string;
    content: string;
    ip: string;
    updateAt: Date;
    nReply: number;
    views: number;
    reply: any[];
    react: Record<string, number>;
    isPrivate: boolean;
    isPublic: boolean;
    reviewStatus: 'pending' | 'approved' | 'rejected';
    reviewNote?: string;
    solutionFor?: number;
    showReviewer?: boolean;
    reviewerUid?: number;
}
declare module 'hydrooj' {
    interface Model {
        blog: typeof BlogModel;
    }
    interface DocType {
        [TYPE_BLOG]: BlogDoc;
    }
}
export class BlogModel {
    static async add(
        owner: number, title: string, content: string, ip?: string,
        isPrivate: boolean = false
    ): Promise<ObjectId> {
        const payload: Partial<BlogDoc> = {
            content,
            owner,
            title,
            ip,
            nReply: 0,
            updateAt: new Date(),
            views: 0,
            isPrivate,
            isPublic: false,
            reviewStatus: isPrivate ? 'approved' : 'pending', // 私有博客默认通过审核
        };
        const res = await DocumentModel.add(
            'system', payload.content!, payload.owner!, TYPE_BLOG,
            null, null, null, _.omit(payload, ['domainId', 'content', 'owner']),
        );
        payload.docId = res;
        return payload.docId;
    }

    static async get(did: ObjectId): Promise<BlogDoc> {
        return await DocumentModel.get('system', TYPE_BLOG, did);
    }

    static edit(did: ObjectId, title: string, content: string, isPrivate: boolean, solutionFor?: number, noVerify?: boolean, alltg?: boolean): Promise<BlogDoc> {
        const getReviewStatus = async (dataId: ObjectId) => {
            const doc: BlogDoc = await this.get(dataId);
            return doc.reviewStatus;
        };
        
        return Promise.resolve().then(async () => {
            const temp = await getReviewStatus.call(this, did);
            console.log(temp);
            console.log(noVerify);
            const payload = {
                title,
                content,
                isPrivate,
                ...((solutionFor) ? { solutionFor } : {}),
                ...((solutionFor == '') ? { solutionFor: undefined } : {}),
                // 编辑后如果改为公开，需要重新审核
                // 在noVerify时保留当前reviewStatus
                
                ...(((isPrivate)) ? { reviewStatus: 'approved' } : { reviewStatus: 'pending', isPublic: false }),
                ...((noVerify) ? { reviewStatus: temp } : {})
            };
            return DocumentModel.set('system', TYPE_BLOG, did, payload);
        });
    }

    static inc(did: ObjectId, key: NumberKeys<BlogDoc>, value: number): Promise<BlogDoc | null> {
        return DocumentModel.inc('system', TYPE_BLOG, did, key, value);
    }

    static del(did: ObjectId): Promise<never> {
        return Promise.all([
            DocumentModel.deleteOne('system', TYPE_BLOG, did),
            DocumentModel.deleteMultiStatus('system', TYPE_BLOG, { docId: did }),
        ]) as any;
    }

    static count(query: Filter<BlogDoc>) {
        return DocumentModel.count('system', TYPE_BLOG, query);
    }

    static getMulti(query: Filter<BlogDoc> = {}, uid?: number, isAdmin: boolean = false) {
        const filter: Filter<BlogDoc> = { ...query };

        // 非管理员只能看到自己的博客或已公开的博客
        if (!isAdmin && uid) {
            filter.$or = [
                { owner: uid },
                { isPublic: true },
                { isPrivate: true, owner: uid }
            ];
        }
        // 管理员不过滤
        return DocumentModel.getMulti('system', TYPE_BLOG, filter)
            .sort({ _id: -1 });
    }

    static async addReply(did: ObjectId, owner: number, content: string, ip: string): Promise<ObjectId> {
        const [[, drid]] = await await Promise.all([
            DocumentModel.push('system', TYPE_BLOG, did, 'reply', content, owner, { ip }),
            DocumentModel.incAndSet('system', TYPE_BLOG, did, 'nReply', 1, { updateAt: new Date() }),
        ]);
        return drid;
    }

    static setStar(did: ObjectId, uid: number, star: boolean) {
        return DocumentModel.setStatus('system', TYPE_BLOG, did, uid, { star });
    }

    static getStatus(did: ObjectId, uid: number) {
        return DocumentModel.getStatus('system', TYPE_BLOG, did, uid);
    }

    static setStatus(did: ObjectId, uid: number, $set) {
        return DocumentModel.setStatus('system', TYPE_BLOG, did, uid, $set);
    }

    // 审核通过
    static async approve(did: ObjectId, note: string = '', showReviewer: boolean = false, reviewerUid?: number): Promise<BlogDoc> {
        const blog = await DocumentModel.get('system', TYPE_BLOG, did);
        const updated = await DocumentModel.set('system', TYPE_BLOG, did, {
            isPublic: true,
            reviewStatus: 'approved',
            reviewNote: note,
            showReviewer: showReviewer,
            reviewerUid
        });
        return updated;
    }

    // 打回功能
    static async reject(did: ObjectId, note: string = '', showReviewer: boolean = false, reviewerUid?: number): Promise<BlogDoc> {
        const blog = await DocumentModel.get('system', TYPE_BLOG, did);
        const updated = await DocumentModel.set('system', TYPE_BLOG, did, {
            isPublic: false,
            reviewStatus: 'rejected',
            reviewNote: note,
            showReviewer,
            reviewerUid
        });
        return updated;
    }

    // 获取待审核博客列表
    static getPendingReviews() {
        return DocumentModel.getMulti('system', TYPE_BLOG, {
            reviewStatus: 'pending',
            isPrivate: false
        }).sort({ updateAt: 1 });
    }

    // 提交题解
    static async addSolution(
        owner: number, title: string, content: string, solutionFor: number, ip?: string
    ): Promise<ObjectId> {
        const payload: Partial<BlogDoc> = {
            content,
            owner,
            title,
            ip,
            nReply: 0,
            updateAt: new Date(),
            views: 0,
            isPrivate: false,
            isPublic: false,
            reviewStatus: 'pending',
            solutionFor
        };
        const res = await DocumentModel.add(
            'system', payload.content!, payload.owner!, TYPE_BLOG,
            null, null, null, _.omit(payload, ['domainId', 'content', 'owner']),
        );
        payload.docId = res;
        return payload.docId;
    }

    // 获取某题所有题解
    static getSolutions(problemId: number, isAdmin: boolean = false, uid?: number) {
        const filter: Filter<BlogDoc> = { solutionFor: +problemId };
        if (!isAdmin && uid) {
            filter.$or = [
                { owner: uid },
                { isPublic: true }
            ];
        }
        // 管理员不过滤
        return DocumentModel.getMulti('system', TYPE_BLOG, filter).sort({ _id: -1 });
    }
}
global.Hydro.model.blog = BlogModel;
class BlogSolutionAPIHandler extends Handler {
    @param('did', Types.ObjectId)
    @param('solutionFor', Types.PositiveInt, true)
    async get({ domainId }, did: ObjectId, solutionFor = -1) {
        let doc = await BlogModel.get(did);
        if (!doc) throw new BlogNotFoundError(domainId, did);
        await BlogModel.edit(did, doc.title, doc.content, doc.isPrivate, solutionFor, true);
    }
}
class BlogHandler extends Handler {
    ddoc?: BlogDoc;

    @param('did', Types.ObjectId, true)
    async _prepare(domainId: string, did: ObjectId) {
        if (did) {
            this.ddoc = await BlogModel.get(did);
            if (!this.ddoc) throw new BlogNotFoundError(domainId, did);
        }
    }
}
class BlogUserHandler extends BlogHandler {
    @param('uid', Types.Int)
    @param('page', Types.PositiveInt, true)
    async get(domainId: string, uid: number, page = 1) {
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        // 先获取所有博客
        const allDocs = await BlogModel.getMulti({ owner: uid }, this.user._id, isAdmin).toArray();
        // 只保留有权查看的内容，并对题解做特判
        const filtered = [];
        for (const doc of allDocs) {
            if (typeof doc.solutionFor === 'number') {
                // 题解特判
                if (isAdmin || doc.owner === this.user._id) {
                    filtered.push(doc);
                } else if (doc.isPublic && doc.reviewStatus === 'approved') {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        const problem = await ProblemModel.get(domainId, doc.solutionFor);
                        if (problem && !problem.hidden) {
                            filtered.push(doc);
                        }
                    } catch {
                        // 题目不存在或异常，跳过
                    }
                }
            } else {
                // 普通博客
                if (
                    isAdmin ||
                    doc.owner === this.user._id ||
                    doc.isPublic ||
                    (doc.isPrivate && doc.owner === this.user._id)
                ) {
                    filtered.push(doc);
                }
            }
        }
        // 分页
        const pageSize = 10;
        const dpcount = Math.ceil(filtered.length / pageSize);
        const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
        const udoc = await UserModel.getById(domainId, uid);
        const uids = [...new Set(paged.map(doc => doc.owner))];
        const udocs = await Promise.all(
            uids.map(uid => UserModel.getById(domainId, uid))
        );
        const userMap = new Map(uids.map((uid, i) => [uid, udocs[i]]));
        this.response.template = 'blog_main.html';
        this.response.body = {
            ddocs: paged,
            dpcount,
            udoc,
            udocs: userMap,
            page,
        };
    }
}

class BlogPlazaHandler extends BlogHandler {
    @param('page', Types.PositiveInt, true)
    async get({ domainId }, page = 1) {
        // 获取所有已公开的博客文章
        const query = { isPublic: true };
        // 先获取所有博客
        const allDocs = await BlogModel.getMulti(query, this.user._id, this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)).toArray();
        // 只保留有权查看的内容
        const filtered = [];
        for (const doc of allDocs) {
            if (typeof doc.solutionFor === 'number') {
                // 题解特判
                if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
                    filtered.push(doc);
                } else if (doc.isPublic) {
                    // 检查题目是否公开
                    try {
                        // ProblemModel 可能抛异常，需捕获
                        // eslint-disable-next-line no-await-in-loop
                        const problem = await ProblemModel.get(domainId, doc.solutionFor);
                        if (problem && !problem.hidden) {
                            filtered.push(doc);
                        }
                    } catch {
                        // 题目不存在或异常，跳过
                    }
                }
            } else {
                // 普通博客
                if (
                    doc.isPublic ||
                    this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) ||
                    doc.owner === this.user._id
                ) {
                    filtered.push(doc);
                }
            }
        }
        // 分页
        const pageSize = 10;
        const dpcount = Math.ceil(filtered.length / pageSize);
        const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
        // 获取所有作者信息并建立映射
        const uids = [...new Set(paged.map(doc => doc.owner))];
        const udocs = await Promise.all(
            uids.map(uid => UserModel.getById(domainId, uid))
        );
        const userMap = new Map(uids.map((uid, i) => [uid, udocs[i]]));
        this.response.template = 'blog_main.html';
        this.response.body = {
            ddocs: paged,
            dpcount,
            page,
            udocs: userMap,
            udoc: { _id: 0, uname: '所有人', blogpic: '' }
        };
    }
}
class BlogDetailHandler extends BlogHandler {
    @param('did', Types.ObjectId)
    async get({ domainId }, did: ObjectId) {
        const dsdoc = this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
            ? await BlogModel.getStatus(did, this.user._id)
            : null;
        const udoc = await UserModel.getById(domainId, this.ddoc!.owner);

        // 权限检查：只能查看自己的博客、已公开的博客或管理员
        const canView = this.user._id === this.ddoc?.owner ||
            this.ddoc?.isPublic ||
            this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) ||
            (this.ddoc?.isPrivate && this.user._id === this.ddoc.owner);

        if (!canView) throw new BlogNotFoundError(domainId, did);

        // 如果是题解，且题目隐藏，不是自己的题目，没有管理员权限，则禁止访问
        if (typeof this.ddoc?.solutionFor === 'number') {
            const problem = await ProblemModel.get(domainId, this.ddoc.solutionFor);
            if (problem?.hidden && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && problem?.owner !== this.user._id) {
                throw new BlogNotFoundError(domainId, did);
            }
        }

        if (!dsdoc?.view) {
            await Promise.all([
                BlogModel.inc(did, 'views', 1),
                BlogModel.setStatus(did, this.user._id, { view: true }),
            ]);
        }


        this.response.template = 'blog_detail.html';
        this.response.body = {
            ddoc: this.ddoc, dsdoc, udoc,
        };
    }

    async post() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param('did', Types.ObjectId)
    async postStar({ }, did: ObjectId) {
        await BlogModel.setStar(did, this.user._id, true);
        this.back({ star: true });
    }

    @param('did', Types.ObjectId)
    async postUnstar({ }, did: ObjectId) {
        await BlogModel.setStar(did, this.user._id, false);
        this.back({ star: false });
    }
}

class BlogEditHandler extends BlogHandler {
    async get() {
        this.response.template = 'blog_edit.html';
        this.response.body = { ddoc: this.ddoc };
    }
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('isPrivate', Types.Boolean, true)
    async postCreate({ }, title: string, content: string, isPrivate: boolean = false) {
        if (!isPrivate && !this.user.hasPriv(PRIV.PRIV_UNLIMITED_ACCESS)) {
            await global.Hydro.model.opcount.inc('blog.edit', this.user._id.toString(), 60, 1);
        }
        const did = await BlogModel.add(this.user._id, title, content, this.request.ip, isPrivate);
        this.response.body = { did };
        this.response.redirect = this.url('blog_detail', { uid: this.user._id, did });
    }

    @param('did', Types.ObjectId)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('isPrivate', Types.Boolean, true)
    async postUpdate({ }, did: ObjectId, title: string, content: string, isPrivate: boolean = false) {
        if (!isPrivate && !this.user.hasPriv(PRIV.PRIV_UNLIMITED_ACCESS)) {
            await global.Hydro.model.opcount.inc('blog.edit', this.user._id.toString(), 60, 1);
        }
        if (typeof this.ddoc.solutionFor === 'number' && ProblemModel.get('system', this.ddoc.solutionFor)) {
            if (!this.user.own(this.ddoc!)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
            await Promise.all([
                BlogModel.edit(did, title, content, false),
                OplogModel.log(this, 'blog.edit', this.ddoc),
            ]);
        } else {
            if (!this.user.own(this.ddoc!)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
            await Promise.all([
                BlogModel.edit(did, title, content, isPrivate),
                OplogModel.log(this, 'blog.edit', this.ddoc),
            ]);
        }
        this.response.body = { did };
        this.response.redirect = this.url('blog_detail', { uid: this.user._id, did });
    }

    @param('did', Types.ObjectId)
    async postDelete({ }, did: ObjectId) {
        if (!this.user.own(this.ddoc!)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([
            BlogModel.del(did),
            OplogModel.log(this, 'blog.delete', this.ddoc),
        ]);
        this.response.redirect = this.url('blog_main', { uid: this.ddoc!.owner });
    }
}

// 审核处理器（包含通过和打回）
class BlogReviewHandler extends BlogHandler {
    // 审核列表页面
    @param('page', Types.PositiveInt, true)
    async get({ domainId }, page = 1) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        const [ddocs, dpcount] = await this.ctx.db.paginate(
            BlogModel.getPendingReviews(),
            page,
            10
        );
        // 获取所有作者信息
        const uids = [...new Set(ddocs.map(doc => doc.owner))];
        const udocs = await Promise.all(
            uids.map(uid => UserModel.getById(domainId, uid))
        );
        const userMap = new Map(uids.map((uid, i) => [uid, udocs[i]]));
        this.response.template = 'blog_review.html';
        this.response.body = {
            ddocs,
            dpcount,
            page,
            udocs: userMap,
        };
    }

    // 审核通过
    @param('did', Types.ObjectId)
    @param('note', Types.String, true)
    @param('showReviewer', Types.Boolean, true)
    async postApprove({ }, did: ObjectId, note: string = '', showReviewer: boolean = false) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await BlogModel.approve(did, note, showReviewer, this.user._id);
        this.back({ success: true, message: note ? _('Post approved successfully with note') : _('Post approved successfully') });
    }

    // 打回功能
    @param('did', Types.ObjectId)
    @param('note', Types.String, true)
    @param('showReviewer', Types.Boolean, true)
    async postReject({ }, did: ObjectId, note: string = '', showReviewer: boolean = false) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await BlogModel.reject(did, note, showReviewer, this.user._id);
        this.back({ success: true, message: _('Post rejected successfully') });
    }
}
class BlogApproveHandler extends BlogHandler {
    @param('did', Types.ObjectId)
    @param('note', Types.String, true)
    @param('showReviewer', Types.Boolean, true)
    async post({ }, did: ObjectId, note: string = '', showReviewer: boolean = false) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await BlogModel.approve(did, note, showReviewer, this.user._id);
        this.back({ success: true, message: _('Post approved successfully') });
    }
}
class BlogRejectHandler extends BlogHandler {
    @param('did', Types.ObjectId)
    @param('note', Types.String, true)
    @param('showReviewer', Types.Boolean, true)
    async post({ }, did: ObjectId, note: string, showReviewer: boolean = false) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await BlogModel.reject(did, note, showReviewer, this.user._id);
        this.back({ success: true, message: _('Post rejected successfully') });
    }
}

// 题解列表页面
class SolutionHandler extends Handler {
    @param('pid', Types.PositiveInt)
    @param('page', Types.PositiveInt, true)
    async get({ domainId }, pid: number, page = 1) {
        // 检查题目是否存在
        if (domainId != 'system') {
            throw new DomainNotSupportedError(domainId);
        }
        const problem = await ProblemModel.get(domainId, pid);
        if (!problem) throw new ProblemNotFoundError(domainId, pid);
        if (problem.hidden && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && problem.owner !== this.user._id) {
            throw new ProblemNotFoundError(domainId, pid);
        }
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const ddocs = await (await BlogModel.getSolutions(pid, isAdmin, this.user._id)).toArray();
        // 只保留有权查看的题解
        const filtered = ddocs.filter(doc =>
            isAdmin ||
            doc.owner === this.user._id ||
            doc.isPublic
        );
        const uids = [...new Set(filtered.map(doc => doc.owner))];
        const udocs = await Promise.all(
            uids.map(uid => UserModel.getById(domainId, uid))
        );
        const userMap = new Map(uids.map((uid, i) => [uid, udocs[i]]));
        this.response.template = 'blog_main.html';
        this.response.body = {
            ddocs: filtered.slice((page - 1) * 10, page * 10),
            dpcount: Math.ceil(filtered.length / 10),
            page,
            udocs: userMap,
            udoc: { _id: 0, uname: `${pid} 题解`, blogpic: '' },
            solutionFor: pid,
        };
    }
}

// 提交题解页面
class SolutionEditHandler extends Handler {
    @param('pid', Types.PositiveInt)
    async get({ domainId }, pid: number) {
        // 检查题目是否存在
        if (domainId != 'system') {
            throw new DomainNotSupportedError(domainId);
        }
        const problem = await ProblemModel.get(domainId, pid);
        if (!problem) throw new ProblemNotFoundError(domainId, pid);
        if (problem.hidden && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && problem.owner !== this.user._id) {
            throw new ProblemNotFoundError(domainId, pid);
        }
        this.response.template = 'blog_edit.html';
        this.response.body = { ddoc: { title: "P" + pid + "\'s Solution" }, solutionFor: pid };
    }

    @param('pid', Types.PositiveInt)
    @param('title', Types.Title)
    @param('content', Types.Content)
    async postCreate({ domainId }, pid: number, title: string, content: string) {
        if (domainId != 'system') {
            throw new DomainNotSupportedError(domainId);
        }
        // 检查题目是否存在
        if (!this.user.hasPriv(PRIV.PRIV_UNLIMITED_ACCESS)) {
            await global.Hydro.model.opcount.inc('blog.edit', this.user._id.toString(), 60, 1);
        }
        const problem = await ProblemModel.get(domainId, pid);
        if (!problem) throw new ProblemNotFoundError(domainId, pid);
        if (problem.hidden && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && problem.owner !== this.user._id) {
            throw new ProblemNotFoundError(domainId, pid);
        }
        // 检查题解提交开关
        await this.limitRate('add_solution', 3600, 30);
        const did = await BlogModel.addSolution(this.user._id, title, content, pid, this.request.ip);
        this.response.body = { did };
        this.response.redirect = this.url('solution_detail', { pid, did });
    }
}

// 题解详情页面（复用 BlogDetailHandler）
class SolutionDetailHandler extends BlogDetailHandler {
    @param('pid', Types.PositiveInt)
    @param('did', Types.ObjectId)
    async get({ domainId }, pid: number, did: ObjectId) {
        if (domainId != 'system') {
            throw new DomainNotSupportedError(domainId);
        }
        await super.get({ domainId }, did);
        this.response.body.solutionFor = +this.ddoc?.solutionFor;
        if (+this.ddoc?.solutionFor !== +pid) {
            throw new BlogNotFoundError(domainId, did);
        }
        const problem = await ProblemModel.get(domainId, +this.ddoc.solutionFor);
        // 题目隐藏，不是自己的题目，且没有管理员权限时不能查看
        if (problem?.hidden && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && problem?.owner !== this.user._id) {
            throw new BlogNotFoundError(domainId, did);
        }
    }
}
class ApiBlogListHandler extends Handler {
    async get({ domainId }) {
        let ddocs = await BlogModel.getMulti({});
        ddocs=await ddocs.toArray();
        let ret = {};
        for (const doc of ddocs) {
            ret[doc.docId] = doc.owner;
        }
        this.response.type = 'application/json';
        this.response.body = ret;
    }
}
// 路由注册
export async function apply(ctx: Context) {
    ctx.Route('blog_main', '/blog/:uid', BlogUserHandler);
    ctx.Route('blog_plaza', '/blogplaza', BlogPlazaHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('blog_create', '/blog/:uid/create', BlogEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('blog_detail', '/blog/:uid/:did', BlogDetailHandler);
    ctx.Route('blog_edit', '/blog/:uid/:did/edit', BlogEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('blog_edit_solution_api', '/api/blog/editsolution/:did', BlogSolutionAPIHandler, PRIV.PRIV_EDIT_SYSTEM);
    // 审核相关路由
    ctx.Route('blog_review', '/blogreview', BlogReviewHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('blog_approve', '/blog/:uid/:did/approve', BlogApproveHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('blog_reject', '/blog/:uid/:did/reject', BlogRejectHandler, PRIV.PRIV_EDIT_SYSTEM);
    // 题解相关路由
    ctx.Route('solution_list', '/solution/:pid', SolutionHandler);
    ctx.Route('solution_create', '/solution/:pid/create', SolutionEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('solution_detail', '/solution/:pid/:did', SolutionDetailHandler);

    ctx.Route('api_blog_list', '/api/blog/list', ApiBlogListHandler, PRIV.PRIV_EDIT_SYSTEM);
    global.Hydro.ui.inject('DomainManage', 'blog_review', {
        family: 'Blog Settings',
        icon: 'settings',
    });
    ctx.injectUI('UserDropdown', 'blog_main', (h) => ({ icon: 'book', displayName: 'Blog', uid: h.user._id.toString() }),
        PRIV.PRIV_USER_PROFILE);
    ctx.injectUI('UserDropdown', 'blog_plaza', (h) => ({ icon: 'book', displayName: 'Blog Plaza', uid: h.user._id.toString() }),
        PRIV.PRIV_USER_PROFILE);
}
