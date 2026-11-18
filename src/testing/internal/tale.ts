/**
 * The protocol every tale implements, so records and the Vitest adapter can run stories,
 * explorations and decisions of any Program or Decider alike.
 */
import type { Effect } from 'effect';
import type { StoryFailure } from '../Story.ts';
import type { Step, Value } from './steps.ts';

// Stryker disable next-line StringLiteral: the key only has to be one no other method uses
export const TypeId = '~effect-storytime/Tale';

/**
 * What a passing tale reached: a decision's final state or a story's final model per order, as
 * values, and the cases it touched.
 */
export interface Reached {
	readonly final?: Value;
	readonly finals?: ReadonlyArray<{ readonly order: ReadonlyArray<number>; readonly final: Value }>;
	readonly cases: ReadonlyArray<string>;
}

export interface Told {
	/** The Program or Decider the tale is about. */
	readonly subject: object;
	/** What the tale says, step by step, as data. */
	readonly steps: ReadonlyArray<Step>;
	readonly run: Effect.Effect<Reached, StoryFailure>;
}

export interface Tale {
	readonly _tag: 'Story' | 'Exploration' | 'Decision';
	readonly title: string;
	readonly [TypeId]: () => Told;
}

/** A tale that prints as source: a story or a decision, such as an explored path. */
export interface Path extends Tale {
	readonly _tag: 'Story' | 'Decision';
}

/** The stack each tale was made from, kept beside it so the tale itself stays plain data. */
const sites = new WeakMap<Tale, string>();

/**
 * Remembers where `tale` was made: the stack of whoever called `maker`, so its failures point at
 * the test instead of this library.
 */
export const made = <T extends Tale>(
	tale: T,
	maker: (...args: ReadonlyArray<never>) => Tale
): T => {
	// Stryker disable next-line ObjectLiteral,StringLiteral: captureStackTrace always sets `stack`
	const site = { stack: '' };
	Error.captureStackTrace(site, maker);
	// The first line is the holder's header, not a frame.
	sites.set(tale, site.stack.slice(site.stack.indexOf('\n') + 1));
	return tale;
};

/** Gives `failure` the stack of the call that made `tale`, so Vitest's code frame shows the tale. */
export const located = (tale: Tale, failure: StoryFailure): StoryFailure => {
	const site = sites.get(tale);
	if (site !== undefined) failure.stack = `${failure.name}: ${failure.message}\n${site}`;
	return failure;
};
