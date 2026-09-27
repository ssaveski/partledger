/**
 * Lifecycles are typed transition tables over a status column (KTD13). Each aggregate keeps
 * its table here in `libs/domain`; the API applies a transition with one conditional update
 * (`applyTransition`), so the server alone moves an aggregate from state to state.
 */

export interface TransitionRule<Status extends string> {
  /** The states the transition may start from. */
  readonly from: readonly [Status, ...Status[]];
  readonly to: Status;
}

export interface TransitionTable<Status extends string, Transition extends string> {
  /** The aggregate's name as it appears in audit entries, such as `rfq`. */
  readonly aggregate: string;
  readonly statuses: readonly [Status, ...Status[]];
  readonly transitions: { readonly [Name in Transition]: TransitionRule<Status> };
}

export function defineTransitions<const Status extends string, const Transition extends string>(
  table: TransitionTable<Status, Transition>,
): TransitionTable<Status, Transition> {
  return table;
}

export type StatusOf<Table> = Table extends TransitionTable<infer Status, string> ? Status : never;

export type TransitionOf<Table> = Table extends TransitionTable<string, infer Transition> ? Transition : never;

/** Where a transition leads from `from`, or `null` when the table does not allow it. */
export function transitionTarget<Status extends string, Transition extends string>(
  table: TransitionTable<Status, Transition>,
  transition: NoInfer<Transition>,
  from: NoInfer<Status>,
): Status | null {
  const rule = table.transitions[transition];
  return rule.from.includes(from) ? rule.to : null;
}

/** The transitions the table allows from `status`, in declaration order. */
export function transitionsFrom<Status extends string, Transition extends string>(
  table: TransitionTable<Status, Transition>,
  status: NoInfer<Status>,
): Transition[] {
  return transitionNames(table).filter((transition) => transitionTarget(table, transition, status) !== null);
}

export function transitionNames<Status extends string, Transition extends string>(
  table: TransitionTable<Status, Transition>,
): Transition[] {
  return Object.keys(table.transitions).filter((name): name is Transition => Object.hasOwn(table.transitions, name));
}
