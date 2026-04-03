import {
    UserModel, DomainModel, SystemModel, User, PRIV, PERM, CreateError,
    ForbiddenError, ValidationError, BlacklistedError, UserNotFoundError,
    ObjectId, Handler, Context, param, Types,
} from 'hydrooj';
import fetch from 'node-fetch'; // Warning: extra requirements
const inc = global.Hydro.model.opcount.inc;
const oplog = global.Hydro.model.oplog;

const AlreadyLoggedInError = CreateError('ContestAlreadyAttendedError',
    ForbiddenError, "You've already logged in.");
const IncorrectParameterError = CreateError('IncorrectParameterError', 
    ForbiddenError, "Incorrect parameters: [code: {0}, state: {1}]");
const CPOAuthDataRequestFailedError = CreateError(
    'CPOAuthDataRequestFailedError', ForbiddenError,
    "CP OAuth data request failed: {0}");

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
    async get() {
        await oplog.log(this, 'user.cpoauth.first.start', {});
        if (this.user?._id) throw new AlreadyLoggedInError();
        
        await this.limitRate('user_login', 60, 30);
        const state = new ObjectId().toString().repeat(2);
        await oplog.log(this, 'user.cpoauth.first.end', { state: state });
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
        if (!/[0-9a-f]{64}/.test(code) || !/[0-9a-f]{48}/.test(state)
            || state.slice(0, 24) !== state.slice(24)) {
                throw new IncorrectParameterError(code, state);
            }
        if (this.user?._id) throw new AlreadyLoggedInError();
        
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
            })
            const {
                access_token, token_type, expires_in, scope
            } = await response.json();
            
            const userinfo = await fetch(thirdOAuthUri, {
                headers: { Authorization: `Bearer ${access_token}` },
                method: 'GET',
                signal: AbortSignal.timeout(60000),
            });
            data = await userinfo.json();
            if (!data.email) throw "Cannot get user email via given code.";
        } catch (error) {
            console.log(error);
            throw new CPOAuthDataRequestFailedError(error.toString());
        }
        
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
            if (!udoc.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) throw new ValidationError(
                "CP OAuth login in contest mode is forbidden.");
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
    initializeUri();
    ctx.Route('first_cpoauth', '/cpoauth/first', FirstCPOAuthHandler);
    ctx.Route('second_cpoauth', '/cpoauth/second', SecondCPOAuthHandler);
}
