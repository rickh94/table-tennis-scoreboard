import { createSignal, Match, onMount, Switch } from "solid-js";
import ThankYou from "./ThankYou";
import type { ScoreboardInfo } from "../bindings/ScoreboardInfo";
import QRCode from "qrcode";
import { type Result, type Option, sbid, Some } from "./common";
import { createStore } from "solid-js/store";

enum SetupType {
  Unknown = 0,
  StartScoreboard = 1,
  ScoreboardReady = 2,
  StartRemote = 3,
  Loading = 4,
  SetupError = 5,
}

interface RemoteControlSetupProps {
  setupAsScoreboard: (
    name: string,
    onConnectedCallback: Option<Function>,
    failedCallback: Option<Function>,
  ) => Promise<Result<null, string>>;
  setupAsRemote: (
    code: string,
    onConnectedCallback: Option<Function>,
    failedCallback: Option<Function>,
  ) => Promise<Result<null, string>>;
  scoreboardInfo: Option<ScoreboardInfo>;
  onDone: Function;
  remote?: boolean;
}

// TODO: add more info

export default function RemoteControlSetup(props: RemoteControlSetupProps) {
  const [setupType, setSetupType] = createSignal<SetupType>(SetupType.Unknown);
  const [formError, setFormError] = createStore<Option<string>>({
    isSome: false,
  });
  let scoreboardFormRef: HTMLFormElement | undefined;
  let remoteFormRef: HTMLFormElement | undefined;

  onMount(() => {
    if (props.remote) {
      setSetupType(SetupType.StartRemote);
    } else if (props.scoreboardInfo.isSome) {
      setSetupType(SetupType.ScoreboardReady);
    }
  });

  const autoconnectEndpoint = () =>
    props.scoreboardInfo.isSome
      ? `${globalThis.location.protocol}//${globalThis.location.host}?${sbid}=${props.scoreboardInfo.v.sbId}`
      : "";

  // This is a derived property so it will not cause errors on the server
  const manualEndpoint = () =>
    `${globalThis.location.protocol}//${globalThis.location.host}/remote`;

  const startScoreboardSetup = async (ev: SubmitEvent) => {
    setFormError({ isSome: false });
    ev.preventDefault();
    if (!scoreboardFormRef) {
      // TODO: better notifs
      alert("Wrong Mode");
      return;
    }

    const data = new FormData(scoreboardFormRef);
    const name = data.get("name") as string;
    if (!name) {
      setFormError(Some("Enter a name for your scoreboard"));
      return;
    }
    const [r, v] = await props.setupAsScoreboard(
      name,
      Some(() => setSetupType(SetupType.ScoreboardReady)),
      Some(() => setSetupType(SetupType.SetupError)),
    );
    if (r === "Err") {
      setFormError(Some(v));
    }
  };

  const startRemoteSetup = async (ev: SubmitEvent) => {
    ev.preventDefault();
    setFormError({ isSome: false });
    const data = new FormData(remoteFormRef);
    const code = data.get("code") as string;
    if (!code) {
      setFormError(Some("Please enter the code for your scoreboard"));
      return;
    }
    const [r, v] = await props.setupAsRemote(
      code,
      Some(() => props.onDone()),
      Some(() => setSetupType(SetupType.StartRemote)),
    );
    if (r === "Err") {
      setFormError(Some(v));
    }
  };

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
                    setSetupType(SetupType.StartScoreboard);
                  }}
                  data-testid="setup-scoreboard-button"
                >
                  Scoreboard
                </button>
                <div class="text-2xl font-bold uppercase">OR</div>
                <button
                  class="py-2 px-6 text-2xl font-mono font-bold text-black uppercase bg-white border border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 border-t border-l selectable"
                  onClick={() => setSetupType(SetupType.StartRemote)}
                  data-testid="setup-remote-button"
                >
                  Remote
                </button>
              </div>
            </div>
          </Match>

          <Match when={setupType() === SetupType.StartScoreboard}>
            <form
              action="#"
              id="setup-form"
              class="mx-auto pt-4 max-w-3xl flex flex-col gap-y-4 min-h-screen pb-20"
              ref={scoreboardFormRef}
              onSubmit={startScoreboardSetup}
            >
              <header class="flex justify-center w-full text-center flex-col items-center">
                <h1 class="text-4xl font-normal font-sports">
                  Name your scoreboard
                </h1>
                {!!formError.isSome && (
                  <div class="bg-red-300 p-2 border-2 border-red-900 text-red-900 font-bold text-xl">
                    {formError.v}
                  </div>
                )}
              </header>
              <div class="flex w-full justify-center gap-4">
                <div class="flex flex-col">
                  <label for="name" class="font-bold text-xl tracking-wider">
                    Scoreboard Name
                  </label>
                  <div class="border-2 text-black border-transparent focus-within:border-black">
                    <input
                      required
                      type="text"
                      name="name"
                      data-testid="scoreboard-name"
                      id="name"
                      placeholder="New Scoreboard"
                      class="py-2 px-4 text-xl w-full font-mono bg-white border-2 border-black focus:outline-none"
                    />
                  </div>
                  <p class="text-lg text-white">
                    This will help you confim that you are connected correctly
                  </p>
                </div>
              </div>
              <section class="flex justify-start flex-row-reverse mx-auto gap-x-4 mt-8">
                <button
                  class="py-2 px-8 font-mono text-2xl font-bold text-black uppercase bg-green-600 border-t-0 border-l-0 border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 selectable"
                  data-testid="scoreboard-submit-button"
                  type="submit"
                >
                  Create
                </button>
                <button
                  class="py-2 px-8 font-mono text-2xl font-bold text-black uppercase bg-red-600 border-t-0 border-l-0 border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 selectable"
                  title="Reset to Defaults"
                  type="button"
                  onClick={() => setSetupType(SetupType.Unknown)}
                >
                  Cancel
                </button>
              </section>
            </form>
          </Match>
          <Match
            when={
              setupType() === SetupType.ScoreboardReady &&
              props.scoreboardInfo.isSome
            }
          >
            <div class="flex flex-col text-xl" data-testid="scoreboard-ready">
              <header class="flex flex-col items-center justify-center w-full text-center pb-4">
                <h1 class="text-3xl font-semibold pb-2">
                  Connect Another Device to{" "}
                  <span
                    class="font-normal font-sports tracking-wider"
                    data-testid="scoreboard-name"
                  >
                    {props.scoreboardInfo.isSome && props.scoreboardInfo.v.name}
                  </span>
                </h1>
                <p>Scan the QR code or follow the instructions below.</p>
              </header>
              <QRCodeDisplay
                value={autoconnectEndpoint()}
                alt="Client autoconnect qr code"
              />
              <section class="mt-4">
                <h3 class="text-2xl font-semibold pb-2">Or Connect Manually</h3>
                <p>
                  Go to{" "}
                  <strong
                    class="font-bold underline underline-offset-3"
                    data-testid="manual-endpoint"
                  >
                    {manualEndpoint()}
                  </strong>{" "}
                  and enter code
                </p>
                <div class="flex justify-center">
                  <p
                    class="text-8xl tracking-widest font-bold my-4 bg-white p-8 text-black border-black border-4 shadow"
                    data-testid="manual-code"
                  >
                    {props.scoreboardInfo.isSome && props.scoreboardInfo.v.sbId}
                  </p>
                </div>
              </section>
              <section class="mt-4">
                <button
                  class="py-4 px-12 font-mono text-3xl tracking-wide font-bold text-black uppercase bg-green-600 border-t-0 border-l-0 border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 selectable"
                  title="Exit setup menu"
                  data-testid="setup-done-button"
                  onClick={() => props.onDone()}
                >
                  Done
                </button>
              </section>
            </div>
          </Match>
          <Match when={setupType() === SetupType.StartRemote}>
            <form
              action="#"
              id="remote-form"
              class="mx-auto pt-4 max-w-3xl flex flex-col gap-y-4 min-h-screen pb-20"
              ref={remoteFormRef}
              onSubmit={startRemoteSetup}
            >
              <header
                class="flex justify-center w-full text-center flex-col items-center"
                data-testid="remote-connect-title"
              >
                <h1 class="text-4xl font-normal font-sports">
                  Connect to Scoreboard
                </h1>
              </header>
              {!!formError.isSome && (
                <div class="bg-red-300 p-2 border-2 border-red-900 text-red-900 font-bold text-xl">
                  {formError.v}
                </div>
              )}
              <div class="flex w-full justify-center gap-4">
                <div class="flex flex-col">
                  <label
                    for="name"
                    class="font-bold text-4xl tracking-wider mb-2"
                  >
                    Connect Code
                  </label>
                  <div class="flex justify-center w-full">
                    {/*class="border-2 p-8 text-black text-center tracking-widest font-bold text-3xl sm:text-8xl font-mono bg-white border-black focus:outline-none"*/}
                    <div class="flex max-w-full">
                      <input
                        required
                        type="text"
                        name="code"
                        data-testid="scoreboard-code"
                        id="code"
                        placeholder="000000"
                        size="8"
                        class="border-4 p-8 text-black bg-white text-center tracking-widest font-bold text-3xl sm:text-8xl focus:outline-none"
                      />
                    </div>
                  </div>
                  <p class="text-lg text-white">
                    Your scoreboard has a unique six-digit code. Enter it here
                    to connect.
                  </p>
                </div>
              </div>
              <section class="flex justify-start flex-row-reverse mx-auto gap-x-4 mt-8">
                <button
                  class="py-2 px-8 font-mono text-2xl font-bold text-black uppercase bg-green-600 border-t-0 border-l-0 border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 selectable"
                  data-testid="remote-submit-button"
                  type="submit"
                >
                  Connect
                </button>
                <button
                  class="py-2 px-8 font-mono text-2xl font-bold text-black uppercase bg-red-600 border-t-0 border-l-0 border-r-4 border-b-4 border-black active:border-r-0 active:border-b-0 active:border-t-4 active:border-l-4 selectable"
                  title="Reset to Defaults"
                  type="button"
                  onClick={() => setSetupType(SetupType.Unknown)}
                >
                  Cancel
                </button>
              </section>
            </form>
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
// TODO: remote ready screen

function QRCodeDisplay(props: { value: string; alt: string }) {
  const [src, setSrc] = createSignal<string | undefined>(undefined);
  onMount(async () => {
    setSrc(
      await QRCode.toDataURL(props.value, {
        errorCorrectionLevel: "H",
        width: 2000,
      }),
    );
  });
  if (!!src) {
    return (
      <>
        <img
          src={src()}
          class="max-w-full border-black border-4 shadow"
          alt={props.alt}
          data-testid="qrcode"
        />
        <span
          class="hidden"
          aria-hidden="true"
          data-testid="autoconnect-endpoint"
        >
          {props.value}
        </span>
      </>
    );
  } else {
    return null;
  }
}
