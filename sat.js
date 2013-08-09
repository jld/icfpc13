// -*- Mode: javascript; indent-tabs-mode: nil; js-indent-level: 3 -*-
"use strict";
var cld = require("child_process");
var DEFAULT_SOLVER = "picosat";

function listify(x) {
   return x instanceof Array ? x : [x];
}

function Problem() {
   this.lastvar = 0;
   this.clauses = [];
}
exports.Problem = Problem;

Problem.prototype = {
   mk_true: function () {
      return Infinity;
   },
   mk_false: function () {
      return -Infinity;
   },
   mk_var: function() {
      return ++this.lastvar;
   },
   mk_vars: function(n) {
      var acc = [];
      while (n--)
         acc.push(this.mk_var());
      return acc;
   },
   clause: function(atoms) {
      var clause = [], meaningful = true;
      atoms.forEach(function (atom) {
         if (atom === Infinity)
            meaningful = false;
         else if (atom === -Infinity)
            /* skip */;
         else
            clause.push(atom);
      }, this);
      if (meaningful)
         this.clauses.push(clause);
   },
   to_dimacs: function(on_data) {
      on_data("p cnf " + this.lastvar + " " + this.clauses.length + "\n");
      this.clauses.forEach(function(clause) {
         on_data(clause.join(" ") + " 0\n");
      });
   },
   to_dimacs_str: function() {
      var s = "";
      this.to_dimacs(function(data) { s += data });
      return s;
   },
   solve: function(onSolved, /*opt*/ solver_cmd, solver_opts) {
      solver_cmd = solver_cmd || DEFAULT_SOLVER;
      var solver = cld.spawn(solver_cmd, solver_opts);
      solver.stderr.on('data', function(data) {
         data.split("\n").forEach(function(line) {
            if (line.length)
               console.log(solver_cmd + ": " + line);
         });
      });
      var satp;
      var atoms = [];
      solver.stdout.on('data', function(data) {
         data.toString().split("\n").forEach(function(line) {
            switch (line[0]) {
            case 's':
               satp = line.slice(2) == "SATISFIABLE";
               break;
            case 'v':
               line.slice(2).split(" ").map(Number).forEach(function(atom) { atoms.push(atom) });
               break;
            case undefined:
               break;
            default:
               console.log(solver_cmd + ": " + line);
            }
         });
      });
      solver.on('exit', function(code, signal) {
         if (signal) {
            console.log(solver_cmd + " exited on signal " + signal);
            onSolved(undefined);
         } else if (typeof satp !== 'boolean') {
            console.log(solver_cmd + " did not decide!");
            onSolved(undefined);
         } else if (!satp) {
            onSolved(null);
         } else if (atoms[atoms.length - 1] !== 0) {
            console.log(solver_cmd + " did not finish writing assignments!");
            onSolved(undefined);
         } else {
            atoms.pop();
            onSolved(new Solution(atoms));
         }
      });
      this.to_dimacs(function(data) { solver.stdin.write(data) });
      solver.stdin.end();
   },
   ////
   implies: function(antecedents, consequents) {
      // and(antecedents) -> or(consequents)
      antecedents = listify(antecedents);
      consequents = listify(consequents);
      this.clause(antecedents.map(function(v) { return -v }).concat(consequents));
   },
   mk_and: function(inputs) {
      var output = this.mk_var();
      this.implies(inputs, output);
      inputs.forEach(function(input) {
         this.implies(-input, -output);
      }, this);
      return output;
   },
   mk_or: function(inputs) {
      var output = this.mk_var();
      this.implies(output, inputs);
      inputs.forEach(function(input) {
         this.implies(-output, -input);
      }, this);
      return output;
   },
   pop_ge1: function(atoms) {
      this.implies([], atoms);
   },
   pop_le1: function(atoms) {
      for (var i = 0; i < atoms.length; ++i)
         for (var j = i + 1; j < atoms.length; ++j)
            this.implies([atoms[i], atoms[j]], []);
   },
   pop_eq1: function(atoms) {
      this.pop_ge1(atoms);
      this.pop_le1(atoms);
   },
   parity: function(atoms, /*opt*/ parity) {
      parity = parity ? 1 : 0;
      var n = atoms.length, nn = 1 << n;
      for (var i = 0; i < nn; ++i) {
         // This could probably be optimized.  It probably doesn't matter.
         var popcount = 0, row = [];
         for (var j = 0; j < n; ++j) {
            popcount += (i >> j) & 1;
            row.push((i >> j) & 1 ? atoms[j] : -atoms[j]);
         }
         if ((popcount & 1) != parity)
            this.implies(row, []);
      }
   },
   mk_xor: function(inputs) {
      var output = this.mk_var();
      this.parity([output].concat(inputs));
      return output;
   },
   eq_if: function(ctl, atom0, atom1) {
      this.implies([ctl, atom0], atom1);
      this.implies([ctl, atom1], atom0);
   },
   mk_mux: function(ctl, input0, input1) {
      var output = this.mk_var();
      this.eq_if(-ctl, input0, output);
      this.eq_if(ctl, input1, output);
      return output;
   },
   not_that_one: function(soln) {
      this.implies(soln.assigned, []);
   },
}


function Solution(atoms) {
   this.assigned = atoms;
   this.assignedp = [];
   atoms.forEach(function (atom) {
      this.assignedp[Math.abs(atom)] = atom > 0;
   }, this);
}

Solution.prototype = {
   get: function(index) {
      return this.assignedp[index];
   },
   mapget: function(indices) {
      return indices.map(function(index) { return this.get(index) }, this);
   },
};
