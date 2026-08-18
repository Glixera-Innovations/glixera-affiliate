#!/bin/sh
set -eu

data_directory="${DATA_DIR:-/data}"

mkdir -p "$data_directory"
chown node:node "$data_directory"

exec su-exec node "$@"
