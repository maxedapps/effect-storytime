const unchanged = (model) => ({ model });
export const make = (definition) => ({
    ...definition,
    resume: definition.resume ?? unchanged,
    invariants: definition.invariants ?? {}
});
//# sourceMappingURL=Program.js.map