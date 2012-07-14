#!/bin/bash

# Stop this script if an error occurs:
set -o errexit
set -o nounset

MYDIR="$( cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$MYDIR"

rm -rf cov_lib
mkdir cov_lib
./coverage.sh ../JsonDelta.js > cov_lib/JsonDelta.js
node test.js

