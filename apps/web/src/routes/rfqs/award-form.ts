import type { ComparisonLine, ComparisonSupplier, Money } from '@partledger/contracts';
import { z } from 'zod';

/** The select value for deciding that a line gets no award. */
export const noAward = 'noAward';

export interface WinnerOption {
  readonly supplierId: string;
  readonly name: string;
  readonly total: Money;
  readonly lowest: boolean;
  readonly alternate: boolean;
}

/**
 * Suppliers that can win a line: a current quote, or an alternate a quality engineer accepted
 * (R22). Stale answers, no-quotes, pending and late cells cannot win.
 */
export function winnerOptions(line: ComparisonLine, suppliers: readonly ComparisonSupplier[]): WinnerOption[] {
  return suppliers.flatMap((supplier) => {
    const cell = line.cells.find((candidate) => candidate.supplierId === supplier.supplierId);
    if (cell?.quote == null) {
      return [];
    }
    const eligible =
      cell.state === 'bestPrice' ||
      cell.state === 'submitted' ||
      (cell.state === 'alternate' && cell.alternate?.acceptedByQuality === true);
    if (!eligible) {
      return [];
    }
    return [
      {
        supplierId: supplier.supplierId,
        name: supplier.name,
        total: cell.quote.normalisedTotal,
        lowest: line.lowestSupplierId === supplier.supplierId,
        alternate: cell.state === 'alternate',
      },
    ];
  });
}

/** A winner that is not the lowest normalised total needs a justification (R22). */
export function requiresJustification(line: Pick<ComparisonLine, 'lowestSupplierId'>, winner: string): boolean {
  return winner !== '' && winner !== noAward && winner !== line.lowestSupplierId;
}

export interface AwardFormValues {
  decisions: { lineId: string; winner: string; justification: string }[];
}

/** Nothing is preselected: every line starts without a winner, whatever is lowest (R21). */
export function emptyAwardForm(lines: readonly ComparisonLine[]): AwardFormValues {
  return { decisions: lines.map((line) => ({ lineId: line.lineId, winner: '', justification: '' })) };
}

/** Errors are message keys, which the form translates where it shows them. */
export function awardFormSchema(lines: readonly ComparisonLine[]) {
  return z
    .object({
      decisions: z.array(z.object({ lineId: z.string(), winner: z.string(), justification: z.string() })),
    })
    .superRefine((form, context) => {
      form.decisions.forEach((decision, index) => {
        const line = lines[index];
        if (line === undefined) {
          return;
        }
        if (decision.winner === '') {
          context.addIssue({
            code: 'custom',
            path: ['decisions', index, 'winner'],
            message: 'pl.rfqs.award.error.winnerRequired',
          });
        } else if (requiresJustification(line, decision.winner) && decision.justification.trim() === '') {
          context.addIssue({
            code: 'custom',
            path: ['decisions', index, 'justification'],
            message: 'pl.rfqs.award.error.justificationRequired',
          });
        }
      });
    });
}
