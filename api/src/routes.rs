use axum::{
    Json,
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::IntoResponse,
};
use compact_str::CompactString;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{AppState, MatchState, WsMsg};

macro_rules! some_or_disconnect {
    ($get:expr, $ws:expr) => {
        some_or_disconnect!($get, $ws, "This Scoreboard does not exist. Disconnecting")
    };
    ($get:expr, $ws:expr, $e:expr) => {{
        use crate::WsMsg;
        use axum::extract::ws::Message;
        use compact_str::ToCompactString;

        if let Some(v) = $get {
            v
        } else {
            let _ = $ws
                .send(WsMsg::ErrorMessage($e.to_compact_string()).into())
                .await;
            let _ = $ws.send(Message::Close(None)).await;
            return;
        }
    }};
}

macro_rules! dis {
    ($send: expr) => {
        if let Err(e) = $send {
            tracing::debug!("client disconnected abruptly: {e}");
            return;
        }
    };
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../www/src/bindings/")]
#[serde(rename_all = "camelCase")]
struct ScoreboardInfo {
    sb_ws: String,
    #[ts(type = "string")]
    sb_id: CompactString,
    #[ts(type = "string")]
    name: CompactString,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreboardSetupInfo {
    name: CompactString,
    match_state: MatchState,
}

pub async fn init(
    State(app_state): State<AppState>,
    Json(payload): Json<ScoreboardSetupInfo>,
) -> impl IntoResponse {
    let sb = app_state
        .scoreboards
        .add(&payload.name, payload.match_state);
    let prefix = if app_state.https { "wss" } else { "ws" };
    let sb_ws = format!("{prefix}://{}/ws?id={}", app_state.hostname, sb.id);
    Json(ScoreboardInfo {
        sb_id: sb.id,
        sb_ws,
        name: sb.name,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectInfo {
    code: CompactString,
}

pub async fn connect(
    State(app_state): State<AppState>,
    Json(payload): Json<RemoteConnectInfo>,
) -> impl IntoResponse {
    if let Some(name) = app_state.scoreboards.get_name(&payload.code) {
        let prefix = if app_state.https { "wss" } else { "ws" };
        let sb_ws = format!("{prefix}://{}/ws?id={}", app_state.hostname, &payload.code);
        Json(ScoreboardInfo {
            sb_id: payload.code,
            sb_ws,
            name,
        })
        .into_response()
    } else {
        (
            StatusCode::BAD_REQUEST,
            "Could not find matching scoreboard, double check your code",
        )
            .into_response()
    }
}

#[derive(Deserialize)]
pub struct WsQuery {
    id: CompactString,
}

pub async fn ws_handler(
    wsu: WebSocketUpgrade,
    q: Query<WsQuery>,
    State(app_state): State<AppState>,
) -> impl IntoResponse {
    wsu.on_upgrade(move |socket| handle_socket(socket, q.id.clone(), app_state))
}

async fn handle_socket(mut ws: WebSocket, sb_id: CompactString, app_state: AppState) {
    let name = some_or_disconnect!(app_state.scoreboards.get_name(&sb_id), ws);
    let ms = some_or_disconnect!(app_state.scoreboards.get_match_state(&sb_id), ws);
    let updated_at = some_or_disconnect!(app_state.scoreboards.get_updated_at(&sb_id), ws);
    let sender = some_or_disconnect!(app_state.scoreboards.get_sender(&sb_id), ws);
    let mut receiver = sender.subscribe();

    dis!(ws.send(WsMsg::Name(name.clone()).into()).await);
    dis!(ws.send(WsMsg::Update { ms, updated_at }.into()).await);
    loop {
        tokio::select! {
            res = ws.recv() => {
                match read_res(res) {
                    Action::Name(n) => {
                        dis!(app_state.scoreboards.update_name(&sb_id, n.clone()));
                        let _ = sender.send(WsMsg::Name(n));
                    },
                    Action::Update((match_state, update_time)) => {
                        let (ms, updated_at) = some_or_disconnect!(app_state.scoreboards.update_match_state(&sb_id, match_state, update_time), ws);
                        let _ = sender.send(WsMsg::Update{ ms, updated_at});
                    }
                    Action::Noop => {},
                    Action::Error(e) => {
                        tracing::debug!("Webserver Error: {e}");
                    }
                    Action::Close => {
                        break
                    }
                    Action::Forward(msg) => {
                        let _ = sender.send(msg);
                    },
                }

            }

        res = receiver.recv() => {
            tracing::debug!("received {res:?}");
            match res {
                Ok(msg) => dis!(ws.send(msg.into()).await),
                Err(_) => continue,
            }
        }
        }
    }
    if let Err(e) = app_state.scoreboards.disconnect(&sb_id) {
        tracing::debug!("Error removing scoreboard: {e}");
    }
}

enum Action {
    Name(CompactString),
    Update((MatchState, chrono::DateTime<chrono::Utc>)),
    Noop,
    Error(CompactString),
    Close,
    Forward(WsMsg),
}

fn read_res(res: Option<Result<Message, axum::Error>>) -> Action {
    match res {
        Some(Ok(Message::Text(s))) => match serde_json::from_str::<WsMsg>(s.as_str()) {
            Ok(WsMsg::ErrorMessage(e)) => Action::Error(e),
            Ok(WsMsg::Name(n)) => Action::Name(n),
            Ok(WsMsg::Update { ms, updated_at }) => Action::Update((ms, updated_at)),
            Ok(msg) => Action::Forward(msg),
            Err(_) => Action::Error("Invalid message".into()),
        },
        Some(Ok(s)) => {
            tracing::debug!("got non text message {s:?}");
            Action::Noop
        }
        Some(Err(e)) => {
            tracing::debug!("Client disconnected abruptly: {e}");
            Action::Close
        }
        None => Action::Close,
    }
}
