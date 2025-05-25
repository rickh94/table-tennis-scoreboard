export enum GameMode {
  GameOver = 0,
  MatchOver = 1,
  Game = 2,
  Correction = 3,
  Setup = 4,
  SwitchingSides = 5,
  RemoteControlSetup = 6,
}

// TODO: add config for showing swap ends reminder
// TODO: add config for auto-starting the next game

export type GameConfig = {
  matchLength: number;
  player1Key: string;
  player2Key: string;
  scoreCorrectionKey: string;
  winningScore: number;
  switchSides: boolean;
  player1CorrectionKey: string;
  player2CorrectionKey: string;
};

export const defaultGameConfig: GameConfig = {
  matchLength: 5,
  winningScore: 11,
  switchSides: true,
  player1Key: "ArrowLeft",
  player2Key: "ArrowRight",
  scoreCorrectionKey: "Tab",
  player1CorrectionKey: "1",
  player2CorrectionKey: "2",
};

export type Result<T, E = Error> = ["Ok", T] | ["Err", E];
export type Option<T> = { isSome: true; v: T } | { isSome: false };

export const sbid = "sbId";

export function unwrap<T>(o: Option<T>): T {
  if (o.isSome) {
    return o.v;
  } else {
    throw new Error("Tried to unwrap a none value");
  }
}

export function Some<T>(v: T): Option<T> {
  return { isSome: true, v };
}
