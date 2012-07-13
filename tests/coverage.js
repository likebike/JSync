var path = require('path'),
    fs = require('fs');

exports.get_report = function(mod) {
    if(!mod._$jscoverage) {
        console.error('Unable to find the _$jscoverage object.  This probably means that you have not created an instrumented version of your module.');
        console.error('You can create one like this:  sebweb/coverage.sh myfile.js > myfile_cov.js');
        console.error("... and then require('./myfile_cov.js').");
        throw new Error('No Coverage Data');
    }
    var stats = mod._$jscoverage['file.js'],
        output = [],
        fullCoverage = true,
        i, ii, count, isLineImportant, prefix, countStr;
    for(i=1, ii=stats.length; i<ii; i++) {
        count = stats[i] || 0;
        countStr = '' + count;
        while(countStr.length < 3) countStr = ' '+countStr;
        isLineImportant = i in stats;
        if(isLineImportant  &&  !count) fullCoverage = false;
        prefix = '    ';
        if(!count  &&  isLineImportant) prefix = '>>>>';
        output[output.length] = prefix + ' ' + countStr + ' ' + stats.source[i-1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') + '\n';
    }
    return {output:output,
            fullCoverage:fullCoverage};
}
exports.save_report = function(mod) {
    var output = exports.get_report(mod).output;  // I run the 'get_report' function before anything else because it does error checking on the module and prints out some helpful info if it has not been instrumented for code coverage.
    var reportPath = mod._module.filename + '.cov';
    fs.writeFile(reportPath, output.join(''));
};
