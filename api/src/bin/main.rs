use std::env;

use api::router::create_app;
use compact_str::ToCompactString;
use tower_http::trace::{DefaultMakeSpan, TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| format!("{}=debug", env!("CARGO_CRATE_NAME")).into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let hostname = env::var("API_HOSTNAME")
        .expect("API_HOSTNAME must be set")
        .to_compact_string();
    let https = env::var("HTTPS") == Ok("true".to_string());

    let allow_origins = env::var("ALLOW_ORIGINS").expect("ALLOW_ORIGINS must be set");

    let app = create_app(hostname, https, allow_origins).layer(
        TraceLayer::new_for_http().make_span_with(DefaultMakeSpan::default().include_headers(true)),
    );

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await?;

    tracing::debug!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}
