import { TypeId } from './tale.js';
const kinds = {
    Story: {
        builders: 'story',
        subject: 'program',
        schemas: { model: 'Model', message: 'Message', command: 'Command' },
        roles: {
            given: ['model'],
            send: ['message'],
            commands: ['command'],
            resolve: ['command', 'message'],
            emit: ['command', 'message']
        }
    },
    Decision: {
        builders: 'decision',
        subject: 'decider',
        schemas: { state: 'State', command: 'Command', event: 'Event', rejection: 'Rejection' },
        roles: {
            given: ['state'],
            when: ['command'],
            accepted: ['event'],
            rejected: ['rejection']
        }
    }
};
/** A value's canonical JSON as a string literal, its tag first; a value without JSON says why in a comment. */
const encoded = ({ tag, value, notJson }) => {
    if (notJson !== undefined)
        return `/* not JSON: ${notJson} */`;
    const json = JSON.stringify(tag === undefined ? value : Object.assign({ _tag: tag }, value));
    return `'${json.replaceAll(/['\\]/g, '\\$&')}'`;
};
/** The `Story.make(...)` or `Decision.make(...)` call that makes `tale`, after the decoders it uses. */
export const code = (tale) => {
    const { builders, subject, schemas, roles } = kinds[tale._tag];
    const roleOf = (verb, index) => 
    // Stryker disable next-line OptionalChaining: only a verb with values asks, and each of those has roles
    roles[verb]?.slice(0, index + 1).at(-1);
    const steps = tale[TypeId]().steps;
    const used = new Set(steps.flatMap(({ verb, values }) => values.map((_, index) => roleOf(verb, index))));
    const decoders = Object.entries(schemas)
        .filter(([role]) => used.has(role))
        .map(([role, schema]) => `const ${role} = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(${subject}.${schema})));\n`);
    const made = steps.map(({ verb, values }) => `${builders}.${verb}(${values.map((value, index) => `${roleOf(verb, index)}(${encoded(value)})`).join(', ')})`);
    return `${decoders.join('')}${tale._tag}.make(\n\t${[JSON.stringify(tale.title), subject, ...made].join(',\n\t')}\n)`;
};
//# sourceMappingURL=code.js.map