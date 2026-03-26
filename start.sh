#!/bin/bash
# PreciMap server — auto-restart on crash
# Run: bash ~/precimap/start.sh

cd ~/precimap

while true; do
  echo "$(date): Arrancando PreciMap..."
  node server.js
  echo "$(date): Servidor caído, reiniciando en 3s..."
  sleep 3
done
