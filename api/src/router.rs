use axum::{
    Router,
    http::{HeaderValue, Method},
    routing::{any, get, post},
};
use compact_str::CompactString;
use tower_http::cors::{Any, CorsLayer};

use crate::{AppState, routes};

pub fn create_app(hostname: CompactString, https: bool, allow_origins: String) -> Router {
    let allow_origins = allow_origins
        .split(',')
        .map(|u| u.parse().expect("ALLOW_ORIGIN contained an invalid url"))
        .collect::<Vec<HeaderValue>>();
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any)
        .allow_origin(allow_origins);

    let app_state = AppState::new(hostname, https);
    Router::new()
        .route("/", get(|| async { "Table Tennis Scoreboard API" }))
        .route("/init", post(routes::init))
        .route("/connect", post(routes::connect))
        .route("/ws", any(routes::ws_handler))
        .layer(cors)
        .with_state(app_state)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use std::env;
    use std::net::{Ipv4Addr, SocketAddr};

    use axum::{
        body::Body,
        http::{self, Request, StatusCode},
    };
    use compact_str::ToCompactString;
    use futures::{SinkExt, StreamExt};
    use http_body_util::BodyExt;
    use regex::Regex;
    use serde_json::{Value, json};
    use tokio_tungstenite::tungstenite;
    use tower::{Service, ServiceExt};

    use crate::{GameResult, MatchState, Player, WsMsg};

    use super::*;

    macro_rules! default_match_state {
        () => {
            MatchState {
                player1: Player {
                    name: "Player 1".into(),
                    score: 0,
                    games: 0,
                },
                player2: Player {
                    name: "Player 2".into(),
                    score: 0,
                    games: 0,
                },
                game_log: vec![],
                swapped: false,
            }
        };
    }

    macro_rules! connect_socket {
        ($u:expr) => {{
            let (socket, _response) = tokio_tungstenite::connect_async($u.clone()).await.unwrap();
            socket
        }};
    }

    macro_rules! prepare_socket {
        ($s:ident, $n:ident, $ms:ident) => {{
            let p_msg = next_wsmsg!($s);
            let WsMsg::Name(p_name) = p_msg else {
                panic!("incorrect first message from socket1");
            };
            assert_eq!(p_name, $n);

            let p_msg = next_wsmsg!($s);
            let WsMsg::Update {
                ms: p_ms,
                updated_at: _,
            } = p_msg
            else {
                panic!("incorrect second message from socket1");
            };
            assert_eq!(p_ms, $ms);
            $s
        }};
    }

    macro_rules! connect_and_prepare {
        ($u:expr, $n:ident, $ms:ident) => {{
            let mut cap_socket = connect_socket!($u);
            prepare_socket!(cap_socket, $n, $ms)
        }};
    }

    macro_rules! setup_scoreboard {
        ($n:literal, $ms:ident) => {{
            let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)))
                .await
                .unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(axum::serve(listener, create_app("localhost".to_compact_string(), false, "http://localhost:4321,http://127.0.0.1:4321".to_string())).into_future());

            let client =
                hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
                    .build_http();

            let init_uri = format!("http://{addr}/init");
            let req = json_request(&init_uri, &json!({ "name": $n, "matchState": $ms }));
            let resp = client.request(req).await.unwrap();

            assert_eq!(resp.status(), StatusCode::OK);
            let body = resp.into_body().collect().await.unwrap().to_bytes();
            let body: Value = serde_json::from_slice(&body).unwrap();

            let sb_id = body.get("sbId").unwrap().as_str().unwrap();
            let sb_ws = format!("ws://{addr}/ws?id={sb_id}");
            let socket = connect_socket!(sb_ws);
            //let (mut socket, _response) = tokio_tungstenite::connect_async(sb_ws.clone()).await.unwrap();
            ($n, client, socket, sb_ws)
        }}
    }

    macro_rules! next_wsmsg {
        ($s:ident) => {{
            let tmp = match $s.next().await.unwrap().unwrap() {
                tungstenite::Message::Text(s) => s,
                other => panic!("expected text message but got {other:?}"),
            };

            serde_json::from_str(&tmp[..]).unwrap()
        }};
    }

    macro_rules! send_wsmsg {
        ($v:expr) => {
            tungstenite::Message::Text(serde_json::to_string(&json!($v)).unwrap().into())
        };
    }

    fn json_request(uri: &str, json: &Value) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .method(http::Method::POST)
            .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
            .body(Body::from(serde_json::to_vec(&json).unwrap()))
            .unwrap()
    }

    #[tokio::test]
    async fn root() {
        let app = create_app(
            "localhost".to_compact_string(),
            false,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        );

        let resp = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();

        assert_eq!(&body[..], b"Table Tennis Scoreboard API");
    }

    #[tokio::test]
    async fn init() {
        let hostname = env::var("API_HOSTNAME").unwrap().to_compact_string();
        let app = create_app(
            hostname.clone(),
            false,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        );
        let name = "testname";

        let req = json_request(
            "/init",
            &json!({ "name": name, "matchState": default_match_state!() }),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert!(body.is_object());
        assert_eq!(*body.get("name").unwrap(), json!(name));

        let r = Regex::new(r"\d{6}").unwrap();
        assert!(body.get("sbId").is_some());

        let sb_id = body.get("sbId").unwrap().as_str().unwrap();
        assert!(r.is_match(sb_id));

        assert!(body.get("sbWs").is_some());
        assert_eq!(
            body.get("sbWs").unwrap().as_str().unwrap(),
            &format!("ws://{hostname}/ws?id={sb_id}")
        );
    }

    #[tokio::test]
    async fn init_secure() {
        let hostname = env::var("API_HOSTNAME").unwrap().to_compact_string();
        let app = create_app(
            hostname.clone(),
            true,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        );
        let name = "testname";

        let req = json_request(
            "/init",
            &json!({ "name": name, "matchState": default_match_state!() }),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert!(body.is_object());
        assert_eq!(*body.get("name").unwrap(), json!(name));

        let r = Regex::new(r"\d{6}").unwrap();
        assert!(body.get("sbId").is_some());

        let sb_id = body.get("sbId").unwrap().as_str().unwrap();
        assert!(r.is_match(sb_id));

        assert!(body.get("sbWs").is_some());
        let hostname = env::var("API_HOSTNAME").unwrap();
        assert_eq!(
            body.get("sbWs").unwrap().as_str().unwrap(),
            &format!("wss://{hostname}/ws?id={sb_id}")
        );
    }

    #[tokio::test]
    async fn connect_to_existing_scoreboard() {
        let hostname = env::var("API_HOSTNAME").unwrap().to_compact_string();
        let mut app = create_app(
            hostname.clone(),
            false,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        )
        .into_service();
        let name = "scoreboard";

        let init_req = json_request(
            "/init",
            &json!({ "name": name, "matchState": default_match_state!() }),
        );
        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(init_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        let sb_id = body.get("sbId").unwrap().as_str().unwrap();

        let connect_req = json_request("/connect", &json!({"code": sb_id}));

        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(connect_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.get("sbId").unwrap().as_str().unwrap(), sb_id);
        assert_eq!(body.get("name").unwrap().as_str().unwrap(), name);
        assert_eq!(
            body.get("sbWs").unwrap().as_str().unwrap(),
            &format!("ws://{hostname}/ws?id={sb_id}")
        );
    }

    #[tokio::test]
    async fn connect_to_existing_scoreboard_secure() {
        let hostname = env::var("API_HOSTNAME").unwrap().to_compact_string();
        let mut app = create_app(
            hostname.clone(),
            true,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        )
        .into_service();
        let name = "scoreboard";

        let init_req = json_request(
            "/init",
            &json!({ "name": name, "matchState": default_match_state!() }),
        );
        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(init_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        let sb_id = body.get("sbId").unwrap().as_str().unwrap();

        let connect_req = json_request("/connect", &json!({"code": sb_id}));

        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(connect_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.get("sbId").unwrap().as_str().unwrap(), sb_id);
        assert_eq!(body.get("name").unwrap().as_str().unwrap(), name);
        assert_eq!(
            body.get("sbWs").unwrap().as_str().unwrap(),
            &format!("wss://{hostname}/ws?id={sb_id}")
        );
    }

    #[tokio::test]
    async fn cannot_connect_without_scoreboard() {
        let mut app = create_app(
            "localhost".to_compact_string(),
            false,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        )
        .into_service();

        let connect_req = json_request("/connect", &json!({"code": "123123"}));

        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(connect_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            &body[..],
            b"Could not find matching scoreboard, double check your code"
        );
    }

    #[tokio::test]
    async fn cannot_connect_with_invalid_code() {
        let mut app = create_app(
            "localhost".to_compact_string(),
            false,
            "http://localhost:4321,http://127.0.0.1:4321".to_string(),
        )
        .into_service();
        let name = "scoreboard";

        let init_req = json_request(
            "/init",
            &json!({ "name": name, "matchState": default_match_state!() }),
        );
        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(init_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();
        let mut sb_id = body.get("sbId").unwrap().as_str().unwrap().to_string();
        sb_id.pop();
        sb_id.push('A');

        let connect_req = json_request("/connect", &json!({"code": sb_id}));

        let resp = ServiceExt::<Request<Body>>::ready(&mut app)
            .await
            .unwrap()
            .call(connect_req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            &body[..],
            b"Could not find matching scoreboard, double check your code"
        );
    }

    #[tokio::test]
    async fn init_and_ws() {
        let name = "init_and_ws";
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(
            axum::serve(
                listener,
                create_app(
                    "localhost".to_compact_string(),
                    false,
                    "http://localhost:4321,http://127.0.0.1:4321".to_string(),
                ),
            )
            .into_future(),
        );

        let client =
            hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
                .build_http();

        let init_uri = format!("http://{addr}/init");
        let req = json_request(
            &init_uri,
            &json!({ "name": name, "matchState": default_match_state!() }),
        );
        let resp = client.request(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&body).unwrap();

        let sb_id = body.get("sbId").unwrap().as_str().unwrap();
        let sb_ws = format!("ws://{addr}/ws?id={sb_id}");
        let (mut socket, _response) = tokio_tungstenite::connect_async(sb_ws).await.unwrap();

        // first message should be the name of the scoreboard
        let msg = match socket.next().await.unwrap().unwrap() {
            tungstenite::Message::Text(s) => s,
            other => panic!("expected text message but got {other:?}"),
        };
        let d: Value = serde_json::from_str(&msg[..]).unwrap();
        assert_eq!(d.get("t").unwrap(), "Name");
        assert_eq!(d.get("c").unwrap(), name);

        // next message should be match state
        let msg = match socket.next().await.unwrap().unwrap() {
            tungstenite::Message::Text(s) => s,
            other => panic!("expected text message but got {other:?}"),
        };

        let d: WsMsg = serde_json::from_str(&msg[..]).unwrap();

        let WsMsg::Update { ms, updated_at } = d else {
            panic!("incorrect second message from websocket");
        };

        assert_eq!(
            ms,
            MatchState {
                player1: Player {
                    name: "Player 1".into(),
                    score: 0,
                    games: 0,
                },
                player2: Player {
                    name: "Player 2".into(),
                    score: 0,
                    games: 0,
                },
                game_log: vec![],
                swapped: false
            }
        );

        assert!(updated_at < chrono::Utc::now());
    }

    #[tokio::test]
    async fn disconnects_on_invalid_id() {
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(
            axum::serve(
                listener,
                create_app(
                    "localhost".to_compact_string(),
                    false,
                    "http://localhost:4321,http://127.0.0.1:4321".to_string(),
                ),
            )
            .into_future(),
        );

        let sb_ws = format!("ws://{addr}/ws?id=121212");
        let (mut socket, _response) = tokio_tungstenite::connect_async(sb_ws).await.unwrap();

        // first message should be the name of the scoreboard
        let msg = match socket.next().await.unwrap().unwrap() {
            tungstenite::Message::Text(s) => s,
            other => panic!("expected text message but got {other:?}"),
        };
        let m: Value = serde_json::from_str(&msg[..]).unwrap();
        assert_eq!(m.get("t").unwrap().as_str().unwrap(), "ErrorMessage");
        assert_eq!(
            m.get("c").unwrap().as_str().unwrap(),
            "This Scoreboard does not exist. Disconnecting"
        );

        if let Ok(tungstenite::Message::Close(_)) = socket.next().await.unwrap() {
        } else {
            panic!("Next message should be a close message");
        }
    }

    #[tokio::test]
    async fn ws_sends_correct_match_state() {
        let name = "sb_diff_ms";

        let init_ms = MatchState {
            player1: Player {
                name: "Changed Player 1".into(),
                score: 5,
                games: 2,
            },
            player2: Player {
                name: "Changed Player 2".into(),
                score: 3,
                games: 1,
            },
            game_log: vec![
                GameResult {
                    player1_score: 11,
                    player2_score: 8,
                },
                GameResult {
                    player1_score: 11,
                    player2_score: 6,
                },
                GameResult {
                    player1_score: 10,
                    player2_score: 12,
                },
            ],
            swapped: true,
        };

        let (_name, _http_client, mut socket, _sb_ws) = setup_scoreboard!("sb_diff_ms", init_ms);

        // first message should be the name of the scoreboard
        let msg = match socket.next().await.unwrap().unwrap() {
            tungstenite::Message::Text(s) => s,
            other => panic!("expected text message but got {other:?}"),
        };
        let d: Value = serde_json::from_str(&msg[..]).unwrap();
        assert_eq!(d.get("t").unwrap(), "Name");
        assert_eq!(d.get("c").unwrap(), name);

        // next message should be match state
        let msg = match socket.next().await.unwrap().unwrap() {
            tungstenite::Message::Text(s) => s,
            other => panic!("expected text message but got {other:?}"),
        };

        let d: WsMsg = serde_json::from_str(&msg[..]).unwrap();

        let WsMsg::Update { ms, updated_at } = d else {
            panic!("incorrect second message from websocket");
        };

        assert_eq!(ms, init_ms);

        assert!(updated_at < chrono::Utc::now());
    }

    #[tokio::test]
    async fn update_sends_ms_to_multiple_clients() {
        let init_ms = MatchState {
            player1: Player {
                name: "Changed Player 1".into(),
                score: 5,
                games: 2,
            },
            player2: Player {
                name: "Changed Player 2".into(),
                score: 3,
                games: 1,
            },
            game_log: vec![
                GameResult {
                    player1_score: 11,
                    player2_score: 8,
                },
                GameResult {
                    player1_score: 11,
                    player2_score: 6,
                },
                GameResult {
                    player1_score: 10,
                    player2_score: 12,
                },
            ],
            swapped: true,
        };
        let (name, _http_client, mut socket1, sb_ws) =
            setup_scoreboard!("update_scoreboard", init_ms);

        let mut socket2 = connect_socket!(sb_ws);

        // msg received by socket 1 -> name, initial match state

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::Name(n) = msg1 else {
            panic!("incorrect first message from socket1");
        };
        assert_eq!(n, name);

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::Update { ms, updated_at } = msg1 else {
            panic!("incorrect second message from socket1");
        };
        assert_eq!(ms, init_ms);

        assert!(updated_at < chrono::Utc::now());
        let init_update_time = updated_at;

        // msg received by socket 2 -> name, initial match state

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::Name(n) = msg2 else {
            panic!("incorrect first message from socket2");
        };
        assert_eq!(n, name);

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::Update { ms, updated_at } = msg2 else {
            panic!("incorrect second message from socket2");
        };
        assert_eq!(ms, init_ms);

        assert_eq!(init_update_time, updated_at);

        let mut new_ms = init_ms.clone();
        new_ms.player1.score += 1;

        // socket1 update gets sent to both sockets
        socket1
            .send(send_wsmsg!(WsMsg::Update {
                ms: new_ms.clone(),
                updated_at: chrono::Utc::now(),
            }))
            .await
            .unwrap();

        // check socket1 msg
        let msg1 = next_wsmsg!(socket1);
        let WsMsg::Update { ms, updated_at: _ } = msg1 else {
            panic!("incorrect update message from socket1");
        };
        assert_ne!(ms, init_ms);
        assert_eq!(ms, new_ms);

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::Update { ms, updated_at } = msg2 else {
            panic!("incorrect update message from socket2");
        };
        assert_ne!(ms, init_ms);
        assert_eq!(ms, new_ms);

        assert!(updated_at > init_update_time);

        // socket2 update gets sent to socket1
        new_ms.player2.score += 1;
        socket2
            .send(send_wsmsg!(WsMsg::Update {
                ms: new_ms.clone(),
                updated_at: chrono::Utc::now(),
            }))
            .await
            .unwrap();

        // check socket1 msg
        let msg1 = next_wsmsg!(socket1);
        let WsMsg::Update { ms, updated_at: _ } = msg1 else {
            panic!("incorrect update message from socket1");
        };
        assert_ne!(ms, init_ms);
        assert_eq!(ms, new_ms);

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::Update { ms, updated_at } = msg2 else {
            panic!("incorrect update message from socket2");
        };
        assert_ne!(ms, init_ms);
        assert_eq!(ms, new_ms);

        assert!(updated_at > init_update_time);
    }

    #[tokio::test]
    async fn other_messages_are_forwarded() {
        let init_ms = default_match_state!();
        let (name, _http_client, mut socket1, sb_ws) =
            setup_scoreboard!("update_scoreboard", init_ms);
        socket1 = prepare_socket!(socket1, name, init_ms);

        let mut socket2 = connect_and_prepare!(sb_ws, name, init_ms);

        socket1
            .send(send_wsmsg!(WsMsg::GameOver(())))
            .await
            .unwrap();

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::GameOver(()) = msg1 else {
            panic!("incorrect socket1 did not receive gameover message");
        };

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::GameOver(()) = msg2 else {
            panic!("incorrect socket2 did not receive gameover message");
        };

        socket2
            .send(send_wsmsg!(WsMsg::MatchOver(())))
            .await
            .unwrap();

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::MatchOver(()) = msg1 else {
            panic!("incorrect socket1 did not receive matchover message");
        };

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::MatchOver(()) = msg2 else {
            panic!("incorrect socket2 did not receive matchover message");
        };

        socket1.send(send_wsmsg!(WsMsg::NewGame(()))).await.unwrap();

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::NewGame(()) = msg1 else {
            panic!("incorrect socket1 did not receive newgame message");
        };

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::NewGame(()) = msg2 else {
            panic!("incorrect socket2 did not receive newgame message");
        };

        socket2
            .send(send_wsmsg!(WsMsg::NewMatch(())))
            .await
            .unwrap();

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::NewMatch(()) = msg1 else {
            panic!("incorrect socket1 did not receive newmatch message");
        };

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::NewMatch(()) = msg2 else {
            panic!("incorrect socket2 did not receive newmatch message");
        };

        socket1
            .send(send_wsmsg!(WsMsg::SwitchSides(())))
            .await
            .unwrap();

        let msg1 = next_wsmsg!(socket1);
        let WsMsg::SwitchSides(()) = msg1 else {
            panic!("incorrect socket1 did not receive switchsides message");
        };

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::SwitchSides(()) = msg2 else {
            panic!("incorrect socket2 did not receive switchsides message");
        };
    }

    #[tokio::test]
    async fn can_change_scoreboard_name() {
        let init_ms = default_match_state!();
        let (name, _http_client, mut socket1, sb_ws) =
            setup_scoreboard!("rename_scoreboard", init_ms);
        socket1 = prepare_socket!(socket1, name, init_ms);
        let new_name = "New Name";

        socket1
            .send(send_wsmsg!(WsMsg::Name(new_name.into())))
            .await
            .unwrap();

        // name message is echoed back
        let msg1 = next_wsmsg!(socket1);
        let WsMsg::Name(n1) = msg1 else {
            panic!("incorrect socket1 did not receive gameover message");
        };
        assert_eq!(&n1, new_name);

        let mut socket2 = connect_socket!(sb_ws);

        let msg2 = next_wsmsg!(socket2);
        let WsMsg::Name(n2) = msg2 else {
            panic!("incorrect socket2 did not receive gameover message");
        };
        assert_eq!(&n2, new_name);
        assert_ne!(&n2, name);
    }
}
