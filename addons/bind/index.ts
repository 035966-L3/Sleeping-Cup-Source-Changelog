import {
    UserModel, DomainModel, SystemModel, User, PRIV, PERM,
    ForbiddenError, BlacklistedError, ObjectId,
    Handler, Context, param, Types,
} from 'hydrooj';
import fetch from 'node-fetch'; // Warning: extra requirements
const inc = global.Hydro.model.opcount.inc;
const oplog = global.Hydro.model.oplog;

const errorText1 = "Not logged in.";
const errorText2 = "Already logged in.";
const errorText3 = "Already bound. Set ?force=1 to force update.";
const errorText4 = "Incorrect parameters.";
const errorText5 = "Email not match.";
const errorText6 = "No such user!";
const errorText7 = "CP OAuth login in contest mode is forbidden.";

let websiteUri = '';
let clientId = '';
let clientSecret = '';
let redirectUri = '';
let firstOAuthUri = '';
let secondOAuthUri = '';
let thirdOAuthUri = '';

async function initializeUri() {
    websiteUri = await SystemModel.get('server.url').slice(0, -1);
    clientId = await SystemModel.get('cpoauth.clientid');
    clientSecret = await SystemModel.get('cpoauth.clientsecret');
    redirectUri = `${websiteUri}/cpoauth/second`;
    firstOAuthUri = 'https://auth.luogu.me/oauth/authorize' +
                    `?response_type=code&client_id=${clientId}` +
                    `&redirect_uri=${redirectUri}` +
                    `&scope=email+cp:linked&state=`;
    secondOAuthUri = 'https://auth.luogu.me/api/oauth/token';
    thirdOAuthUri = 'https://auth.luogu.me/api/oauth/userinfo';
}

async function successfulAuth(this: Handler, udoc: User) {
    await UserModel.setById(udoc._id, {
        loginat: new Date(), loginip: this.request.ip
    });
    this.context.HydroContext.user = udoc;
    this.session.viewLang = '';
    this.session.uid = udoc._id;
    this.session.sudo = null;
    this.session.sudoUid = null;
    this.session.scope = PERM.PERM_ALL.toString();
    this.session.oauthBind = null;
    this.session.recreate = true;
    await oplog.log(this, 'user.loginSuccess', { uid: udoc._id });
}


export class FirstCPOAuthHandler extends Handler {
    @param('force', Types.Boolean)
    @param('login', Types.Boolean)
    async get(others: any, force = false, login = false) {
        await oplog.log(this, 'user.cpoauth.first.start', {
            force: force, login: login
        });
        if (!this.user?._id && !login) throw new ForbiddenError(errorText1);
        if (this.user?._id && login) throw new ForbiddenError(errorText2);
        const udoc = await UserModel.getById("system", this.user._id);
        if (udoc._udoc.bound && !force) throw new ForbiddenError(errorText3);
        
        await inc('cpoauth', this.user._id.toString(), 60, 6);
        const state = login ?
                      new ObjectId().toString() + new ObjectId().toString() :
                      new ObjectId().toString().repeat(2);
        await oplog.log(this, 'user.cpoauth.first.start', { state: state });
        this.response.redirect = firstOAuthUri + state;
    }
}

export class SecondCPOAuthHandler extends Handler {
    @param('code', Types.String)
    @param('state', Types.String)
    async get(others: any, code: string, state: string) {
        await oplog.log(this, 'user.cpoauth.second.start', { 
            code: code, state: state
        });
        if (!/[0-9a-f]{64}/.test(code) || !/[0-9a-f]{48}/.test(state)) {
            throw new ForbiddenError(errorText4);
        }
        const login = state.slice(0, 24) !== state.slice(24);
        if (!this.user?._id && !login) throw new ForbiddenError(errorText1);
        if (this.user?._id && login) throw new ForbiddenError(errorText2);
        
        await inc('cpoauth', this.user._id.toString(), 60, 6);
        let data = {};
        try {
            const response = await fetch(secondOAuthUri, {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri,
                    client_id: clientId,
                    client_secret: clientSecret,
                }),
                method: 'POST',
                signal: AbortSignal.timeout(900000),
            })
            const {
                access_token, token_type, expires_in, scope
            } = await response.json();
            
            const userinfo = await fetch(thirdOAuthUri, {
                headers: { Authorization: `Bearer ${access_token}` },
                method: 'GET',
                signal: AbortSignal.timeout(900000),
            });
            data = await userinfo.json();
        } catch (error) {
            console.log(error);
            const prefix = login ? "Bind failed: " : "Login failed: ";
            throw new ForbiddenError(prefix + error.toString());
        }
        
        const mailLower = data.email.toLowerCase();
        let uid = this.user._id;
        let udoc = {};
        if (!login) {
            udoc = await UserModel.getById("system", this.user._id);
            if (udoc.mailLower != mailLower) {
                throw new ForbiddenError(errorText5);
            }
        } else {
            udoc = await UserModel.getByEmail("system", mailLower);
            if (!udoc) throw new ForbiddenError(errorText6);
            uid = udoc._id;
        }
        
        await UserModel.setById(uid, {
            bound: true,
            cpInfo: data.linked_accounts,
        });
        await DomainModel.setUserInDomain("system", uid, {
            "rpInfo.cpInfo.bound": true,
            "rpInfo.cpInfo.cpInfo": data.linked_accounts,
        });
        await oplog.log(this, 'user.cpoauth.second.end', { data: data });
        
        if (login) {
            if (SystemModel.get('system.contestmode')) {
                if (!udoc.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
                    throw new ValidationError(errorText7);
                }
            }
            await oplog.log(this, 'user.login', { cpoauth: true });
            if (!udoc.hasPriv(PRIV.PRIV_USER_PROFILE)) {
                throw new BlacklistedError(
                    udoc.uname, udoc.banReason
                );
            }
            await successfulAuth.call(this, udoc);
            this.session.save = false;
        }
        this.response.redirect = '/';
    }
}


export async function apply(ctx: Context) {
    initializeUri();
    ctx.Route('first_cpoauth', '/cpoauth/first', FirstCPOAuthHandler);
    ctx.Route('second_cpoauth', '/cpoauth/second', SecondCPOAuthHandler);
}
