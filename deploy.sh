#!/bin/bash

set -e

cd /home/ubuntu/anish-todo

echo "Starting Docker Compose deployment..."

docker compose up --build -d

echo "Deployment completed."
