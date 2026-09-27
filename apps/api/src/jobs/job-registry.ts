/// <reference types="vite/client" />

import type { ModuleJobs } from './job.types';

export class InvalidJobRegistryError extends Error {
  constructor(problem: string) {
    super(`The job registry is invalid: ${problem}`);
    this.name = 'InvalidJobRegistryError';
  }
}

function isModuleJobs(value: unknown): value is ModuleJobs {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jobs' in value &&
    Array.isArray(value.jobs) &&
    'schedules' in value &&
    Array.isArray(value.schedules)
  );
}

/** Merges modules' jobs; a job or schedule declared twice, or a schedule of an unregistered job, is refused. */
export function combineModuleJobs(modules: readonly ModuleJobs[]): ModuleJobs {
  const jobs = modules.flatMap((module) => module.jobs);
  const schedules = modules.flatMap((module) => module.schedules);
  const jobNames = jobs.map((registration) => registration.declaration.name);
  const scheduleNames = schedules.map((schedule) => schedule.name);
  for (const names of [jobNames, scheduleNames]) {
    const repeated = names.filter((name, position) => names.indexOf(name) !== position);
    if (repeated.length > 0) {
      throw new InvalidJobRegistryError(`${repeated.join(', ')} declared twice`);
    }
  }
  for (const schedule of schedules) {
    if (!jobs.some((registration) => registration.declaration === schedule.job)) {
      throw new InvalidJobRegistryError(`schedule ${schedule.name} runs ${schedule.job.name}, which is not registered`);
    }
  }
  return { jobs, schedules };
}

// One file per module (KTD38), discovered by name so parallel units never edit the same file.
const moduleFiles = import.meta.glob<unknown>('./schedules/*.ts', { eager: true, import: 'default' });

/** Every job and schedule the API runs in production. */
export const productionJobs: ModuleJobs = combineModuleJobs(
  Object.entries(moduleFiles).map(([file, value]) => {
    if (!isModuleJobs(value)) {
      throw new InvalidJobRegistryError(`${file} does not export its module's jobs and schedules as default`);
    }
    return value;
  }),
);
