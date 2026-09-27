/** The application's time source (KTD12); tests replace it to move time. */
export interface Clock {
  now(): Date;
}

export const clock = Symbol('Clock');

export const systemClock: Clock = {
  now() {
    return new Date();
  },
};
