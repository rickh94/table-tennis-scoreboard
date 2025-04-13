import { createSignal, Match, Switch } from "solid-js";
import ThankYou from "./ThankYou";

enum SetupType {
  Unknown = 0,
  Scoreboard = 1,
  Remote = 2,
  Loading = 3,
}

interface RemoteControlSetupProps {
  setupAsScoreboard: Function;
}

export default function RemoteControlSetup(props: RemoteControlSetupProps) {
  const [setupType, setSetupType] = createSignal<SetupType>(SetupType.Unknown);
  return (
    <div
      class="max-w-5xl mx-auto px-4 mb-96 text-white"
      data-testid="remote-control-setup"
    >
      <header class="w-full flex flex-col justify-center text-center pt-20 gap-4">
        <h1
          class="text-5xl font-normal font-sports tracking-wider"
          data-testid="winner-text"
        >
          Setup Remote Control
        </h1>
        <p class="text-xl text-left max-w-3xl mx-auto">
          You can connect another device (phone, tablet, etc.) to use as a
          remote control. Start with the device that you want to be the
          scoreboard and follow the instructions.
        </p>
      </header>
      <div class="flex justify-center w-full text-center mt-6">
        <Switch fallback={<div>Error</div>}>
          <Match when={setupType() === SetupType.Unknown}>
            <div class="flex flex-col items-center gap-8">
              <div>
                <h3 class="flex max-w-3xl text-3xl font-bold">
                  This device is the...
                </h3>
              </div>
              <div class="flex flex-col md:flex-row gap-4 justify-center items-center">
                <button
                  class="py-2 px-6 text-2xl font-mono font-bold text-black uppercase bg-white border border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 border-t border-l selectable"
                  onClick={() => {
                    setSetupType(SetupType.Scoreboard);
                    props.setupAsScoreboard();
                  }}
                  data-testid="setup-scoreboard-button"
                >
                  Scoreboard
                </button>
                <div class="text-2xl font-bold uppercase">OR</div>
                <button
                  class="py-2 px-6 text-2xl font-mono font-bold text-black uppercase bg-white border border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 border-t border-l selectable"
                  onClick={() => setSetupType(SetupType.Remote)}
                  data-testid="setup-remote-button"
                >
                  Remote
                </button>
              </div>
            </div>
          </Match>

          <Match when={setupType() === SetupType.Scoreboard}>
            <div>Scoreboard</div>
          </Match>
          <Match when={setupType() === SetupType.Remote}>
            <div>Remote</div>
          </Match>
          <Match when={setupType() === SetupType.Loading}>
            <div>Loading</div>
          </Match>
        </Switch>
      </div>
      <div class="mt-8 text-white container max-w-2xl mx-auto">
        <ThankYou />
      </div>
    </div>
  );
}
