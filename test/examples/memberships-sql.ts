// The membership Store on `effect/sql`, as an app writes it. Only type-checked: the tests run
// decisions against the in-memory Store in membership.ts.
// #region store
import { Context, Effect, Layer, Predicate, Schema } from 'effect';
import { SqlClient, SqlError, SqlSchema } from 'effect/sql';
import type { Decider } from 'effect-storytime';
import { Membership } from './membership.ts';
import type { Event } from './membership.ts';

const Row = Schema.Struct({ ...Membership.fields, userId: Schema.String });

export class Memberships extends Context.Service<
	Memberships,
	Decider.Store<string, Membership, Event, SqlError.SqlError | Schema.SchemaError>
>()('Memberships') {
	static readonly layer = Layer.effect(
		Memberships,
		Effect.gen(function* () {
			// A client that maps camelCase fields to snake_case columns and back.
			const sql = yield* SqlClient.SqlClient;
			const find = SqlSchema.findOneOption({
				Request: Schema.String,
				Result: Membership,
				execute: (userId) =>
					sql`SELECT source, active, checked_at FROM memberships WHERE user_id = ${userId}`
			});
			return Memberships.of({
				load: find,
				save: (userId, state, events) =>
					Effect.gen(function* () {
						const row = yield* Schema.encodeEffect(Row)({ ...state, userId });
						yield* sql`INSERT INTO memberships ${sql.insert(row)}
							ON CONFLICT (user_id) DO UPDATE SET ${sql.update(row, ['userId'])}`;
						// The state is the truth; the events may be kept as a history.
						yield* Effect.forEach(
							events,
							(event) =>
								sql`INSERT INTO membership_history ${sql.insert({ userId, kind: event._tag })}`,
							{ discard: true }
						);
					}),
				// SERIALIZABLE protects everything `load` read; a conflict retries the whole decision.
				transaction: (effect) =>
					sql.withTransaction(effect).pipe(
						Effect.provideService(SqlClient.BeginTransaction, 'BEGIN ISOLATION LEVEL SERIALIZABLE'),
						Effect.retry({
							while: (error) =>
								SqlError.isSqlError(error) &&
								(Predicate.isTagged(error.reason, 'SerializationError') ||
									Predicate.isTagged(error.reason, 'DeadlockError')),
							times: 5
						})
					)
			});
		})
	);
}
// #endregion store
