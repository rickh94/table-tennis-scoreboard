import {
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Setter,
} from "solid-js";
import { GameMode, type GameConfig, type MatchState } from "./common";
import PlayerScore from "./PlayerScore";

// TODO: maybe animate number changing

// TODO: option to hide ui
interface PlayingGameProps {
  mode: GameMode;
  setMode: Setter<GameMode>;
  config: GameConfig;
  matchState: MatchState;
  setMatchState: Setter<MatchState>;
  playerScored: Function;
  playerCorrection: Function;
}

interface SidePlayer {
  name: string;
  score: number;
  games: number;
  onScore: Function;
  onCorrection: Function;
  redNumber: Accessor<boolean>;
}

export default function PlayingGame(props: PlayingGameProps) {
  const [player1RedNumber, setPlayer1RedNumber] = createSignal(false);
  const [player2RedNumber, setPlayer2RedNumber] = createSignal(false);

  const leftPlayer = (): SidePlayer =>
    props.matchState.swapped
      ? {
          ...props.matchState.player2,
          onScore: () => props.playerScored("player2"),
          onCorrection: () => props.playerCorrection("player2"),
          redNumber: player2RedNumber,
        }
      : {
          ...props.matchState.player1,
          onScore: () => props.playerScored("player1"),
          onCorrection: () => props.playerCorrection("player1"),
          redNumber: player1RedNumber,
        };

  const rightPlayer = (): SidePlayer =>
    props.matchState.swapped
      ? {
          ...props.matchState.player1,
          onScore: () => props.playerScored("player1"),
          onCorrection: () => props.playerCorrection("player1"),
          redNumber: player1RedNumber,
        }
      : {
          ...props.matchState.player2,
          onScore: () => props.playerScored("player2"),
          onCorrection: () => props.playerCorrection("player2"),
          redNumber: player2RedNumber,
        };

  const handleKeyUp = (ev: KeyboardEvent) => {
    if (props.mode === GameMode.Game) {
      ev.preventDefault();
      if (ev.key === props.config.player1Key) {
        props.playerScored("player1");
      } else if (ev.key === props.config.player2Key) {
        props.playerScored("player2");
      } else if (ev.key === props.config.scoreCorrectionKey) {
        props.setMode(GameMode.Correction);
      } else if (ev.key === props.config.player1CorrectionKey) {
        setPlayer1RedNumber(true);
        props.playerCorrection("player1");
        setTimeout(() => setPlayer1RedNumber(false), 300);
      } else if (ev.key === props.config.player2CorrectionKey) {
        setPlayer2RedNumber(true);
        props.playerCorrection("player2");
        setTimeout(() => setPlayer2RedNumber(false), 300);
      }
    } else if (props.mode === GameMode.Correction) {
      ev.preventDefault();
      if (
        ev.key === props.config.player1Key ||
        ev.key === props.config.player1CorrectionKey
      ) {
        props.playerCorrection("player1");
      } else if (
        ev.key === props.config.player2Key ||
        ev.key === props.config.player2CorrectionKey
      ) {
        props.playerCorrection("player2");
      } else if (ev.key === props.config.scoreCorrectionKey) {
        props.setMode(GameMode.Game);
      }
    }
  };
  onMount(() => {
    if (globalThis.addEventListener) {
      globalThis.addEventListener("keyup", handleKeyUp);
    }
  });
  onCleanup(() => {
    if (globalThis.removeEventListener) {
      globalThis.removeEventListener("keyup", handleKeyUp);
    }
  });

  return (
    <main class="grid grid-cols-2">
      <PlayerScore
        mode={props.mode}
        showBorder={true}
        name={leftPlayer().name}
        reverse={false}
        score={leftPlayer().score}
        games={leftPlayer().games}
        onScore={leftPlayer().onScore}
        onCorrection={leftPlayer().onCorrection}
        redNumber={leftPlayer().redNumber()}
        testid="left"
      />
      <PlayerScore
        mode={props.mode}
        showBorder={false}
        name={rightPlayer().name}
        reverse={true}
        score={rightPlayer().score}
        games={rightPlayer().games}
        onScore={rightPlayer().onScore}
        onCorrection={rightPlayer().onCorrection}
        redNumber={rightPlayer().redNumber()}
        testid="right"
      />
    </main>
  );
}
