#!/bin/bash

# Stop this script if an error occurs:
set -o errexit
set -o nounset

MYDIR="$( cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$MYDIR"

rm -rf cov_lib
mkdir cov_lib
echo Instrumenting JDelta.js...
./coverage.sh ../JDelta.js > cov_lib/JDelta.js
echo Instrumenting JDeltaDB.js...
./coverage.sh ../JDeltaDB.js > cov_lib/JDeltaDB.js
echo Instrumenting JDeltaSync.js...
./coverage.sh ../JDeltaSync.js > cov_lib/JDeltaSync.js
echo Running test.js...
node test.js

