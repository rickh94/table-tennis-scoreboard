"use strict";
import { createSignal, Switch, Match, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
  GameMode,
  type GameConfig,
  defaultGameConfig,
  type Result,
  sbid,
  type Option,
  Some,
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
import type { MatchState } from "../bindings/MatchState";
import type { Player } from "../bindings/Player";
import type { WsMsg } from "../bindings/WsMsg";

enum HasWinner {
  No,
  Game,
  Match,
}

// TODO: add transitions between modes
// TODO: make option to download match data
//
async function getScoreboardInfo(
  name: string,
  matchState: MatchState,
): Promise<Result<ScoreboardInfo, string>> {
  try {
    const response = await fetch(`${API_URL}/init`, {
      method: "POST",
      body: JSON.stringify({ name, matchState }),
      headers: { "Content-Type": "application/json" },
    });
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

async function getSocket(
  code: string,
): Promise<Result<ScoreboardInfo, string>> {
  try {
    const response = await fetch(`${API_URL}/connect`, {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const text = await response.text();
      console.log(text);
      return ["Err", text];
    }
    const obj = (await response.json()) as ScoreboardInfo;
    return ["Ok", obj];
  } catch (err) {
    console.log(err);
    return ["Err", `Could not get scoreboard info from the server: ${err}`];
  }
}

interface GameProps {
  remote: boolean;
}

let parsed: any;

function parseReceived(data: any): Result<WsMsg, string> {
  parsed = JSON.parse(data);
  if (!("t" in parsed && "c" in parsed)) {
    console.error("invalid message from server", data);
    return ["Err", "Invalid message from server"];
  }
  return ["Ok", parsed as WsMsg];
}

export default function Game(props: GameProps) {
  const [mode, setMode] = createSignal<GameMode>(
    props.remote ? GameMode.RemoteControlSetup : GameMode.Game,
  );
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
  const [socket, setSocket] = createStore<Option<WebSocket>>({ isSome: false });
  const [scoreboardInfo, setScoreboardInfo] = createStore<
    Option<ScoreboardInfo>
  >({ isSome: false });

  const [resetTimeout, setResetTimeout] = createStore<Option<number>>({
    isSome: false,
  });

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

    if (globalThis.location) {
      const params = new URLSearchParams(globalThis.location.search);
      const id = params.get(sbid);
      if (id) {
        setupAsRemote(id, { isSome: false }, { isSome: false });
      }
    }
    if (globalThis.history) {
      globalThis.history.replaceState({}, "Table Tennis Scoreboard", "/");
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
      const t = window.setTimeout(() => {
        startGame();
      }, 3000);
      setResetTimeout(Some(t));
      msgSocket({ t: "SwitchSides", c: null });
    } else {
      startGame();
    }
  };

  const startGame = () => {
    if (resetTimeout.isSome) {
      clearTimeout(resetTimeout.v);
      setResetTimeout({ isSome: false });
    }
    setMode(GameMode.Game);
    sendMatchUpdate(HasWinner.No);
    msgSocket({ t: "NewGame", c: null });
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
    sendMatchUpdate(HasWinner.No);
    msgSocket({ t: "NewMatch", c: null });
  };

  const checkForWin = (): HasWinner => {
    const {
      player1: { score: player1Score },
      player2: { score: player2Score },
    } = matchState;
    // No one has won yet
    if (
      player1Score < config.winningScore &&
      player2Score < config.winningScore
    ) {
      return HasWinner.No;
    }
    // neither player has a two point advantage, duece, there is no winner
    if (Math.abs(player1Score - player2Score) < 2) {
      return HasWinner.No;
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
    console.log(nextGames);
    if (nextGames > Math.floor(config.matchLength / 2)) {
      setMode(GameMode.MatchOver);
      return HasWinner.Match;
    } else {
      setMode(GameMode.GameOver);
      return HasWinner.Game;
    }
  };

  const msgSocket = (m: WsMsg) => {
    if (socket.isSome) {
      socket.v.send(JSON.stringify(m));
    } else {
      console.log("not sending");
    }
  };

  const sendMatchUpdate = (haswinner: HasWinner) => {
    msgSocket({
      t: "Update",
      c: { ms: matchState, updatedAt: new Date().getTime() },
    });
    switch (haswinner) {
      case HasWinner.No:
        break;
      case HasWinner.Game:
        msgSocket({ t: "GameOver", c: null });
        break;
      case HasWinner.Match:
        msgSocket({ t: "MatchOver", c: null });
        break;
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
    const haswinner = checkForWin();
    if (socket.isSome) {
      sendMatchUpdate(haswinner);
    }
  };

  const playerCorrection = (player: "player1" | "player2") => {
    setMatchState(player, (p) => ({
      ...p,
      score: p.score - 1 > 0 ? p.score - 1 : 0,
    }));
    const gameover = checkForWin();
    if (socket.isSome) {
      sendMatchUpdate(gameover);
    }
  };

  let res: Result<WsMsg, string>;

  const handleSocketEvent = (data: any) => {
    res = parseReceived(data);
    if (res[0] === "Err") {
      //TODO: error message
      alert(res[1]);
      return;
    }
    const { t: variant, c: content } = res[1];
    switch (variant) {
      case "ErrorMessage":
        // TODO: better messaging
        alert(content);
        break;
      case "Name":
        setScoreboardInfo(
          (prev): Option<ScoreboardInfo> =>
            prev.isSome
              ? Some({ ...prev.v, name: content })
              : { isSome: false },
        );
        break;
      case "Update":
        setMatchState(content.ms);
        break;
      case "GameOver":
        setMode(GameMode.GameOver);
        break;
      case "MatchOver":
        setMode(GameMode.MatchOver);
        break;
      case "NewGame":
        setMode(GameMode.Game);
        break;
      case "NewMatch":
        setMode(GameMode.Game);
        break;
      case "SwitchSides":
        setMode(GameMode.SwitchingSides);
        break;
    }
  };

  const setupSocket = (
    conn: WebSocket,
    onConnectedCallback: Option<Function>,
    onFailedCallback: Option<Function>,
  ): Result<null, string> => {
    let failureTimeout: Option<number> = { isSome: false };
    if (onFailedCallback.isSome) {
      failureTimeout = Some(setTimeout(onFailedCallback.v, 10000));
    }
    conn.onopen = () => {
      if (failureTimeout.isSome) {
        clearTimeout(failureTimeout.v);
      }
      setSocket(Some(conn));
      if (onConnectedCallback.isSome) {
        onConnectedCallback.v();
      }
    };
    conn.onmessage = async (ev: MessageEvent) => {
      handleSocketEvent(ev.data);
    };
    conn.onclose = (_ev: CloseEvent) => {
      setSocket({ isSome: false });
      setScoreboardInfo({ isSome: false });
      // TODO: do better than this.
      alert("Disconnected");
    };
    // TODO: socket.onerror
    return ["Ok", null];
  };

  const setupAsScoreboard = async (
    name: string,
    onConnectedCallback: Option<Function>,
    onFailedCallback: Option<Function>,
  ): Promise<Result<null, string>> => {
    const [r, v] = await getScoreboardInfo(name, matchState);
    if (r === "Err") {
      return [r, v];
    }
    setScoreboardInfo(Some(v));
    try {
      const conn = new WebSocket(v.sbWs);
      return setupSocket(conn, onConnectedCallback, onFailedCallback);
    } catch (err) {
      console.error(err);
      return ["Err", "Could not connect to server"];
    }
  };

  const setupAsRemote = async (
    code: string,
    onConnectedCallback: Option<Function>,
    onFailedCallback: Option<Function>,
  ): Promise<Result<null, string>> => {
    const [r, v] = await getSocket(code);
    if (r === "Err") {
      console.log("error");
      return ["Err", v];
    }
    setScoreboardInfo(Some(v));
    const conn = new WebSocket(v.sbWs);

    return setupSocket(conn, onConnectedCallback, onFailedCallback);
  };

  const updateConfig = (
    nextConfig: GameConfig,
    player1Name: string,
    player2Name: string,
  ) => {
    setConfig(nextConfig);
    setMatchState("player1", (prev) => ({ ...prev, name: player1Name }));
    setMatchState("player2", (prev) => ({ ...prev, name: player2Name }));
    sendMatchUpdate(HasWinner.No);
  };

  const disconnectSocket = () => {
    if (socket.isSome) {
      socket.v.close();
      setSocket({ isSome: false });
    }
  };

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
              scoreboardInfo={scoreboardInfo}
              mode={mode()}
              playerScored={playerScored}
              playerCorrection={playerCorrection}
              setMode={setMode}
              config={config}
              matchState={matchState}
            />
          </Match>
          <Match when={mode() === GameMode.GameOver}>
            <GameOver matchState={matchState} newGame={newGame} />
          </Match>
          <Match when={mode() === GameMode.SwitchingSides}>
            <SwitchingSides startGame={startGame} />
          </Match>
          <Match when={mode() === GameMode.MatchOver}>
            <MatchOver newMatch={newMatch} matchState={matchState} />
          </Match>
          <Match when={mode() === GameMode.RemoteControlSetup}>
            <RemoteControlSetup
              setupAsScoreboard={setupAsScoreboard}
              setupAsRemote={setupAsRemote}
              scoreboardInfo={scoreboardInfo}
              onDone={() => setMode(GameMode.Game)}
              remote={props.remote}
            />
          </Match>
          <Match when={mode() === GameMode.Setup}>
            <Setup
              config={config}
              updateConfig={updateConfig}
              setMode={setMode}
              matchState={matchState}
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
      <Menu>
        <ul class="min-w-48 text-center mb-2 bg-white border border-b-4 border-r-4 box-shadow border-black font-mono font-bold divide-y-2 divide-y-black">
          <Show when={mode() !== GameMode.Game}>
            <li class="p-2">
              <button
                class="cursor-pointer"
                onClick={() => setMode(GameMode.Game)}
                data-testid="back-to-game-button"
              >
                Back to Game
              </button>
            </li>
          </Show>
          <li class="p-2">
            <a href="/help" target="_blank" data-testid="help-button">
              Help
            </a>
          </li>
          <Show when={mode() !== GameMode.Setup}>
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
          </Show>
          <Show
            when={scoreboardInfo.isSome}
            fallback={
              <li class="p-2">
                <button
                  class="cursor-pointer"
                  onClick={startRemoteControlSetup}
                  data-testid="remote-button"
                >
                  Remote Control
                </button>
              </li>
            }
          >
            <li class="p-2">
              <button
                class="cursor-pointer"
                onClick={startRemoteControlSetup}
                data-testid="connect-button"
              >
                Connect Remotes
              </button>
            </li>
            <li class="p-2">
              <button
                class="cursor-pointer text-red-800"
                onClick={() => disconnectSocket()}
                data-testid="disconnect-button"
              >
                Disconnect
              </button>
            </li>
          </Show>
        </ul>
      </Menu>
    </div>
  );
}

// TODO: Tests for different menu buttons, maybe refactor menu items
