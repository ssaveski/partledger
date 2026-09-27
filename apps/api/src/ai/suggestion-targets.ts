/// <reference types="vite/client" />

import type { TenantRole } from '@partledger/contracts';
import type { z } from 'zod';

import type { AppDatabase } from '../db/tenant-transaction';

/**
 * What a suggestion can change (KTD40). A module that lets AI suggest values for its records
 * declares a target in `ai/targets/<module>.ts`: which roles may decide its suggestions, the
 * schema of each field's value, how to read a record's version and how to apply an accepted
 * value. Accepting runs `apply` in the person's command, never anything automatic.
 */
export interface SuggestionTarget {
  readonly type: 'entity_field' | 'import_mapping';
  /** The `target_entity` of its suggestions, such as `part`. */
  readonly entity: string;
  /** People holding any of these roles may accept or reject its suggestions. */
  readonly roles: readonly [TenantRole, ...TenantRole[]];
  /** The schema of a field's value, or `null` for a field that takes no suggestions. */
  valueSchema(field: string): z.ZodType | null;
  /**
   * The record's current version, or `null` when it does not exist in the tenant. It should lock
   * the row (`select … for update`), so the record cannot change between this read and `apply`.
   */
  currentVersion(database: AppDatabase, tenantId: string, id: string): Promise<number | null>;
  /**
   * Applies an accepted value to a record still at `baseVersion`, with a conditional update, and
   * returns the record's new version; `null` when the record is no longer at `baseVersion`, which
   * the accepting command refuses as a version conflict.
   */
  apply(database: AppDatabase, change: TargetChange): Promise<number | null>;
}

export interface TargetChange {
  readonly tenantId: string;
  readonly id: string;
  readonly field: string;
  readonly value: unknown;
  readonly baseVersion: number;
  readonly now: Date;
}

export class InvalidSuggestionTargetsError extends Error {
  constructor(problem: string) {
    super(`The suggestion targets are invalid: ${problem}`);
    this.name = 'InvalidSuggestionTargetsError';
  }
}

export class SuggestionTargets {
  private readonly byKey: ReadonlyMap<string, SuggestionTarget>;

  constructor(targets: readonly SuggestionTarget[]) {
    const byKey = new Map<string, SuggestionTarget>();
    for (const target of targets) {
      const key = `${target.type}/${target.entity}`;
      if (byKey.has(key)) {
        throw new InvalidSuggestionTargetsError(`${key} is declared twice`);
      }
      byKey.set(key, target);
    }
    this.byKey = byKey;
  }

  find(type: string, entity: string): SuggestionTarget | undefined {
    return this.byKey.get(`${type}/${entity}`);
  }

  /** The targets of an entity, whatever their type. */
  ofEntity(entity: string): readonly SuggestionTarget[] {
    return [...this.byKey.values()].filter((target) => target.entity === entity);
  }
}

export const suggestionTargets = Symbol('SuggestionTargets');

function isSuggestionTarget(value: unknown): value is SuggestionTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'entity' in value &&
    'roles' in value &&
    'valueSchema' in value &&
    'currentVersion' in value &&
    'apply' in value
  );
}

// One file per module (KTD38), discovered by name so parallel units never edit the same file.
const moduleFiles = import.meta.glob<unknown>('./targets/*.ts', { eager: true, import: 'default' });

/** Every suggestion target of the shipped modules. */
export function productionSuggestionTargets(): SuggestionTargets {
  return new SuggestionTargets(
    Object.entries(moduleFiles).flatMap(([file, value]) => {
      const targets: readonly unknown[] = Array.isArray(value) ? value : [value];
      return targets.map((target) => {
        if (!isSuggestionTarget(target)) {
          throw new InvalidSuggestionTargetsError(`${file} does not export its suggestion targets as default`);
        }
        return target;
      });
    }),
  );
}
