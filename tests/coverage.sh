#!/bin/bash

# Use like this:  coverage.sh myfile.js > myfile_cov.js
# ... Then you can access the exported '_$jscoverage' value and do your analysis from there.


# Stop this script if an error occurs:
set -o errexit
set -o nounset


TIMESTAMP=$(date '+%Y%m%d%H%M%S%N')
WORKDIR=".cov1_$TIMESTAMP"
COVDIR=".cov2_$TIMESTAMP"

mkdir "$WORKDIR"

cp -L $1 "$WORKDIR/file.js"
jscoverage --no-highlight "$WORKDIR" "$COVDIR"
echo 'var _$jscoverage;'   # So _$jscoverage does not leak into the global namespace.
echo
cat "$COVDIR/file.js"
echo
echo '; module.exports._$jscoverage = _$jscoverage; module.exports._module = module;'

rm -rf "$WORKDIR"
rm -rf "$COVDIR"

