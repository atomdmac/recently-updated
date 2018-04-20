#! /usr/bin/env node

var npm = require('npm');
var asyncMap = require('async.map');
var semver = require('semver');
var chalk = require('chalk');
var inspect = require('util').inspect;
var ArgumentParser = require('argparse').ArgumentParser;
var pkg = require('../package.json');

var parser = new ArgumentParser({
  version: pkg.version,
  addHelp: true,
  description: 'List recently updated npm packages. ' +
    'If no options are passed, it will look for packages updated within ' +
    'the last 24 hours. Multiple cutoff arguments can be combined by ' +
    'adding them together.'
});
parser.addArgument(
  [ '--hours' ],
  {
    help: 'time cutoff in hours',
  }
);
parser.addArgument(
  [ '-d', '--days' ],
  {
    help: 'time cutoff in days'
  }
);
parser.addArgument(
  [ '-w', '--weeks' ],
  {
    help: 'time cutoff in weeks'
  }
);
var args = parser.parseArgs();

const _WEEKS = parseInt(args['weeks']) || 0;
const _DAYS = parseInt(args['days']) || 0;
const _HOURS = parseInt(args['hours']) || 0;

var HOURS = _HOURS + 24 * (_DAYS + 7 * _WEEKS);
if (!HOURS) {
  HOURS = 24;
}

npm.load({outfd: null}, function () {
  npm.commands.ls([], true, function (er, tree) {
    var flat = flatten(tree);
    addTimes(flat, function () {
      var lastFound = null;
      for (var key in flat) {
        var dep = flat[key];
        var nameDisplayed = false;
        for (var version in dep.times) {
          var time = dep.times[version];
          if (new Date().getTime() - new Date(time).getTime() < HOURS * 3600000) {
            dep.semvers.forEach(function (s) {
              if (semver.satisfies(version, s)) {
                lastFound = dep.name;
                if (!nameDisplayed) {
                  console.log('\n' + dep.name + chalk.dim('\n\tfrom ranges [' + dep.semvers.join(', ') + ']'));
                  nameDisplayed = true;
                }
                console.log(chalk.yellow('\t' + version + '\t' + time.toLocaleString()));
              }
            });
          }
        }
      }

      if (lastFound) {
        console.log('\n--------')
        console.log('(use "npm ls ' + lastFound + '" to see what depends on that package)');
        console.log('(use "npm issues ' + lastFound + '" to view the issues for that package)');
      } else {
        console.warn('No recently updated dependencies were found');
      }
    });
  });
});

// flatten the tree and de-dupe
function flatten(tree, out, parent) {
  if (!out) out = {};

  // recursively iterate over tree
  if (tree.dependencies) {
    for (var dep in tree.dependencies) {
      out = flatten(tree.dependencies[dep], out, tree);
    }
  }

  if (tree.name) {
    // name -> details
    out[tree.name] = out[tree.name] || {
      name: tree.name,
      semvers: [],
      versions: {}
    };

    // out['babel'].versions['0.1.3'] -> { version, parent }
    out[tree.name].versions[tree.version] = {
      version: tree.version,
      parent: parent ? out[parent.name] : null
    };

    // rawSpec is the semver range that ended up pulling this package
    if (tree._requested) {
      out[tree.name].semvers.push(tree._requested.rawSpec);
    }
  }

  return out;
}

// fetch all the times a package was published
function getTimesForPackage(dep, cb) {
  npm.commands.view([dep.name, 'time'], true, function (err, data) {
    cb(null, data);
  });
}

// fetch and merge in publish times into the flattened tree
function addTimes(flat, cb) {
  var keys = Object.keys(flat);
  asyncMap(keys, function (key, mapcb) {
    const dep = flat[key];
    return getTimesForPackage(dep, function (err, res) {
      if (err || !res) {
        mapcb(null, dep);
      } else {
        const versionKeys = Object.keys(res);
        if (!versionKeys.length) {
          dep.times = {};
          mapcb(null, dep);
        } else {
          var versionMap = res[versionKeys[0]].time;
          var versions = Object.keys(versionMap);
          // Remove any instances of `created` and `modified` to prevent semver
          // from complaining.
          versions = versions.filter(function (el) {
            return el !== 'created' && el !== 'modified';
          });

          dep.times = {};
          versions.forEach(function (v) {
            dep.times[v] = new Date(versionMap[v]);
          });
          mapcb(null, dep);
        }

      }
    });
  }, function (err, results) {
    cb(flat);
  });
}
