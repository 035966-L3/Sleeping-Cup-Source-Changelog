import { db, UserModel, Udoc, VUdoc, GDoc, DomainModel, BaseUserDict, Context } from 'hydrooj';

export const coll: Collection<Udoc> = db.collection('user');
export const collV: Collection<VUdoc> = db.collection('vuser');
export const collGroup: Collection<GDoc> = db.collection('user.group');
UserModel.getListForRender = async function (domainId: string, uids: number[]) {
    const [udocs, vudocs, dudocs] = await Promise.all([
        UserModel.getMulti({ _id: { $in: uids } }, ['_id', 'uname', 'mail', 'avatar', 'school', 'studentId']).toArray(),
        collV.find({ _id: { $in: uids } }).toArray(),
        DomainModel.getDomainUserMulti(domainId, uids).project({ uid: true, level: true, rp: true }).toArray()
    ]);
    const udict = {};
    for (const udoc of udocs) udict[udoc._id] = udoc;
    for (const udoc of vudocs) udict[udoc._id] = { ...udict[udoc._id], ...udoc };
    for (const dudoc of dudocs) {
        udict[dudoc.uid].level = dudoc.level;
        udict[dudoc.uid].rp = dudoc.rp;
    }
    for (const uid of uids) {
        if (!udict[uid]) {
            udict[uid] = { ...UserModel.defaultUser };
        }
    }
    for (const key in udict) {
        udict[key].school ||= '';
        udict[key].studentId ||= '';
        udict[key].avatar ||= `gravatar:${udict[key].mail}`;
        udict[key].displayName = '';
    }
    return udict as BaseUserDict;
};

export async function apply(ctx: Context) {
    ctx.on('handler/after/SystemUserPriv#get', async (that) => {
        const udocs = that.response.body.udocs;
        const udict = [];
        for (const udoc of udocs) {
            udict.push(await UserModel.getById('system', udoc._id));
        }
        that.response.body.udocs = udict;
    });
    ctx.on('handler/after/DomainUser#get', async (that) => {
        const rudocs = that.response.body.rudocs;
        const roles = Object.keys(rudocs);
        for (let role of roles) {
            let newulist = [];
            let ufr = rudocs[role].sort((a, b) => a._id - b._id);
            for(let user of ufr) {
                newulist.push(await UserModel.getById('system', user._id));
            }
            rudocs[role] = newulist;
        }
        that.response.body.udocs = rudocs;
    });
}
