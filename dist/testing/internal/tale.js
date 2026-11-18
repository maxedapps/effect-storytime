// Stryker disable next-line StringLiteral: the key only has to be one no other method uses
export const TypeId = '~effect-storytime/Tale';
/** The stack each tale was made from, kept beside it so the tale itself stays plain data. */
const sites = new WeakMap();
/**
 * Remembers where `tale` was made: the stack of whoever called `maker`, so its failures point at
 * the test instead of this library.
 */
export const made = (tale, maker) => {
    // Stryker disable next-line ObjectLiteral,StringLiteral: captureStackTrace always sets `stack`
    const site = { stack: '' };
    Error.captureStackTrace(site, maker);
    // The first line is the holder's header, not a frame.
    sites.set(tale, site.stack.slice(site.stack.indexOf('\n') + 1));
    return tale;
};
/** Gives `failure` the stack of the call that made `tale`, so Vitest's code frame shows the tale. */
export const located = (tale, failure) => {
    const site = sites.get(tale);
    if (site !== undefined)
        failure.stack = `${failure.name}: ${failure.message}\n${site}`;
    return failure;
};
//# sourceMappingURL=tale.js.map