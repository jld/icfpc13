'use strict';
var http = require("http");
var fs = require("fs");

var the_host = "icfpc2013.cloudapp.net";
var delay = 4100;
var chicken = "vpsH1H";
var secret;
try {
   secret = fs.readFileSync("private/secret").toString().match(/.*/)[0];
} catch (exn) {
   console.warn("WARNING: No secret; unable to make requests.");
}

var problems;
try {
   problems = JSON.parse(fs.readFileSync("private/myproblems.json"));
} catch (exn) {
   problems = []
}
exports.get_problems = function() { return problems };

var nextreq = 0;
function post(endpoint, json, callback, this_arg, immed) {
   var now = Date.now();
   if (!immed && nextreq > now) {
      setTimeout(post, nextreq - now, endpoint, json, callback, this_arg, true);
      nextreq += delay;
      return;
   }
   nextreq = Math.max(nextreq, now + delay);
   var data = json ? JSON.stringify(json) : "";
   var spec = {
      hostname: the_host,
      path: endpoint + "?auth=" + secret + chicken,
      method: 'POST'
   };
   var req = http.request(spec, function(res) {
      var acc = "";
      res.setEncoding('utf8');
      res.on('data', function(chunk) { acc += chunk });
      res.on('end', function() {
	 if (res.statusCode != 200) {
	    console.log(endpoint + ": HTTP ERROR " + res.statusCode + ": " + acc);
	    if (res.statusCode == 429)
	       post(endpoint, json, callback, this_arg);
	    else
	       callback.call(this_arg, null);
	    return;
	 }
	 callback.call(this_arg, JSON.parse(acc))
      });
   });
   req.on('error', function (e) {
      console.log("Failed to call " + endpoint + ": " + e.message);
   });
   req.write(data);
   req.end();
}
exports.post = post;
exports.get_nextreq = function() { return nextreq };

function sync() {
   post("/myproblems", null, function(p) {
      problems = p;
      fs.writeFileSync("private/myproblems.json",
		       JSON.stringify(problems).replace(/},/g, "},\n"));
   });
}
exports.sync = sync;

function stat() {
   post("/status", null, function(st) { console.log(st) });
}
exports.stat = stat;

function solve(xs, robot, prob, scallback) {
   var id = prob.id;
   post("/eval", {id: id, arguments: xs}, function (s) {
      s = s || {};
      if (s.status != "ok") {
	 console.log(id + ": FAILURE: /eval: " + s.message);
	 scallback(false);
	 return;
      }
      var outs = s.outputs;
      for (var i = 0; i < xs.length; ++i)
	 console.log(id + ": " + xs[i] + " -> " + outs[i]);
      function attempt() {
	 robot(prob, xs, outs, function (soln) {
	    if (!soln) {
	       console.log(id + ": no solution; ABANDONING PROBLEM, DANGER, BEES, etc.");
	       scallback(false);
	       return;
	    }
	    console.log(id + ": trying " + soln);
	    post("/guess", {id: id, program: soln}, function(s) {
	       s = s || {};
	       if (s.status == "win") {
		  console.log(id + ": Yay!  We won!");
		  if (scallback)
		     scallback(true);
	       } else if (s.status == "mismatch") {
		  var new_x = s.values[0], new_out = s.values[1], wrong = s.values[2];
		  console.log(id + ": " + new_x + " -> " + new_out + " (not " + wrong + ")");
		  xs.push(new_x);
		  outs.push(new_out);
		  attempt();
	       } else {
		  console.log(id + ": FAILURE: /guess: " + s.message);
		  scallback(false);
	       }
	    });
	 });
      }
      attempt();
   });
}
exports.solve = solve;
