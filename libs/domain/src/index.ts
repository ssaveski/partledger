export { domainError, refuse, versionConflict, type DomainError, type DomainErrorOf } from './domain-error';
export { failure, success, type Failure, type Result, type Success } from './result';
export {
  defineTransitions,
  transitionNames,
  transitionsFrom,
  transitionTarget,
  type StatusOf,
  type TransitionOf,
  type TransitionRule,
  type TransitionTable,
} from './transitions';
