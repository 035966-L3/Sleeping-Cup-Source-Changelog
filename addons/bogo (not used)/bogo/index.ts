import {
    UserModel, DocumentModel, SystemModel, 
    ValidationError, PRIV, db, randomstring,
    ObjectId, Handler, Context, param, Types,
} from 'hydrooj';

function generateBogoToken(mustInclude?: number) {
    let first = '-';
    let second = '-';
    while (!/^[0-9]$/.test(first)) first = randomstring(1);
    while (!/^[0-9]$/.test(second)) second = randomstring(1);
    [first, second] = (first > second) ? [second, first] : [first, second];
    if (first === second) second = (+second + 1).toString();
    if (second === '10') [first, second] = ['0', '9'];
    if (mustInclude && mustInclude != +first && mustInclude != +second) {
        return generateBogoToken(mustInclude);
    }
    return { first: +first, second: +second };
}

function generateRandomBogoPermutation() {
    let result = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = 1; i <= 9; i++) {
        let swapWith = 10;
        while (true) {
            const randomCharacter = randomstring(1);
            if (/[0-9a-f]/.test(randomCharacter)) {
                const theNumber = +randomCharacter;
                if (theNumber <= i) {
                    swapWith = theNumber;
                    break;
                }
                continue;
            }
        }
        if (swapWith !== i) [result[i], result[swapWith]] = [result[swapWith], result[i]];
    }
    for (let i = 0; i <= 9; i++)
        if (result[i] !== i) return result;
    return generateRandomBogoPermutation();
}

function generateMask(p: number[]) {
    const table = ['A', 'B', 'C', 'D'];
    let mask = ['-', '-', '-', '-'];
    let count = 0;
    for (let i = 0; i <= 9; i++)
        if (p[i] % 3 === 0) {
            mask[Math.round(p[i] / 3)] = table[count];
            count++;
        }
    return mask;
}

function inversionCount(p: number[]) {
    let answer = 0;
    for (let i = 0; i <= 8; i++)
        for (let j = i + 1; j <= 9; j++)
            if (p[i] > p[j]) answer++;
    return answer;
}

function generateFirstElementDescription(record, board) {
    const index = record.consumedBogoToken.first;
    let element = record.newBoard[record.consumedBogoToken.second];
    if (record.operation === "Discard") element = record.newBoard[record.consumedBogoToken.first];
    if (element % 3 === 0) element = board.mask[Math.round(element / 3)];
    return { index: index, element: element };
}

function generateSecondElementDescription(record, board) {
    const index = record.consumedBogoToken.second;
    let element = record.newBoard[record.consumedBogoToken.first];
    if (record.operation === "Discard") element = record.newBoard[record.consumedBogoToken.second];
    if (element % 3 === 0) element = board.mask[Math.round(element / 3)];
    return { index: index, element: element };
}

export interface BoardDoc {
    _id: ObjectId,
    content: '',
    owner: 1,
    domainId: 'system',
    docType: 29032903,
    docId: number,
    currentBoard: number[],
    originalBoard: number[],
    mask: string[],
    operationCount: number,
    operationSequence: any[],
    finished: boolean,
    beginAt: Date,
    finishAt?: Date | null,
    winner: number,
    jackpot: number,
    standingsSnapshot: any[];
}

declare module 'hydrooj' {
    interface DocType {
        [29032903]: BoardDoc;
    }
}

export class BogoBoardHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const thisUser = await UserModel.getById('system', this.user._id);
        if (!thisUser._udoc.nextBogoToken) await UserModel.setById(this.user._id, {
            nextBogoToken: generateBogoToken(),
            cooldownUntil: new Date(),
            bogoCoins: 0,
            victory: 0,
        });
    }
    async get() {
        const boardId = await SystemModel.get("bogo.currentBoardId");
        const board = await DocumentModel.get('system', 29032903, boardId, null);
        const thisUser = await UserModel.getById('system', this.user._id);
        let myOperations = [];
        for (let i = 0; i < board.operationSequence.length; i++) {
            if (board.operationSequence[i].uid === this.user._id) {
                myOperations.push({
                    id: i + 1,
                    at: board.operationSequence[i].processedAt,
                    swap: generateFirstElementDescription(board.operationSequence[i], board),
                    swapFor: generateSecondElementDescription(board.operationSequence[i], board),
                    operation: board.operationSequence[i].operation,
                    status: board.operationSequence[i].operationStatus,
                    profit: board.operationSequence[i].profit,
                });
            }
        }
        myOperations.reverse();
        this.response.body = {
            board: board,
            cooldownUntil: thisUser._udoc.cooldownUntil,
            nextBogoToken: thisUser._udoc.nextBogoToken,
            bogoCoins: thisUser._udoc.bogoCoins,
            myOperations: myOperations,
        };
        this.response.template = 'bogo.html';
        const victory = await db.collection('document').findOne({
            docType: 29032903,
            winner: this.user._id,
            claimed: false,
        });
        if (victory) {
            this.response.template = 'bogo_congrats.html';
            this.response.body = {
                boardId: victory.docId,
                jackpot: victory.jackpot,
            }
            await DocumentModel.set('system', 29032903, victory.docId, { claimed: true });
        }
    }
}

export class BogoBoardPurchaseHandler extends Handler {
    async get() {
        this.response.redirect = 'https://www.bilibili.com/video/BV1GJ411x7h7';
    }
}

export class BogoBoardProcessingHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const sessionId = new ObjectId();
        const vacant = new ObjectId("000000000000000000000000");
        const applicationResult = await db.collection('system').findOneAndUpdate(
            { _id: "bogo.currentProcessSessionId", value: vacant },
            { $set: { value: sessionId } },
            { returnDocument: 'after' }
        ) || { _id: "bogo.currentProcessSessionId", value: vacant };
        if (applicationResult.value.toString() === sessionId.toString()) {
            const queuedOperations = await DocumentModel.getMulti(
                    'system', 2903, { operationStatus: "Pending" }
                ).sort({ _id: 1 }).toArray();
            for (let i = 0; i < queuedOperations.length; i++) {
                let operationChanges = {};
                let boardChanges = {};
                operationChanges.processedAt = new Date();
                const thisOperation = queuedOperations[i];
                const uid = thisOperation.owner;
                const thisUser = await UserModel.getById('system', uid);
                operationChanges.content = thisOperation.content.split('/')[0];
                let reserve = null;
                if (thisOperation.content.split('/')[1] === "First") {
                    reserve = thisUser._udoc.nextBogoToken.first;
                }
                if (thisOperation.content.split('/')[1] === "Second") {
                    reserve = thisUser._udoc.nextBogoToken.second;
                }
                operationChanges.consumedBogoToken = thisUser._udoc.nextBogoToken;
                await UserModel.setById(uid, { nextBogoToken: generateBogoToken(reserve) });
                const boardId = thisOperation.parentId;
                const board = await DocumentModel.get('system', 29032903, boardId, null);
                operationChanges.bogoOperationId = board.operationCount + 1;
                boardChanges.operationCount = board.operationCount + 1;
                const currentBoardId = await SystemModel.get("bogo.currentBoardId");
                boardChanges.operationSequence = [];
                for (let j = 0; j < board.operationSequence.length; j++) {
                    const element = board.operationSequence[j];
                    boardChanges.operationSequence.push({
                        docId: element.docId,
                        uid: element.uid,
                        consumedBogoToken: {
                            first: element.consumedBogoToken.first, 
                            second: element.consumedBogoToken.second,
                        },
                        operation: element.operation,
                        newBoard: element.newBoard.slice(),
                        processedAt: new Date(element.processedAt.getTime()),
                        profit: element.profit,
                        won: element.won,
                        jackpot: element.jackpot,
                        operationStatus: element.operationStatus,
                    });
                }
                if (thisOperation.content.split('/')[0] === "Discard") {
                    operationChanges.operationStatus = "Success";
                    operationChanges.newBoard = board.currentBoard;
                    boardChanges.operationSequence.push({
                        docId: thisOperation._id,
                        uid: uid,
                        consumedBogoToken: operationChanges.consumedBogoToken,
                        operation: "Discard",
                        newBoard: board.currentBoard,
                        processedAt: operationChanges.processedAt,
                        profit: 0,
                        won: false,
                        jackpot: 0,
                        operationStatus: "Success",
                    });
                    await DocumentModel.set('system', 2903, thisOperation.docId, operationChanges);
                    await DocumentModel.set('system', 29032903, boardId, boardChanges);
                    continue;
                }
                if (currentBoardId !== boardId) {
                    operationChanges.operationStatus = "Failed";
                    operationChanges.profit = 1;
                    operationChanges.newBoard = board.currentBoard;
                    boardChanges.operationSequence.push({
                        docId: thisOperation._id,
                        uid: uid,
                        consumedBogoToken: operationChanges.consumedBogoToken,
                        operation: "Apply",
                        newBoard: board.currentBoard,
                        processedAt: operationChanges.processedAt,
                        profit: 1,
                        won: false,
                        jackpot: 0,
                        operationStatus: "Failed",
                    });
                    await UserModel.setById(uid, { bogoCoins: thisUser._udoc.bogoCoins + 1 });
                    await DocumentModel.set('system', 2903, thisOperation.docId, operationChanges);
                    await DocumentModel.set('system', 29032903, boardId, boardChanges);
                    continue;
                }
                operationChanges.operationStatus = "Success";
                operationChanges.profit = inversionCount(board.currentBoard);
                boardChanges.currentBoard = board.currentBoard.slice();
                const pair = operationChanges.consumedBogoToken;
                const cup = boardChanges.currentBoard[pair.first];
                boardChanges.currentBoard[pair.first] = boardChanges.currentBoard[pair.second];
                boardChanges.currentBoard[pair.second] = cup;
                operationChanges.profit -= inversionCount(boardChanges.currentBoard);
                operationChanges.newBoard = boardChanges.currentBoard;
                boardChanges.jackpot = board.jackpot + Math.abs(operationChanges.profit);
                if (!inversionCount(boardChanges.currentBoard)) {
                    operationChanges.won = true;
                    operationChanges.jackpot = boardChanges.jackpot;
                    boardChanges.finished = true;
                    boardChanges.finishAt = operationChanges.processedAt;
                    boardChanges.winner = uid;
                    const currentVictoryCount = thisUser._udoc.victory;
                    await UserModel.setById(uid, { victory: currentVictoryCount + 1 });
                }
                boardChanges.operationSequence.push({
                    docId: thisOperation._id,
                    uid: uid,
                    consumedBogoToken: operationChanges.consumedBogoToken,
                    operation: "Apply",
                    newBoard: boardChanges.currentBoard,
                    processedAt: operationChanges.processedAt,
                    profit: operationChanges.profit,
                    won: operationChanges.won || false,
                    jackpot: operationChanges.jackpot || 0,
                    operationStatus: "Success",
                });
                const netProfit = operationChanges.profit + (operationChanges.jackpot || 0);
                const newBogoCoinCount = thisUser._udoc.bogoCoins + netProfit;
                await UserModel.setById(uid, { bogoCoins: newBogoCoinCount });
                await DocumentModel.set('system', 2903, thisOperation.docId, operationChanges);
                await DocumentModel.set('system', 29032903, boardId, boardChanges);
                if (!inversionCount(boardChanges.currentBoard)) {
                    await SystemModel.set("bogo.currentBoardId", boardId + 1);
                    const board = generateRandomBogoPermutation();
                    const standings = await UserModel.getMulti({
                            nextBogoToken: { $exists: true }
                        }).sort({ bogoCoins: -1, victory: -1, _id: 1 }).toArray();
                    let standingsSnapshot = [];
                    for (let j = 0; j < standings.length; j++) {
                        standingsSnapshot.push({
                            rank: j + 1,
                            uid: standings[j]._id,
                            bogoCoins: standings[j].bogoCoins,
                            victory: standings[j].victory,
                        });
                        if (j > 0) {
                            if (standingsSnapshot[j].bogoCoins === standingsSnapshot[j - 1].bogoCoins) {
                                standingsSnapshot[j].rank = standingsSnapshot[j - 1].rank;
                            }
                        }
                    }
                    await DocumentModel.set('system', 29032903, boardId, {
                        standingsSnapshot: standingsSnapshot
                    });
                    await DocumentModel.add('system', "", 1, 29032903, boardId + 1, null, null, {
                        currentBoard: board,
                        originalBoard: board,
                        mask: generateMask(board),
                        operationCount: 0,
                        operationSequence: [],
                        finished: false,
                        beginAt: new Date(),
                        finishAt: null,
                        winner: 0,
                        jackpot: 0,
                        claimed: false,
                        standingsSnapshot: [],
                    });
                }
            }
            await SystemModel.set("bogo.currentProcessSessionId", vacant);
        }
    }
    async get() {
        this.response.redirect = '/bogo';
    }
}

export class BogoBoardOperationHandler extends Handler {
    @param('operation', Types.String)
    @param('reserve', Types.String)
    async prepare(pack: any) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const thisUser = await UserModel.getById('system', this.user._id);
        const nextBogoToken = thisUser._udoc.nextBogoToken;
        if (!nextBogoToken) throw new ValidationError('nextBogoToken');
        const operation = pack.operation;
        const reserve = pack.reserve;
        if (operation !== "Apply" && operation !== "Discard") throw new ValidationError('operation');
        if (reserve !== "First" && reserve !== "Second" && reserve !== "None") {
            throw new ValidationError('reserve');
        }
        const cooldownUntil = thisUser._udoc.cooldownUntil;
        if (new Date() < cooldownUntil) throw new ValidationError('cooldownUntil');
    }
    @param('operation', Types.String)
    @param('reserve', Types.String)
    async get(pack: any) {
        const operation = pack.operation;
        const reserve = pack.reserve;
        let cooldownUntil = new Date();
        cooldownUntil.setTime(cooldownUntil.getTime() + 60000);
        if (reserve !== "None") cooldownUntil.setTime(cooldownUntil.getTime() + 240000);
        await UserModel.setById(this.user._id, { cooldownUntil: cooldownUntil });
        const boardId = await SystemModel.get("bogo.currentBoardId");
        const content = operation + "/" + reserve;
        await DocumentModel.add('system', content, this.user._id, 2903, null, 29032903, boardId, {
            bogoOperationId: 0,
            consumedBogoToken: null,
            newBoard: null,
            processedAt: null,
            profit: 0,
            won: false,
            jackpot: 0,
            operationStatus: "Pending",
        });
        this.response.redirect = '/bogo/process';
    }
}

export class BogoBoardArchiveHandler extends Handler {
    @param('boardid', Types.UnsignedInt)
    async prepare(pack: any) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const currentBoardId = await SystemModel.get("bogo.currentBoardId");
        const boardid = +(pack.boardid);
        if (boardid >= currentBoardId || boardid < 0) throw new ValidationError('boardId');
        if (boardid === 0 && currentBoardId === 1) throw new ValidationError('boardId');
    }
    @param('boardid', Types.UnsignedInt)
    async get(pack: any) {
        let boardid = +(pack.boardid);
        if (boardid === 0) {
            const currentBoardId = await SystemModel.get("bogo.currentBoardId");
            boardid = currentBoardId - 1;
        }
        const board = await DocumentModel.get('system', 29032903, boardid, null);
        let uidList = [];
        for (let i = 0; i < board.operationSequence.length; i++) {
            if (!uidList.includes(board.operationSequence[i].uid)) {
                uidList.push(board.operationSequence[i].uid);
            }
        }
        const userList = await UserModel.getList('system', uidList);
        this.response.body = { board: board, userList: userList };
        this.response.template = 'bogo_history.html';
    }
}

export class BogoBoardStandingsHandler extends Handler {
    @param('boardid', Types.UnsignedInt)
    async prepare(pack: any) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const currentBoardId = await SystemModel.get("bogo.currentBoardId");
        const boardid = +(pack.boardid);
        if (boardid >= currentBoardId || boardid < 0) throw new ValidationError('boardId');
        if (boardid === 0 && currentBoardId === 1) throw new ValidationError('boardId');
    }
    @param('boardid', Types.UnsignedInt)
    async get(pack: any) {
        let boardid = +(pack.boardid);
        if (boardid === 0) {
            const currentBoardId = await SystemModel.get("bogo.currentBoardId");
            boardid = currentBoardId - 1; 
        }
        const board = await DocumentModel.get('system', 29032903, boardid, null);
        let uidList = [];
        for (let i = 0; i < board.standingsSnapshot.length; i++) {
            if (!uidList.includes(board.standingsSnapshot[i].uid)) {
                uidList.push(board.standingsSnapshot[i].uid);
            }
        }
        const userList = await UserModel.getList('system', uidList);
        this.response.body = { board: board, userList: userList };
        this.response.template = 'bogo_ranking.html';
    }
}


export async function apply(ctx: Context) {
    const bogoBoardCount = await DocumentModel.count("system", 29032903);
    await SystemModel.set("bogo.currentBoardId", bogoBoardCount);
    await SystemModel.set("bogo.currentProcessSessionId", new ObjectId("000000000000000000000000"));
    const board = generateRandomBogoPermutation();
    if (bogoBoardCount === 0) {
        await DocumentModel.add('system', "", 1, 29032903, 1, null, null, {
            currentBoard: board,
            originalBoard: board,
            mask: generateMask(board),
            operationCount: 0,
            operationSequence: [],
            finished: false,
            beginAt: new Date(),
            finishAt: null,
            winner: 0,
            jackpot: 0,
            claimed: false,
            standingsSnapshot: [],
        });
        await SystemModel.set("bogo.currentBoardId", 1);
    }
    ctx.Route('bogo_main', '/bogo', BogoBoardHandler);
    ctx.Route('bogo_purchase', '/bogo/purchase', BogoBoardPurchaseHandler);
    ctx.Route('bogo_operation', '/bogo/operate/:operation/:reserve', BogoBoardOperationHandler);
    ctx.Route('bogo_process', '/bogo/process', BogoBoardProcessingHandler);
    ctx.Route('bogo_history', '/bogo/archive/:boardid', BogoBoardArchiveHandler);
    ctx.Route('bogo_ranking', '/bogo/standings/:boardid', BogoBoardStandingsHandler);
}
