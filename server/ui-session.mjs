import crypto from 'node:crypto';

export const SESSION_HEADER = 'x-branchline-session';

// A launch credential pairs the host UI with its own server. It is not sent to
// the model, stored in a ledger, or accepted from an action's JSON fields.
export function createUiSession() {
  const token = crypto.randomBytes(32).toString('hex');
  let active = true;
  return Object.freeze({
    token,
    authorize(request) {
      const supplied = request.headers[SESSION_HEADER];
      if (!active || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
        || !crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(token, 'hex'))) {
        throw Object.assign(new Error('This interface is not paired with the running app. Reopen Branchline from its launcher.'), { status: 401 });
      }
    },
    revoke() { active = false; },
  });
}
