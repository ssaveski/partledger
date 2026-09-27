import { z } from 'zod';

import { errorParamsSchema, messageKeySchema } from './errors';

/**
 * Reads of lifecycle aggregates tell the client what it may do next and why it may not do
 * the rest (R32), so screens and agents never re-derive the server's state machine.
 */
export function lifecycleRead<Shape extends z.ZodRawShape, const Transition extends string>(
  aggregate: z.ZodObject<Shape>,
  transitions: readonly [Transition, ...Transition[]],
) {
  const transition = z.enum(transitions);
  return aggregate.extend({
    allowedTransitions: z
      .array(transition)
      .describe('Transitions the current principal may request now; the server still decides.'),
    blockingReasons: z
      .array(
        z
          .object({
            transition: transition.describe('The transition that is blocked.'),
            message: messageKeySchema,
            params: errorParamsSchema,
          })
          .strict(),
      )
      .describe('Why each other transition is not available, as message keys.'),
  });
}
