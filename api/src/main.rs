use std::{collections::HashSet, env, fmt::Display, iter::repeat_with, sync::Arc};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, Method},
    response::IntoResponse,
    routing::{any, get, post},
};
use compact_str::{CompactString, ToCompactString};
use dashmap::DashMap;
use serde::Serialize;
use tokio::sync::broadcast::{self, Sender};
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::{DefaultMakeSpan, TraceLayer},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use ts_rs::TS;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| format!("{}=debug", env!("CARGO_CRATE_NAME")).into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let app = create_app().layer(
        TraceLayer::new_for_http().make_span_with(DefaultMakeSpan::default().include_headers(true)),
    );

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await?;

    tracing::debug!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

fn get_scoreboard_id() -> CompactString {
    repeat_with(|| fastrand::digit(10))
        .take(6)
        .collect::<CompactString>()
}

#[derive(Clone)]
struct Scoreboards(Arc<DashMap<CompactString, Sender<CompactString>>>);

impl Default for Scoreboards {
    fn default() -> Self {
        Self(Arc::new(DashMap::with_capacity(8)))
    }
}

impl Scoreboards {
    fn create(&self) -> CompactString {
        let mut new_id = get_scoreboard_id();
        while self.0.get(&new_id).is_some() {
            new_id = get_scoreboard_id();
        }
        let (tx, _) = broadcast::channel(2);
        self.0.insert(new_id.clone(), tx);
        new_id
    }
}

#[derive(Clone)]
struct AppState {
    scoreboards: Scoreboards,
    hostname: CompactString,
}

impl AppState {
    fn new() -> Self {
        let hostname = env::var("API_HOSTNAME")
            .expect("API_HOSTNAME must be set")
            .to_compact_string();
        Self {
            scoreboards: Default::default(),
            hostname,
        }
    }
}

fn create_app() -> Router<()> {
    let allow_origins = env::var("ALLOW_ORIGINS")
        .expect("ALLOW_ORIGINS must be set")
        .split(',')
        .map(|u| u.parse().expect("ALLOW_ORIGIN contained an invalid url"))
        .collect::<Vec<HeaderValue>>();
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any)
        .allow_origin(allow_origins);

    let app_state = AppState::new();
    Router::new()
        .route("/init", get(init))
        .layer(cors)
        .with_state(app_state)
}
//.route("/ws", any(ws_handler))

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../www/src/bindings/")]
#[serde(rename_all = "camelCase")]
struct ScoreboardInfo {
    scoreboard_ws: String,
    #[ts(type = "string")]
    scoreboard_id: CompactString,
}

async fn init(State(app_state): State<AppState>) -> impl IntoResponse {
    let scoreboard_id = app_state.scoreboards.create();
    let scoreboard_ws = format!("ws://{}/ws?id={scoreboard_id}&score", app_state.hostname);
    Json(ScoreboardInfo {
        scoreboard_id,
        scoreboard_ws,
    })
}
