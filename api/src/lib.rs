#![warn(clippy::all, clippy::pedantic, clippy::unwrap_used)]
#![allow(
    clippy::missing_errors_doc,
    clippy::unused_async,
    clippy::missing_panics_doc
)]
use chrono::serde::ts_milliseconds;
use std::{env, iter::repeat_with, sync::Arc};

use axum::extract::ws::Message;
use compact_str::{CompactString, ToCompactString};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::broadcast::{self, Sender};
use ts_rs::TS;

pub mod router;
pub mod routes;

#[derive(Serialize, Deserialize, Clone, TS, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../www/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct Player {
    #[ts(type = "string")]
    name: CompactString,
    score: usize,
    games: usize,
}

#[derive(Serialize, Deserialize, Clone, TS, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../www/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameResult {
    player1_score: usize,
    player2_score: usize,
}

#[derive(Serialize, Deserialize, Clone, TS, Debug, Eq, PartialEq)]
#[ts(export, export_to = "../../www/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct MatchState {
    player1: Player,
    player2: Player,
    game_log: Vec<GameResult>,
    swapped: bool,
}

fn get_scoreboard_id() -> CompactString {
    repeat_with(|| fastrand::digit(10))
        .take(6)
        .collect::<CompactString>()
}

#[derive(Clone)]
pub struct Scoreboard {
    id: CompactString,
    name: CompactString,
    sender: Sender<WsMsg>,
    state: MatchState,
    updated_at: chrono::DateTime<chrono::Utc>,
}

impl Scoreboard {
    #[must_use]
    pub fn new(id: CompactString, name: CompactString, state: MatchState) -> Self {
        let (sender, _) = broadcast::channel(2);
        Self {
            id,
            name,
            sender,
            state,
            updated_at: chrono::Utc::now(),
        }
    }
}

#[derive(Clone)]
pub struct Scoreboards(Arc<DashMap<CompactString, Scoreboard>>);

impl Default for Scoreboards {
    fn default() -> Self {
        Self(Arc::new(DashMap::with_capacity(8)))
    }
}

impl Scoreboards {
    #[must_use]
    pub fn add(&self, name: &str, match_state: MatchState) -> Scoreboard {
        let mut new_id = get_scoreboard_id();
        while self.0.get(&new_id).is_some() {
            new_id = get_scoreboard_id();
        }
        let sb = Scoreboard::new(new_id.clone(), name.into(), match_state);
        self.0.insert(new_id.clone(), sb.clone());
        sb
    }

    #[must_use]
    pub fn get_name(&self, id: &str) -> Option<CompactString> {
        Some(self.0.get(id)?.value().name.clone())
    }

    #[must_use]
    pub fn get_match_state(&self, id: &str) -> Option<MatchState> {
        Some(self.0.get(id)?.value().state.clone())
    }
    #[must_use]
    pub fn get_updated_at(&self, id: &str) -> Option<chrono::DateTime<chrono::Utc>> {
        Some(self.0.get(id)?.value().updated_at)
    }

    #[must_use]
    pub fn get_sender(&self, id: &str) -> Option<Sender<WsMsg>> {
        Some(self.0.get(id)?.value().sender.clone())
    }

    #[must_use]
    pub fn update_match_state(
        &self,
        id: &str,
        next_state: MatchState,
        update_time: chrono::DateTime<chrono::Utc>,
    ) -> Option<(MatchState, chrono::DateTime<chrono::Utc>)> {
        let mut sb = self.0.get_mut(id)?;
        // ignore updates that may have come in late
        if sb.value().updated_at > update_time {
            Some((sb.value().state.clone(), sb.value().updated_at))
        } else {
            sb.value_mut().state = next_state.clone();
            sb.value_mut().updated_at = update_time;
            Some((next_state, update_time))
        }
    }

    pub fn update_name(&self, id: &str, next_name: CompactString) -> anyhow::Result<()> {
        let Some(mut sb) = self.0.get_mut(id) else {
            return Err(anyhow::anyhow!("Could not find matching scoreboard"));
        };
        sb.value_mut().name = next_name;
        Ok(())
    }

    pub fn disconnect(&self, id: &str) -> anyhow::Result<()> {
        if self
            .0
            .get(id)
            .ok_or(anyhow::anyhow!("Could not find matching scoreboard"))?
            .value()
            .sender
            .receiver_count()
            <= 1
        {
            self.0.remove(id);
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct AppState {
    pub scoreboards: Scoreboards,
    pub hostname: CompactString,
    pub https: bool,
}

#[allow(clippy::new_without_default)]
impl AppState {
    #[must_use]
    pub fn new(hostname: CompactString, https: bool) -> Self {
        Self {
            scoreboards: Scoreboards::default(),
            hostname,
            https,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, TS, Debug, PartialEq, Eq)]
#[serde(tag = "t", content = "c")]
#[ts(export, export_to = "../../www/src/bindings/")]
pub enum WsMsg {
    ErrorMessage(#[ts(type = "string")] CompactString),
    Name(#[ts(type = "string")] CompactString),
    Update {
        ms: MatchState,
        #[serde(with = "ts_milliseconds", rename = "updatedAt")]
        #[ts(type = "number")]
        updated_at: chrono::DateTime<chrono::Utc>,
    },
    GameOver(()),
    MatchOver(()),
    NewGame(()),
    NewMatch(()),
    SwitchSides(()),
}

impl From<WsMsg> for Message {
    fn from(val: WsMsg) -> Self {
        Message::Text(json!(val).to_string().into())
    }
}
