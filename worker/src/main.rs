use std::env;
use std::thread::sleep;
use std::time::Duration;
use postgres::{Client, NoTls};
use redis::Commands;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct DeleteJob {
    todo_id: i32,
}

fn connect_postgres(db_url: &str) -> Client {
    loop {
        println!("[Rust Worker] Connecting to PostgreSQL at {}...", db_url);
        match Client::connect(db_url, NoTls) {
            Ok(client) => {
                println!("[Rust Worker] Connected to PostgreSQL successfully.");
                return client;
            }
            Err(e) => {
                eprintln!(
                    "[Rust Worker] Failed to connect to PostgreSQL: {}. Retrying in 2 seconds...",
                    e
                );
                sleep(Duration::from_secs(2));
            }
        }
    }
}

fn connect_redis(redis_url: &str) -> redis::Connection {
    loop {
        println!("[Rust Worker] Connecting to Redis at {}...", redis_url);
        match redis::Client::open(redis_url) {
            Ok(client) => match client.get_connection() {
                Ok(conn) => {
                    println!("[Rust Worker] Connected to Redis successfully.");
                    return conn;
                }
                Err(e) => {
                    eprintln!(
                        "[Rust Worker] Failed to get Redis connection: {}. Retrying in 2 seconds...",
                        e
                    );
                    sleep(Duration::from_secs(2));
                }
            },
            Err(e) => {
                eprintln!(
                    "[Rust Worker] Failed to create Redis client: {}. Retrying in 2 seconds...",
                    e
                );
                sleep(Duration::from_secs(2));
            }
        }
    }
}

fn main() {
    println!("[Rust Worker] Starting Todo Worker...");

    let redis_url =
        env::var("REDIS_URL").unwrap_or_else(|_| "redis://redis:6379".to_string());
    let db_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://postgres:postgrespassword@db:5432/todo_db".to_string()
    });

    let mut redis_conn = connect_redis(&redis_url);
    let mut pg_client = connect_postgres(&db_url);

    println!("[Rust Worker] Ready! Listening for delete jobs on queue 'todo_delete_queue'...");

    loop {
        let pop_result: Result<(String, String), redis::RedisError> =
            redis_conn.blpop("todo_delete_queue", 0.0);

        match pop_result {
            Ok((_queue_name, payload)) => {
                println!("[Rust Worker] Received job: {}", payload);

                match serde_json::from_str::<DeleteJob>(&payload) {
                    Ok(job) => {
                        println!(
                            "[Rust Worker] Executing DELETE for todo_id: {}",
                            job.todo_id
                        );
                        match pg_client.execute(
                            "DELETE FROM todos WHERE id = $1",
                            &[&job.todo_id],
                        ) {
                            Ok(rows_affected) => {
                                println!(
                                    "[Rust Worker] Successfully deleted todo_id: {} (rows affected: {})",
                                    job.todo_id, rows_affected
                                );
                            }
                            Err(e) => {
                                eprintln!(
                                    "[Rust Worker] Database error executing DELETE for todo_id {}: {}",
                                    job.todo_id, e
                                );
                                pg_client = connect_postgres(&db_url);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[Rust Worker] Error parsing job payload '{}': {}",
                            payload, e
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "[Rust Worker] Redis error during blpop: {}. Reconnecting in 2 seconds...",
                    e
                );
                sleep(Duration::from_secs(2));
                redis_conn = connect_redis(&redis_url);
            }
        }
    }
}

