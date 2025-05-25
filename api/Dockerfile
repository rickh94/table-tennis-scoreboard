FROM rust:1-slim-bookworm AS builder

RUN apt-get update && apt-get install -y libssl-dev openssl pkg-config

WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo install --path .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl-dev openssl && apt clean && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/cargo/bin/main /usr/local/bin/api

CMD ["api"]
