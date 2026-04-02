import {
    UserModel, DomainModel, SystemModel, ForbiddenError,
    ObjectId, Handler, Context, param, Types
} from 'hydrooj';
import fetch from 'node-fetch'; // Warning: extra requirements
const inc = global.Hydro.model.opcount.inc;

const errorText1 = "Not logged in.";
const errorText2 = "Already bound. Set ?force=1 to force update.";
const errorText3 = "Incorrect parameters.";

let clientId = '';
let clientSecret = '';
let redirectUri = '';
let firstOAuthUri = '';
let secondOAuthUri = '';
let thirdOAuthUri = '';

async function init() {
    clientId = await SystemModel.get('clientId');
    clientSecret = await SystemModel.get('clientSecret');
    redirectUri = 'https://scg3.piaoztsdy.cn/cpoauth/second';
    firstOAuthUri = 'https://auth.luogu.me/oauth/authorize' +
                    `?response_type=code&client_id=${clientId}` +
                    `&redirect_uri=${redirectUri}&scope=cp:linked&state=`;
    secondOAuthUri = 'https://auth.luogu.me/api/oauth/token';
    thirdOAuthUri = 'https://auth.luogu.me/api/oauth/userinfo';
}

export class FirstCPOAuthHandler extends Handler {
    @param('force', Types.Boolean)
    async get(others: any, force = false) {
        if (!this.user?._id) throw new ForbiddenError(errorText1);
        const userDoc = await UserModel.getById("system", this.user._id);
        if (userDoc._udoc.bound && !force) throw new ForbiddenError(errorText2);
        
        await inc('cpoauth', this.user._id.toString(), 86400, 4);
        const state = new ObjectId().toString().repeat(2);
        this.response.redirect = firstOAuthUri + state;
    }
}

export class SecondCPOAuthHandler extends Handler {
    @param('code', Types.String)
    @param('state', Types.String)
    async get(others: any, code: string, state: string) {
        if (!this.user?._id) throw new ForbiddenError(errorText1);
        if (!/[0-9a-f]{64}/.test(code) || !/[0-9a-f]{48}/.test(state)) {
            throw new ForbiddenError(errorText3);
        }
        if (state.slice(0, 24) !== state.slice(24)) {
            throw new ForbiddenError(errorText3);
        }
        await inc('cpoauth', this.user._id.toString(), 86400, 4);
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
        const data = await userinfo.json();
        await UserModel.setById(this.user._id, {
            bound: true,
            cpInfo: data.linked_accounts,
        });
        await DomainModel.setUserInDomain("system", this.user._id, {
            "rpInfo.cpInfo.bound": true,
            "rpInfo.cpInfo.cpInfo": data.linked_accounts,
        });
        this.response.redirect = '/';
    }
}

export async function apply(ctx: Context) {
    init();
    ctx.Route('first_cpoauth', '/cpoauth/first', FirstCPOAuthHandler);
    ctx.Route('second_cpoauth', '/cpoauth/second', SecondCPOAuthHandler);
}
