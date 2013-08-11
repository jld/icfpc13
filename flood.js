'use strict';
var cld = require("child_process");
var fs = require("fs");
var cont = require("./contest");

function robot(prob, xs, outs, callback) {
   var args = [prob.size - 1 + "",
	       prob.operators.join(","),
	       xs.join(","),
	       outs.join(",")]
   // Note to self: ditch the stderr when parallelizing.
   var fl = cld.spawn("./flood", args);
   fl.stderr.on('data', function(data) { process.stderr.write(data) });
   var acc = "";
   fl.stdout.on('data', function(data) { acc += data.toString() });
   fl.on('exit', function(code, signal) {
      if (signal) {
	 console.log("flood: fatal signal " + signal);
	 callback(null)
      } else if (code) {
	 console.log("flood: exit status " + code);
	 callback(null)
      } else
	 callback(acc.match(/.*/)[0]);
   });
}
exports.robot = robot;

// This doesn't really belong here, but whatever.
function randxs(n) {
   var xs = Array(n);
   var fd = fs.openSync("/dev/urandom", "r");
   var b = Buffer(n * 8);
   var off = 0;
   while (off < b.length)
      off += fs.readSync(fd, b, off, b.length - off);
   fs.closeSync(fd);
   for (var i = 0; i < n; ++i) {
      xs[i] = "";
      for (var j = 0; j < 8; ++j) {
	 var b8 = b.readUInt8(i * 8 + j);
	 xs[i] += (b8 & 15).toString(16);
	 xs[i] += (b8 >> 4).toString(16);
	 // It's random, so the order doesn't matter.
      }
   }
   return xs;
}
exports.randxs = randxs;


var usual = ["0000000000000000", "ffffffffffffffff"];
exports.set_usual = function(uu) { usual = uu; }
var nrand = 14;
exports.set_nrand = function(nn) { nrand = nn; }
function solve(prob) {
   cont.solve(usual.concat(randxs(nrand)), robot, prob);
}
exports.solve = solve;
