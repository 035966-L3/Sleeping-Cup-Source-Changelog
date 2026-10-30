import {
    UserModel, DomainModel, DocumentModel, SystemModel, User, PRIV, PERM,
    ForbiddenError, ValidationError, BlacklistedError, UserNotFoundError,
    CreateError, ObjectId, Handler, Context, param, Types, randomstring,
} from 'hydrooj';
import fetch from 'node-fetch'; // Warning: extra requirements
const inc = global.Hydro.model.opcount.inc;
const oplog = global.Hydro.model.oplog;
const TYPE_CP_OAUTH_STATE_CACHE = 234565432;

const AlreadyLoggedInError = CreateError(
    'AlreadyLoggedInError', ForbiddenError,
    "You have already logged in.");
const CPOAuthDataCheckFailedError = CreateError(
    'CPOAuthDataCheckFailedError', ForbiddenError,
    "CP OAuth data check failed: {0}");
const CannotLoginViaCPOAuthInContestModeError = CreateError(
    'CannotLoginViaCPOAuthInContestModeError', ForbiddenError,
    "CP OAuth login in contest mode is forbidden.");
let websiteUri = '';
let clientId = '';
let clientSecret = '';
let redirectUri = '';
let firstOAuthUri = '';
let secondOAuthUri = '';
let thirdOAuthUri = '';
let fourthOAuthUri = '';

async function initializeUri() {
    websiteUri = (await SystemModel.get('server.url')).slice(0, -1);
    clientId = await SystemModel.get('cpoauth.clientid');
    clientSecret = await SystemModel.get('cpoauth.clientsecret');
    redirectUri = `${websiteUri}/cpoauth/second`;
    firstOAuthUri = 'https://www.cpoauth.com/oauth/authorize' +
                    `?response_type=code&client_id=${clientId}` +
                    `&redirect_uri=${redirectUri}` +
                    `&scope=email+cp:linked&state=`;
    secondOAuthUri = 'https://www.cpoauth.com/api/oauth/token';
    thirdOAuthUri = 'https://www.cpoauth.com/api/oauth/userinfo';
    fourthOAuthUri = 'https://www.cpoauth.com/api/oauth/revoke';
}

async function successfulAuth(this: Handler, udoc: User) {
    await this.ctx.serial('auth/before-login', this, udoc);
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
    await this.ctx.serial('auth/login', this, udoc);
}


export class FirstCPOAuthHandler extends Handler {
    async get() {
        await oplog.log(this, 'user.cpoauth.first.start', {});
        if (this.user?._id) throw new AlreadyLoggedInError();
        
        await this.limitRate('user_login', 60, 30);
        let state = '';
        while (state.length < 48) {
            const randomCharacter = randomstring(1);
            if (/[0-9a-f]/.test(randomCharacter)) state += randomCharacter;
        }
        await DocumentModel.deleteMulti("system", TYPE_CP_OAUTH_STATE_CACHE, {
            content: { 
                $lt: (new Date().getTime() - 66666).toString().padStart(13, '0')
        }});
        const timestamp = new Date().getTime().toString().padStart(13, '0');
        await DocumentModel.add("system", timestamp, 1,
            TYPE_CP_OAUTH_STATE_CACHE, state);
        await oplog.log(this, 'user.cpoauth.first.end', { state: state });
        this.response.redirect = firstOAuthUri + state;
    }
}

export class SecondCPOAuthHandler extends Handler {
    @param('code', Types.String)
    @param('state', Types.String)
    async get(others: any, code: string, state: string) {
        const timestamp = new Date().getTime().toString().padStart(13, '0');
        const now = parseInt(timestamp, 10);
        await oplog.log(this, 'user.cpoauth.second.start', {});
        if (this.user?._id) throw new AlreadyLoggedInError();
        if (!/[0-9a-f]{64}/.test(code)) throw new ValidationError('code');
        if (!/[0-9a-f]{48}/.test(state)) throw new ValidationError('state');
        const stateDoc = await DocumentModel.get("system",
            TYPE_CP_OAUTH_STATE_CACHE, state);
        if (!stateDoc || now - parseInt(stateDoc.content, 10) > 60000) {
            throw new ValidationError('state');
        }
        await DocumentModel.deleteOne("system",
            TYPE_CP_OAUTH_STATE_CACHE, state);
        
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
                signal: AbortSignal.timeout(60000),
            });
            const {
                access_token, refresh_token, expires_in
            } = await response.json();
            
            const userinfo = await fetch(thirdOAuthUri, {
                headers: { Authorization: `Bearer ${access_token}` },
                method: 'GET',
                signal: AbortSignal.timeout(60000),
            });
            data = await userinfo.json();
            if (!data.email) throw "Cannot get user email via given code.";
            if (!data.email_verified) {
                throw "Please, verify your email on CP OAuth first.";
            }
            await fetch(fourthOAuthUri, {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: refresh_token,
                    token_type_hint: 'refresh_token'
                }),
                method: 'POST',
                signal: AbortSignal.timeout(60000),
            });
        } catch (error) {
            console.log(error);
            throw new CPOAuthDataCheckFailedError(error.toString());
        };
        
        const mailLower = data.email.toLowerCase();
        const udoc = await UserModel.getByEmail("system", mailLower);
        if (!udoc) throw new UserNotFoundError(mailLower);
        const uid = udoc._id;
        
        await UserModel.setById(uid, {
            bound: true,
            cpInfo: data.linked_accounts,
        });
        await DomainModel.setUserInDomain("system", uid, {
            "rpInfo.cpInfo.bound": true,
            "rpInfo.cpInfo.cpInfo": data.linked_accounts,
        });
        await oplog.log(this, 'user.cpoauth.second.end', { data: data });
        
        await this.limitRate('user_login_id', 60, 5, udoc.uname);
        if (SystemModel.get('system.contestmode')) {
            if (!udoc.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
                throw new CannotLoginViaCPOAuthInContestModeError();
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
        this.response.redirect = '/';
    }
}


export async function apply(ctx: Context) {
    await initializeUri();
    ctx.Route('first_cpoauth', '/cpoauth/first', FirstCPOAuthHandler);
    ctx.Route('second_cpoauth', '/cpoauth/second', SecondCPOAuthHandler);
}
