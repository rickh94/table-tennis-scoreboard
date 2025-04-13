import { createSignal, Switch, Match, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
  GameMode,
  type MatchState,
  type GameConfig,
  defaultGameConfig,
  type Result,
  type Player,
} from "./common";
import PlayingGame from "./PlayingGame";
import GameOver from "./GameOver";
import SwitchingSides from "./SwitchingSides";
import MatchOver from "./MatchOver";
import Setup from "./Setup";
import Menu from "./Menu";
import RemoteControlSetup from "./RemoteControlSetup";
import { API_URL } from "astro:env/client";
import type { ScoreboardInfo } from "../bindings/ScoreboardInfo";

// TODO: make option to download match data
// TODO: load initial config from localStorage
//
async function getScoreboardInfo(): Promise<Result<ScoreboardInfo, string>> {
  try {
    const response = await fetch(`${API_URL}/init`);
    if (!response.ok) {
      const text = await response.text();
      console.log(text);
      return ["Err", `Server returned an error: ${text}`];
    }
    const obj = (await response.json()) as ScoreboardInfo;
    return ["Ok", obj];
  } catch (err) {
    console.log(err);
    return ["Err", `Could not get scoreboard info from the server: ${err}`];
  }
}

export default function Game() {
  const [mode, setMode] = createSignal<GameMode>(GameMode.Game);
  //const [mode, setMode] = createSignal<GameMode>(GameMode.RemoteControlSetup);
  const [matchState, setMatchState] = createStore<MatchState>({
    player1: {
      name: "Player 1",
      score: 0,
      games: 0,
    },
    player2: {
      name: "Player 2",
      score: 0,
      games: 0,
    },
    // A game is an object with keys winner, player1score, and player2score
    gameLog: [],
    swapped: false,
  });
  const [config, setConfig] = createStore<GameConfig>({
    ...defaultGameConfig,
  });
  const [socket, setSocket] = createSignal<WebSocket | undefined>(undefined);

  onMount(() => {
    if (globalThis.localStorage) {
      const loadedConfig = JSON.parse(localStorage.getItem("config") ?? "{}");
      if (loadedConfig instanceof Object) {
        setConfig({
          ...loadedConfig,
          ...defaultGameConfig,
        });
      }
      const player1Name = localStorage.getItem("player1Name");
      const player2Name = localStorage.getItem("player2Name");
      setMatchState((state) => ({
        ...state,
        player1: {
          ...state.player1,
          name: player1Name ?? state.player1.name,
        },
        player2: {
          ...state.player2,
          name: player2Name ?? state.player2.name,
        },
      }));
    }
  });

  const newGame = () => {
    setMatchState((state) => ({
      ...state,
      swapped: config.switchSides ? !state.swapped : state.swapped,
      player1: {
        ...state.player1,
        score: 0,
      },
      player2: {
        ...state.player2,
        score: 0,
      },
    }));
    if (config.switchSides) {
      setMode(GameMode.SwitchingSides);
      setTimeout(() => {
        setMode(GameMode.Game);
      }, 3000);
    } else {
      setMode(GameMode.Game);
    }
  };
  const newMatch = () => {
    setMode(GameMode.Game);
    setMatchState((state) => ({
      player1: {
        name: state.player1.name,
        score: 0,
        games: 0,
      },
      player2: {
        name: state.player2.name,
        score: 0,
        games: 0,
      },
      gameLog: [],
      swapped: false,
    }));
  };

  const checkForWin = () => {
    const {
      player1: { score: player1Score },
      player2: { score: player2Score },
    } = matchState;
    // No one has won yet
    if (
      player1Score < config.winningScore &&
      player2Score < config.winningScore
    ) {
      return;
    }
    // neither player has a two point advantage, duece, there is no winner
    if (Math.abs(player1Score - player2Score) < 2) {
      return;
    }
    // at this point, one player has more than the winning score and has won by two points
    let winner: "player1" | "player2" =
      player1Score > player2Score ? "player1" : "player2";
    let nextGames = matchState[winner].games + 1;
    setMatchState(winner, (player: Player) => ({
      ...player,
      games: nextGames,
    }));
    setMatchState("gameLog", (gameLog) => [
      ...gameLog,
      { player1Score, player2Score },
    ]);
    if (nextGames > config.matchLength / 2) {
      setMode(GameMode.MatchOver);
    } else {
      setMode(GameMode.GameOver);
    }
  };

  const startRemoteControlSetup = () => {
    setMode(GameMode.RemoteControlSetup);
  };

  const playerScored = (player: "player1" | "player2") => {
    setMatchState(player, (p) => ({
      ...p,
      score: p.score + 1,
    }));
    checkForWin();
  };

  const playerCorrection = (player: "player1" | "player2") => {
    setMatchState(player, (p) => ({
      ...p,
      score: p.score - 1 > 0 ? p.score - 1 : 0,
    }));
    checkForWin();
  };

  const setupAsScoreboard = async () => {
    const [r, v] = await getScoreboardInfo();
    if (r === "Err") {
      alert(v);
      return;
    }
    const clientEndpoint = `${globalThis.location.href}?scoreboardId=${v.scoreboardId}`;
    console.log(clientEndpoint);
    const conn = new WebSocket(v.scoreboardWs);
    conn.onopen = () => {
      setSocket(conn);
    };
    conn.onmessage = async (ev: MessageEvent) => {
      console.log(ev.data);
      //const m = await parseReceived(ev.data);
      //if (m.t === "ChangeRoom") {
      //  setRoom(m.c);
      //  setMessages([]);
      //} else {
      //  setMessages((prev) => [...prev, m]);
      //}
    };
    conn.onclose = (_ev: CloseEvent) => {
      setSocket(undefined);
      // TODO: do better than this.
      alert("Disconnected");
    };
    // TODO: socket.onerror
  };

  onMount(() => {
    if (globalThis.location) {
      const _params = new URLSearchParams(globalThis.location.search);
    }
  });

  return (
    <div
      classList={{
        "min-h-screen h-auto": true,
        "bg-blue-700": mode() === GameMode.Game,
        "bg-sky-700": mode() === GameMode.RemoteControlSetup,
        "bg-red-700": mode() === GameMode.Correction,
        "bg-green-700":
          mode() === GameMode.GameOver ||
          mode() === GameMode.MatchOver ||
          mode() === GameMode.SwitchingSides,
        "bg-yellow-500": mode() === GameMode.Setup,
      }}
      id="main-content"
    >
      <div class="px-4 mx-auto max-w-4xl min-h-screen text-white xl:max-w-7xl">
        <Switch fallback={<div>Not Implemented</div>}>
          <Match
            when={mode() === GameMode.Game || mode() === GameMode.Correction}
          >
            <PlayingGame
              mode={mode()}
              playerScored={playerScored}
              playerCorrection={playerCorrection}
              setMode={setMode}
              setMatchState={setMatchState}
              config={config}
              matchState={matchState}
            />
          </Match>
          <Match when={mode() === GameMode.GameOver}>
            <GameOver matchState={matchState} newGame={newGame} />
          </Match>
          <Match when={mode() === GameMode.SwitchingSides}>
            <SwitchingSides setMode={setMode} />
          </Match>
          <Match when={mode() === GameMode.MatchOver}>
            <MatchOver newMatch={newMatch} matchState={matchState} />
          </Match>
          <Match when={mode() === GameMode.RemoteControlSetup}>
            <RemoteControlSetup setupAsScoreboard={setupAsScoreboard} />
          </Match>
          <Match when={mode() === GameMode.Setup}>
            <Setup
              config={config}
              setConfig={setConfig}
              setMode={setMode}
              matchState={matchState}
              setMatchState={setMatchState}
            />
          </Match>
        </Switch>
      </div>

      <div id="correction" class="fixed bottom-0 left-0 mb-4 ml-4">
        <Switch fallback={<div></div>}>
          <Match when={mode() === GameMode.Game}>
            <button
              class="py-2 px-4 font-mono font-bold text-black uppercase bg-white border border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 border-t border-l selectable"
              data-testid="correction-button"
              title="Correct a scoring mistake"
              onClick={() => setMode(GameMode.Correction)}
            >
              Correction
            </button>
          </Match>
          <Match when={mode() === GameMode.Correction}>
            <button
              class="py-2 px-4 font-mono font-bold text-black uppercase bg-white border border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 border-t border-l selectable"
              onClick={() => setMode(GameMode.Game)}
              title="Correct a scoring mistake"
              data-testid="end-correction-button"
            >
              Correction Complete
            </button>
          </Match>
        </Switch>
      </div>
      <Show when={mode() !== GameMode.Setup}>
        <Menu>
          <ul class="min-w-32 text-center mb-2 bg-white border border-b-4 border-r-4 box-shadow border-black font-mono font-bold divide-y-2 divide-y-black">
            <li class="p-2">
              <a href="/help" target="_blank" data-testid="help-button">
                Help
              </a>
            </li>
            <li class="p-2">
              <button
                class="cursor-pointer"
                onClick={() => setMode(GameMode.Setup)}
                title="Configure Match Settings"
                data-testid="setup-button"
              >
                Setup
              </button>
            </li>
            <li class="p-2">
              {/* TODO: dynamic button to setup remote control or disconnect remote control depending on socket state */}
              <button
                class="cursor-pointer"
                onClick={startRemoteControlSetup}
                data-testid="remote-button"
              >
                Remote Control
              </button>
            </li>
          </ul>
        </Menu>
      </Show>
    </div>
  );
}

// swap sides button in menu
//<button
//  class="py-2 px-4 font-mono font-bold text-black uppercase bg-white border border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 border-t border-l selectable"
//  onClick={() =>
//    setMatchState((state) => ({ ...state, swapped: !state.swapped }))
//  }
//  title="Correct a scoring mistake"
//  data-testid="end-correction-button"
//>
//  swap
//</button>
