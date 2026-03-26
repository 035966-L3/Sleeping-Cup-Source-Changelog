import { Context } from 'hydrooj';
import { ForbiddenError } from '@hydrooj/framework';
export function apply(ctx: Context) {
    ctx.on('handler/before', (h) => {
        if (h.context.path == '/home/settings/domain') throw new ForbiddenError('Feature Deprecated');
    });
}
